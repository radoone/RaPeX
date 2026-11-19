import type { Firestore } from "firebase-admin/firestore";
import { SAFETY_GATE_CONFIG } from "./safety-gate-config.js";

export const PUBLIC_SCAN_TEXT_SPEC = {
  embeddingModel: SAFETY_GATE_CONFIG.textEmbedder,
  embeddingDimensions: 1536,
  embeddingInputVersion: 1,
} as const;

/** Only pass the shop object from an authenticated Admin API response. */
export function verifiedPublicScanDomains(expectedShop: string, shop: {
  myshopifyDomain?: unknown;
  primaryDomain?: { host?: unknown };
} | undefined): string[] {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(expectedShop) || shop?.myshopifyDomain !== expectedShop) {
    throw new Error("Shopify catalog identity does not match the installed shop");
  }
  const domains = [expectedShop];
  const host = shop.primaryDomain?.host;
  if (typeof host === "string" && host.length <= 253 &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) {
    domains.push(host);
  }
  return [...new Set(domains)];
}

export function compatiblePublicScanVector(data: Record<string, any>, productId: string, text: string, now = Date.now()): number[] | undefined {
  if (data.productId !== productId || !text || data.embeddingText !== text) return undefined;
  if (typeof data.expireAt?.toMillis !== "function" || !(data.expireAt.toMillis() > now)) return undefined;
  // The original cache writer (ebe0fc2) used gemini-embedding-001/1536 and
  // buildEmbeddingText v1. Freeze that legacy contract; model changes disable it.
  const legacy = data.embeddingModel === undefined && data.embeddingDimensions === undefined && data.embeddingInputVersion === undefined;
  if (legacy) {
    if (PUBLIC_SCAN_TEXT_SPEC.embeddingModel !== "vertexai/gemini-embedding-001") return undefined;
  } else if (data.embeddingModel !== PUBLIC_SCAN_TEXT_SPEC.embeddingModel ||
      data.embeddingDimensions !== PUBLIC_SCAN_TEXT_SPEC.embeddingDimensions ||
      data.embeddingInputVersion !== PUBLIC_SCAN_TEXT_SPEC.embeddingInputVersion) return undefined;
  const value = data.vector_text;
  const vector = Array.isArray(value) ? value : typeof value?.toArray === "function" ? value.toArray() : undefined;
  if (!Array.isArray(vector) || vector.length !== PUBLIC_SCAN_TEXT_SPEC.embeddingDimensions ||
      !vector.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) ||
      !vector.some((n: number) => n !== 0)) return undefined;
  return vector;
}

/** Optional optimization only: callers fall back to embedding on cache read failure. */
export async function loadPublicScanOnboardingVectors(
  db: Firestore,
  verifiedDomains: readonly string[],
  products: Array<{ productId: string; text: string; image?: string }>,
): Promise<Map<string, { vector: number[]; domain: string; imageVector?: number[] }>> {
  const result = new Map<string, { vector: number[]; domain: string; imageVector?: number[] }>();
  for (const domain of verifiedDomains) {
    const pending = products.filter(product => !result.has(product.productId));
    for (let start = 0; start < pending.length; start += 100) {
      const chunk = pending.slice(start, start + 100);
      const refs = chunk.map(product => db.collection("rapex_leads").doc(encodeURIComponent(domain))
        .collection("products").doc(encodeURIComponent(product.productId)));
      const snapshots = await db.getAll(...refs, { fieldMask: [
        "productId", "embeddingText", "vector_text", "expireAt", "embeddingModel", "embeddingDimensions", "embeddingInputVersion",
        "imageUrl", "vector_image", "imageEmbeddingModel",
      ] });
      snapshots.forEach((snapshot, index) => {
        const product = chunk[index];
        const data = snapshot.data() || {};
        const vector = compatiblePublicScanVector(data, product.productId, product.text);
        if (!vector) return;
        const raw = data.vector_image;
        const image = Array.isArray(raw) ? raw : typeof raw?.toArray === "function" ? raw.toArray() : undefined;
        const imageVector = product.image && data.imageUrl === product.image &&
          data.imageEmbeddingModel === SAFETY_GATE_CONFIG.imageEmbedder && Array.isArray(image) &&
          image.length === 1408 && image.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) && image.some((n: number) => n !== 0)
          ? image as number[] : undefined;
        result.set(product.productId, { vector, domain, ...(imageVector ? { imageVector } : {}) });
      });
    }
  }
  return result;
}
