import { defineFirestoreRetriever } from "@genkit-ai/firebase";
import { vertexAI } from "@genkit-ai/google-genai";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { DocumentData, RetrieverAction } from "genkit/retriever";
import { functionsAi } from "./firebase-admin.js";
import { FIRESTORE_COLLECTIONS } from "./safety-gate-config.js";
import type { ProductInput } from "./safety-gate-checker.schemas.js";
import {
  getProductImageUrls,
  normalizePictures,
  normalizeTimestamp,
  prepareImageMedia,
} from "./safety-gate-checker-media.js";
import type { NormalizedAlert } from "./safety-gate-checker.types.js";

export const ALERT_LOOKBACK_DAYS = 365;

const RAG_TEXT_LIMIT = 12;
const RAG_IMAGE_LIMIT = 6;
const MAX_RAG_ALERTS = 12;
const VECTOR_TEXT_FIELD = "vector_text";
const VECTOR_IMAGE_FIELD = "vector_image";
const TEXT_VECTOR_DIMENSIONS = 1536;
const IMAGE_VECTOR_DIMENSIONS = 1408;

let textRetriever: RetrieverAction | null = null;
let imageRetriever: RetrieverAction | null = null;
let legacyImageRetriever: RetrieverAction | null = null;

function merchantProductDocId(shop: string, productId: string): string {
  return `${encodeURIComponent(shop)}::${encodeURIComponent(productId)}`;
}

function asVectorArray(value: unknown): number[] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const maybeVector = value as { toArray?: () => number[]; _values?: number[] };
  if (typeof maybeVector.toArray === "function") {
    return maybeVector.toArray();
  }

  if (Array.isArray(maybeVector._values)) {
    return maybeVector._values;
  }

  return undefined;
}

async function getCachedMerchantProductVectors(product: ProductInput): Promise<{
  textVector?: number[];
  imageVector?: number[];
} | null> {
  const shop = product.shop?.trim();
  const productId = product.productId?.trim();
  if (!shop || !productId) {
    return null;
  }

  const snapshot = await getFirestore()
    .collection(FIRESTORE_COLLECTIONS.merchantProducts)
    .doc(merchantProductDocId(shop, productId))
    .get();

  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data() as Record<string, unknown>;
  const cachedSourceUpdatedAt =
    typeof data.sourceUpdatedAt === "string" ? data.sourceUpdatedAt.trim() : undefined;
  const requestedSourceUpdatedAt = product.sourceUpdatedAt?.trim();

  if (requestedSourceUpdatedAt && cachedSourceUpdatedAt && cachedSourceUpdatedAt !== requestedSourceUpdatedAt) {
    return null;
  }

  return {
    textVector: asVectorArray(data.vector_text),
    imageVector: asVectorArray(data.vector_image),
  };
}

async function retrieveAlertsFromCachedVectors(product: ProductInput): Promise<NormalizedAlert[]> {
  const cachedVectors = await getCachedMerchantProductVectors(product);
  if (!cachedVectors?.textVector?.length && !cachedVectors?.imageVector?.length) {
    return [];
  }

  const db = getFirestore();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ALERT_LOOKBACK_DAYS);
  const candidates: NormalizedAlert[] = [];
  const seen = new Set<string>();

  if (cachedVectors.textVector?.length) {
    try {
      const snapshot = await db
        .collection(FIRESTORE_COLLECTIONS.alerts)
        .where("meta.alert_date", ">=", Timestamp.fromDate(cutoffDate))
        .findNearest({
          vectorField: VECTOR_TEXT_FIELD,
          queryVector: cachedVectors.textVector,
          limit: RAG_TEXT_LIMIT,
          distanceMeasure: "COSINE",
          distanceResultField: "distance",
        })
        .get();

      for (const document of snapshot.docs) {
        const normalized = normalizeRetrieverDocument({
          content: [],
          metadata: {
            id: document.id,
            ...document.data(),
            distance: document.get("distance"),
          },
        } as DocumentData);
        if (!normalized || seen.has(normalized.id)) {
          continue;
        }
        seen.add(normalized.id);
        candidates.push(normalized);
      }
    } catch (error) {
      console.warn("Cached text vector query failed; falling back to live embedding query", error);
    }
  }

  if (cachedVectors.imageVector?.length) {
    try {
      const snapshot = await db
        .collection(FIRESTORE_COLLECTIONS.alertImages)
        .where("meta.alert_date", ">=", Timestamp.fromDate(cutoffDate))
        .findNearest({
          vectorField: VECTOR_IMAGE_FIELD,
          queryVector: cachedVectors.imageVector,
          limit: RAG_IMAGE_LIMIT,
          distanceMeasure: "COSINE",
          distanceResultField: "distance",
        })
        .get();

      for (const document of snapshot.docs) {
        const normalized = normalizeRetrieverDocument({
          content: [],
          metadata: {
            id: document.id,
            ...document.data(),
            distance: document.get("distance"),
          },
        } as DocumentData);
        if (!normalized || seen.has(normalized.id)) {
          continue;
        }
        seen.add(normalized.id);
        candidates.push(normalized);
      }
    } catch (error) {
      console.warn("Cached image vector query failed; falling back to live embedding query", error);
    }
  }

  candidates.sort((left, right) => {
    const leftDistance =
      typeof left.distance === "number" ? left.distance : Number.POSITIVE_INFINITY;
    const rightDistance =
      typeof right.distance === "number" ? right.distance : Number.POSITIVE_INFINITY;
    return leftDistance - rightDistance;
  });

  return candidates.slice(0, MAX_RAG_ALERTS);
}

