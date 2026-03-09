import * as logger from "firebase-functions/logger";
import { PRODUCT_SAFETY_API_USAGE } from "./safety-gate-config.js";
import { checkProductSafety } from "./safety-gate-checker.js";
import type { ProductCheckInput } from "./safety-gate-types.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
} as const;

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

function applyCorsHeaders(response: ResponseShape): void {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.set(name, value);
  }
}

function coerceString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return coerceString(value[0]);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function extractApiKey(request: RequestShape): string {
  return (
    coerceString(request.headers["x-api-key"]) ||
    coerceString(request.query.apiKey) ||
    ""
  );
}

function readProductData(request: RequestShape): Partial<ProductCheckInput> | null {
  if (request.method === "POST" && request.body) {
    return {
      name: coerceString(request.body.name),
      category: coerceString(request.body.category),
      description: coerceString(request.body.description),
      imageUrl: coerceString(request.body.imageUrl),
      brand: coerceString(request.body.brand),
      model: coerceString(request.body.model),
    };
  }

  if (request.method === "GET") {
    return {
      name: coerceString(request.query.name) || coerceString(request.query.product),
      category: coerceString(request.query.category),
      description: coerceString(request.query.description),
      imageUrl: coerceString(request.query.imageUrl),
      brand: coerceString(request.query.brand),
      model: coerceString(request.query.model),
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
  applyCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  const providedKey = extractApiKey(request);
  const expectedApiKey = (process.env.SAFETY_GATE_API_KEY ?? "").trim();

  if (!providedKey || !expectedApiKey || providedKey !== expectedApiKey) {
    logger.warn("Unauthorized API access attempt", {
      hasApiKey: Boolean(providedKey),
      apiKeyLength: providedKey.length,
      expectedKeyLength: expectedApiKey.length,
    });
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
