import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import { FIRESTORE_COLLECTIONS } from "./safety-gate-config.js";
import { checkProductAgainstAlerts } from "./safety-gate-checker.js";
import type { ProductInput } from "./safety-gate-checker.schemas.js";
import { normalizePictures } from "./safety-gate-checker-media.js";
import type { NormalizedAlert } from "./safety-gate-checker.types.js";
import { ALERT_LOOKBACK_DAYS } from "./safety-gate-checker-retrieval.js";
import { embedImage, embedText } from "./safety-gate-embeddings.js";
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
};

const MONITOR_TEXT_CANDIDATE_LIMIT = 8;
const MONITOR_IMAGE_CANDIDATE_LIMIT = 5;
const MAX_ALERTS_PER_PRODUCT = 12;

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
  days?: number;
}): MerchantMonitoringWindow {
  const now = new Date();
  const fullLookbackDate = new Date(now);
  fullLookbackDate.setDate(fullLookbackDate.getDate() - ALERT_LOOKBACK_DAYS);

  if (params.forceFullScan) {
    return {
      mode: "bootstrap",
      strategy: "full-lookback",
      days: ALERT_LOOKBACK_DAYS,
      checkpointDate: fullLookbackDate,
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
    };
  }

  const persistedCheckpoint = normalizeAlertDate(params.currentState?.lastRapexAlertDate);
  if (persistedCheckpoint) {
    return {
      mode: "delta",
      strategy: "since-last-check",
      days: null,
      checkpointDate: persistedCheckpoint,
    };
  }

  return {
    mode: "bootstrap",
    strategy: "full-lookback",
    days: ALERT_LOOKBACK_DAYS,
    checkpointDate: fullLookbackDate,
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
      product_category: String(fields.product_category || ""),
      product_description: String(fields.product_description || ""),
      risk_level: String(fields.risk_level || ""),
      alert_level: String(fields.alert_level || ""),
      alert_type: String(fields.alert_type || ""),
      risk_legal_provision: String(fields.risk_legal_provision || ""),
      notifying_country: String(fields.notifying_country || ""),
      product_brand: fields.product_brand ? String(fields.product_brand) : undefined,
      product_model: fields.product_model ? String(fields.product_model) : undefined,
      pictures: normalizePictures(fields),
    },
    source: "recent",
  };
}

async function getMonitorState(shop: string): Promise<MerchantMonitorStateDocument | null> {
  const snapshot = await db
    .collection(FIRESTORE_COLLECTIONS.merchantMonitorState)
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
): Promise<AlertRetrievalCandidate[]> {
  const snapshot = await db
    .collection(FIRESTORE_COLLECTIONS.alerts)
    .where("meta.alert_date", ">=", Timestamp.fromDate(checkpointDate))
    .orderBy("meta.alert_date", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      alert: normalizeRapexAlert(doc.id, data),
      textVector: asVectorArray(data.vector_text),
      imageVector: asVectorArray(data.vector_image),
    };
  });
}

