import * as logger from "firebase-functions/logger";
import { isAuthorizedApiKey } from "./api-auth.js";
import { PRODUCT_SAFETY_API_USAGE } from "./safety-gate-config.js";
import { checkProductSafety } from "./safety-gate-checker.js";
import type { ProductCheckInput } from "./safety-gate-types.js";

const MAX_NAME_CHARS = 300;
const MAX_CATEGORY_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 4000;
const MAX_BRAND_MODEL_CHARS = 200;
const MAX_URL_CHARS = 2048;

type RequestShape = {
  method: string;
  body?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
};

type ResponseShape = {
  set(name: string, value: string): void;
  status(code: number): ResponseShape;
  json(payload: unknown): void;
  send(payload: string): void;
};

function coerceString(value: unknown, maxLength = MAX_DESCRIPTION_CHARS): string | undefined {
  if (Array.isArray(value)) {
    return coerceString(value[0], maxLength);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function coerceStringArray(value: unknown, maxItems = 10, maxLength = MAX_URL_CHARS): string[] | undefined {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .map((entry) => coerceString(entry, maxLength))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxItems);

  return normalized.length > 0 ? normalized : undefined;
}

function readProductData(request: RequestShape): Partial<ProductCheckInput> | null {
  if (request.method === "POST" && request.body) {
    return {
      name: coerceString(request.body.name, MAX_NAME_CHARS),
      category: coerceString(request.body.category, MAX_CATEGORY_CHARS),
      description: coerceString(request.body.description, MAX_DESCRIPTION_CHARS),
      imageUrl: coerceString(request.body.imageUrl, MAX_URL_CHARS),
      imageUrls: coerceStringArray(request.body.imageUrls),
      brand: coerceString(request.body.brand, MAX_BRAND_MODEL_CHARS),
      model: coerceString(request.body.model, MAX_BRAND_MODEL_CHARS),
      shop: coerceString(request.body.shop, 255),
      productId: coerceString(request.body.productId, 128),
      sourceUpdatedAt: coerceString(request.body.sourceUpdatedAt, 64),
    };
  }

  return null;
}

function isValidProductCheckInput(data: Partial<ProductCheckInput> | null): data is ProductCheckInput {
  return Boolean(data?.name && data.category && data.description);
}

export async function handleCheckProductSafetyRequest(
  request: RequestShape,
  response: ResponseShape,
): Promise<void> {
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({
      error: "Method not allowed",
      message: "Only POST requests are supported",
    });
    return;
  }

  if (!isAuthorizedApiKey(request)) {
    logger.warn("Unauthorized API access attempt on checkProductSafetyAPI");
    response.status(401).json({
      error: "Unauthorized",
      message: "Valid API key required",
    });
    return;
  }

  try {
    logger.info("Product safety check API called", {
      method: request.method,
      hasBody: Boolean(request.body),
      query: request.query,
      authorized: true,
    });

    const productData = readProductData(request);
    if (!productData) {
      response.status(400).json({
        error: "Missing product data",
        usage: PRODUCT_SAFETY_API_USAGE,
      });
      return;
    }

    if (!isValidProductCheckInput(productData)) {
      response.status(400).json({
        error: "Missing required fields",
        required: ["name", "category", "description"],
        provided: productData,
      });
      return;
    }

    logger.info("Processing product safety check", { productData });
    const result = await checkProductSafety(productData);

    logger.info("Product safety check completed", {
      isSafe: result.isSafe,
      warningsCount: result.warnings.length,
      analysisMode: result.analysis.mode,
      productImagesUsed: result.analysis.productImagesUsed,
      alertImagesUsed: result.analysis.alertImagesUsed,
      candidateAlertsConsidered: result.analysis.candidateAlertsConsidered,
    });

    response.status(200).json(result);
  } catch (error) {
    logger.error("Product safety check API error", { error });
    response.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
}
