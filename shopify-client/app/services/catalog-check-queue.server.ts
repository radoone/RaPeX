import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { pendingAutomaticProductIds, productCheckRetryWindow } from "./catalog-state";
import { toIsoString } from "./monitoring-runs";

const milliseconds = (value: unknown) => {
  const iso = toIsoString(value);
  return iso ? Date.parse(iso) : undefined;
};

export async function readAutomaticCatalogChecks(
  merchant: DocumentSnapshot,
  products: Array<{ id: string; updatedAt?: string | null }>,
  ownerTestAccess: boolean,
) {
  if (products.length === 0 || merchant.get("installationRetiredAt")) return [];
  const now = Date.now();
  const merchantData = merchant.data() || {};
  const validUntil = milliseconds(merchantData.subscriptionValidUntil) ?? 0;
  const entitled = ownerTestAccess || (
    merchantData.monitoringEntitled === true &&
    merchantData.subscriptionStatus === "active" &&
    validUntil > now
  );

  const auditProductIds: string[] = [];
  const runId = merchantData.initialScanRunId;
  if (merchantData.initialScanStatus === "scanning" && typeof runId === "string" &&
    runId && !runId.includes("/")) {
    const run = await merchant.ref.collection("initial_catalog_runs").doc(runId).get();
    const updatedAt = milliseconds(run.get("updatedAt")) ?? 0;
    if (["queued", "processing", "retrying"].includes(run.get("status")) &&
      updatedAt > now - productCheckRetryWindow) {
      const startedAt = milliseconds(run.get("createdAt"));
      for (const product of products) {
        const productVersion = milliseconds(product.updatedAt);
        if (startedAt !== undefined && productVersion !== undefined && productVersion <= startedAt) {
          auditProductIds.push(product.id.replace("gid://shopify/Product/", ""));
        }
      }
    }
  }
  if (!entitled || auditProductIds.length === products.length) return auditProductIds;

  // Bounded, indexed read of recent lightweight receipts. An absent receipt
  // means the automatic check is unconfirmed, including for busy catalogs.
  const recentJobs = await merchant.ref.collection("product_change_jobs")
    .where("updatedAt", ">", Timestamp.fromMillis(now - productCheckRetryWindow))
    .orderBy("updatedAt", "desc")
    .limit(300)
    .select("productId", "sourceUpdatedAt", "status", "attemptCount", "queuedAt", "startedAt", "createdAt", "updatedAt")
    .get();
  const jobs = recentJobs.docs.map(job => {
    const data = job.data();
    return {
      productId: data.productId,
      sourceUpdatedAt: data.sourceUpdatedAt,
      status: data.status,
      attemptCount: data.attemptCount,
      createdAt: milliseconds(data.createdAt),
      startedAt: milliseconds(data.startedAt),
      queuedAt: milliseconds(data.queuedAt),
      updatedAt: milliseconds(data.updatedAt),
    };
  });
  const queuedProductIds = pendingAutomaticProductIds(
    products, jobs, now, milliseconds(merchantData.createdAt) ?? 0,
  );
  return [...new Set([...auditProductIds, ...queuedProductIds])];
}
