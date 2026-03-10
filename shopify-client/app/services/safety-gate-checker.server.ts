import merchantDb from "../merchant-db.server";
import { shopifyProductToProductData, type ProductData } from "./safety-gate-checker.client";

const FIREBASE_FUNCTIONS_BASE_URL =
  process.env.FIREBASE_FUNCTIONS_BASE_URL ||
  "https://europe-west1-rapex-99a2c.cloudfunctions.net";
const SAFETY_GATE_API_KEY = process.env.SAFETY_GATE_API_KEY || "";

export interface SafetyCheckResult {
  isSafe: boolean;
  warnings: Array<{
    alertId: string;
    overallSimilarity: number;
    imageSimilarity?: number;
    textSimilarity?: number;
    scoreBreakdown?: {
      visualWeight: number;
      textWeight: number;
      scoringMode: "image-first" | "text-only";
    };
    riskLevel: string;
    alertType: string;
    riskLegalProvision: string;
    reason: string;
    alertDetails: {
      meta: {
        recordid: string;
        alert_date: string;
        ingested_at: string;
      };
      fields: {
        product_category: string;
        product_description: string;
        risk_level: string;
        alert_level: string;
        alert_type: string;
        risk_legal_provision: string;
        notifying_country: string;
        product_brand?: string;
        product_model?: string;
        pictures?: string[];
      };
    };
  }>;
  recommendation: string;
  checkedAt: string;
  analysis: {
    mode: "text-only" | "with-image";
    scoringMode: "image-first" | "text-only";
    productImagesProvided: number;
    productImagesUsed: number;
    alertImagesUsed: number;
    candidateAlertsConsidered: number;
  };
}

export interface MerchantDeltaMonitoringResult {
  shop: string;
  mode: "delta" | "bootstrap";
  productsScanned: number;
  rapexAlertsScanned: number;
  matchesFound: number;
  alertsCreated: number;
  checkpoint: {
    lastRapexAlertDate?: string | null;
    lastRapexRecordTimestamp?: string | null;
  };
}

function requireApiKey(): string {
  const apiKey = SAFETY_GATE_API_KEY.trim();
  if (!apiKey) {
    throw new Error("SAFETY_GATE_API_KEY is not configured");
  }
  return apiKey;
}

function applySimilarityThreshold<T extends SafetyCheckResult>(result: T, threshold: number): T {
  const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 0;
  if (safeThreshold <= 0) {
    return result;
  }

  const filteredWarnings = result.warnings.filter((warning) => {
    const similarity = Number.isFinite(warning.overallSimilarity) ? warning.overallSimilarity : 0;
    return similarity >= safeThreshold;
  });

  return {
    ...result,
    warnings: filteredWarnings,
    isSafe: filteredWarnings.length === 0 ? true : result.isSafe,
  };
}

export async function getSimilarityThresholdForShop(shop: string): Promise<number> {
  const envDefault = Number(process.env.SAFETY_GATE_SIMILARITY_THRESHOLD || "0");
  try {
    const setting = await merchantDb.safetySetting.findUnique({
      where: { shop },
    });
    if (setting && Number.isFinite(setting.similarityThreshold)) {
      return setting.similarityThreshold;
    }
  } catch (error) {
    console.error("Error fetching similarity threshold for shop", shop, error);
  }
  return Number.isFinite(envDefault) ? envDefault : 0;
}

export async function checkProductSafety(
  productData: ProductData,
  similarityThreshold?: number,
): Promise<SafetyCheckResult> {
  try {
    const envDefault = Number(process.env.SAFETY_GATE_SIMILARITY_THRESHOLD || "0");
    const effectiveThreshold = Number.isFinite(similarityThreshold)
      ? similarityThreshold
      : (Number.isFinite(envDefault) ? envDefault : 0);

    const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/checkProductSafetyAPI`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": requireApiKey(),
      },
      body: JSON.stringify(productData),
    });

    if (!response.ok) {
      throw new Error(`Safety Gate API returned ${response.status}: ${response.statusText}`);
    }

    const rawResult = (await response.json()) as SafetyCheckResult;
    const result = applySimilarityThreshold(rawResult, effectiveThreshold);
    console.info("Safety Gate check completed", {
      product: productData.name,
      analysisMode: result.analysis?.mode,
      productImagesUsed: result.analysis?.productImagesUsed ?? 0,
      alertImagesUsed: result.analysis?.alertImagesUsed ?? 0,
      candidateAlertsConsidered: result.analysis?.candidateAlertsConsidered ?? 0,
    });
    return result;
  } catch (error) {
    console.error("Error checking product safety:", error);
    return {
      isSafe: true,
      warnings: [],
      recommendation: `Unable to verify product safety against Safety Gate database. Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      checkedAt: new Date().toISOString(),
      analysis: {
        mode: "text-only",
        scoringMode: "text-only",
        productImagesProvided: productData.imageUrls?.length || (productData.imageUrl ? 1 : 0),
        productImagesUsed: 0,
        alertImagesUsed: 0,
        candidateAlertsConsidered: 0,
      },
    };
  }
}

export async function upsertMerchantProductForMonitoring(input: {
  shop: string;
  productId: string;
  productTitle: string;
  productHandle?: string;
  product: ProductData;
  sourceUpdatedAt?: string;
}): Promise<void> {
  const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/upsertMerchantProductAPI`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": requireApiKey(),
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Upsert merchant product failed: ${response.status} ${message}`);
  }
}

export async function runMerchantDeltaMonitoring(
  shop: string,
  options?: { forceFullScan?: boolean; limit?: number },
): Promise<MerchantDeltaMonitoringResult> {
  const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/runMerchantDeltaMonitoringAPI`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": requireApiKey(),
    },
    body: JSON.stringify({
      shop,
      forceFullScan: Boolean(options?.forceFullScan),
      limit: options?.limit,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Run merchant monitoring failed: ${response.status} ${message}`);
  }

  const payload = (await response.json()) as { result: MerchantDeltaMonitoringResult };
  return payload.result;
}

export { shopifyProductToProductData };
