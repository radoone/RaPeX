import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { productSafetyFingerprint } from "./product-safety-coverage.js";
import { normalizePictures } from "./safety-gate-checker-media.js";
import { installationKey, sameProductVersion } from "./product-lifecycle.js";
import { MATCHER_POLICY_VERSION } from "./safety-gate-config.js";
import type { ProductInput, SafetyCheckResult } from "./safety-gate-checker.schemas.js";
import type { NormalizedAlert } from "./safety-gate-checker.types.js";

export function productPairCacheId(product: ProductInput, alert: NormalizedAlert): string {
  // A technical re-embedding or a different batch/image priority is not new evidence.
  const fields = Object.fromEntries(Object.entries(alert.fields)
    .filter(([key]) => !["pictures", "product_image", "product_other_images"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify({ version: 1, matcherPolicy: MATCHER_POLICY_VERSION, productId: product.productId, product: productSafetyFingerprint(product),
    alertId: alert.id, fields, pictures: [...new Set(normalizePictures(alert.fields))].sort() })).digest("hex");
}

export function mergeSafetyResults(results: SafetyCheckResult[], candidateCount: number): SafetyCheckResult {
  if (!results.length) throw new Error("Missing safety result");
  const warnings = [...new Map(results.flatMap(result => result.warnings).map(warning => [warning.alertId, warning])).values()];
  return { ...results[0], isSafe: warnings.length === 0, warnings,
    recommendation: warnings.length ? "Possible Safety Gate matches require review of the exact product, model and batch." : results[0].recommendation,
    checkedAt: new Date().toISOString(), analysis: { ...results[0].analysis, candidateAlertsConsidered: candidateCount,
      comparedImageAlertIds: [...new Set(results.flatMap(result => result.analysis.comparedImageAlertIds || []))] } };
}

function collection(db: Firestore, product: ProductInput) {
  return db.doc(`merchants/${encodeURIComponent(product.shop!)}`).collection("product_match_results");
}

export async function capturePairCacheInstallation(db: Firestore, product: ProductInput): Promise<string | undefined> {
  if (!product.shop || !product.productId || !product.sourceUpdatedAt) return undefined;
  const merchant = await db.doc(`merchants/${encodeURIComponent(product.shop)}`).get();
  if (!merchant.exists || merchant.get("installationRetiredAt")) throw new Error("Merchant installation is unavailable");
  return installationKey(merchant.data() || {});
}

export async function readPairMatchResults(db: Firestore, product: ProductInput, alerts: NormalizedAlert[], installation?: string): Promise<Array<{ alertId: string; result: SafetyCheckResult }>> {
  if (!product.shop || !product.productId || !product.sourceUpdatedAt) return [];
  const refs = alerts.map(alert => collection(db, product).doc(productPairCacheId(product, alert)));
  const rows = await db.getAll(...refs);
  return rows.flatMap((row, i) => row.exists && row.get("installation") === installation ? [{ alertId: alerts[i].id, result: JSON.parse(row.get("resultJson")) as SafetyCheckResult }] : []);
}

export async function writePairMatchResults(db: Firestore, product: ProductInput, alerts: NormalizedAlert[], result: SafetyCheckResult, installation?: string): Promise<void> {
  if (!product.shop || !product.productId || !product.sourceUpdatedAt) return;
  const rows = alerts.map(alert => {
    const warnings = result.warnings.filter(warning => warning.alertId === alert.id);
    const single = { ...result, warnings, isSafe: warnings.length === 0,
      recommendation: warnings.length ? "Possible Safety Gate match requires review." : "No match found for this Safety Gate record.",
      analysis: { ...result.analysis, candidateAlertsConsidered: 1 } };
    const resultJson = JSON.stringify(single);
    if (Buffer.byteLength(resultJson) > 850_000) throw new Error("Pair result exceeds document limit");
    return { ref: collection(db, product).doc(productPairCacheId(product, alert)), data: {
      productId: product.productId, sourceAlertId: alert.id, installation, resultJson, createdAt: FieldValue.serverTimestamp(),
    } };
  });
  // Deliberately no TTL: unchanged completed pairs remain reusable across future deltas.
  await db.runTransaction(async transaction => {
    const merchantRef = db.doc(`merchants/${encodeURIComponent(product.shop!)}`);
    const [merchant, current] = await Promise.all([transaction.get(merchantRef), transaction.get(merchantRef.collection("products").doc(encodeURIComponent(product.productId!)))]);
    if (!merchant.exists || merchant.get("installationRetiredAt") || installationKey(merchant.data() || {}) !== installation || current.get("deletedAt") || (current.exists && !sameProductVersion(current.get("sourceUpdatedAt"), product.sourceUpdatedAt))) throw new Error("Product or installation changed during pair matching");
    for (const row of rows) transaction.set(row.ref, row.data);
  });
}
