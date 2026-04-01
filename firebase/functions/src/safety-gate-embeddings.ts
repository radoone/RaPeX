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
    let contentType = response.headers["content-type"] || "application/octet-stream";
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

export async function embedText(content: string): Promise<number[] | undefined> {
  if (!content.trim()) {
    return undefined;
  }

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
    logger.warn("Text embedding failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
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
