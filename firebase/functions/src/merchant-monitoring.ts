import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { randomUUID } from "node:crypto";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import { AI_CONFIG, FIRESTORE_COLLECTIONS, MATCHING_THRESHOLDS } from "./safety-gate-config.js";
import { buildMonitoringCursorValues } from "./monitoring-cursor.js";
import { monitoringTaskId, scheduledMonitoringRunId } from "./monitoring-task-id.js";
import { isProductChangeSupersededByDeletion } from "./product-lifecycle.js";
import { checkProductAgainstAlerts, checkProductSafety } from "./safety-gate-checker.js";
import type { ProductInput } from "./safety-gate-checker.schemas.js";
import { normalizePictures } from "./safety-gate-checker-media.js";
import type { NormalizedAlert } from "./safety-gate-checker.types.js";
import { ALERT_LOOKBACK_DAYS } from "./safety-gate-checker-retrieval.js";
import { buildEmbeddingText, embedImage, embedText, embedTexts } from "./safety-gate-embeddings.js";
import type {
  MerchantMonitorStateDocument,
  MerchantProductUpsertInput,
} from "./safety-gate-types.js";

type MerchantMonitoringSummary = {
  shop: string;
  mode: "delta" | "bootstrap" | "windowed";
  window: {
    strategy: "since-last-check" | "last-days" | "full-lookback";
    days: number | null;
    checkpointDate: string;
  };
  productsScanned: number;
  rapexAlertsScanned: number;
  matchesFound: number;
  alertsCreated: number;
  checkpoint: {
    lastRapexAlertDate: string | null;
    lastRapexRecordTimestamp: string | null;
  };
};

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

type AlertRetrievalCandidate = {
  alert: NormalizedAlert;
  textVector?: number[];
  imageVector?: number[];
};

type MerchantProductCandidate = {
  id: string;
  data: Record<string, unknown>;
};

type MerchantMonitoringWindow = {
  mode: MerchantMonitoringSummary["mode"];
  strategy: MerchantMonitoringSummary["window"]["strategy"];
  days: number | null;
  checkpointDate: Date;
  checkpointRecordTimestamp: string | null;
};

const MONITOR_TEXT_CANDIDATE_LIMIT = 8;
const MONITOR_IMAGE_CANDIDATE_LIMIT = 5;
const MAX_ALERTS_PER_PRODUCT = 12;
const MONITORING_RUNS = "monitoring_runs";
const MAX_MONITORING_TASK_ATTEMPTS = 8;
const MONITORING_TASK_QUEUE = getFunctions().taskQueue<MerchantMonitoringTaskPayload>(
  "locations/europe-west1/functions/merchantMonitoringTask",
);
const PRODUCT_CHANGE_TASK_QUEUE = getFunctions().taskQueue<ShopifyProductChangeTaskPayload>(
  "locations/europe-west1/functions/shopifyProductChangeTask",
);

export type MerchantMonitoringTaskPayload = {
  shop: string;
  runId: string;
  triggerMode: "scheduled";
};

export type ShopifyProductChangeTaskPayload = {
  operation?: "upsert" | "delete";
  shop: string;
  productId: string;
  productTitle?: string;
  productHandle?: string;
  sourceUpdatedAt?: string;
  product?: ProductInput;
  similarityThreshold?: number;
};

function monitoringRunRef(shop: string, runId: string, collection = MONITORING_RUNS) {
  return db.collection(FIRESTORE_COLLECTIONS.merchants)
    .doc(encodeURIComponent(shop))
    .collection(collection)
    .doc(runId);
}

function currentEntitlement(data: Record<string, unknown>): boolean {
  if (data.monitoringEntitled !== true || data.subscriptionStatus !== "active") return false;
  const validUntil = data.subscriptionValidUntil;
  return !(validUntil instanceof Timestamp) || validUntil.toMillis() > Date.now();
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
} as const;

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
  return coerceString(request.headers["x-api-key"]) || "";
}

function requireAuthorizedRequest(request: RequestShape): boolean {
  const expectedKey = (process.env.SAFETY_GATE_API_KEY ?? "").trim();
  const providedKey = extractApiKey(request);
  return Boolean(expectedKey && providedKey && expectedKey === providedKey);
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

function isMissingVectorIndexError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message || "";
  return message.includes("FAILED_PRECONDITION") && message.includes("Missing vector index configuration");
}

function normalizeAlertDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function normalizeTimestampString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function coercePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "string" && !value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function resolveMonitoringWindow(params: {
  currentState: MerchantMonitorStateDocument | null;
  forceFullScan?: boolean;
  allHistory?: boolean;
  days?: number;
}): MerchantMonitoringWindow {
  const now = new Date();
  const fullLookbackDate = new Date(now);
  fullLookbackDate.setDate(fullLookbackDate.getDate() - ALERT_LOOKBACK_DAYS);

  if (params.allHistory) {
    return {
      mode: "bootstrap",
      strategy: "full-lookback",
      days: null,
      checkpointDate: new Date("1970-01-01T00:00:00.000Z"),
      checkpointRecordTimestamp: null,
    };
  }

  if (params.forceFullScan) {
    return {
      mode: "bootstrap",
      strategy: "full-lookback",
      days: ALERT_LOOKBACK_DAYS,
      checkpointDate: fullLookbackDate,
      checkpointRecordTimestamp: null,
    };
  }

  if (Number.isFinite(params.days) && (params.days as number) > 0) {
    const boundedDays = Math.min(Math.floor(params.days as number), ALERT_LOOKBACK_DAYS);
    const lastDaysDate = new Date(now);
    lastDaysDate.setDate(lastDaysDate.getDate() - boundedDays);
    return {
      mode: "windowed",
      strategy: "last-days",
      days: boundedDays,
      checkpointDate: lastDaysDate,
      checkpointRecordTimestamp: null,
    };
  }

  const persistedCheckpoint = normalizeAlertDate(params.currentState?.lastRapexAlertDate);
  if (persistedCheckpoint) {
    return {
      mode: "delta",
      strategy: "since-last-check",
      days: null,
      checkpointDate: persistedCheckpoint,
      checkpointRecordTimestamp: params.currentState?.lastRapexRecordTimestamp || null,
    };
  }

  return {
    mode: "bootstrap",
    strategy: "full-lookback",
    days: ALERT_LOOKBACK_DAYS,
    checkpointDate: fullLookbackDate,
    checkpointRecordTimestamp: null,
  };
}

