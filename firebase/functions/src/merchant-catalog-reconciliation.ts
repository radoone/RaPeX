import { randomUUID } from "node:crypto";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import { installationKey } from "./product-lifecycle.js";
import { currentEntitlement, productChangeJobId, type ShopifyProductChangeTaskPayload } from "./merchant-monitoring.js";
import { decryptStoredShopifyToken } from "./merchant-catalog-audit.js";
import { merchantCatalogAuditTaskId } from "./monitoring-task-id.js";
import { mapBounded } from "./matching-work.js";
import { catalogNeedsRepair, dispatchCatalogRepairs, parseCatalogNodes, parseCatalogPage, prepareCatalogVerification, type CatalogSnapshot, type ReconciliationPage } from "./catalog-reconciliation.js";

const RUNS = "catalog_reconciliation_runs";
const MAX_RUN_AGE = 20 * 60 * 60_000;
const QUEUE = getFunctions().taskQueue<ReconciliationTask>("locations/europe-west1/functions/merchantCatalogReconciliationTask");
const PRODUCT_QUEUE = getFunctions().taskQueue<ShopifyProductChangeTaskPayload>("locations/europe-west1/functions/shopifyProductChangeTask");
export type ReconciliationTask = { shop: string; runId: string; installation: string; phase: "discover" | "verify"; pageIndex: number };

function merchantRef(shop: string) { return db.collection("merchants").doc(encodeURIComponent(shop)); }
function validShop(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value); }
function taskFor(shop: string, runId: string, installation: string, data: Record<string, any>): ReconciliationTask {
  if (!["discover", "verify"].includes(data.phase) || !Number.isSafeInteger(data.pageIndex) || data.pageIndex < 0) throw new Error("Invalid reconciliation progress");
  return { shop, runId, installation, phase: data.phase, pageIndex: data.pageIndex };
}
async function enqueue(payload: ReconciliationTask): Promise<void> {
  try {
    await QUEUE.enqueue(payload, { id: merchantCatalogAuditTaskId(payload.shop, payload.runId, `reconcile-${payload.phase}-${payload.pageIndex}`), dispatchDeadlineSeconds: 1200 });
  } catch (error) { if ((error as { code?: string }).code !== "functions/task-already-exists") throw error; }
}

/** Walk tenants in bounded pages; one durable catalog run per installation/day. */
export async function reconcileMerchantCatalogs(scheduleTime: string): Promise<{ shopsQueued: number; failures: number }> {
  const date = new Date(scheduleTime);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid reconciliation schedule time");
  let cursor: string | null = null, shopsQueued = 0, failures = 0;
  for (;;) {
    let query = db.collection("merchants").orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const merchants = await query.get();
    await mapBounded(merchants.docs, 5, async merchant => {
      const shop = merchant.get("shop") || decodeURIComponent(merchant.id);
      if (!validShop(shop) || merchant.get("installationRetiredAt")) return;
      try {
        const payload = await reserveCatalogReconciliation(shop, date);
        if (payload) { await enqueue(payload); shopsQueued++; }
      } catch (error) { failures++; logger.error("Could not enqueue catalog reconciliation", { shop, error: error instanceof Error ? error.message : String(error) }); }
    });
    if (merchants.size < 100) break;
    cursor = merchants.docs[merchants.docs.length - 1].id;
  }
  return { shopsQueued, failures };
}

export async function reserveCatalogReconciliation(shop: string, date: Date): Promise<ReconciliationTask | null> {
  if (!validShop(shop)) throw new Error("Invalid reconciliation shop");
  const ref = merchantRef(shop);
  return db.runTransaction(async transaction => {
    const merchant = await transaction.get(ref);
    if (!merchant.exists || merchant.get("installationRetiredAt")) return null;
    const installation = installationKey(merchant.data() || {});
    const runId = `daily-${date.toISOString().slice(0, 10)}-${merchantCatalogAuditTaskId(shop, installation, "installation").slice(-16)}`;
    const priorId = merchant.get("catalogReconciliationRunId");
    const prior = typeof priorId === "string" ? await transaction.get(ref.collection(RUNS).doc(priorId)) : null;
    if (prior?.exists && prior.get("installation") === installation && ["queued", "processing", "retrying"].includes(prior.get("status")) &&
      prior.get("createdAt") instanceof Timestamp && Date.now() - prior.get("createdAt").toMillis() < MAX_RUN_AGE) {
      return taskFor(shop, priorId, installation, prior.data() || {});
    }
    const run = ref.collection(RUNS).doc(runId), existing = prior?.id === runId ? prior : await transaction.get(run);
    if (existing?.exists) return null;
    // The initial import owns bulk vectorization; reconciliation only repairs an established catalog.
    const phase = currentEntitlement(merchant.data() || {}) && merchant.get("initialScanStatus") === "completed" ? "discover" : "verify";
    const data = {
      shop, installation, status: "queued", phase, pageIndex: 0, cursor: null, lastProductId: null,
      shopifyProductsSeen: 0, storedProductsVerified: 0, upsertRepairsPlanned: 0, deletionRepairsPlanned: 0,
      createdAt: Timestamp.now(), expireAt: Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60_000), updatedAt: FieldValue.serverTimestamp(),
    };
    if (prior?.exists && ["queued", "processing", "retrying"].includes(prior.get("status"))) transaction.set(prior.ref, { status: "abandoned", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(run, data);
    transaction.set(ref, { catalogReconciliationRunId: runId }, { merge: true });
    return taskFor(shop, runId, installation, data);
  });
}

/** OAuth stays server-side; failed/partial GraphQL responses never mean an empty catalog. */
export async function requestCatalogGraphQL(shop: string, query: string, variables: Record<string, unknown>): Promise<any> {
  if (!validShop(shop)) throw new Error("Invalid reconciliation shop");
  const sessions = await db.collection("shopify_sessions").where("shop", "==", shop).where("isOnline", "==", false).limit(1).get();
  const accessToken = decryptStoredShopifyToken(sessions.docs[0]?.get("accessToken"));
  const version = process.env.SHOPIFY_ADMIN_API_VERSION || process.env.SHOPIFY_API_VERSION || "2026-07";
  const response = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Shopify reconciliation request failed (${response.status})`);
  const payload = await response.json() as any;
  if (payload.errors?.length || !payload.data) throw new Error("Shopify reconciliation query is unavailable");
  return payload;
}

async function productExistence(shop: string, ids: string[]) {
  if (!ids.length) return new Map();
  return parseCatalogNodes(await requestCatalogGraphQL(shop, `query CatalogExistence($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { id updatedAt } }
  }`, { ids: ids.map(id => `gid://shopify/Product/${id}`) }), ids);
}

