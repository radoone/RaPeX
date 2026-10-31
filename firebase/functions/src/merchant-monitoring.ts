import { FieldPath, FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { createHash, randomUUID } from "node:crypto";
import * as logger from "firebase-functions/logger";
import { isAuthorizedApiKey } from "./api-auth.js";
import { db } from "./firebase-admin.js";
import { mapBounded } from "./matching-work.js";
import { AI_CONFIG, FIRESTORE_COLLECTIONS, MATCHING_THRESHOLDS } from "./safety-gate-config.js";
import { recallWithinThreshold } from "./vector-recall.js";
import { selectMonitoringImages, prioritizeMonitoringImages, type MonitoringImage, type StoredMonitoringImage } from "./monitoring-images.js";
import { buildMonitoringCursorValues } from "./monitoring-cursor.js";
import { monitoringTaskId, scheduledMonitoringRunId } from "./monitoring-task-id.js";
import { canApplyProductVersion, installationKey, isProductChangeSupersededByDeletion } from "./product-lifecycle.js";
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
  hasMore: boolean;
  productsScanned: number;
  rapexAlertsScanned: number;
  matchesFound: number;
  alertsCreated: number;
  checkpoint: {
    lastRapexAlertDate: string | null;
    lastRapexRecordTimestamp: string | null;
    lastRapexAlertDocId: string | null;
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
  images?: MonitoringImage[];
};

type MerchantProductCandidate = {
  id: string;
  data: Record<string, unknown>;
  matchedImageUrls?: string[];
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
  triggerMode: "scheduled" | "manual";
  installation?: string;
  checkpointScope?: string;
};

export type ShopifyProductChangeTaskPayload = {
  operation?: "upsert" | "delete";
  installation?: string;
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
  if (data.installationRetiredAt || data.monitoringEntitled !== true || data.subscriptionStatus !== "active") return false;
  const validUntil = data.subscriptionValidUntil;
  return validUntil instanceof Timestamp && validUntil.toMillis() > Date.now();
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

function requireAuthorizedRequest(request: RequestShape): boolean {
  return isAuthorizedApiKey(request);
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

async function loadMonitoringImages(candidates: AlertRetrievalCandidate[]): Promise<void> {
  const byAlert = new Map<string, StoredMonitoringImage[]>();
  const ids = [...new Set(candidates.map(candidate => candidate.alert.id))];
  // Firestore permits 30 disjunctions; do not issue one read query per alert/photo.
  for (let offset = 0; offset < ids.length; offset += 30) {
    const snapshots = await db.collection(FIRESTORE_COLLECTIONS.alertImages)
      .where("alertId", "in", ids.slice(offset, offset + 30))
      .select("alertId", "imageUrl", "embeddingSourceUrl", "vector_image").get();
    for (const doc of snapshots.docs) {
      const data = doc.data();
      const alertId = String(data.alertId);
      const images = byAlert.get(alertId) || [];
      images.push({ imageUrl: String(data.imageUrl), embeddingSourceUrl: data.embeddingSourceUrl, vector: asVectorArray(data.vector_image) });
      byAlert.set(alertId, images);
    }
  }
  for (const candidate of candidates) {
    candidate.images = selectMonitoringImages(normalizePictures(candidate.alert.fields), byAlert.get(candidate.alert.id) || []);
  }
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

  if (!alertCandidate.textVector?.length) throw new Error("Safety Gate text vector is unavailable");
  const searches = [
    { field: "vector_text", vector: alertCandidate.textVector, initialLimit: MONITOR_TEXT_CANDIDATE_LIMIT, maxDistance: MATCHING_THRESHOLDS.textDistance, imageUrl: undefined as string | undefined },
    ...(alertCandidate.images || []).map(image => ({ field: "vector_image", vector: image.vector, initialLimit: MONITOR_IMAGE_CANDIDATE_LIMIT, maxDistance: MATCHING_THRESHOLDS.imageDistance, imageUrl: image.mediaUrl })),
  ];
  const imageScores = new Map<string, Map<string, number>>();
  for (const { field, vector, initialLimit, maxDistance, imageUrl } of searches) {
    if (!vector?.length) continue;
    const docs = await recallWithinThreshold({
      initialLimit, maxDistance,
      fetch: async (limit) => (await collection.findNearest({
        vectorField: field, queryVector: vector, limit, distanceMeasure: "COSINE", distanceResultField: "distance",
      }).get()).docs,
      distance: (doc) => doc.get("distance"),
    });
    for (const doc of docs) {
      const data = doc.data() as Record<string, unknown>;
      if (data.deletedAt) continue;
      const candidate = candidates.get(doc.id) || { id: doc.id, data };
      if (imageUrl) {
        const scores = imageScores.get(doc.id) || new Map<string, number>();
        scores.set(imageUrl, Math.min(scores.get(imageUrl) ?? Infinity, Number(doc.get("distance"))));
        imageScores.set(doc.id, scores);
        candidate.matchedImageUrls = [...scores].sort((a, b) => a[1] - b[1]).map(([url]) => url);
      }
      candidates.set(doc.id, candidate);
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
  sourceUpdatedAt?: string;
  installation?: string;
  warningsCount: number;
  riskLevel: string;
}): Promise<number> {
  const alertsCollection = db
    .collection(FIRESTORE_COLLECTIONS.merchants)
    .doc(encodeURIComponent(params.shop))
    .collection(FIRESTORE_COLLECTIONS.subAlerts);

  const result = JSON.parse(params.resultJson);
  let created = 0;
  // A finding is a product/source pair, not a mutable bucket for all product warnings.
  for (const warning of result.warnings) {
    if (!warning.alertId) throw new Error("Finding is missing its Safety Gate source ID");
    const id = createHash("sha256").update(`${params.productId}\0${warning.alertId}`).digest("hex");
    const ref = alertsCollection.doc(`finding_${id}`);
    const merchantRef = db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(params.shop));
    const productRef = merchantRef.collection(FIRESTORE_COLLECTIONS.subProducts).doc(encodeURIComponent(params.productId));
    const wasCreated = await db.runTransaction(async (transaction) => {
      const [merchant, product, current, legacy] = await Promise.all([
        transaction.get(merchantRef), transaction.get(productRef), transaction.get(ref),
        transaction.get(alertsCollection.where("productId", "==", params.productId)),
      ]);
      if (!merchant.exists || merchant.get("installationRetiredAt") || product.get("deletedAt")) return false;
      if (params.sourceUpdatedAt && product.get("sourceUpdatedAt") !== params.sourceUpdatedAt) return false;
      if (params.installation && installationKey(merchant.data() || {}) !== params.installation) return false;
      if (current.exists) return false; // Preserve original evidence and every merchant decision.
      const existingPair = legacy.docs.some((doc) => {
        try { return JSON.parse(String(doc.get("checkResult"))).warnings?.some((w: { alertId?: string }) => w.alertId === warning.alertId); }
        catch { throw new Error("Stored finding evidence cannot be read"); }
      });
      if (existingPair) return false; // Preserve pre-migration findings, including reviewed history.
      transaction.create(ref, {
        shop: params.shop, productId: params.productId, productTitle: params.productTitle,
        productHandle: params.productHandle || null, sourceAlertId: warning.alertId,
        checkResult: JSON.stringify({ ...result, warnings: [warning], isSafe: false }),
        status: "active", reviewState: "needs_review", warningsCount: 1,
        riskLevel: warning.riskLevel || params.riskLevel,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        dismissedAt: null, dismissedBy: null, resolvedAt: null, resolutionType: null, notes: null,
      });
      return true;
    });
    if (wasCreated) created += 1;
  }
  return created;
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

  const initialMerchant = await merchantRef.get();
  if (!initialMerchant.exists || initialMerchant.get("installationRetiredAt")) throw new Error("Merchant installation is missing or retired");
  const existingSnapshot = await docRef.get();
  const existingData = (existingSnapshot.data() as Record<string, unknown> | undefined) || {};
  const existingSourceUpdatedAt =
    typeof existingData.sourceUpdatedAt === "string" ? existingData.sourceUpdatedAt.trim() : undefined;
  const incomingSourceUpdatedAt = input.sourceUpdatedAt?.trim();
  const canReuseCachedVectors = Boolean(
    existingSnapshot.exists &&
      existingSourceUpdatedAt &&
      incomingSourceUpdatedAt &&
      existingData.embeddingVersion === 2 && existingSourceUpdatedAt === incomingSourceUpdatedAt && Boolean(asVectorArray(existingData.vector_text)?.length),
  );

  const [vectorText, vectorImage] = await Promise.all([
    canReuseCachedVectors || !textContent
      ? Promise.resolve(undefined)
      : embedText(textContent),
    canReuseCachedVectors || !primaryImage
      ? Promise.resolve(undefined)
      : embedImage(primaryImage),
  ]);

  if (!canReuseCachedVectors && textContent && !vectorText?.length) {
    throw new Error(`Text embedding unavailable for Shopify product ${productId}`);
  }
  const payload: Record<string, unknown> = {
    shop,
    productId,
    productTitle: input.productTitle,
    embeddingVersion: 2,
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
    ...(!canReuseCachedVectors ? { vector_text: vectorText?.length ? FieldValue.vector(vectorText) : FieldValue.delete() } : {}),
    ...(!canReuseCachedVectors ? { vector_image: vectorImage?.length ? FieldValue.vector(vectorImage) : FieldValue.delete() } : {}),
  };

  await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(docRef);
    const merchant = await transaction.get(merchantRef);
    if (initialMerchant.exists && (!merchant.exists || installationKey(merchant.data() || {}) !== installationKey(initialMerchant.data() || {}))) {
      throw new Error("Merchant installation changed during product import");
    }
    if (incomingSourceUpdatedAt && !canApplyProductVersion(latest.data() || {}, incomingSourceUpdatedAt)) return;
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
  const initialMerchant = await merchantRef.get();
  if (!initialMerchant.exists || initialMerchant.get("installationRetiredAt")) throw new Error("Merchant installation is missing or retired");
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
      existingData.embeddingVersion === 2 && existingData.sourceUpdatedAt === item.input.sourceUpdatedAt && Boolean(asVectorArray(existingData.vector_text)?.length);
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

  const writes: Array<{ ref: DocumentReference; payload: Record<string, unknown>; version?: string }> = [];
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
      embeddingVersion: 2,
      ...(item.input.sourceUpdatedAt ? { deletedAt: FieldValue.delete(), deletedSourceUpdatedAt: FieldValue.delete() } : {}),
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
    writes.push({ ref: docRef, payload, version: item.input.sourceUpdatedAt });
  });
  await db.runTransaction(async (transaction) => {
    const merchant = await transaction.get(merchantRef);
    const latest = await Promise.all(writes.map((write) => transaction.get(write.ref)));
    if (initialMerchant.exists && (!merchant.exists || installationKey(merchant.data() || {}) !== installationKey(initialMerchant.data() || {}))) {
      throw new Error("Merchant installation changed during catalog import");
    }
    writes.forEach((write, index) => {
      if (write.version && !canApplyProductVersion(latest[index].data() || {}, write.version)) return;
      transaction.set(write.ref, write.payload, { merge: true });
    });
    transaction.set(merchantRef, { shop, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
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
  checkpointScope?: string;
}): Promise<MerchantMonitoringSummary> {
  const shop = params.shop.trim();
  if (!shop) {
    throw new Error("shop is required");
  }

  const monitorRef = db
    .collection(FIRESTORE_COLLECTIONS.merchants)
    .doc(encodeURIComponent(shop));
  const merchantState = await getMonitorState(shop);
  if (!merchantState || (merchantState as unknown as Record<string, unknown>).installationRetiredAt) throw new Error("Merchant installation is missing or retired");
  const checkpointRef = params.checkpointScope
    ? monitorRef.collection("monitor_checkpoints").doc(params.checkpointScope)
    : monitorRef;
  const scopedState = params.checkpointScope ? (await checkpointRef.get()).data() : merchantState;
  const currentState = { ...merchantState,
    lastRapexAlertDate: scopedState?.lastRapexAlertDate || null,
    lastRapexRecordTimestamp: scopedState?.lastRapexRecordTimestamp || null,
    lastRapexAlertDocId: scopedState?.lastRapexAlertDocId || null,
  } as MerchantMonitorStateDocument;
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

  const setProgress = async (values: Record<string, unknown>) => {
    if (!runRef) return;
    await db.runTransaction(async transaction => {
      const merchant = await transaction.get(monitorRef);
      if (!merchant.exists || installationKey(merchant.data() || {}) !== installationKey(merchantState as unknown as Record<string, unknown>)) throw new Error("Merchant installation changed during progress update");
      transaction.set(runRef, values, { merge: true });
    });
  };

  if (runRef) {
    const completedRun = await runRef.get();
    const completedSummary = completedRun.get("completedSummary");
    if (completedSummary && typeof completedSummary === "object") {
      return completedSummary as MerchantMonitoringSummary;
    }
  }

  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(monitorRef);
    if (!current.exists || installationKey(current.data() || {}) !== installationKey(merchantState as unknown as Record<string, unknown>)) throw new Error("Merchant installation changed before monitoring");
    transaction.set(monitorRef, {
      updatedAt: FieldValue.serverTimestamp(), lastMonitorRunStart: FieldValue.serverTimestamp(),
      lastMonitorStatus: "IN_PROGRESS", lastRunMode: monitoringWindow.mode,
    }, { merge: true });
  });

  try {
    const rapexAlertCandidates = await loadRapexAlertCandidatesSince(
      monitoringWindow.checkpointDate,
      limit,
      monitoringWindow.strategy === "since-last-check"
        ? monitoringWindow.checkpointRecordTimestamp
        : null,
      monitoringWindow.strategy === "since-last-check" ? currentState?.lastRapexAlertDocId : null,
    );
    const dateCandidates = [...rapexAlertCandidates];
    let changesQuery = db.collection("rapex_changes").orderBy("changedAt", "asc").orderBy(FieldPath.documentId(), "asc");
    const savedChange = scopedState?.lastRapexChangeId;
    if (typeof savedChange === "string" && savedChange && scopedState?.lastRapexChangeAt instanceof Timestamp) changesQuery = changesQuery.startAfter(scopedState.lastRapexChangeAt, savedChange);
    const changes = params.checkpointScope ? null : await changesQuery.limit(limit).get();
    if (changes) {
      const seen = new Set(rapexAlertCandidates.map((candidate) => candidate.alert.id));
      const snapshots = await Promise.all(changes.docs.map((change) => db.collection(FIRESTORE_COLLECTIONS.alerts).doc(String(change.get("alertId"))).get()));
      for (const snapshot of snapshots) {
        if (!snapshot.exists) throw new Error("Safety Gate change references a missing source");
        if (seen.has(snapshot.id)) continue;
        const data = snapshot.data()!;
        rapexAlertCandidates.push({ alert: normalizeRapexAlert(snapshot.id, data), textVector: asVectorArray(data.vector_text) });
        seen.add(snapshot.id);
      }
    }
    await loadMonitoringImages(rapexAlertCandidates);
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

        existing.alerts.set(alertCandidate.alert.id, prioritizeMonitoringImages(alertCandidate.alert, productCandidate.matchedImageUrls || []));

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
      await setProgress({
        status: "processing",
        rapexAlertsScanned: rapexAlerts.length,
        candidateProducts: candidateProductsByDocId.size,
        productsScanned: 0,
        matchesFound: 0,
        alertsCreated: 0,
        heartbeatAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    let matchesFound = 0;
    let alertsCreated = 0;
    let productsScanned = 0;

    const candidateEntries = Array.from(candidateProductsByDocId.values());
    await mapBounded(candidateEntries, 2, async (candidate) => {
      const productInput = toProductInput(candidate.product.data);
      const result = await checkProductAgainstAlerts(
        productInput,
        Array.from(candidate.alerts.values()),
      );
      const threshold = Number((merchantState as unknown as Record<string, unknown>).similarityThreshold || 0);
      if (threshold > 0) {
        result.warnings = result.warnings.filter((warning) => warning.overallSimilarity >= threshold);
        result.isSafe = result.warnings.length === 0;
      }
      productsScanned += 1;

      const expireDate = new Date();
      expireDate.setDate(expireDate.getDate() + AI_CONFIG.checkHistoryTtlDays);

      const productRef = monitorRef.collection(FIRESTORE_COLLECTIONS.subProducts).doc(candidate.product.id);
      const applied = await db.runTransaction(async (transaction) => {
        const [product, merchant] = await Promise.all([transaction.get(productRef), transaction.get(monitorRef)]);
        if (!merchant.exists || installationKey(merchant.data() || {}) !== installationKey(merchantState as unknown as Record<string, unknown>)) throw new Error("Merchant installation changed during monitoring");
        if (!product.exists || product.get("deletedAt") || product.get("sourceUpdatedAt") !== candidate.product.data.sourceUpdatedAt) return false;
        transaction.set(monitorRef.collection(FIRESTORE_COLLECTIONS.subChecks)
          .doc(monitoringTaskId(shop, `${runId}:${candidate.product.data.productId || candidate.product.id}`)), {
          shop, productId: String(candidate.product.data.productId || ""),
          productTitle: String(candidate.product.data.productTitle || candidate.product.data.name || ""),
          isSafe: result.isSafe, checkedAt: new Date(result.checkedAt),
          ...(typeof candidate.product.data.sourceUpdatedAt === "string" ? { sourceUpdatedAt: candidate.product.data.sourceUpdatedAt } : {}),
          createdAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromDate(expireDate),
        });
        transaction.set(productRef, {
          updatedAt: FieldValue.serverTimestamp(), lastDeltaCheckAt: FieldValue.serverTimestamp(), lastCheckedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return true;
      });
      if (!applied) return;

      if (!result.isSafe && result.warnings.length > 0) {
        matchesFound += result.warnings.length;
        const created = await upsertAlertForProduct({
          shop,
          productId: String(candidate.product.data.productId || ""),
          productTitle: String(candidate.product.data.productTitle || candidate.product.data.name || ""),
          productHandle: coerceString(candidate.product.data.productHandle),
          resultJson: JSON.stringify(result),
          sourceUpdatedAt: coerceString(candidate.product.data.sourceUpdatedAt),
          installation: installationKey((currentState || {}) as unknown as Record<string, unknown>),
          warningsCount: result.warnings.length,
          riskLevel:
            result.warnings[0]?.alertDetails?.fields?.alert_level ||
            result.warnings[0]?.alertDetails?.fields?.risk_level ||
            result.warnings[0]?.riskLevel ||
            "Unknown",
        });
        if (created) {
          alertsCreated += created;
        }
      }

      if (runRef && (productsScanned % 5 === 0 || productsScanned === candidateProductsByDocId.size)) {
        await setProgress({
          productsScanned,
          matchesFound,
          alertsCreated,
          heartbeatAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    const latestAlert = dateCandidates.at(-1)?.alert;
    const summary: MerchantMonitoringSummary = {
      shop,
      mode: monitoringWindow.mode,
      window: {
        strategy: monitoringWindow.strategy,
        days: monitoringWindow.days,
        checkpointDate: monitoringWindow.checkpointDate.toISOString(),
      },
      hasMore: dateCandidates.length >= limit || (changes?.size || 0) >= limit,
      productsScanned,
      rapexAlertsScanned: rapexAlerts.length,
      matchesFound,
      alertsCreated,
      checkpoint: {
        lastRapexAlertDate: latestAlert?.meta.alert_date || normalizeAlertDate(currentState?.lastRapexAlertDate)?.toISOString() || null,
        lastRapexRecordTimestamp: latestAlert?.meta.record_timestamp || currentState?.lastRapexRecordTimestamp || null,
        lastRapexAlertDocId: latestAlert?.id || currentState?.lastRapexAlertDocId || null,
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
      const merchant = await transaction.get(monitorRef);
      const checkpoint = await transaction.get(checkpointRef);
      if (!merchant.exists || installationKey(merchant.data() || {}) !== installationKey(merchantState as unknown as Record<string, unknown>)) throw new Error("Merchant installation changed during monitoring");
      const savedDate = normalizeAlertDate(checkpoint.get("lastRapexAlertDate"))?.getTime() || 0;
      const nextDate = normalizeAlertDate(checkpointUpdate.lastRapexAlertDate)?.getTime() || 0;
      const savedTuple = `${String(checkpoint.get("lastRapexRecordTimestamp") || "")}:${String(checkpoint.get("lastRapexAlertDocId") || "")}`;
      const nextTuple = `${checkpointUpdate.lastRapexRecordTimestamp || ""}:${checkpointUpdate.lastRapexAlertDocId || ""}`;
      if (changes?.docs.length) {
        const lastChange = changes.docs.at(-1)!;
        const previousTime = merchant.get("lastRapexChangeAt");
        const nextTime = lastChange.get("changedAt");
        if (!(nextTime instanceof Timestamp)) throw new Error("Safety Gate change has no committed timestamp");
        if (!(previousTime instanceof Timestamp) || nextTime.valueOf() > previousTime.valueOf() || (nextTime.valueOf() === previousTime.valueOf() && lastChange.id > String(merchant.get("lastRapexChangeId") || ""))) {
          transaction.set(monitorRef, { lastRapexChangeId: lastChange.id, lastRapexChangeAt: lastChange.get("changedAt") }, { merge: true });
        }
      }
      if (nextDate > savedDate || (nextDate === savedDate && nextTuple >= savedTuple)) transaction.set(checkpointRef, checkpointUpdate, { merge: true });
      transaction.set(monitorRef, { lastMonitorStatus: summary.hasMore ? "IN_PROGRESS" : "SUCCESS", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (runRef) {
        transaction.set(runRef, {
          status: params.monitoringRunCollection === "initial_catalog_monitoring_pages" ? "completed" : "page_processed",
          completedSummary: summary,
          completedAt: FieldValue.serverTimestamp(),
          leaseExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });

    return summary;
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const merchant = await transaction.get(monitorRef);
      if (merchant.exists && installationKey(merchant.data() || {}) === installationKey(merchantState as unknown as Record<string, unknown>)) transaction.set(monitorRef, {
        updatedAt: FieldValue.serverTimestamp(),
        lastMonitorRunEnd: FieldValue.serverTimestamp(),
        lastMonitorStatus: "FAILURE",
        lastError: error instanceof Error ? error.message : String(error),
      } satisfies Partial<MerchantMonitorStateDocument>, { merge: true });
    });
    throw error;
  }
}

async function enqueueMerchantMonitoringTask(payload: MerchantMonitoringTaskPayload): Promise<boolean> {
  const installation = await db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(payload.shop)).get();
  if (!installation.exists || installation.get("installationRetiredAt") || (payload.installation && payload.installation !== installationKey(installation.data() || {}))) return false;
  payload = { ...payload, installation: installationKey(installation.data() || {}) };
  const runRef = monitoringRunRef(payload.shop, payload.runId);
  const shouldEnqueue = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runRef);
    const merchant = await transaction.get(db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(payload.shop)));
    if (!merchant.exists || merchant.get("installationRetiredAt") || installationKey(merchant.data() || {}) !== payload.installation) return false;
    const status = snapshot.get("status");
    if (status === "completed" || status === "skipped_unentitled") return false;
    if (status === "processing" || status === "retrying") return false;
    if (status === "queued") return true;

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
      id: monitoringTaskId(payload.shop, `${payload.runId}:${payload.installation}`),
      dispatchDeadlineSeconds: 1800,
    });
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code === "functions/task-already-exists") {
      return false;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db.runTransaction(async (transaction) => {
      const merchantRef = db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(payload.shop));
      const merchant = await transaction.get(merchantRef);
      if (!merchant.exists || installationKey(merchant.data() || {}) !== payload.installation) return;
      transaction.set(runRef, { status: "enqueue_failed", lastError: errorMessage, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(merchantRef, { lastMonitorStatus: "FAILURE", lastError: errorMessage, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    throw error;
  }
}

export async function handleMerchantMonitoringTask(
  payload: MerchantMonitoringTaskPayload,
  retryCount: number,
): Promise<void> {
  const shop = coerceString(payload?.shop);
  const runId = coerceString(payload?.runId);
  if (!shop || !runId || !["scheduled", "manual"].includes(payload?.triggerMode)) {
    throw new Error("Invalid merchant monitoring task payload");
  }

  const runRef = monitoringRunRef(shop, runId);
  const merchantRef = db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(shop));
  const merchantSnapshot = await merchantRef.get();
  if (!merchantSnapshot.exists || merchantSnapshot.get("installationRetiredAt") || (payload.installation && payload.installation !== installationKey(merchantSnapshot.data() || {}))) return;
  const setRun = async (data: Record<string, unknown>) => db.runTransaction(async (transaction) => {
    const merchant = await transaction.get(merchantRef);
    if (merchant.exists && installationKey(merchant.data() || {}) === installationKey(merchantSnapshot.data() || {})) transaction.set(runRef, data, { merge: true });
  });
  const claim = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runRef);
    const merchant = await transaction.get(merchantRef);
    if (!merchant.exists || installationKey(merchant.data() || {}) !== installationKey(merchantSnapshot.data() || {})) return "finished" as const;
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

  if (!merchantSnapshot.exists || (payload.installation && payload.installation !== installationKey(merchantSnapshot.data() || {})) || !currentEntitlement(merchantSnapshot.data() || {})) {
    await setRun({
      status: "skipped_unentitled",
      skippedAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  try {
    const result = await runMerchantDeltaMonitoringForShop({
      shop,
      triggerMode: payload.triggerMode,
      checkpointScope: payload.checkpointScope,
      runId,
    });
    if (result.hasMore) {
      const nextRunId = `continued-${monitoringTaskId(shop, JSON.stringify({ ...result.checkpoint, changes: (await merchantRef.get()).get("lastRapexChangeId") }))}`;
      await enqueueMerchantMonitoringTask({ shop, runId: nextRunId, triggerMode: payload.triggerMode, installation: installationKey(merchantSnapshot.data() || {}), ...(payload.checkpointScope ? { checkpointScope: payload.checkpointScope } : {}) });
    }
    await setRun({
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: FieldValue.delete(),
      result,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    const exhausted = retryCount + 1 >= MAX_MONITORING_TASK_ATTEMPTS;
    await setRun({
      status: exhausted ? "failed" : "retrying",
      lastError: error instanceof Error ? error.message : String(error),
      ...(exhausted ? { failedAt: FieldValue.serverTimestamp() } : {}),
      leaseExpiresAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
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
  const runId = `${scheduledMonitoringRunId(Number.isNaN(scheduledAt.getTime()) ? new Date() : scheduledAt)}-${monitoringTaskId("schedule", Number.isNaN(scheduledAt.getTime()) ? new Date().toISOString() : scheduledAt.toISOString()).slice(-12)}`;
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
    ? `product-delete:${payload.productId}:${payload.sourceUpdatedAt}:${payload.installation || "legacy"}`
    : `product:${payload.productId}:${payload.sourceUpdatedAt}:${payload.installation || "legacy"}`);
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
    if (!shop || !productId || !sourceUpdatedAt || !Number.isFinite(Date.parse(sourceUpdatedAt)) || (operation === "upsert" && (!productTitle || !sourceUpdatedAt || !product?.name || !product.category || !product.description))) {
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
    if (!merchantSnapshot.exists) return response.status(409).json({ error: "Merchant installation is missing" });
    payload.installation = installationKey(merchantSnapshot.data() || {});
    if (operation !== "delete" && !currentEntitlement((merchantSnapshot.data() || {}) as Record<string, unknown>)) {
      return response.status(200).json({ success: true, queued: false, reason: "no_current_entitlement" });
    }

    const jobId = productChangeJobId(payload);
    const jobRef = productChangeJobRef(shop, jobId);
    const shouldEnqueue = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(jobRef);
      const merchant = await transaction.get(merchantRef);
      if (!merchant.exists || merchant.get("installationRetiredAt") || installationKey(merchant.data() || {}) !== payload.installation) return false;
      if (["processing", "completed"].includes(String(snapshot.get("status")))) return false;
      if (snapshot.get("status") === "queued") return true;
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
          await db.runTransaction(async transaction => {
            const merchant = await transaction.get(merchantRef);
            if (merchant.exists && installationKey(merchant.data() || {}) === payload.installation) transaction.set(jobRef, { status: "enqueue_failed", lastError: error instanceof Error ? error.message : String(error), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          });
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
  if (!merchantSnapshot.exists || (payload.installation && payload.installation !== installationKey(merchantSnapshot.data() || {}))) return;
  const setJob = async (data: Record<string, unknown>) => db.runTransaction(async (transaction) => {
    const merchant = await transaction.get(merchantRef);
    if (merchant.exists && installationKey(merchant.data() || {}) === installationKey(merchantSnapshot.data() || {})) {
      transaction.set(jobRef, data, { merge: true });
    }
  });
  if (payload.operation !== "delete" && !currentEntitlement((merchantSnapshot.data() || {}) as Record<string, unknown>)) {
    await setJob({ status: "skipped_unentitled", updatedAt: FieldValue.serverTimestamp() });
    return;
  }

  await setJob({ status: "processing", attemptCount: retryCount + 1, startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  try {
    const productRef = merchantRef.collection(FIRESTORE_COLLECTIONS.subProducts).doc(encodeURIComponent(payload.productId));
    if (payload.operation === "delete") {
      const now = FieldValue.serverTimestamp();
      await db.runTransaction(async (transaction) => {
        const [product, merchant, alerts] = await Promise.all([
          transaction.get(productRef), transaction.get(merchantRef),
          transaction.get(merchantRef.collection(FIRESTORE_COLLECTIONS.subAlerts).where("productId", "==", payload.productId)),
        ]);
        if (!merchant.exists || installationKey(merchant.data() || {}) !== installationKey(merchantSnapshot.data() || {})) return;
        const incoming = payload.sourceUpdatedAt;
        if (!incoming || !canApplyProductVersion(product.data() || {}, incoming)) return;
        transaction.set(productRef, {
          shop, productId: payload.productId, deletedAt: now,
          deletedSourceUpdatedAt: incoming, updatedAt: now,
          vector_text: FieldValue.delete(), vector_image: FieldValue.delete(),
        }, { merge: true });
        alerts.docs.forEach((document) => transaction.set(document.ref, {
          productDeleted: true, productDeletedAt: now, updatedAt: now,
        }, { merge: true }));
      });
      await setJob({ status: "completed", completedAt: now, updatedAt: now });
      return;
    }

    if (!payload.sourceUpdatedAt || !payload.product || !payload.productTitle) {
      throw new Error("Product change task is missing normalized product data");
    }
    const existingProduct = await productRef.get();
    const existingVersion = existingProduct.get("sourceUpdatedAt");
    if (typeof existingVersion === "string" && Date.parse(existingVersion) > Date.parse(payload.sourceUpdatedAt)) {
      await setJob({ status: "superseded", updatedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (isProductChangeSupersededByDeletion(
      existingProduct.get("deletedAt"),
      existingProduct.get("deletedSourceUpdatedAt"),
      payload.sourceUpdatedAt,
    )) {
      await setJob({ status: "superseded", updatedAt: FieldValue.serverTimestamp() });
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
      await setJob({ status: "superseded", updatedAt: FieldValue.serverTimestamp() });
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
      await setJob({ status: "analyzed", resultJson, updatedAt: FieldValue.serverTimestamp() });
    }
    const result = JSON.parse(resultJson) as {
      isSafe: boolean;
      warnings: Array<Record<string, any>>;
      checkedAt: string;
    };
    const productKey = `${jobId}`;
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + AI_CONFIG.checkHistoryTtlDays);
    const committed = await db.runTransaction(async (transaction) => {
      const [latest, merchant] = await Promise.all([transaction.get(productRef), transaction.get(merchantRef)]);
      if (!merchant.exists || installationKey(merchant.data() || {}) !== installationKey(merchantSnapshot.data() || {})) return false;
      if (!latest.exists || !canApplyProductVersion(latest.data() || {}, payload.sourceUpdatedAt!) || latest.get("sourceUpdatedAt") !== payload.sourceUpdatedAt) return false;
      transaction.set(merchantRef.collection(FIRESTORE_COLLECTIONS.subChecks).doc(productKey), {
      shop,
      productId: payload.productId,
      productTitle: payload.productTitle,
      isSafe: result.isSafe,
      checkedAt: new Date(result.checkedAt),
      sourceUpdatedAt: payload.sourceUpdatedAt,
      createdAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromDate(expireDate),
    }, { merge: true });
      transaction.set(productRef, {
        deletedAt: FieldValue.delete(), deletedSourceUpdatedAt: FieldValue.delete(),
        lastImmediateCheckAt: FieldValue.serverTimestamp(), lastCheckedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
    if (!committed) {
      // Do not recreate a job under a purged tenant.
      if ((await merchantRef.get()).exists) await setJob({ status: "superseded", updatedAt: FieldValue.serverTimestamp() });
      return;
    }

    if (!result.isSafe && result.warnings.length > 0) {
      const warning = result.warnings[0];
      await upsertAlertForProduct({
        shop,
        productId: payload.productId,
        productTitle: payload.productTitle,
        productHandle: payload.productHandle,
        resultJson,
        sourceUpdatedAt: payload.sourceUpdatedAt,
        installation: installationKey(merchantSnapshot.data() || {}),
        warningsCount: result.warnings.length,
        riskLevel: warning.alertDetails?.fields?.alert_level || warning.alertDetails?.fields?.risk_level || warning.riskLevel || "Unknown",
      });
    }
    // A negative technical check does not override a merchant's recorded decision.

    await setJob({ status: "completed", completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    logger.info("Shopify product change processed", { shop, productId: payload.productId, sourceUpdatedAt: payload.sourceUpdatedAt, isSafe: result.isSafe });
  } catch (error) {
    await setJob({ status: "retrying", lastError: error instanceof Error ? error.message : String(error), updatedAt: FieldValue.serverTimestamp() });
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

    const checkpointScope = forceFullScan || days ? `manual-${randomUUID()}` : undefined;
    const result = await runMerchantDeltaMonitoringForShop({
      shop,
      forceFullScan,
      days,
      ...(checkpointScope ? { checkpointScope } : {}),
      limit,
      triggerMode: "manual",
    });

    if (result.hasMore) await enqueueMerchantMonitoringTask({
      shop, runId: `manual-continuation-${randomUUID()}`, triggerMode: "manual",
      ...(checkpointScope ? { checkpointScope } : {}),
    });
    response.status(200).json({ success: true, result });
  } catch (error) {
    response.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