function toProductInput(document: Record<string, unknown>): ProductInput {
  const imageUrls = Array.isArray(document.imageUrls)
    ? document.imageUrls.filter((value): value is string => typeof value === "string")
    : undefined;

  return {
    name: String(document.name || document.productTitle || "Unknown product"),
    category: String(document.category || "general"),
    description: String(document.description || ""),
    imageUrl: coerceString(document.imageUrl),
    imageUrls,
    brand: coerceString(document.brand),
    model: coerceString(document.model),
    shop: coerceString(document.shop),
    productId: coerceString(document.productId),
    sourceUpdatedAt: coerceString(document.sourceUpdatedAt),
  };
}

function normalizeRapexAlert(docId: string, data: Record<string, unknown>): NormalizedAlert {
  const meta = (data.meta as Record<string, unknown>) || {};
  const fields = (data.fields as Record<string, unknown>) || {};
  const alertDate = normalizeAlertDate(meta.alert_date);
  const ingestedAt = normalizeAlertDate(meta.ingested_at);

  return {
    id: docId,
    meta: {
      recordid: String(meta.recordid || docId),
      alert_date: alertDate ? alertDate.toISOString() : "",
      ingested_at: ingestedAt ? ingestedAt.toISOString() : "",
      record_timestamp: normalizeTimestampString(meta.record_timestamp) || undefined,
    },
    fields: {
      ...fields,
      caseNumber: String(fields.caseNumber || fields.alert_number || ""),
      alert_number: String(fields.caseNumber || fields.alert_number || ""),
      brand: fields.brand != null ? String(fields.brand) : (fields.product_brand ? String(fields.product_brand) : undefined),
      product_brand: fields.brand != null ? String(fields.brand) : (fields.product_brand ? String(fields.product_brand) : undefined),
      name: String(fields.name || fields.product_name || ""),
      product_name: String(fields.name || fields.product_name || ""),
      type_numberOfModel: fields.type_numberOfModel != null ? String(fields.type_numberOfModel) : (fields.product_model ? String(fields.product_model) : undefined),
      product_model: fields.type_numberOfModel != null ? String(fields.type_numberOfModel) : (fields.product_model ? String(fields.product_model) : undefined),
      category: String(fields.category || fields.product_category || ""),
      product_category: String(fields.category || fields.product_category || ""),
      danger: String(fields.danger || fields.alert_description || ""),
      alert_description: String(fields.danger || fields.alert_description || ""),
      measures: String(fields.measures || fields.technical_defect || ""),
      technical_defect: String(fields.measures || fields.technical_defect || ""),
      description: String(fields.description || fields.product_description || ""),
      product_description: String(fields.description || fields.product_description || ""),
      level: String(fields.level || fields.risk_level || fields.alert_level || ""),
      risk_level: String(fields.level || fields.risk_level || fields.alert_level || ""),
      alert_level: String(fields.level || fields.alert_level || fields.risk_level || ""),
      riskType: String(fields.riskType || fields.alert_type || ""),
      alert_type: String(fields.riskType || fields.alert_type || ""),
      risk_legal_provision: String(fields.risk_legal_provision || fields.danger || ""),
      notifyingCountry: String(fields.notifyingCountry || fields.alert_country || fields.notifying_country || ""),
      notifying_country: String(fields.notifyingCountry || fields.alert_country || fields.notifying_country || ""),
      countryOfOrigin: String(fields.countryOfOrigin || fields.product_country || fields.country_of_origin || ""),
      pictures: normalizePictures(fields),
    },
    source: "recent",
  };
}

async function getMonitorState(shop: string): Promise<MerchantMonitorStateDocument | null> {
  const snapshot = await db
    .collection(FIRESTORE_COLLECTIONS.merchants)
    .doc(encodeURIComponent(shop))
    .get();
  if (!snapshot.exists) {
    return null;
  }
  return snapshot.data() as MerchantMonitorStateDocument;
}

async function loadRapexAlertCandidatesSince(
  checkpointDate: Date,
  limit: number,
  checkpointRecordTimestamp?: string | null,
  checkpointDocId?: string | null,
): Promise<AlertRetrievalCandidate[]> {
  let query = db
    .collection(FIRESTORE_COLLECTIONS.alerts)
    .where("meta.alert_date", ">=", Timestamp.fromDate(checkpointDate))
    .orderBy("meta.alert_date", "asc")
    .orderBy("meta.record_timestamp", "asc")
    .orderBy(FieldPath.documentId(), "asc");

  // Older monitor documents may have a timestamp checkpoint from before the
  // document ID tie-breaker was introduced. Passing an empty string as the
  // third cursor value is invalid in Firestore. Re-read from the inclusive
  // alert-date boundary in that case; alert upserts are idempotent, and the
  // completed run writes the full timestamp + document ID checkpoint.
  const cursorValues = buildMonitoringCursorValues(checkpointDate, checkpointRecordTimestamp, checkpointDocId);
  if (cursorValues) {
    query = query.startAfter(
      Timestamp.fromDate(cursorValues[0]),
      cursorValues[1],
      cursorValues[2],
    );
  }

  const snapshot = await query.limit(limit).get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        alert: normalizeRapexAlert(doc.id, data),
        textVector: asVectorArray(data.vector_text),
        imageVector: asVectorArray(data.vector_image),
      };
    })
    .sort((left, right) => {
      const leftDate = normalizeAlertDate(left.alert.meta.alert_date)?.getTime() || 0;
      const rightDate = normalizeAlertDate(right.alert.meta.alert_date)?.getTime() || 0;
      if (leftDate !== rightDate) {
        return leftDate - rightDate;
      }

      const timestampOrder = String(left.alert.meta.record_timestamp || "").localeCompare(
        String(right.alert.meta.record_timestamp || ""),
      );
      return timestampOrder || left.alert.id.localeCompare(right.alert.id);
    });
}