export async function prepareReconciliationPage(shop: string, data: Record<string, any>, entitled: boolean): Promise<ReconciliationPage> {
  const products = merchantRef(shop).collection("products");
  if (data.phase === "discover") {
    const page = parseCatalogPage(await requestCatalogGraphQL(shop, `query ReconcileCatalog($after: String) {
      products(first: 100, after: $after, sortKey: ID) { nodes { id updatedAt } pageInfo { hasNextPage endCursor } }
    }`, { after: data.cursor || null }), data.cursor || null, data.lastProductId || null);
    const stored = page.products.length ? await db.getAll(...page.products.map(p => products.doc(p.id)), { fieldMask: ["sourceUpdatedAt", "deletedAt", "deletedSourceUpdatedAt"] }) : [];
    return {
      phase: "discover", nextCursor: page.cursor, lastProductId: page.lastProductId, done: page.done, visited: page.products.length,
      repairs: page.products.filter((p, i) => entitled && catalogNeedsRepair(stored[i]?.exists ? { id: p.id, ...stored[i].data() } : undefined, p))
        .map(p => ({ id: p.id, operation: "upsert", sourceUpdatedAt: p.updatedAt })),
    };
  }
  let query = products.orderBy(FieldPath.documentId()).select("sourceUpdatedAt", "deletedAt", "deletedSourceUpdatedAt", "deletionCleanupCompletedAt").limit(100);
  if (data.cursor) query = query.startAfter(data.cursor);
  const snapshot = await query.get();
  const candidates = snapshot.docs.filter(p => !p.get("deletedAt") || !p.get("deletionCleanupCompletedAt"));
  const ids = candidates.map(p => p.id);
  if (ids.some(id => !/^[1-9]\d*$/.test(id))) throw new Error("Stored catalog identity is invalid");
  const current = await productExistence(shop, ids);
  return {
    phase: "verify", nextCursor: snapshot.size ? snapshot.docs[snapshot.docs.length - 1].id : null,
    lastProductId: null, done: snapshot.size < 100, visited: snapshot.size,
    repairs: prepareCatalogVerification(candidates.map(p => ({ id: p.id, ...p.data() } as CatalogSnapshot)), current, new Date().toISOString(), entitled),
  };
}

function ownsRun(merchant: any, run: any, payload: ReconciliationTask, lease?: string): boolean {
  return merchant.exists && !merchant.get("installationRetiredAt") && installationKey(merchant.data() || {}) === payload.installation &&
    merchant.get("catalogReconciliationRunId") === payload.runId && run.exists && run.get("installation") === payload.installation &&
    (!lease || run.get("leaseToken") === lease);
}

