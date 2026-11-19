import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { installationKey, sameProductVersion } from "./product-lifecycle.js";
import { normalizeProductBarcodes } from "./product-barcodes.js";
import { SafetyCheckResultSchema, type ProductInput, type SafetyCheckResult } from "./safety-gate-checker.schemas.js";
import { PUBLIC_SCAN_COVERAGE_POLICY } from "./public-scan-coverage.js";
import { MATCHER_POLICY_VERSION } from "./safety-gate-config.js";

export function productSafetyFingerprint(product: ProductInput): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1, name: product.name, category: product.category, description: product.description,
    imageUrl: product.imageUrl, imageUrls: product.imageUrls, brand: product.brand, model: product.model,
    barcodes: normalizeProductBarcodes(product.barcodes),
    sourceUpdatedAt: product.sourceUpdatedAt && Number.isFinite(Date.parse(product.sourceUpdatedAt)) ? new Date(product.sourceUpdatedAt).toISOString() : product.sourceUpdatedAt,
  })).digest("hex");
}

/** Durable successful full-index coverage. Capture server read time BEFORE retrieval:
 * writes arriving during matching must remain eligible for the following delta.
 */
export async function withProductSafetyCoverage(
  db: Firestore, product: ProductInput, check: () => Promise<SafetyCheckResult>,
  supplementIdentifiers?: (base: SafetyCheckResult) => Promise<SafetyCheckResult>,
): Promise<SafetyCheckResult> {
  if (!product.shop || !product.productId || !product.sourceUpdatedAt) return check();
  const merchantRef = db.doc(`merchants/${encodeURIComponent(product.shop)}`);
  const productRef = merchantRef.collection("products").doc(encodeURIComponent(product.productId));
  const ref = merchantRef.collection("product_safety_coverage").doc(encodeURIComponent(product.productId));
  const fingerprint = productSafetyFingerprint(product), lease = randomUUID();
  const claim = await db.runTransaction(async transaction => {
    const [merchant, stored, current] = await Promise.all([transaction.get(merchantRef), transaction.get(ref), transaction.get(productRef)]);
    if (!merchant.exists || merchant.get("installationRetiredAt")) throw new Error("Merchant installation is unavailable");
    const installation = installationKey(merchant.data() || {});
    if (current.get("deletedAt") || (current.exists && !sameProductVersion(current.get("sourceUpdatedAt"), product.sourceUpdatedAt))) throw new Error("Product version changed before safety check");
    if (stored.get("matcherPolicy") === MATCHER_POLICY_VERSION && stored.get("installation") === installation && stored.get("fingerprint") === fingerprint && stored.get("resultJson") && stored.get("coveredThrough") instanceof Timestamp) {
      const changes = await transaction.get(db.collection("rapex_changes").where("changedAt", ">", stored.get("coveredThrough")).limit(1));
      if (changes.empty) return { cached: JSON.parse(stored.get("resultJson")) as SafetyCheckResult };
    }
    if (stored.get("leaseExpiresAt") instanceof Timestamp && stored.get("leaseExpiresAt").toMillis() > Date.now()) throw new Error("Product safety check is already processing; retry later");
    // These domains originate in an authenticated Shopify Admin response, never
    // in a storefront URL supplied by the merchant or a product-check request.
    const domains = current.get("publicScanCacheDomains");
    if (Array.isArray(domains)) {
      for (const domain of domains.slice(0, 2)) {
        if (typeof domain !== "string" || !/^[a-z0-9.-]+$/.test(domain)) continue;
        const publicProduct = await transaction.get(db.doc(`rapex_leads/${encodeURIComponent(domain)}/products/${encodeURIComponent(product.productId!)}`));
        const portable = publicProduct.get("safetyCoverage");
        if (!(publicProduct.get("expireAt") instanceof Timestamp) || publicProduct.get("expireAt").toMillis() <= Date.now() ||
            publicProduct.get("productId") !== product.productId || portable?.policy !== PUBLIC_SCAN_COVERAGE_POLICY ||
            !(portable.coveredThrough instanceof Timestamp)) continue;
        const exactFacts = portable.fingerprint === fingerprint;
        const identifiersOnly = supplementIdentifiers && portable.identifierFree === true &&
          portable.similarityFingerprint === productSafetyFingerprint({ ...product, barcodes: [] });
        if (!exactFacts && !identifiersOnly) continue;
        const changes = await transaction.get(db.collection("rapex_changes").where("changedAt", ">", portable.coveredThrough).limit(1));
        if (!changes.empty) continue;
        let parsed;
        try { parsed = SafetyCheckResultSchema.safeParse(JSON.parse(portable.resultJson)); } catch { continue; }
        if (!parsed.success) continue;
        if (!exactFacts) {
          transaction.set(ref, { lease, leaseExpiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000) }, { merge: true });
          return { installation, coveredThrough: portable.coveredThrough as Timestamp, publicBaseResult: parsed.data as SafetyCheckResult,
            importedFromPublicScan: domain };
        }
        const coverage = { fingerprint, installation, sourceUpdatedAt: product.sourceUpdatedAt!, coveredThrough: portable.coveredThrough };
        transaction.set(ref, { ...coverage, matcherPolicy: MATCHER_POLICY_VERSION, resultJson: JSON.stringify(parsed.data), completedAt: FieldValue.serverTimestamp(),
          importedFromPublicScan: domain }, { merge: true });
        transaction.set(productRef, { safetyCoverage: coverage }, { merge: true });
        return { cached: parsed.data as SafetyCheckResult };
      }
    }
    transaction.set(ref, { lease, leaseExpiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000) }, { merge: true });
    return { installation, coveredThrough: stored.readTime };
  });
  if (claim.cached) {
    console.info("Using stored full-product Safety Gate coverage", { shop: product.shop, productId: product.productId });
    return claim.cached;
  }
  try {
    const result = claim.publicBaseResult ? await supplementIdentifiers!(claim.publicBaseResult) : await check();
    const resultJson = JSON.stringify(result);
    if (Buffer.byteLength(resultJson) > 850_000) throw new Error("Safety coverage result exceeds document limit");
    await db.runTransaction(async transaction => {
      const [merchant, stored, current] = await Promise.all([transaction.get(merchantRef), transaction.get(ref), transaction.get(productRef)]);
      if (!merchant.exists || merchant.get("installationRetiredAt") || installationKey(merchant.data() || {}) !== claim.installation || stored.get("lease") !== lease || current.get("deletedAt") || (current.exists && !sameProductVersion(current.get("sourceUpdatedAt"), product.sourceUpdatedAt))) throw new Error("Product or installation changed during safety check");
      const coverage = { fingerprint, installation: claim.installation!, sourceUpdatedAt: product.sourceUpdatedAt!, coveredThrough: claim.coveredThrough! };
      transaction.set(ref, { ...coverage, matcherPolicy: MATCHER_POLICY_VERSION, resultJson, completedAt: FieldValue.serverTimestamp(), lease: FieldValue.delete(), leaseExpiresAt: FieldValue.delete() }, { merge: true });
      if (claim.importedFromPublicScan) transaction.set(ref, { importedFromPublicScan: claim.importedFromPublicScan }, { merge: true });
      if (current.exists) transaction.set(productRef, { safetyCoverage: coverage }, { merge: true });
    });
    console.info("Stored full-product Safety Gate coverage", { shop: product.shop, productId: product.productId });
    return result;
  } finally {
    await db.runTransaction(async transaction => {
      const stored = await transaction.get(ref);
      if (stored.get("lease") === lease) transaction.set(ref, { lease: FieldValue.delete(), leaseExpiresAt: FieldValue.delete() }, { merge: true });
    });
  }
}
