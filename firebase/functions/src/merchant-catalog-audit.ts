import { FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import { FIRESTORE_COLLECTIONS } from "./safety-gate-config.js";
import type { MerchantProductUpsertInput, ProductCheckInput } from "./safety-gate-types.js";
import { merchantCatalogAuditTaskId } from "./monitoring-task-id.js";
import { runMerchantDeltaMonitoringForShop, upsertMerchantProductsBatch } from "./merchant-monitoring.js";

const PAGE_SIZE = 100;
const ALERT_PAGE_SIZE = 500;
const MAX_TASK_ATTEMPTS = 8;
const AUDIT_RUNS = "initial_catalog_runs";
const CATALOG_AUDIT_QUEUE = getFunctions().taskQueue<MerchantCatalogAuditTaskPayload>(
  "locations/europe-west1/functions/merchantCatalogAuditTask",
);

export type MerchantCatalogAuditTaskPayload = {
  shop: string;
  runId: string;
  phase: "import" | "monitor";
  pageIndex: number;
};

type RequestShape = {
  method: string;
  body?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
};

type ResponseShape = {
  set(name: string, value: string): void;
  status(code: number): ResponseShape;
  json(payload: unknown): void;
  send(payload: string): void;
};

function runRef(shop: string, runId: string) {
  return db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(shop))
    .collection(AUDIT_RUNS).doc(runId);
}

function merchantRef(shop: string) {
  return db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(shop));
}

function shopDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const shop = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ? shop : undefined;
}

function requestHeader(request: RequestShape, name: string): string {
  const value = request.headers[name.toLowerCase()] ?? request.headers[name];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function authorized(request: RequestShape, response: ResponseShape): boolean {
  const expected = (process.env.SAFETY_GATE_API_KEY || "").trim();
  const supplied = requestHeader(request, "x-api-key").trim();
  if (expected && supplied === expected) return true;
  response.status(expected ? 401 : 503).json({ error: expected ? "Unauthorized" : "Operations key is not configured" });
  return false;
}

function applyCors(response: ResponseShape): void {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
}

function toProductInput(node: Record<string, any>, shop: string): MerchantProductUpsertInput {
  const tags = Array.isArray(node.tags) ? node.tags.filter((tag: unknown): tag is string => typeof tag === "string") : [];
  const category = String(node.productType || tags.find((tag: string) => ["toys", "electronics", "clothing", "cosmetics", "food", "jewelry"].includes(tag.toLowerCase())) || "general").toLowerCase();
  const description = String(node.description || node.descriptionHtml || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const imageUrls = [...new Set([
    node.featuredImage?.url,
    ...(node.images?.nodes || []).map((image: any) => image?.url),
  ].filter((url): url is string => typeof url === "string" && Boolean(url.trim())))].slice(0, 4);
  const brandTag = tags.find((tag: string) => tag.toLowerCase().startsWith("brand:"));
  const product: ProductCheckInput = {
    name: String(node.title || "Untitled product"),
    category,
    description: description || String(node.title || ""),
    ...(imageUrls[0] ? { imageUrl: imageUrls[0] } : {}),
    ...(imageUrls.length ? { imageUrls } : {}),
    ...(node.vendor || brandTag ? { brand: String(node.vendor || brandTag?.replace(/^brand:\s*/i, "")) } : {}),
    shop,
    productId: String(node.id || "").replace("gid://shopify/Product/", ""),
    ...(node.updatedAt ? { sourceUpdatedAt: String(node.updatedAt) } : {}),
  };
  return {
    shop,
    productId: product.productId || "",
    productTitle: product.name,
    ...(node.handle ? { productHandle: String(node.handle) } : {}),
    product,
    ...(node.updatedAt ? { sourceUpdatedAt: String(node.updatedAt) } : {}),
  };
}

async function loadOfflineAccessToken(shop: string): Promise<string> {
  const sessions = await db.collection("shopify_sessions")
    .where("shop", "==", shop)
    .where("isOnline", "==", false)
    .limit(1)
    .get();
  const token = sessions.docs[0]?.get("accessToken");
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("A durable offline Shopify session is not available for this shop");
  }
  return token;
}

async function loadShopifyProductPage(shop: string, cursor: string | null): Promise<{
  products: MerchantProductUpsertInput[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const accessToken = await loadOfflineAccessToken(shop);
  const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || process.env.SHOPIFY_API_VERSION || "2026-07";
  const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({
      query: `query InitialCatalogAudit($first: Int!, $after: String) {
        products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title handle vendor productType tags description descriptionHtml updatedAt
            featuredImage { url }
            images(first: 4) { nodes { url } }
          }
        }
      }`,
      variables: { first: PAGE_SIZE, after: cursor },
    }),
    signal: globalThis.AbortSignal.timeout(60_000),
  });
  const payload = await response.json() as { data?: any; errors?: Array<{ message?: string }> };
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || `Shopify catalog request failed (${response.status})`);
  }
  const connection = payload.data?.products;
  if (!connection) throw new Error("Shopify did not return a catalog page");
  return {
    products: (connection.nodes || []).map((node: Record<string, any>) => toProductInput(node, shop)),
    hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
    endCursor: typeof connection.pageInfo?.endCursor === "string" ? connection.pageInfo.endCursor : null,
  };
}