async function findCandidateProductsForAlert(
  shop: string,
  alertCandidate: AlertRetrievalCandidate,
): Promise<MerchantProductCandidate[]> {
  const candidates = new Map<string, MerchantProductCandidate>();
  const collection = db.collection(FIRESTORE_COLLECTIONS.merchantProducts).where("shop", "==", shop);

  if (alertCandidate.textVector?.length) {
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
      candidates.set(doc.id, {
        id: doc.id,
        data: doc.data() as Record<string, unknown>,
      });
    }
  }

  if (alertCandidate.imageVector?.length) {
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
      candidates.set(doc.id, {
        id: doc.id,
        data: doc.data() as Record<string, unknown>,
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
  const query = await db
    .collection(FIRESTORE_COLLECTIONS.merchantAlerts)
    .where("shop", "==", params.shop)
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

  await db.collection(FIRESTORE_COLLECTIONS.merchantAlerts).add({
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
  const textContent = (input.product.description || input.product.name || "").trim();
  const docId = merchantProductDocId(shop, productId);
  const docRef = db.collection(FIRESTORE_COLLECTIONS.merchantProducts).doc(docId);
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
    lastCheckedAt: FieldValue.serverTimestamp(),
    ...(input.productHandle ? { productHandle: input.productHandle } : {}),
    ...(primaryImage ? { imageUrl: primaryImage } : {}),
    ...(input.product.imageUrls?.length ? { imageUrls: input.product.imageUrls } : {}),
    ...(input.product.brand ? { brand: input.product.brand } : {}),
    ...(input.product.model ? { model: input.product.model } : {}),
    ...(input.sourceUpdatedAt ? { sourceUpdatedAt: input.sourceUpdatedAt } : {}),
    ...(vectorText?.length ? { vector_text: FieldValue.vector(vectorText) } : {}),
    ...(vectorImage?.length ? { vector_image: FieldValue.vector(vectorImage) } : {}),
  };

  await docRef.set(payload, { merge: true });

  return {
    shop,
    productId,
    vectorTextWritten: Boolean(vectorText?.length),
    vectorImageWritten: Boolean(vectorImage?.length),
  };
}

export async function runMerchantDeltaMonitoringForShop(params: {
  shop: string;
  forceFullScan?: boolean;
  days?: number;
  limit?: number;
  triggerMode?: "manual" | "scheduled";
}): Promise<MerchantMonitoringSummary> {
  const shop = params.shop.trim();
  if (!shop) {
    throw new Error("shop is required");
  }

  const monitorRef = db
    .collection(FIRESTORE_COLLECTIONS.merchantMonitorState)
    .doc(encodeURIComponent(shop));
  const currentState = await getMonitorState(shop);
  const forceFullScan = Boolean(params.forceFullScan);
  const monitoringWindow = resolveMonitoringWindow({
    currentState,
    forceFullScan,
    days: params.days,
  });
  const limit = Number.isFinite(params.limit) && (params.limit as number) > 0
    ? Math.min(Math.floor(params.limit as number), 500)
    : 250;

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

      await db.collection(FIRESTORE_COLLECTIONS.merchantChecks).add({
        shop,
        productId: String(candidate.product.data.productId || ""),
        productTitle: String(candidate.product.data.productTitle || candidate.product.data.name || ""),
        isSafe: result.isSafe,
        checkedAt: new Date(result.checkedAt),
        createdAt: FieldValue.serverTimestamp(),
      });

      await db.collection(FIRESTORE_COLLECTIONS.merchantProducts).doc(candidate.product.id).set(
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
    }

    const latestAlert = rapexAlerts[0];
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

    await monitorRef.set(
      {
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
      } satisfies Partial<MerchantMonitorStateDocument>,
      { merge: true },
    );

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

export async function runDailyMerchantDeltaMonitoring(): Promise<{
  shopsProcessed: number;
  failures: Array<{ shop: string; error: string }>;
}> {
  const [stateSnapshot, productSnapshot] = await Promise.all([
    db.collection(FIRESTORE_COLLECTIONS.merchantMonitorState).get(),
    db.collection(FIRESTORE_COLLECTIONS.merchantProducts).get(),
  ]);

  const shopsFromState = stateSnapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return coerceString(data.shop) || decodeURIComponent(doc.id);
    })
    .filter((shop): shop is string => Boolean(shop));

  const shopsFromProducts = productSnapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return coerceString(data.shop);
    })
    .filter((shop): shop is string => Boolean(shop));

  const uniqueShops = [...new Set([...shopsFromState, ...shopsFromProducts])];
  const failures: Array<{ shop: string; error: string }> = [];

  for (const shop of uniqueShops) {
    try {
      await runMerchantDeltaMonitoringForShop({
        shop,
        triggerMode: "scheduled",
      });
    } catch (error) {
      failures.push({
        shop,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error("Scheduled merchant delta monitoring failed", {
        shop,
        error: failures[failures.length - 1].error,
      });
    }
  }

  return {
    shopsProcessed: uniqueShops.length,
    failures,
  };
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
