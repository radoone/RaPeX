import axios from "axios";
import * as logger from "firebase-functions/logger";
import { embeddingsAi } from "./firebase-admin.js";
import { SAFETY_GATE_CONFIG } from "./safety-gate-config.js";

export function getPictureUrls(fields: Record<string, unknown> | null | undefined): string[] {
  return [...new Set([
    ...(Array.isArray(fields?.pictures) ? fields.pictures : []),
    ...(fields?.product_image ? [fields.product_image] : []),
    ...(typeof fields?.product_other_images === "string"
      ? fields.product_other_images.split(",")
      : []),
  ]
    .filter((picture): picture is string => typeof picture === "string")
    .map((picture) => picture.trim())
    .filter(Boolean))];
}

export function getFirstPicture(fields: Record<string, unknown> | null | undefined): string | null {
  return getPictureUrls(fields)[0] ?? null;
}

async function fetchImageAsBase64(
  url: string,
): Promise<{ url: string; contentType: string } | null> {
  if (!url) {
    return null;
  }

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: SAFETY_GATE_CONFIG.imageFetchTimeoutMs,
    });

    const base64 = Buffer.from(response.data, "binary").toString("base64");
    let contentType =
      normalizeHeaderValue(response.headers["content-type"]) || "application/octet-stream";
    if (contentType.startsWith("image/")) {
      contentType = contentType.split(";")[0].trim();
    }

    return { url: base64, contentType };
  } catch (error) {
    logger.warn("Failed to fetch image for embedding", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function normalizeHeaderValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === "string");
  }

  return undefined;
}

function cleanString(val: unknown): string {
  if (val === null || val === undefined) {
    return "";
  }
  return String(val).trim();
}

export function buildEmbeddingText(params: {
  brand?: unknown;
  model?: unknown;
  category?: unknown;
  title?: unknown;
  description?: unknown;
}): string {
  const brand = cleanString(params.brand);
  const model = cleanString(params.model);
  const category = cleanString(params.category);
  const title = cleanString(params.title);
  // Truncate description to prevent generic e-commerce descriptions from diluting the specific product title/model
  const rawDesc = cleanString(params.description);
  const description = rawDesc.length > 350 ? `${rawDesc.slice(0, 350)}...` : rawDesc;

  const parts = [
    brand ? `Brand: ${brand}` : "",
    model ? `Model: ${model}` : "",
    category ? `Category: ${category}` : "",
    title ? `Title: ${title}` : "",
    description ? `Description: ${description}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

export async function embedText(content: string, maxRetries = 3): Promise<number[] | undefined> {
  if (!content.trim()) {
    return undefined;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const [result] = await embeddingsAi.embed({
        embedder: SAFETY_GATE_CONFIG.textEmbedder,
        content,
        options: {
          outputDimensionality: 1536,
        },
      });
      return result?.embedding;
    } catch (error) {
      const isRateLimit = String(error).includes("429") || String(error).includes("RESOURCE_EXHAUSTED");
      if (isRateLimit && attempt < maxRetries) {
        const delayMs = attempt * 1500;
        logger.warn(`Vertex AI rate limit hit, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
        continue;
      }
      logger.warn("Text embedding failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
  return undefined;
}

export async function embedTexts(
  contents: string[],
  maxRetries = 3,
): Promise<Array<number[] | undefined>> {
  if (!contents.length) {
    return [];
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const results = await embeddingsAi.embedMany({
        embedder: SAFETY_GATE_CONFIG.textEmbedder,
        content: contents.map((c) => c.trim() || " "),
        options: {
          outputDimensionality: 1536,
        },
      });
      return results.map((r) => r?.embedding);
    } catch (error) {
      const isRateLimit = String(error).includes("429") || String(error).includes("RESOURCE_EXHAUSTED");
      if (isRateLimit && attempt < maxRetries) {
        const delayMs = attempt * 2000;
        logger.warn(`Rate limit hit during batch embed, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
        continue;
      }
      logger.warn("Batch text embedding failed, falling back to individual embeddings", {
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  // Fallback: chunked individual embeddings
  const results: Array<number[] | undefined> = [];
  const chunkSize = 10;
  for (let i = 0; i < contents.length; i += chunkSize) {
    const chunk = contents.slice(i, i + chunkSize);
    const chunkEmbeddings = await Promise.all(chunk.map((c) => embedText(c)));
    results.push(...chunkEmbeddings);
  }
  return results;
}

export async function embedImage(url: string): Promise<number[] | undefined> {
  const media = await fetchImageAsBase64(url);
  if (!media) {
    return undefined;
  }

  try {
    const [result] = await embeddingsAi.embed({
      embedder: SAFETY_GATE_CONFIG.imageEmbedder,
      content: { content: [{ media }] },
      options: {
        outputDimensionality: 1408,
      },
    });
    return result?.embedding;
  } catch (error) {
    logger.warn("Image embedding failed", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
