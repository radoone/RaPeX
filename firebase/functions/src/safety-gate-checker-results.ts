import type {
  MatchResult,
  SafetyCheckResult,
  ProductInput,
} from "./safety-gate-checker.schemas.js";
import type { AnalysisMatchCandidate, NormalizedAlert } from "./safety-gate-checker.types.js";

type AnalysisResponseShape = {
  output?: unknown;
  text: string;
};

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

  return `You are a product safety expert analyzing potential matches between a new product and existing RAPEX alerts.

NEW PRODUCT TO CHECK:
Name: ${product.name}
Category: ${product.category}
Description: ${product.description}
Brand: ${product.brand || "Not specified"}
Model: ${product.model || "Not specified"}

RECENT SAFETY GATE ALERTS (last 12 months):
${alertsText}

TASK:
1. Compare the new product with each Safety Gate alert
2. Prioritize alerts from the last year only; ignore older records.
3. If images are provided, use visual similarity alongside the text fields.
4. For each potential match, provide:
   - Similarity score (0-100, where 100 is identical)
   - Reason for the match
   - Risk assessment

Return ONLY a JSON array of matches where similarity > 50. Each match should have:
- alertId: the Safety Gate alert ID
- similarity: similarity score (50-100)
- reason: detailed explanation of why you think this is a match
- riskAssessment: assessment of the risk level

If no matches found, return empty array.`;
}

export function createNoAlertsResult(): SafetyCheckResult {
  return {
    isSafe: true,
    warnings: [],
    recommendation: "No recent Safety Gate alerts found. Product appears safe based on available data.",
    checkedAt: new Date().toISOString(),
  };
}

export function createUnavailableAnalysisResult(): SafetyCheckResult {
  return {
    isSafe: true,
    warnings: [],
    recommendation: "Unable to analyze product against Safety Gate alerts at this time.",
    checkedAt: new Date().toISOString(),
  };
}

export function parseAnalysisMatches(
  analysisResponse: AnalysisResponseShape,
): AnalysisMatchCandidate[] {
  if (Array.isArray(analysisResponse.output)) {
    return analysisResponse.output as AnalysisMatchCandidate[];
  }

  try {
    const parsed = JSON.parse(analysisResponse.text);
    return Array.isArray(parsed) ? (parsed as AnalysisMatchCandidate[]) : [];
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
): SafetyCheckResult {
  const warnings = matches
    .map((match): MatchResult => {
      const alert = alerts.find((candidate) => candidate.id === match.alertId);
      const alertDetails = buildAlertDetails(alert);
      const alertType = alertDetails.fields.alert_type;
      const alertLevel = alertDetails.fields.alert_level;
      const riskLegalProvision = alertDetails.fields.risk_legal_provision;

      return {
        alertId: match.alertId || "",
        similarity: match.similarity || 0,
        riskLevel: mapRiskLevel(alertDetails.fields.risk_level || ""),
        alertType: alertType || alertLevel || "Unknown",
        riskLegalProvision: riskLegalProvision || "",
        reason: match.reason || "Potential similarity detected",
        alertDetails,
      };
    })
    .filter((warning) => warning.similarity > 30);

  return {
    isSafe: warnings.length === 0,
    warnings,
    recommendation: buildRecommendation(warnings),
    checkedAt: new Date().toISOString(),
  };
}
