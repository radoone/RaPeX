import type {
  MatchResult,
  SafetyCheckResult,
  ProductInput,
} from "./safety-gate-checker.schemas.js";
import type {
  AnalysisMatchCandidate,
  NormalizedAlert,
  SafetyCheckAnalysis,
} from "./safety-gate-checker.types.js";

type AnalysisResponseShape = {
  output?: unknown;
  text: string;
};

const IMAGE_FIRST_VISUAL_WEIGHT = 0.78;
const IMAGE_FIRST_TEXT_WEIGHT = 0.22;
const TEXT_ONLY_VISUAL_WEIGHT = 0;
const TEXT_ONLY_TEXT_WEIGHT = 1;
const MIN_OVERALL_MATCH_SCORE = 45;

function describeAlertSource(alert: NormalizedAlert): string {
  const distanceLabel =
    typeof alert.distance === "number" ? ` (distance: ${alert.distance.toFixed(4)})` : "";

  return alert.source === "retriever"
    ? `Source: vector retriever${distanceLabel}`
    : "Source: recent time-filtered scan";
}

export function buildComparisonPrompt(product: ProductInput, alerts: NormalizedAlert[]): string {
  const alertsText = alerts
    .map(
      (alert) => `Alert ID: ${alert.id}
Product: ${alert.fields.product_description}
Category: ${alert.fields.product_category}
Brand: ${alert.fields.product_brand || "Unknown"}
Risk Level: ${alert.fields.risk_level}
Country: ${alert.fields.notifying_country}
${describeAlertSource(alert)}`,
    )
    .join("\n\n");

  return `NEW PRODUCT TO CHECK:
Name: ${product.name}
Category: ${product.category}
Description: ${product.description}
Brand: ${product.brand || "Not specified"}
Model: ${product.model || "Not specified"}

RECENT SAFETY GATE ALERTS (last 12 months):
${alertsText}`;
}

function createDefaultAnalysis(candidateAlertsConsidered: number, productImagesProvided = 0): SafetyCheckAnalysis {
  return {
    mode: "text-only",
    scoringMode: "text-only",
    productImagesProvided,
    productImagesUsed: 0,
    alertImagesUsed: 0,
    candidateAlertsConsidered,
  };
}

export function createNoAlertsResult(productImagesProvided = 0): SafetyCheckResult {
  return {
    isSafe: true,
    warnings: [],
    recommendation: "No recent Safety Gate alerts found. Product appears safe based on available data.",
    checkedAt: new Date().toISOString(),
    analysis: createDefaultAnalysis(0, productImagesProvided),
  };
}

export function createUnavailableAnalysisResult(
  analysis: SafetyCheckAnalysis,
): SafetyCheckResult {
  return {
    isSafe: true,
    warnings: [],
    recommendation: "Unable to analyze product against Safety Gate alerts at this time.",
    checkedAt: new Date().toISOString(),
    analysis,
  };
}

function clampScore(value: number | undefined | null): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(Math.round(Number(value)), 0), 100);
}

function getTextSimilarity(match: AnalysisMatchCandidate): number {
  return clampScore(match.textSimilarity ?? match.overallSimilarity);
}

function getImageSimilarity(match: AnalysisMatchCandidate): number | undefined {
  if (!Number.isFinite(match.imageSimilarity)) {
    return undefined;
  }

  return clampScore(match.imageSimilarity);
}

function computeOverallSimilarity(
  imageSimilarity: number | undefined,
  textSimilarity: number,
  scoringMode: "image-first" | "text-only",
): number {
  if (scoringMode === "text-only" || imageSimilarity == null) {
    return clampScore(textSimilarity);
  }

  const weighted =
    imageSimilarity * IMAGE_FIRST_VISUAL_WEIGHT + textSimilarity * IMAGE_FIRST_TEXT_WEIGHT;

  if (imageSimilarity >= 90) {
    return clampScore(Math.max(weighted, imageSimilarity - 5));
  }

  if (imageSimilarity >= 80) {
    return clampScore(Math.max(weighted, imageSimilarity - 8));
  }

  if (imageSimilarity >= 70) {
    return clampScore(Math.max(weighted, imageSimilarity - 12));
  }

  if (imageSimilarity <= 25 && textSimilarity >= 70) {
    return clampScore(Math.min(weighted, 55));
  }

  return clampScore(weighted);
}

function getScoreBreakdown(
  scoringMode: "image-first" | "text-only",
): NonNullable<MatchResult["scoreBreakdown"]> {
  if (scoringMode === "text-only") {
    return {
      visualWeight: TEXT_ONLY_VISUAL_WEIGHT,
      textWeight: TEXT_ONLY_TEXT_WEIGHT,
      scoringMode,
    };
  }

  return {
    visualWeight: IMAGE_FIRST_VISUAL_WEIGHT,
    textWeight: IMAGE_FIRST_TEXT_WEIGHT,
    scoringMode,
  };
}

function enrichReason(
  originalReason: string | undefined,
  scoringMode: "image-first" | "text-only",
  imageSimilarity: number | undefined,
  overallSimilarity: number,
): string {
  const baseReason = originalReason?.trim() || "Potential similarity detected";

  if (scoringMode === "image-first" && imageSimilarity != null) {
    return `${baseReason} Visual packaging similarity carried the final review score (${imageSimilarity}% image match, ${overallSimilarity}% overall match).`;
  }

  return baseReason;
}

