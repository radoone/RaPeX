import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";
import { scanPublicCatalogProducts } from "./public-store-scanner.js";
import { enqueueFreeScanCatalogPage, sendFreeScanReport } from "./free-scan.js";
import { fetchPublicCatalogPage, runFreeScanCatalogPage, type FreeScanPage, type ScanPreviewMatch } from "./free-scan-catalog.js";

function preview(matches: ScanPreviewMatch[]): ScanPreviewMatch[] {
  return matches.slice(0, 5).map(match => ({
    productId: String(match.productId || "").slice(0, 100),
    productTitle: String(match.productTitle || "").slice(0, 1000),
    productUrl: String(match.productUrl || "").slice(0, 2048),
    result: { warnings: (match.result?.warnings || []).slice(0, 1).map(warning => ({
      alertId: String(warning.alertId || "").slice(0, 500),
      ...(typeof warning.overallSimilarity === "number" ? { overallSimilarity: warning.overallSimilarity } : {}),
    })) },
  }));
}

/** One durable task per public catalog page; no catalog-sized arrays in a request document. */
export async function handleFreeScanCatalogTask(payload: FreeScanPage, retryCount: number): Promise<void> {
  if (!/^[A-Za-z0-9]{20}$/.test(payload?.requestId || "")) throw new Error("Invalid free scan request ID");
  const ref = db.collection("free_scan_requests").doc(payload.requestId);
  try {
    await runFreeScanCatalogPage(payload, {
      load: async () => {
        const snapshot = await ref.get();
        if (!snapshot.exists || (snapshot.get("expireAt") instanceof Timestamp && snapshot.get("expireAt").toMillis() <= Date.now())) return null;
        return {
          domain: String(snapshot.get("domain")), status: String(snapshot.get("status")),
          nextPage: Number(snapshot.get("nextPage") || 0), checkedProducts: Number(snapshot.get("checkedProducts") || 0),
          possibleMatches: Number(snapshot.get("possibleMatches") || 0), catalogComplete: snapshot.get("catalogComplete") === true,
        };
      },
      fetch: fetchPublicCatalogPage,
      unseen: async products => {
        if (!products.length) return [];
        const snapshots = await db.getAll(...products.map(product => ref.collection("products").doc(String(product.id))));
        return products.filter((_, index) => !snapshots[index].exists);
      },
      scan: (domain, products) => scanPublicCatalogProducts(domain, products),
      commit: async (pageIndex, products, result, exhausted) => {
        await db.runTransaction(async transaction => {
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists || !["queued", "running"].includes(snapshot.get("status")) || Number(snapshot.get("nextPage") || 0) !== pageIndex) return;
          const expireAt = snapshot.get("expireAt") instanceof Timestamp ? snapshot.get("expireAt") : Timestamp.fromMillis(Date.now() + 30 * 86400_000);
          const compactMatches = preview(result.matches);
          const matchesByProduct = new Map(result.matches.map(match => [match.productId, match]));
          for (const product of products) {
            const match = matchesByProduct.get(String(product.id));
            transaction.create(ref.collection("products").doc(String(product.id)), {
              productId: String(product.id), checkedAt: FieldValue.serverTimestamp(), pageIndex,
              match: match ? preview([match])[0] : null, expireAt,
            });
          }
          const checkedProducts = Number(snapshot.get("checkedProducts") || 0) + products.length;
          const possibleMatches = Number(snapshot.get("possibleMatches") || 0) + result.flaggedProductsCount;
          const matches = [...(snapshot.get("previewMatches") || []), ...compactMatches].slice(0, 5);
          transaction.update(ref, {
            nextPage: pageIndex + 1, checkedProducts, possibleMatches, previewMatches: matches,
            catalogComplete: exhausted, status: exhausted ? "reporting" : "running", updatedAt: FieldValue.serverTimestamp(),
          });
          transaction.set(db.collection("rapex_leads").doc(encodeURIComponent(String(snapshot.get("domain")))), {
            domain: snapshot.get("domain"), status: "scanning", totalProductsScanned: checkedProducts,
            flaggedProductsCount: possibleMatches, matches, lastPublicScanRequestId: payload.requestId,
            updatedAt: new Date().toISOString(), expireAt: Timestamp.fromMillis(Date.now() + 90 * 86400_000),
            scanProgress: { stage: "vector_search", message: `Preverených ${checkedProducts} verejných produktov. Sken pokračuje.` },
          }, { merge: true });
        });
      },
      enqueue: pageIndex => enqueueFreeScanCatalogPage({ requestId: payload.requestId, pageIndex }),
      report: async () => {
        const snapshot = await ref.get();
        if (!snapshot.exists || snapshot.get("status") !== "reporting" || snapshot.get("catalogComplete") !== true) return;
        const data = snapshot.data()!;
        const lead = { totalProductsScanned: Number(data.checkedProducts), flaggedProductsCount: Number(data.possibleMatches), matches: data.previewMatches || [] };
        await sendFreeScanReport(payload.requestId, data as Parameters<typeof sendFreeScanReport>[1], { success: true, lead });
        await db.runTransaction(async transaction => {
          const current = await transaction.get(ref);
          if (current.get("status") !== "reporting") return;
          transaction.update(ref, { status: "completed", reportAcceptedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
          transaction.set(db.collection("rapex_leads").doc(encodeURIComponent(data.domain)), {
            ...lead, matches: lead.matches, status: lead.flaggedProductsCount ? "review_needed" : "new",
            scannedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            scanProgress: { stage: "completed", percent: 100, message: `Sken celého verejného katalógu dokončený: ${lead.totalProductsScanned} produktov.` },
          }, { merge: true });
        });
      },
    });
  } catch (error) {
    logger.error("Public full-catalog scan task failed", { requestId: payload.requestId, pageIndex: payload.pageIndex, retryCount, error });
    if (retryCount >= 7) {
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || ["completed", "failed"].includes(snapshot.get("status"))) return;
        const leadRef = db.collection("rapex_leads").doc(encodeURIComponent(String(snapshot.get("domain"))));
        const lead = await transaction.get(leadRef);
        if (lead.get("lastPublicScanRequestId") === payload.requestId) transaction.set(leadRef, { status: "error", scanProgress: { stage: "error", percent: 0, message: "Sken celého katalógu sa nepodarilo dokončiť." }, updatedAt: new Date().toISOString() }, { merge: true });
        transaction.update(ref, { status: "failed", failureCode: "catalog_scan_failed", updatedAt: FieldValue.serverTimestamp() });
      });
    }
    throw error;
  }
}
