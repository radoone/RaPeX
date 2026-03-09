import { defineFirestoreRetriever } from "@genkit-ai/firebase";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { DocumentData, RetrieverAction } from "genkit/retriever";
import { functionsAi } from "./firebase-admin.js";
import type { ProductInput } from "./safety-gate-checker.schemas.js";
import { normalizePictures, normalizeTimestamp, prepareImageMedia } from "./safety-gate-checker-media.js";
import type { NormalizedAlert } from "./safety-gate-checker.types.js";

export const ALERT_LOOKBACK_DAYS = 365;

const RAG_TEXT_LIMIT = 12;
const RAG_IMAGE_LIMIT = 6;
const MAX_RAG_ALERTS = 12;
const VECTOR_TEXT_FIELD = "vector_text";
const VECTOR_IMAGE_FIELD = "vector_image";

let textRetriever: RetrieverAction | null = null;
let imageRetriever: RetrieverAction | null = null;

function ensureTextRetriever(): RetrieverAction | null {
  if (textRetriever) {
    return textRetriever;
  }

  try {
    textRetriever = defineFirestoreRetriever(functionsAi, {
      name: "rapex-text-retriever",
      firestore: getFirestore(),
      collection: "rapex_alerts",
      embedder: "googleai/text-embedding-004",
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
      name: "rapex-image-retriever",
      firestore: getFirestore(),
      collection: "rapex_alerts",
      embedder: "googleai/multimodalembedding@001",
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

  const candidates: NormalizedAlert[] = [];
  const seen = new Set<string>();
  const activeTextRetriever = ensureTextRetriever();
  const activeImageRetriever = ensureImageRetriever();

  if (!activeTextRetriever && !activeImageRetriever) {
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

  if (activeImageRetriever && product.imageUrl) {
    const encodedImage = await prepareImageMedia(product.imageUrl);
    if (encodedImage) {
      try {
        const result = await functionsAi.retrieve({
          retriever: activeImageRetriever,
          query: { content: [{ media: encodedImage }] },
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
    .collection("rapex_alerts")
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