function toVertexInlineMedia(encodedImage: { url: string; contentType?: string }) {
  const contentType = encodedImage.contentType ?? "application/octet-stream";

  if (!encodedImage.url.startsWith("data:")) {
    return {
      ...encodedImage,
      contentType,
    };
  }

  const [, base64 = ""] = encodedImage.url.split(",", 2);
  return {
    ...encodedImage,
    url: base64,
    contentType,
  };
}

function ensureTextRetriever(): RetrieverAction | null {
  if (textRetriever) {
    return textRetriever;
  }

  try {
    textRetriever = defineFirestoreRetriever(functionsAi, {
      name: "rapex-text-retriever",
      firestore: getFirestore(),
      collection: FIRESTORE_COLLECTIONS.alerts,
      embedder: vertexAI.embedder("gemini-embedding-001", {
        outputDimensionality: TEXT_VECTOR_DIMENSIONS,
      }),
      vectorField: VECTOR_TEXT_FIELD,
      contentField: "fields.product_description",
      distanceResultField: "distance",
    });
  } catch (error) {
    console.warn("Unable to initialize text retriever; falling back to DB scan", error);
    textRetriever = null;
  }

  return textRetriever;
}

function ensureImageRetriever(): RetrieverAction | null {
  if (imageRetriever) {
    return imageRetriever;
  }

  try {
    imageRetriever = defineFirestoreRetriever(functionsAi, {
      name: "rapex-alert-images-retriever",
      firestore: getFirestore(),
      collection: FIRESTORE_COLLECTIONS.alertImages,
      embedder: vertexAI.embedder("multimodalembedding@001", {
        outputDimensionality: IMAGE_VECTOR_DIMENSIONS,
      }),
      vectorField: VECTOR_IMAGE_FIELD,
      contentField: "fields.product_description",
      distanceResultField: "distance",
    });
  } catch (error) {
    console.warn("Unable to initialize image retriever; image similarity will be skipped", error);
    imageRetriever = null;
  }

  return imageRetriever;
}

function ensureLegacyImageRetriever(): RetrieverAction | null {
  if (legacyImageRetriever) {
    return legacyImageRetriever;
  }

  try {
    legacyImageRetriever = defineFirestoreRetriever(functionsAi, {
      name: "rapex-image-retriever-legacy",
      firestore: getFirestore(),
      collection: FIRESTORE_COLLECTIONS.alerts,
      embedder: vertexAI.embedder("multimodalembedding@001", {
        outputDimensionality: IMAGE_VECTOR_DIMENSIONS,
      }),
      vectorField: VECTOR_IMAGE_FIELD,
      contentField: "fields.product_description",
      distanceResultField: "distance",
    });
  } catch (error) {
    console.warn("Unable to initialize legacy image retriever; continuing with alert-image collection only", error);
    legacyImageRetriever = null;
  }

  return legacyImageRetriever;
}

function normalizeRetrieverDocument(doc: DocumentData): NormalizedAlert | null {
  const metadata: any = (doc as any)?.metadata || {};
  const metaSection: any = metadata.meta || metadata;
  const fieldsSection: any = metadata.fields || {};

  const recordId = String(metaSection.recordid ?? metadata.recordid ?? metadata.id ?? metaSection.id ?? "");
  const alertId = recordId || String(metadata.id || "");

  if (!alertId) {
    return null;
  }

  return {
    id: alertId,
    meta: {
      recordid: recordId || alertId,
      alert_date: normalizeTimestamp(metaSection.alert_date || metadata.alert_date),
      ingested_at: normalizeTimestamp(metaSection.ingested_at || metadata.ingested_at),
    },
    fields: {
      product_category: String(fieldsSection.product_category || ""),
      product_description: String(fieldsSection.product_description || ""),
      risk_level: String(fieldsSection.risk_level || ""),
      alert_level: String(fieldsSection.alert_level || ""),
      alert_type: String(fieldsSection.alert_type || ""),
      risk_legal_provision: String(fieldsSection.risk_legal_provision || ""),
      notifying_country: String(fieldsSection.notifying_country || ""),
      product_brand: fieldsSection.product_brand != null ? String(fieldsSection.product_brand) : undefined,
      product_model: fieldsSection.product_model != null ? String(fieldsSection.product_model) : undefined,
      pictures: normalizePictures(fieldsSection),
    },
    distance: metadata.distance,
    source: "retriever",
  };
}