async function enqueue(payload: MerchantCatalogAuditTaskPayload): Promise<void> {
  const pageId = `${payload.phase}-${payload.pageIndex}`;
  try {
    await CATALOG_AUDIT_QUEUE.enqueue(payload, {
      id: merchantCatalogAuditTaskId(payload.shop, payload.runId, pageId),
      dispatchDeadlineSeconds: 1800,
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "functions/task-already-exists") return;
    throw error;
  }
}

export async function handleStartMerchantCatalogAuditRequest(request: RequestShape, response: ResponseShape): Promise<void> {
  applyCors(response);
  if (request.method === "OPTIONS") return response.status(204).send("");
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (!authorized(request, response)) return;

  const shop = shopDomain(request.body?.shop);
  const runId = typeof request.body?.runId === "string" ? request.body.runId.trim() : "";
  if (!shop || !/^[a-zA-Z0-9_-]{8,100}$/.test(runId)) {
    return response.status(400).json({ success: false, error: "A valid shop and runId are required" });
  }

  const ref = runRef(shop, runId);
  const started = await db.runTransaction(async (transaction) => {
    const merchantSnapshot = await transaction.get(merchantRef(shop));
    const snapshot = await transaction.get(ref);
    if (!merchantSnapshot.exists || merchantSnapshot.get("initialScanRunId") !== runId || merchantSnapshot.get("initialScanStatus") !== "scanning") {
      return false;
    }
    if (snapshot.exists) return true;
    transaction.set(ref, {
      shop,
      runId,
      status: "queued",
      phase: "import",
      pageIndex: 0,
      cursor: null,
      productsFetched: 0,
      productsImported: 0,
      productsScanned: 0,
      rapexAlertsScanned: 0,
      alertsCreated: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!started) return response.status(409).json({ success: false, error: "No active catalog audit reservation exists" });
  try {
    await enqueue({ shop, runId, phase: "import", pageIndex: 0 });
    response.status(202).json({ success: true, runId, status: "queued" });
  } catch {
    await ref.set({ status: "enqueue_failed", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    response.status(503).json({ success: false, error: "Could not queue the catalog audit" });
  }
}

function stateTask(shop: string, runId: string, data: Record<string, unknown>): MerchantCatalogAuditTaskPayload | null {
  const phase = data.phase;
  const pageIndex = data.pageIndex;
  if ((phase !== "import" && phase !== "monitor") || typeof pageIndex !== "number" || !Number.isInteger(pageIndex) || pageIndex < 0) return null;
  return { shop, runId, phase, pageIndex };
}

async function setRootProgress(shop: string, values: Record<string, unknown>): Promise<void> {
  await merchantRef(shop).set({ ...values, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function completeAudit(shop: string, run: DocumentReference): Promise<void> {
  const activityRef = merchantRef(shop).collection(FIRESTORE_COLLECTIONS.subActivityLogs).doc();
  await db.runTransaction(async (transaction) => {
    transaction.set(run, {
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(merchantRef(shop), {
      initialScanStatus: "completed",
      initialScanCompletedAt: FieldValue.serverTimestamp(),
      freeScanUsed: true,
      freeScanCompletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(activityRef, {
      shop,
      type: "bulk",
      action: "check",
      details: "Completed the initial full catalog audit against indexed Safety Gate history.",
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function handleMerchantCatalogAuditTask(payload: MerchantCatalogAuditTaskPayload, retryCount: number): Promise<void> {
  const shop = shopDomain(payload?.shop);
  const runId = typeof payload?.runId === "string" ? payload.runId.trim() : "";
  if (!shop || !/^[a-zA-Z0-9_-]{8,100}$/.test(runId)) throw new Error("Invalid catalog audit task payload");
  const ref = runRef(shop, runId);
  const claim = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { kind: "missing" as const };
    const data = snapshot.data() || {};
    if (data.status === "completed" || data.status === "failed") return { kind: "finished" as const };
    const current = stateTask(shop, runId, data);
    if (!current) return { kind: "invalid" as const };
    if (current.phase !== payload.phase || current.pageIndex !== payload.pageIndex) return { kind: "stale" as const, current };
    const lease = data.leaseExpiresAt;
    if (data.status === "processing" && lease instanceof Timestamp && lease.toMillis() > Date.now()) return { kind: "busy" as const };
    transaction.set(ref, {
      status: "processing",
      attemptCount: retryCount + 1,
      startedAt: data.startedAt || FieldValue.serverTimestamp(),
      heartbeatAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + 33 * 60 * 1000),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { kind: "claimed" as const, data };
  });
  if (claim.kind === "missing" || claim.kind === "finished") return;
  if (claim.kind === "invalid") throw new Error("Catalog audit progress is invalid");
  if (claim.kind === "busy") throw new Error("Catalog audit page is already processing");
  if (claim.kind === "stale") {
    await enqueue(claim.current);
    return;
  }

  const merchantSnapshot = await merchantRef(shop).get();
  if (!merchantSnapshot.exists || merchantSnapshot.get("initialScanRunId") !== runId) {
    await ref.set({ status: "cancelled", leaseExpiresAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return;
  }

  try {
    const data = claim.data;
    let next: MerchantCatalogAuditTaskPayload | null = null;
    if (payload.phase === "import") {
      const cursor = typeof data.cursor === "string" ? data.cursor : null;
      const page = await loadShopifyProductPage(shop, cursor);
      if (page.products.length) await upsertMerchantProductsBatch(page.products);
      const fetched = Number(data.productsFetched || 0) + page.products.length;
      const imported = Number(data.productsImported || 0) + page.products.length;
      if (!page.products.length && fetched === 0) {
        await ref.set({ status: "failed", failureCode: "empty_catalog", failedAt: FieldValue.serverTimestamp(), leaseExpiresAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        await setRootProgress(shop, { initialScanStatus: "failed", initialScanFailureCode: "empty_catalog" });
        return;
      }
      if (page.hasNextPage) {
        if (!page.endCursor) throw new Error("Shopify catalog page did not include its next cursor");
        next = { shop, runId, phase: "import", pageIndex: payload.pageIndex + 1 };
        await ref.set({
          phase: next.phase, pageIndex: next.pageIndex, cursor: page.endCursor,
          productsFetched: fetched, productsImported: imported, status: "queued",
          leaseExpiresAt: FieldValue.delete(), heartbeatAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        await setRootProgress(shop, { initialScanStatus: "scanning", initialScanProductsFetched: fetched, initialScanProductsImported: imported });
      } else {
        next = { shop, runId, phase: "monitor", pageIndex: 0 };
        await ref.set({
          phase: next.phase, pageIndex: 0, cursor: FieldValue.delete(),
          productsFetched: fetched, productsImported: imported, status: "queued",
          leaseExpiresAt: FieldValue.delete(), heartbeatAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        await setRootProgress(shop, { initialScanStatus: "scanning", initialScanProductsFetched: fetched, initialScanProductsImported: imported });
      }
    } else {
      const result = await runMerchantDeltaMonitoringForShop({
        shop,
        allHistory: payload.pageIndex === 0,
        limit: ALERT_PAGE_SIZE,
        triggerMode: "manual",
        runId: `${runId}-monitor-${payload.pageIndex}`,
        monitoringRunCollection: "initial_catalog_monitoring_pages",
      });
      const alertsScanned = Number(data.rapexAlertsScanned || 0) + result.rapexAlertsScanned;
      const productsScanned = Number(data.productsScanned || 0) + result.productsScanned;
      const alertsCreated = Number(data.alertsCreated || 0) + result.alertsCreated;
      if (result.rapexAlertsScanned === ALERT_PAGE_SIZE) {
        next = { shop, runId, phase: "monitor", pageIndex: payload.pageIndex + 1 };
        await ref.set({
          phase: next.phase, pageIndex: next.pageIndex, status: "queued",
          rapexAlertsScanned: alertsScanned, productsScanned, alertsCreated,
          lastMonitorCheckpoint: result.checkpoint, leaseExpiresAt: FieldValue.delete(),
          heartbeatAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        await ref.set({
          rapexAlertsScanned: alertsScanned, productsScanned, alertsCreated,
          lastMonitorCheckpoint: result.checkpoint, leaseExpiresAt: FieldValue.delete(),
          heartbeatAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        await completeAudit(shop, ref);
        logger.info("Initial Shopify catalog audit completed", { shop, runId, productsImported: data.productsImported, productsScanned, alertsScanned, alertsCreated });
        return;
      }
      await setRootProgress(shop, { initialScanStatus: "scanning", initialScanProductsScanned: productsScanned, initialScanAlertsScanned: alertsScanned });
    }
    if (next) await enqueue(next);
  } catch (error) {
    const exhausted = retryCount + 1 >= MAX_TASK_ATTEMPTS;
    await ref.set({
      status: exhausted ? "failed" : "retrying",
      ...(exhausted ? { failedAt: FieldValue.serverTimestamp(), failureCode: "task_failed" } : {}),
      leaseExpiresAt: FieldValue.delete(),
      heartbeatAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (exhausted) await setRootProgress(shop, { initialScanStatus: "failed", initialScanFailureCode: "task_failed" });
    logger.error("Initial Shopify catalog audit task failed", { shop, runId, phase: payload.phase, pageIndex: payload.pageIndex, attempt: retryCount + 1, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