export async function handleCatalogReconciliationTask(payload: ReconciliationTask, retryCount = 0): Promise<void> {
  if (!validShop(payload?.shop) || !/^daily-\d{4}-\d{2}-\d{2}-[a-f0-9]{16}$/.test(payload.runId) || !payload.installation) throw new Error("Invalid catalog reconciliation task");
  taskFor(payload.shop, payload.runId, payload.installation, payload);
  const ref = merchantRef(payload.shop), run = ref.collection(RUNS).doc(payload.runId), lease = randomUUID();
  const claim = await db.runTransaction(async transaction => {
    const [merchant, snapshot] = await Promise.all([transaction.get(ref), transaction.get(run)]);
    if (!ownsRun(merchant, snapshot, payload) || ["completed", "failed", "abandoned"].includes(snapshot.get("status"))) return { kind: "finished" as const };
    const data = snapshot.data() || {}, current = taskFor(payload.shop, payload.runId, payload.installation, data);
    if (current.phase !== payload.phase || current.pageIndex !== payload.pageIndex) return { kind: "stale" as const, current };
    if (data.leaseUntil instanceof Timestamp && data.leaseUntil.toMillis() > Date.now()) throw new Error("Catalog reconciliation page is already processing");
    transaction.set(run, { status: "processing", leaseToken: lease, leaseUntil: Timestamp.fromMillis(Date.now() + 22 * 60_000), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { kind: "claimed" as const, data, entitled: currentEntitlement(merchant.data() || {}) && merchant.get("initialScanStatus") === "completed" };
  });
  if (claim.kind === "finished") return;
  if (claim.kind === "stale") { await enqueue(claim.current); return; }
  const update = async (values: Record<string, unknown>): Promise<boolean> => db.runTransaction(async transaction => {
    const [merchant, snapshot] = await Promise.all([transaction.get(ref), transaction.get(run)]);
    if (!ownsRun(merchant, snapshot, payload, lease)) return false;
    transaction.set(run, values, { merge: true });return true;
  });
  try {
    const page: ReconciliationPage = claim.data.prepared || await prepareReconciliationPage(payload.shop, claim.data, claim.entitled);
    if (!claim.data.prepared && !await update({ prepared: page, updatedAt: FieldValue.serverTimestamp() })) return;
    // Bounded queue dispatch only. Model work remains in the existing version-fenced product worker.
    await dispatchCatalogRepairs(page.repairs, async repair => {
      const body: ShopifyProductChangeTaskPayload = {
        shop: payload.shop, productId: repair.id, operation: repair.operation, installation: payload.installation,
        sourceUpdatedAt: repair.sourceUpdatedAt, recoveryRunId: payload.runId,
      };
      if (repair.operation === "upsert") body.refreshFromShopify = true;
      const merchant = await ref.get();
      if (!merchant.exists || merchant.get("installationRetiredAt") || installationKey(merchant.data() || {}) !== payload.installation || merchant.get("catalogReconciliationRunId") !== payload.runId) return;
      if (repair.operation === "upsert" && (!currentEntitlement(merchant.data() || {}) || merchant.get("initialScanStatus") !== "completed")) return;
      try { await PRODUCT_QUEUE.enqueue(body, { id: productChangeJobId(body), dispatchDeadlineSeconds: 1800 }); }
      catch (error) { if ((error as { code?: string }).code !== "functions/task-already-exists") throw error; }
    });
    const done = page.phase === "verify" && page.done;
    const phase = page.phase === "discover" && page.done ? "verify" : page.phase;
    const pageIndex = phase !== page.phase ? 0 : payload.pageIndex + 1;
    const advanced = await db.runTransaction(async transaction => {
      const [merchant, snapshot] = await Promise.all([transaction.get(ref), transaction.get(run)]);
      if (!ownsRun(merchant, snapshot, payload, lease)) return false;
      const values = {
        phase, pageIndex, cursor: phase !== page.phase ? null : page.nextCursor, lastProductId: phase !== page.phase ? null : page.lastProductId,
        status: done ? "completed" : "queued", prepared: FieldValue.delete(), leaseToken: FieldValue.delete(), leaseUntil: FieldValue.delete(),
        shopifyProductsSeen: Number(snapshot.get("shopifyProductsSeen") || 0) + (page.phase === "discover" ? page.visited : 0),
        storedProductsVerified: Number(snapshot.get("storedProductsVerified") || 0) + (page.phase === "verify" ? page.visited : 0),
        // Planned durable dispatches; completion of a catalog run is not completion of safety analysis.
        upsertRepairsPlanned: Number(snapshot.get("upsertRepairsPlanned") || 0) + page.repairs.filter(p => p.operation === "upsert").length,
        deletionRepairsPlanned: Number(snapshot.get("deletionRepairsPlanned") || 0) + page.repairs.filter(p => p.operation === "delete").length,
        ...(done ? { completedAt: FieldValue.serverTimestamp() } : {}), updatedAt: FieldValue.serverTimestamp(),
      };
      transaction.set(run, values, { merge: true });
      if (done) transaction.set(ref, { catalogInventoryComparedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (advanced && !done) await enqueue({ ...payload, phase, pageIndex });
    if (advanced && done) logger.info("Shopify catalog reconciliation enumeration completed; repairs are queued separately", { shop: payload.shop, runId: payload.runId });
  } catch (error) {
    // If progress already committed, do not roll its cursor/status back when continuation enqueue fails.
    await db.runTransaction(async transaction => {
      const [merchant, snapshot] = await Promise.all([transaction.get(ref), transaction.get(run)]);
      if (ownsRun(merchant, snapshot, payload, lease)) transaction.set(run, {
        status: retryCount >= 7 ? "failed" : "retrying", leaseToken: FieldValue.delete(), leaseUntil: FieldValue.delete(),
        failureCode: "reconciliation_unavailable", updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    logger.error("Shopify catalog reconciliation page failed", { shop: payload.shop, runId: payload.runId, phase: payload.phase, pageIndex: payload.pageIndex });
    throw error;
  }
}
