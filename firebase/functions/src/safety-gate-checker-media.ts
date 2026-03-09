import axios from "axios";
import type { EncodedImage } from "./safety-gate-checker.types.js";

const IMAGE_TIMEOUT_MS = 10000;

function guessContentType(url: string): string | undefined {
  const lower = url.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return undefined;
}

export function normalizeTimestamp(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return String(value);
}

export function normalizePictures(fields: any): string[] {
  return [
    ...(Array.isArray(fields?.pictures) ? fields.pictures : []),
    ...(fields?.product_image ? [fields.product_image] : []),
    ...(typeof fields?.product_other_images === "string"
      ? fields.product_other_images.split(",")
      : []),
  ]
    .map((picture: any) => (typeof picture === "string" ? picture.trim() : picture))
    .filter(Boolean);
}

export async function prepareImageMedia(imageUrl: string): Promise<EncodedImage | null> {
  if (typeof imageUrl !== "string" || !imageUrl.trim()) {
    return null;
  }

  const trimmed = imageUrl.trim();

  try {
    const response = await axios.get(trimmed, {
      responseType: "arraybuffer",
      timeout: IMAGE_TIMEOUT_MS,
    });

    const base64 = Buffer.from(response.data, "binary").toString("base64");
    let contentType =
      response.headers["content-type"] || guessContentType(trimmed) || "application/octet-stream";

    if (contentType.startsWith("image/")) {
      contentType = contentType.split(";")[0].trim();
    }

    return {
      url: `data:${contentType};base64,${base64}`,
      contentType,
    };
  } catch (error) {
    console.warn(
      `Failed to load image from ${trimmed}:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export function isUnsupportedMimeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes("unsupported mime type");
}