async function findCandidateProductsForAlert(
  shop: string,
  alertCandidate: AlertRetrievalCandidate,
): Promise<MerchantProductCandidate[]> {
  const candidates = new Map<string, MerchantProductCandidate>();
  const collection = db
    .collection(FIRESTORE_COLLECTIONS.merchants)
    .doc(encodeURIComponent(shop))
    .collection(FIRESTORE_COLLECTIONS.subProducts);

  if (alertCandidate.textVector?.length) {
    try {
      const textSnapshot = await collection
        .findNearest({
          vectorField: "vector_text",
          queryVector: alertCandidate.textVector,
          limit: MONITOR_TEXT_CANDIDATE_LIMIT,
          distanceMeasure: "COSINE",
          distanceResultField: "text_distance",
        })
        .get();

      for (const doc of textSnapshot.docs) {
        const distance = doc.get("text_distance");
        if (distance != null && distance > MATCHING_THRESHOLDS.textDistance) {
          continue;
        }
        candidates.set(doc.id, {
          id: doc.id,
          data: doc.data() as Record<string, unknown>,
        });
      }
    } catch (error) {
      if (!isMissingVectorIndexError(error)) {
        throw error;
      }
      logger.warn("Skipping merchant text vector retrieval because Firestore index is not ready", {
        shop,
        alertId: alertCandidate.alert.id,
        vectorField: "vector_text",
      });
    }
  }

  if (alertCandidate.imageVector?.length) {
    try {
      const imageSnapshot = await collection
        .findNearest({
          vectorField: "vector_image",
          queryVector: alertCandidate.imageVector,
          limit: MONITOR_IMAGE_CANDIDATE_LIMIT,
          distanceMeasure: "COSINE",
          distanceResultField: "image_distance",
        })
        .get();

      for (const doc of imageSnapshot.docs) {
        const distance = doc.get("image_distance");
        if (distance != null && distance > MATCHING_THRESHOLDS.imageDistance) {
          continue;
        }
        candidates.set(doc.id, {
          id: doc.id,
          data: doc.data() as Record<string, unknown>,
        });
      }
    } catch (error) {
      if (!isMissingVectorIndexError(error)) {
        throw error;
      }
      logger.warn("Skipping merchant image vector retrieval because Firestore index is not ready", {
        shop,
        alertId: alertCandidate.alert.id,
        vectorField: "vector_image",
      });
    }
  }

  return Array.from(candidates.values());
}

async function upsertAlertForProduct(params: {
  shop: string;
  productId: string;
  productTitle: string;
  productHandle?: string;
  resultJson: string;
  warningsCount: number;
  riskLevel: string;
}): Promise<boolean> {
  const alertsCollection = db
    .collection(FIRESTORE_COLLECTIONS.merchants)
    .doc(encodeURIComponent(params.shop))
    .collection(FIRESTORE_COLLECTIONS.subAlerts);

  const query = await alertsCollection
    .where("productId", "==", params.productId)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (!query.empty) {
    const existing = query.docs[0];
    await existing.ref.set(
      {
        checkResult: params.resultJson,
        warningsCount: params.warningsCount,
        riskLevel: params.riskLevel,
        updatedAt: FieldValue.serverTimestamp(),
        resolvedAt: null,
        dismissedAt: null,
        dismissedBy: null,
        resolutionType: null,
        status: "active",
      },
      { merge: true },
    );
    return false;
  }

  await alertsCollection.add({
    shop: params.shop,
    productId: params.productId,
    productTitle: params.productTitle,
    productHandle: params.productHandle || null,
    checkResult: params.resultJson,
    status: "active",
    riskLevel: params.riskLevel,
    warningsCount: params.warningsCount,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    dismissedAt: null,
    dismissedBy: null,
    resolvedAt: null,
    resolutionType: null,
    notes: null,
  });
  return true;
}