export function parseAnalysisMatches(
  analysisResponse: AnalysisResponseShape,
): AnalysisMatchCandidate[] {
  if (Array.isArray(analysisResponse.output)) {
    return analysisResponse.output as AnalysisMatchCandidate[];
  }

  if (analysisResponse.output && typeof analysisResponse.output === "object") {
    const objectValues = Object.values(analysisResponse.output as Record<string, unknown>);
    if (objectValues.every((value) => value && typeof value === "object")) {
      return objectValues as AnalysisMatchCandidate[];
    }
  }

  try {
    const parsed = JSON.parse(analysisResponse.text);
    if (Array.isArray(parsed)) {
      return parsed as AnalysisMatchCandidate[];
    }

    if (parsed && typeof parsed === "object") {
      const objectValues = Object.values(parsed as Record<string, unknown>);
      if (objectValues.every((value) => value && typeof value === "object")) {
        return objectValues as AnalysisMatchCandidate[];
      }
    }

    return [];
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    return [];
  }
}

function mapRiskLevel(databaseRiskLevel: string): string {
  if (!databaseRiskLevel) return "unknown";

  const normalized = databaseRiskLevel.toLowerCase().trim();
  if (normalized.includes("serious") || normalized === "1") return "serious";
  if (normalized.includes("high") || normalized === "2") return "high";
  if (normalized.includes("medium") || normalized === "3") return "medium";
  if (normalized.includes("low") || normalized === "4") return "low";
  if (["serious", "high", "medium", "low"].includes(normalized)) return normalized;

  return "unknown";
}

function buildAlertDetails(alert?: NormalizedAlert): MatchResult["alertDetails"] {
  if (!alert) {
    return {
      meta: { recordid: "", alert_date: "", ingested_at: "" },
      fields: {
        product_category: "",
        product_description: "",
        risk_level: "",
        alert_level: "",
        alert_type: "",
        risk_legal_provision: "",
        notifying_country: "",
      },
    };
  }

  return {
    meta: {
      ...alert.meta,
      recordid: String(alert.meta?.recordid || alert.id || ""),
      alert_date: String(alert.meta?.alert_date || ""),
      ingested_at: String(alert.meta?.ingested_at || ""),
    },
    fields: {
      ...(alert.fields || {}),
      product_category: String(alert.fields?.product_category || ""),
      product_description: String(alert.fields?.product_description || ""),
      risk_level: String(alert.fields?.risk_level || ""),
      alert_level: String(alert.fields?.alert_level || ""),
      alert_type: String(alert.fields?.alert_type || ""),
      risk_legal_provision: String(alert.fields?.risk_legal_provision || ""),
      notifying_country: String(alert.fields?.notifying_country || ""),
    },
  };
}

function buildRecommendation(warnings: MatchResult[]): string {
  if (warnings.length === 0) {
    return "Product appears safe based on Safety Gate database analysis. No significant matches found.";
  }

  const highRiskWarnings = warnings.filter(
    (warning) => warning.riskLevel === "serious" || warning.riskLevel === "high",
  );

  if (highRiskWarnings.length > 0) {
    return "⚠️ HIGH RISK: Found serious safety alerts for similar products. Recommend avoiding purchase and consulting authorities.";
  }

  return "⚡ CAUTION: Found alerts for similar products. Review safety concerns before purchase.";
}

export function buildSafetyCheckResult(
  matches: AnalysisMatchCandidate[],
  alerts: NormalizedAlert[],
  analysis: SafetyCheckAnalysis,
): SafetyCheckResult {
  const warnings = matches
    .map((match): MatchResult => {
      const alert = alerts.find((candidate) => candidate.id === match.alertId);
      const alertDetails = buildAlertDetails(alert);
      const alertType = alertDetails.fields.alert_type;
      const alertLevel = alertDetails.fields.alert_level;
      const riskLegalProvision = alertDetails.fields.risk_legal_provision;
      const scoringMode =
        analysis.scoringMode === "image-first" && Number.isFinite(match.imageSimilarity)
          ? "image-first"
          : "text-only";
      const textSimilarity = getTextSimilarity(match);
      const imageSimilarity = getImageSimilarity(match);
      const overallSimilarity = computeOverallSimilarity(
        imageSimilarity,
        textSimilarity,
        scoringMode,
      );

      return {
        alertId: match.alertId || "",
        overallSimilarity,
        imageSimilarity,
        textSimilarity,
        scoreBreakdown: getScoreBreakdown(scoringMode),
        riskLevel: mapRiskLevel(alertDetails.fields.risk_level || ""),
        alertType: alertType || alertLevel || "Unknown",
        riskLegalProvision: riskLegalProvision || "",
        reason: enrichReason(match.reason, scoringMode, imageSimilarity, overallSimilarity),
        alertDetails,
      };
    })
    .filter((warning) => warning.overallSimilarity >= MIN_OVERALL_MATCH_SCORE);

  return {
    isSafe: warnings.length === 0,
    warnings,
    recommendation: buildRecommendation(warnings),
    checkedAt: new Date().toISOString(),
    analysis,
  };
}