function isWithinLookback(alertDateRaw: string, cutoffDate: Date): boolean {
  const alertDate = alertDateRaw ? new Date(alertDateRaw) : null;
  return !alertDate || Number.isNaN(alertDate.getTime()) || alertDate >= cutoffDate;
}

export async function retrieveAlertsWithRag(product: ProductInput): Promise<NormalizedAlert[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ALERT_LOOKBACK_DAYS);

  const cachedCandidates = await retrieveAlertsFromCachedVectors(product);
  if (cachedCandidates.length > 0) {
    return cachedCandidates;
  }

  const candidates: NormalizedAlert[] = [];
  const seen = new Set<string>();
  const activeTextRetriever = ensureTextRetriever();
  const activeImageRetriever = ensureImageRetriever();
  const activeLegacyImageRetriever = ensureLegacyImageRetriever();

  if (!activeTextRetriever && !activeImageRetriever && !activeLegacyImageRetriever) {
    return [];
  }

  if (activeTextRetriever) {
    try {
      const result = await functionsAi.retrieve({
        retriever: activeTextRetriever,
        query: product.description,
        options: { limit: RAG_TEXT_LIMIT },
      });

      for (const document of result || []) {
        const normalized = normalizeRetrieverDocument(document);
        if (!normalized || seen.has(normalized.id) || !isWithinLookback(normalized.meta.alert_date, cutoffDate)) {
          continue;
        }

        seen.add(normalized.id);
        candidates.push(normalized);
      }
    } catch (error) {
      console.warn("Text retriever query failed; falling back to DB scan", error);
    }
  }

  const imageRetrievers = [
    activeImageRetriever,
    activeLegacyImageRetriever,
  ].filter((retriever): retriever is RetrieverAction => Boolean(retriever));

  if (imageRetrievers.length > 0) {
    for (const imageUrl of getProductImageUrls(product)) {
      const encodedImage = await prepareImageMedia(imageUrl);
      if (!encodedImage) {
        continue;
      }
      const vertexInlineMedia = toVertexInlineMedia(encodedImage);

      for (const retriever of imageRetrievers) {
        try {
          const result = await functionsAi.retrieve({
            retriever,
            query: { content: [{ media: vertexInlineMedia }] },
            options: { limit: RAG_IMAGE_LIMIT },
          });

          for (const document of result || []) {
            const normalized = normalizeRetrieverDocument(document);
            if (!normalized || seen.has(normalized.id) || !isWithinLookback(normalized.meta.alert_date, cutoffDate)) {
              continue;
            }

            seen.add(normalized.id);
            candidates.push(normalized);
          }
        } catch (error) {
          console.warn("Image retriever query failed; continuing without image recall", error);
        }
      }
    }
  }

  candidates.sort((left, right) => {
    const leftDistance =
      typeof left.distance === "number" ? left.distance : Number.POSITIVE_INFINITY;
    const rightDistance =
      typeof right.distance === "number" ? right.distance : Number.POSITIVE_INFINITY;
    return leftDistance - rightDistance;
  });

  return candidates.slice(0, MAX_RAG_ALERTS);
}

export async function searchRecentRapexAlerts(days = ALERT_LOOKBACK_DAYS): Promise<NormalizedAlert[]> {
  const db = getFirestore();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  console.log(`Searching Safety Gate alerts from ${cutoffDate.toISOString()} to now...`);

  const alertsSnapshot = await db
    .collection(FIRESTORE_COLLECTIONS.alerts)
    .where("meta.alert_date", ">=", Timestamp.fromDate(cutoffDate))
    .orderBy("meta.alert_date", "desc")
    .limit(100)
    .get();

  console.log(`Found ${alertsSnapshot.docs.length} recent Safety Gate alerts`);

  return alertsSnapshot.docs.map((doc) => {
    const data = doc.data() as any;
    const meta = data.meta || {};
    const fields = data.fields || {};

    return {
      id: doc.id,
      meta: {
        ...meta,
        recordid: String(meta.recordid || doc.id),
        alert_date:
          meta.alert_date && typeof meta.alert_date.toDate === "function"
            ? meta.alert_date.toDate().toISOString()
            : String(meta.alert_date || ""),
        ingested_at:
          meta.ingested_at && typeof meta.ingested_at.toDate === "function"
            ? meta.ingested_at.toDate().toISOString()
            : String(meta.ingested_at || ""),
      },
      fields: {
        ...fields,
        product_category: String(fields.product_category || ""),
        product_description: String(fields.product_description || ""),
        risk_level: String(fields.risk_level || ""),
        alert_level: String(fields.alert_level || ""),
        alert_type: String(fields.alert_type || ""),
        risk_legal_provision: String(fields.risk_legal_provision || ""),
        notifying_country: String(fields.notifying_country || ""),
        product_brand: fields.product_brand != null ? String(fields.product_brand) : undefined,
        product_model: fields.product_model != null ? String(fields.product_model) : undefined,
        pictures: normalizePictures(fields),
      },
      source: "recent" as const,
    };
  });
}