export async function upsertMerchantProduct(
  input: MerchantProductUpsertInput,
): Promise<{ shop: string; productId: string; vectorTextWritten: boolean; vectorImageWritten: boolean }> {
  const productId = String(input.productId || "").trim();
  const shop = String(input.shop || "").trim();
  if (!shop || !productId) {
    throw new Error("shop and productId are required");
  }

  const primaryImage = input.product.imageUrl || input.product.imageUrls?.[0];
  const textContent = buildEmbeddingText({
    brand: input.product.brand,
    model: input.product.model,
    category: input.product.category,
    title: input.product.name,
    description: input.product.description,
  });

  const merchantRef = db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(shop));
  const docRef = merchantRef
    .collection(FIRESTORE_COLLECTIONS.subProducts)
    .doc(encodeURIComponent(productId));

  const existingSnapshot = await docRef.get();
  const existingData = (existingSnapshot.data() as Record<string, unknown> | undefined) || {};
  const existingSourceUpdatedAt =
    typeof existingData.sourceUpdatedAt === "string" ? existingData.sourceUpdatedAt.trim() : undefined;
  const incomingSourceUpdatedAt = input.sourceUpdatedAt?.trim();
  const canReuseCachedVectors = Boolean(
    existingSnapshot.exists &&
      existingSourceUpdatedAt &&
      incomingSourceUpdatedAt &&
      existingSourceUpdatedAt === incomingSourceUpdatedAt,
  );

  const [vectorText, vectorImage] = await Promise.all([
    canReuseCachedVectors || !textContent
      ? Promise.resolve(undefined)
      : embedText(textContent),
    canReuseCachedVectors || !primaryImage
      ? Promise.resolve(undefined)
      : embedImage(primaryImage),
  ]);

  const payload: Record<string, unknown> = {
    shop,
    productId,
    productTitle: input.productTitle,
    name: input.product.name,
    category: input.product.category,
    description: input.product.description,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(input.productHandle ? { productHandle: input.productHandle } : {}),
    ...(primaryImage ? { imageUrl: primaryImage } : {}),
    ...(input.product.imageUrls?.length ? { imageUrls: input.product.imageUrls } : {}),
    ...(input.product.brand ? { brand: input.product.brand } : {}),
    ...(input.product.model ? { model: input.product.model } : {}),
    ...(input.sourceUpdatedAt ? { sourceUpdatedAt: input.sourceUpdatedAt } : {}),
    ...(vectorText?.length ? { vector_text: FieldValue.vector(vectorText) } : {}),
    ...(vectorImage?.length ? { vector_image: FieldValue.vector(vectorImage) } : {}),
  };

  await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(docRef);
    const latestVersion = latest.get("sourceUpdatedAt");
    if (typeof latestVersion === "string" && incomingSourceUpdatedAt &&
      Date.parse(latestVersion) > Date.parse(incomingSourceUpdatedAt)) return;
    transaction.set(docRef, {
      ...payload,
      createdAt: latest.exists ? latest.get("createdAt") || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(merchantRef, { shop, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  return {
    shop,
    productId,
    vectorTextWritten: Boolean(vectorText?.length),
    vectorImageWritten: Boolean(vectorImage?.length),
  };
}

/** Import a Shopify catalog page with batched text embeddings and bounded image work. */
export async function upsertMerchantProductsBatch(
  inputs: MerchantProductUpsertInput[],
): Promise<{ imported: number; embedded: number }> {
  if (!inputs.length) return { imported: 0, embedded: 0 };

  const prepared = inputs.map((input) => {
    const productId = String(input.productId || "").trim();
    const shop = String(input.shop || "").trim();
    if (!shop || !productId) throw new Error("shop and productId are required");
    return {
      input,
      shop,
      productId,
      text: buildEmbeddingText({
        brand: input.product.brand,
        model: input.product.model,
        category: input.product.category,
        title: input.product.name,
        description: input.product.description,
      }),
      image: input.product.imageUrl || input.product.imageUrls?.[0],
    };
  });
  const shop = prepared[0].shop;
  if (prepared.some((item) => item.shop !== shop)) throw new Error("A product batch must belong to one shop");

  const merchantRef = db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(shop));
  const existingSnapshots = await Promise.all(prepared.map((item) => merchantRef
    .collection(FIRESTORE_COLLECTIONS.subProducts)
    .doc(encodeURIComponent(item.productId))
    .get()));
  const reusable = prepared.map((item, index) => {
    const existing = existingSnapshots[index];
    const existingData = (existing.data() || {}) as Record<string, unknown>;
    return existing.exists &&
      typeof existingData.sourceUpdatedAt === "string" &&
      Boolean(item.input.sourceUpdatedAt) &&
      existingData.sourceUpdatedAt === item.input.sourceUpdatedAt;
  });

  const textVectors: Array<number[] | undefined> = new Array(prepared.length);
  const imageVectors: Array<number[] | undefined> = new Array(prepared.length);
  for (let start = 0; start < prepared.length; start += 50) {
    const indexes = prepared.slice(start, start + 50)
      .map((_, offset) => start + offset)
      .filter((index) => !reusable[index] && Boolean(prepared[index].text));
    const vectors = await embedTexts(indexes.map((index) => prepared[index].text));
    indexes.forEach((index, vectorIndex) => { textVectors[index] = vectors[vectorIndex]; });
  }

  for (let start = 0; start < prepared.length; start += 4) {
    const indexes = prepared.slice(start, start + 4)
      .map((_, offset) => start + offset)
      .filter((index) => !reusable[index] && Boolean(prepared[index].image));
    const vectors = await Promise.all(indexes.map((index) => embedImage(prepared[index].image!)));
    indexes.forEach((index, vectorIndex) => { imageVectors[index] = vectors[vectorIndex]; });
  }

  const batch = db.batch();
  let embedded = 0;
  prepared.forEach((item, index) => {
    if (!reusable[index] && item.text && !textVectors[index]?.length) {
      throw new Error(`Text embedding is unavailable for Shopify product ${item.productId}`);
    }
    const existing = existingSnapshots[index];
    const docRef = merchantRef.collection(FIRESTORE_COLLECTIONS.subProducts).doc(encodeURIComponent(item.productId));
    const changedSource = !reusable[index];
    const payload: Record<string, unknown> = {
      shop,
      productId: item.productId,
      productTitle: item.input.productTitle,
      name: item.input.product.name,
      category: item.input.product.category,
      description: item.input.product.description,
      createdAt: existing.exists ? existing.get("createdAt") || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(item.input.productHandle ? { productHandle: item.input.productHandle } : {}),
      ...(item.image ? { imageUrl: item.image } : {}),
      ...(item.input.product.imageUrls?.length ? { imageUrls: item.input.product.imageUrls } : {}),
      ...(item.input.product.brand ? { brand: item.input.product.brand } : {}),
      ...(item.input.product.model ? { model: item.input.product.model } : {}),
      ...(item.input.sourceUpdatedAt ? { sourceUpdatedAt: item.input.sourceUpdatedAt } : {}),
      ...(changedSource ? { vector_text: textVectors[index]?.length ? FieldValue.vector(textVectors[index]!) : FieldValue.delete() } : {}),
      ...(changedSource ? { vector_image: imageVectors[index]?.length ? FieldValue.vector(imageVectors[index]!) : FieldValue.delete() } : {}),
    };
    if (textVectors[index]?.length) embedded += 1;
    batch.set(docRef, payload, { merge: true });
  });
  batch.set(merchantRef, { shop, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  return { imported: prepared.length, embedded };
}

export async function runMerchantDeltaMonitoringForShop(params: {
  shop: string;
  forceFullScan?: boolean;
  allHistory?: boolean;
  days?: number;
  limit?: number;
  triggerMode?: "manual" | "scheduled";
  runId?: string;
  monitoringRunCollection?: string;
}): Promise<MerchantMonitoringSummary> {
  const shop = params.shop.trim();
  if (!shop) {
    throw new Error("shop is required");
  }

  const monitorRef = db
    .collection(FIRESTORE_COLLECTIONS.merchants)
    .doc(encodeURIComponent(shop));
  const currentState = await getMonitorState(shop);
  const forceFullScan = Boolean(params.forceFullScan);
  const monitoringWindow = resolveMonitoringWindow({
    currentState,
    forceFullScan,
    allHistory: params.allHistory,
    days: params.days,
  });
  const limit = Number.isFinite(params.limit) && (params.limit as number) > 0
    ? Math.min(Math.floor(params.limit as number), 500)
    : 250;
  const runId = params.runId || randomUUID();
  const runRef = params.runId
    ? monitoringRunRef(shop, params.runId, params.monitoringRunCollection)
    : null;

  if (runRef) {
    const completedRun = await runRef.get();
    const completedSummary = completedRun.get("completedSummary");
    if (completedRun.get("status") === "completed" && completedSummary && typeof completedSummary === "object") {
      return completedSummary as MerchantMonitoringSummary;
    }
  }

  await monitorRef.set(
    {
      shop,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: currentState?.createdAt || FieldValue.serverTimestamp(),
      lastMonitorRunStart: FieldValue.serverTimestamp(),
      lastMonitorStatus: "IN_PROGRESS",
      lastRunMode: monitoringWindow.mode,
    } satisfies MerchantMonitorStateDocument,
    { merge: true },
  );

  try {
    const rapexAlertCandidates = await loadRapexAlertCandidatesSince(
      monitoringWindow.checkpointDate,
      limit,
      monitoringWindow.strategy === "since-last-check"
        ? monitoringWindow.checkpointRecordTimestamp
        : null,
      monitoringWindow.strategy === "since-last-check" ? currentState?.lastRapexAlertDocId : null,
    );
    const rapexAlerts = rapexAlertCandidates.map((candidate) => candidate.alert);
    const candidateProductsByDocId = new Map<
      string,
      { product: MerchantProductCandidate; alerts: Map<string, NormalizedAlert> }
    >();

    for (const alertCandidate of rapexAlertCandidates) {
      const productCandidates = await findCandidateProductsForAlert(shop, alertCandidate);
      for (const productCandidate of productCandidates) {
        const existing = candidateProductsByDocId.get(productCandidate.id) ?? {
          product: productCandidate,
          alerts: new Map<string, NormalizedAlert>(),
        };

        if (existing.alerts.size < MAX_ALERTS_PER_PRODUCT) {
          existing.alerts.set(alertCandidate.alert.id, alertCandidate.alert);
        }

        candidateProductsByDocId.set(productCandidate.id, existing);
      }
    }

    logger.info("Merchant delta monitoring shortlist prepared", {
      shop,
      rapexAlertsScanned: rapexAlerts.length,
      candidateProducts: candidateProductsByDocId.size,
      mode: monitoringWindow.mode,
      windowStrategy: monitoringWindow.strategy,
      windowDays: monitoringWindow.days,
      checkpointDate: monitoringWindow.checkpointDate.toISOString(),
    });

    if (runRef) {
      await runRef.set({
        status: "processing",
        rapexAlertsScanned: rapexAlerts.length,
        candidateProducts: candidateProductsByDocId.size,
        productsScanned: 0,
        matchesFound: 0,
        alertsCreated: 0,
        heartbeatAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    let matchesFound = 0;
    let alertsCreated = 0;
    let productsScanned = 0;

    for (const candidate of candidateProductsByDocId.values()) {
      const productInput = toProductInput(candidate.product.data);
      const result = await checkProductAgainstAlerts(
        productInput,
        Array.from(candidate.alerts.values()),
      );
      productsScanned += 1;

      const expireDate = new Date();
      expireDate.setDate(expireDate.getDate() + AI_CONFIG.checkHistoryTtlDays);

      await db
        .collection(FIRESTORE_COLLECTIONS.merchants)
        .doc(encodeURIComponent(shop))
        .collection(FIRESTORE_COLLECTIONS.subChecks)
        .doc(monitoringTaskId(shop, `${runId}:${candidate.product.data.productId || candidate.product.id}`))
        .set({
          shop,
          productId: String(candidate.product.data.productId || ""),
          productTitle: String(candidate.product.data.productTitle || candidate.product.data.name || ""),
          isSafe: result.isSafe,
          checkedAt: new Date(result.checkedAt),
          ...(typeof candidate.product.data.sourceUpdatedAt === "string"
            ? { sourceUpdatedAt: candidate.product.data.sourceUpdatedAt }
            : {}),
          createdAt: FieldValue.serverTimestamp(),
          expireAt: Timestamp.fromDate(expireDate),
        });

      await db
        .collection(FIRESTORE_COLLECTIONS.merchants)
        .doc(encodeURIComponent(shop))
        .collection(FIRESTORE_COLLECTIONS.subProducts)
        .doc(candidate.product.id)
        .set(
          {
            updatedAt: FieldValue.serverTimestamp(),
            lastDeltaCheckAt: FieldValue.serverTimestamp(),
            lastCheckedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

      if (!result.isSafe && result.warnings.length > 0) {
        matchesFound += result.warnings.length;
        const created = await upsertAlertForProduct({
          shop,
          productId: String(candidate.product.data.productId || ""),
          productTitle: String(candidate.product.data.productTitle || candidate.product.data.name || ""),
          productHandle: coerceString(candidate.product.data.productHandle),
          resultJson: JSON.stringify(result),
          warningsCount: result.warnings.length,
          riskLevel:
            result.warnings[0]?.alertDetails?.fields?.alert_level ||
            result.warnings[0]?.alertDetails?.fields?.risk_level ||
            result.warnings[0]?.riskLevel ||
            "Unknown",
        });
        if (created) {
          alertsCreated += 1;
        }
      }

      if (runRef && (productsScanned % 5 === 0 || productsScanned === candidateProductsByDocId.size)) {
        await runRef.set({
          productsScanned,
          matchesFound,
          alertsCreated,
          heartbeatAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    const latestAlert = rapexAlerts.at(-1);
    const summary: MerchantMonitoringSummary = {
      shop,
      mode: monitoringWindow.mode,
      window: {
        strategy: monitoringWindow.strategy,
        days: monitoringWindow.days,
        checkpointDate: monitoringWindow.checkpointDate.toISOString(),
      },
      productsScanned,
      rapexAlertsScanned: rapexAlerts.length,
      matchesFound,
      alertsCreated,
      checkpoint: {
        lastRapexAlertDate: latestAlert?.meta.alert_date || normalizeAlertDate(currentState?.lastRapexAlertDate)?.toISOString() || null,
        lastRapexRecordTimestamp: latestAlert?.meta.record_timestamp || currentState?.lastRapexRecordTimestamp || null,
      },
    };

    const checkpointUpdate = {
        updatedAt: FieldValue.serverTimestamp(),
        lastMonitorRunEnd: FieldValue.serverTimestamp(),
        lastMonitorStatus: "SUCCESS",
        lastRunMode: summary.mode,
        lastProductsScanned: summary.productsScanned,
        lastAlertsCreated: summary.alertsCreated,
        lastMatchesFound: summary.matchesFound,
        lastRapexAlertDate: summary.checkpoint.lastRapexAlertDate
          ? Timestamp.fromDate(new Date(summary.checkpoint.lastRapexAlertDate))
          : currentState?.lastRapexAlertDate || null,
        lastRapexRecordTimestamp:
          summary.checkpoint.lastRapexRecordTimestamp || currentState?.lastRapexRecordTimestamp || null,
        lastRapexAlertDocId: latestAlert?.id || currentState?.lastRapexAlertDocId || null,
      } satisfies Partial<MerchantMonitorStateDocument>;
    await db.runTransaction(async (transaction) => {
      transaction.set(monitorRef, checkpointUpdate, { merge: true });
      if (runRef) {
        transaction.set(runRef, {
          status: "completed",
          completedSummary: summary,
          completedAt: FieldValue.serverTimestamp(),
          leaseExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });

    return summary;
  } catch (error) {
    await monitorRef.set(
      {
        updatedAt: FieldValue.serverTimestamp(),
        lastMonitorRunEnd: FieldValue.serverTimestamp(),
        lastMonitorStatus: "FAILURE",
        lastError: error instanceof Error ? error.message : String(error),
      } satisfies Partial<MerchantMonitorStateDocument>,
      { merge: true },
    );
    throw error;
  }
}

async function enqueueMerchantMonitoringTask(payload: MerchantMonitoringTaskPayload): Promise<boolean> {
  const runRef = monitoringRunRef(payload.shop, payload.runId);
  const shouldEnqueue = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runRef);
    const status = snapshot.get("status");
    if (status === "completed" || status === "skipped_unentitled") return false;
    if (status === "queued" || status === "processing" || status === "retrying") return false;

    transaction.set(runRef, {
      shop: payload.shop,
      runId: payload.runId,
      triggerMode: payload.triggerMode,
      mode: "delta",
      status: "queued",
      createdAt: snapshot.get("createdAt") || FieldValue.serverTimestamp(),
      queuedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      attemptCount: 0,
    }, { merge: true });
    return true;
  });
  if (!shouldEnqueue) return false;

  try {
    await MONITORING_TASK_QUEUE.enqueue(payload, {
      id: monitoringTaskId(payload.shop, payload.runId),
      dispatchDeadlineSeconds: 1800,
    });
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code === "functions/task-already-exists") {
      return false;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    await runRef.set({
      status: "enqueue_failed",
      lastError: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(payload.shop)).set({
      lastMonitorStatus: "FAILURE",
      lastMonitorRunStart: FieldValue.serverTimestamp(),
      lastMonitorRunEnd: FieldValue.serverTimestamp(),
      lastRunMode: "delta",
      lastError: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}

export async function handleMerchantMonitoringTask(
  payload: MerchantMonitoringTaskPayload,
  retryCount: number,
): Promise<void> {
  const shop = coerceString(payload?.shop);
  const runId = coerceString(payload?.runId);
  if (!shop || !runId || payload?.triggerMode !== "scheduled") {
    throw new Error("Invalid merchant monitoring task payload");
  }

  const runRef = monitoringRunRef(shop, runId);
  const merchantRef = db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(shop));
  const claim = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runRef);
    if (!snapshot.exists) return "missing" as const;
    const status = snapshot.get("status");
    if (status === "completed" || status === "skipped_unentitled") return "finished" as const;
    const leaseExpiresAt = snapshot.get("leaseExpiresAt");
    if (status === "processing" && leaseExpiresAt instanceof Timestamp && leaseExpiresAt.toMillis() > Date.now()) {
      return "busy" as const;
    }

    const leaseExpires = Timestamp.fromMillis(Date.now() + 33 * 60 * 1000);
    transaction.set(runRef, {
      status: "processing",
      attemptCount: retryCount + 1,
      startedAt: snapshot.get("startedAt") || FieldValue.serverTimestamp(),
      lastAttemptAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: leaseExpires,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return "claimed" as const;
  });

  if (claim === "missing") throw new Error("Merchant monitoring run record is missing");
  if (claim === "finished") return;
  if (claim === "busy") throw new Error("Merchant monitoring run is already being processed; retry after its lease expires");

  const merchantSnapshot = await merchantRef.get();
  if (!merchantSnapshot.exists || !currentEntitlement(merchantSnapshot.data() || {})) {
    await runRef.set({
      status: "skipped_unentitled",
      skippedAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  try {
    const result = await runMerchantDeltaMonitoringForShop({
      shop,
      triggerMode: "scheduled",
      runId,
    });
    await runRef.set({
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: FieldValue.delete(),
      result,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    const exhausted = retryCount + 1 >= MAX_MONITORING_TASK_ATTEMPTS;
    await runRef.set({
      status: exhausted ? "failed" : "retrying",
      lastError: error instanceof Error ? error.message : String(error),
      ...(exhausted ? { failedAt: FieldValue.serverTimestamp() } : {}),
      leaseExpiresAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}

export async function runDailyMerchantDeltaMonitoring(scheduleTime?: string): Promise<{
  shopsQueued: number;
  shopsSkippedUnentitled: number;
  failures: Array<{ shop: string; error: string }>;
}> {
  const merchantsSnapshot = await db
    .collection(FIRESTORE_COLLECTIONS.merchants)
    .select("shop", "monitoringEntitled", "subscriptionStatus", "subscriptionValidUntil")
    .get();

  const eligibleShops = merchantsSnapshot.docs.filter((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return currentEntitlement(data);
  }).map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return coerceString(data.shop) || decodeURIComponent(doc.id);
  }).filter((shop): shop is string => Boolean(shop));

  const failures: Array<{ shop: string; error: string }> = [];

  const scheduledAt = scheduleTime ? new Date(scheduleTime) : new Date();
  const runId = scheduledMonitoringRunId(Number.isNaN(scheduledAt.getTime()) ? new Date() : scheduledAt);
  let shopsQueued = 0;

  for (let index = 0; index < eligibleShops.length; index += 10) {
    const batch = eligibleShops.slice(index, index + 10);
    const results = await Promise.allSettled(batch.map((shop) => enqueueMerchantMonitoringTask({
      shop,
      runId,
      triggerMode: "scheduled",
    })));
    results.forEach((result, batchIndex) => {
      if (result.status === "fulfilled") {
        if (result.value) shopsQueued += 1;
        return;
      }
      const shop = batch[batchIndex];
      const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push({ shop, error: errorMessage });
      logger.error("Could not enqueue scheduled merchant delta monitoring", { shop, error: errorMessage });
    });
  }

  return {
    shopsQueued,
    shopsSkippedUnentitled: merchantsSnapshot.size - eligibleShops.length,
    failures,
  };
}

function productChangeJobId(payload: ShopifyProductChangeTaskPayload): string {
  return monitoringTaskId(payload.shop, payload.operation === "delete"
    ? `product-delete:${payload.productId}`
    : `product:${payload.productId}:${payload.sourceUpdatedAt}`);
}

function productChangeJobRef(shop: string, jobId: string) {
  return db.collection(FIRESTORE_COLLECTIONS.merchants)
    .doc(encodeURIComponent(shop))
    .collection("product_change_jobs")
    .doc(jobId);
}

/** Fast authenticated ingress: Shopify's webhook only queues work and returns. */
export async function handleStartShopifyProductChangeRequest(
  request: RequestShape,
  response: ResponseShape,
): Promise<void> {
  applyCorsHeaders(response);
  if (request.method === "OPTIONS") return response.status(204).send("");
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (!requireAuthorizedRequest(request)) return response.status(401).json({ error: "Unauthorized" });

  try {
    const body = request.body || {};
    const shop = coerceString(body.shop);
    const productId = coerceString(body.productId);
    const productTitle = coerceString(body.productTitle);
    const sourceUpdatedAt = coerceString(body.sourceUpdatedAt);
    const operation = body.operation === "delete" ? "delete" : "upsert";
    const product = body.product as ProductInput | undefined;
    const threshold = Number(body.similarityThreshold ?? 0);
    if (!shop || !productId || (operation === "upsert" && (!productTitle || !sourceUpdatedAt || !product?.name || !product.category || !product.description))) {
      return response.status(400).json({ error: "shop, product identity, sourceUpdatedAt and normalized product fields are required" });
    }
    const payload: ShopifyProductChangeTaskPayload = {
      operation,
      shop,
      productId,
      ...(productTitle ? { productTitle } : {}),
      productHandle: coerceString(body.productHandle),
      ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
      ...(product ? { product: { ...product, shop, productId, sourceUpdatedAt } } : {}),
      similarityThreshold: Number.isFinite(threshold) ? Math.max(0, threshold) : 0,
    };
    const merchantRef = db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(shop));
    const merchantSnapshot = await merchantRef.get();
    if (operation !== "delete" && !currentEntitlement((merchantSnapshot.data() || {}) as Record<string, unknown>)) {
      return response.status(200).json({ success: true, queued: false, reason: "no_current_entitlement" });
    }

    const jobId = productChangeJobId(payload);
    const jobRef = productChangeJobRef(shop, jobId);
    const shouldEnqueue = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(jobRef);
      if (["queued", "processing", "completed"].includes(String(snapshot.get("status")))) return false;
      transaction.set(jobRef, {
        shop,
        productId,
        sourceUpdatedAt,
        status: "queued",
        attemptCount: 0,
        createdAt: snapshot.get("createdAt") || FieldValue.serverTimestamp(),
        queuedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
    if (shouldEnqueue) {
      try {
        await PRODUCT_CHANGE_TASK_QUEUE.enqueue(payload, {
          id: jobId,
          dispatchDeadlineSeconds: 1800,
        });
      } catch (error) {
        if ((error as { code?: string })?.code !== "functions/task-already-exists") {
          await jobRef.set({ status: "enqueue_failed", lastError: error instanceof Error ? error.message : String(error), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          throw error;
        }
      }
    }
    return response.status(202).json({ success: true, queued: true, jobId });
  } catch (error) {
    logger.error("Could not queue Shopify product change", { error });
    return response.status(500).json({ success: false, error: "Could not queue product check" });
  }
}

/** Retryable Cloud Task processor for Shopify product lifecycle webhooks. */
export async function handleShopifyProductChangeTask(
  payload: ShopifyProductChangeTaskPayload,
  retryCount = 0,
): Promise<void> {
  const shop = payload.shop.trim();
  const jobId = productChangeJobId(payload);
  const jobRef = productChangeJobRef(shop, jobId);
  const merchantRef = db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(shop));
  const jobSnapshot = await jobRef.get();
  if (jobSnapshot.get("status") === "completed") return;
  const merchantSnapshot = await merchantRef.get();
  if (payload.operation !== "delete" && !currentEntitlement((merchantSnapshot.data() || {}) as Record<string, unknown>)) {
    await jobRef.set({ status: "skipped_unentitled", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return;
  }

  await jobRef.set({ status: "processing", attemptCount: retryCount + 1, startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  try {
    const productRef = merchantRef.collection(FIRESTORE_COLLECTIONS.subProducts).doc(encodeURIComponent(payload.productId));
    if (payload.operation === "delete") {
      const now = FieldValue.serverTimestamp();
      const productSnapshot = await productRef.get();
      const alertSnapshot = await merchantRef.collection(FIRESTORE_COLLECTIONS.subAlerts)
        .where("productId", "==", payload.productId)
        .get();
      const batch = db.batch();
      if (productSnapshot.exists) {
        batch.set(productRef, {
          deletedAt: now,
          deletedSourceUpdatedAt: payload.sourceUpdatedAt || null,
          updatedAt: now,
        }, { merge: true });
      }
      alertSnapshot.docs.forEach((document) => batch.set(document.ref, {
        productDeleted: true,
        productDeletedAt: now,
        updatedAt: now,
      }, { merge: true }));
      if (productSnapshot.exists || !alertSnapshot.empty) await batch.commit();
      await jobRef.set({ status: "completed", completedAt: now, updatedAt: now }, { merge: true });
      return;
    }

    if (!payload.sourceUpdatedAt || !payload.product || !payload.productTitle) {
      throw new Error("Product change task is missing normalized product data");
    }
    const existingProduct = await productRef.get();
    const existingVersion = existingProduct.get("sourceUpdatedAt");
    if (typeof existingVersion === "string" && Date.parse(existingVersion) > Date.parse(payload.sourceUpdatedAt)) {
      await jobRef.set({ status: "superseded", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }
    if (isProductChangeSupersededByDeletion(
      existingProduct.get("deletedAt"),
      existingProduct.get("deletedSourceUpdatedAt"),
      payload.sourceUpdatedAt,
    )) {
      await jobRef.set({ status: "superseded", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }
    await upsertMerchantProduct({
      shop,
      productId: payload.productId,
      productTitle: payload.productTitle,
      productHandle: payload.productHandle,
      product: payload.product,
      sourceUpdatedAt: payload.sourceUpdatedAt,
    });
    const currentProduct = await productRef.get();
    if (currentProduct.get("sourceUpdatedAt") !== payload.sourceUpdatedAt) {
      await jobRef.set({ status: "superseded", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    let resultJson = jobSnapshot.get("resultJson");
    if (typeof resultJson !== "string") {
      const result = await checkProductSafety(payload.product);
      const threshold = payload.similarityThreshold ?? 0;
      const filteredWarnings = threshold > 0
        ? result.warnings.filter((warning) => warning.overallSimilarity >= threshold)
        : result.warnings;
      const filteredResult = {
        ...result,
        warnings: filteredWarnings,
        isSafe: filteredWarnings.length === 0,
      };
      resultJson = JSON.stringify(filteredResult);
      await jobRef.set({ status: "analyzed", resultJson, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    const result = JSON.parse(resultJson) as {
      isSafe: boolean;
      warnings: Array<Record<string, any>>;
      checkedAt: string;
    };
    const productKey = `${jobId}`;
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + AI_CONFIG.checkHistoryTtlDays);
    await merchantRef.collection(FIRESTORE_COLLECTIONS.subChecks).doc(productKey).set({
      shop,
      productId: payload.productId,
      productTitle: payload.productTitle,
      isSafe: result.isSafe,
      checkedAt: new Date(result.checkedAt),
      sourceUpdatedAt: payload.sourceUpdatedAt,
      createdAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromDate(expireDate),
    }, { merge: true });

    await productRef.set({
      deletedAt: FieldValue.delete(),
      deletedSourceUpdatedAt: FieldValue.delete(),
      lastImmediateCheckAt: FieldValue.serverTimestamp(),
      lastCheckedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (!result.isSafe && result.warnings.length > 0) {
      const warning = result.warnings[0];
      await upsertAlertForProduct({
        shop,
        productId: payload.productId,
        productTitle: payload.productTitle,
        productHandle: payload.productHandle,
        resultJson,
        warningsCount: result.warnings.length,
        riskLevel: warning.alertDetails?.fields?.alert_level || warning.alertDetails?.fields?.risk_level || warning.riskLevel || "Unknown",
      });
    } else {
      const activeAlerts = await merchantRef.collection(FIRESTORE_COLLECTIONS.subAlerts)
        .where("productId", "==", payload.productId)
        .where("status", "==", "active")
        .get();
      const batch = db.batch();
      activeAlerts.docs.forEach((document) => batch.set(document.ref, {
        status: "resolved",
        resolvedAt: FieldValue.serverTimestamp(),
        resolutionType: "automatic_product_update",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }));
      if (!activeAlerts.empty) await batch.commit();
    }

    await jobRef.set({ status: "completed", completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logger.info("Shopify product change processed", { shop, productId: payload.productId, sourceUpdatedAt: payload.sourceUpdatedAt, isSafe: result.isSafe });
  } catch (error) {
    await jobRef.set({ status: "retrying", lastError: error instanceof Error ? error.message : String(error), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
}

function parseUpsertInput(body: Record<string, unknown> | undefined): MerchantProductUpsertInput {
  if (!body) {
    throw new Error("Request body is required");
  }

  const shop = coerceString(body.shop);
  const productId = coerceString(body.productId);
  const productTitle = coerceString(body.productTitle);
  const product = body.product as ProductInput | undefined;

  if (!shop || !productId || !productTitle || !product) {
    throw new Error("shop, productId, productTitle and product are required");
  }

  return {
    shop,
    productId,
    productTitle,
    productHandle: coerceString(body.productHandle),
    sourceUpdatedAt: coerceString(body.sourceUpdatedAt),
    product,
  };
}

export async function handleUpsertMerchantProductRequest(
  request: RequestShape,
  response: ResponseShape,
): Promise<void> {
  applyCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!requireAuthorizedRequest(request)) {
    response.status(401).json({ error: "Unauthorized", message: "Valid API key required" });
    return;
  }

  try {
    const input = parseUpsertInput(request.body);
    const result = await upsertMerchantProduct(input);
    response.status(200).json({ success: true, result });
  } catch (error) {
    response.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handleRunMerchantDeltaMonitoringRequest(
  request: RequestShape,
  response: ResponseShape,
): Promise<void> {
  applyCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!requireAuthorizedRequest(request)) {
    response.status(401).json({ error: "Unauthorized", message: "Valid API key required" });
    return;
  }

  try {
    const shop = coerceString(request.body?.shop);
    if (!shop) {
      response.status(400).json({ success: false, error: "shop is required" });
      return;
    }

    const monitoringMode = coerceString(request.body?.monitoringMode);
    const requestedDays = coercePositiveInteger(request.body?.days);
    if (monitoringMode === "last-days" && !requestedDays) {
      response.status(400).json({
        success: false,
        error: "days is required when monitoringMode is last-days",
      });
      return;
    }

    const forceFullScan =
      Boolean(request.body?.forceFullScan) || monitoringMode === "full-lookback";
    const days = monitoringMode === "weekly"
      ? 7
      : monitoringMode === "since-last-check" || forceFullScan
        ? undefined
        : requestedDays;
    const limit = coercePositiveInteger(request.body?.limit);

    const result = await runMerchantDeltaMonitoringForShop({
      shop,
      forceFullScan,
      days,
      limit,
      triggerMode: "manual",
    });

    response.status(200).json({ success: true, result });
  } catch (error) {
    response.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
