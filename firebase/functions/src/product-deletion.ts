import { FieldPath, FieldValue, type Firestore, type DocumentReference } from "firebase-admin/firestore";
import { canApplyProductVersion, installationKey, sameProductVersion } from "./product-lifecycle.js";

/** Soft-delete first; then mark findings in bounded, resumable batches without changing decisions. */
export async function markMerchantProductDeleted(
  database: Firestore, merchantRef: DocumentReference, shop: string, productId: string, incoming: string, installation: string,
): Promise<boolean> {
  const productRef = merchantRef.collection("products").doc(encodeURIComponent(productId));
  const marked = await database.runTransaction(async transaction => {
    const [merchant, product] = await Promise.all([transaction.get(merchantRef), transaction.get(productRef)]);
    if (!merchant.exists || merchant.get("installationRetiredAt") || installationKey(merchant.data() || {}) !== installation) return false;
    const data = product.data() || {};
    if (data.deletedAt && sameProductVersion(data.deletedSourceUpdatedAt, incoming)) return true;
    if (!canApplyProductVersion(data, incoming)) return false;
    transaction.set(productRef, {
      shop, productId, deletedAt: FieldValue.serverTimestamp(), deletedSourceUpdatedAt: incoming,
      updatedAt: FieldValue.serverTimestamp(), deletionCleanupCompletedAt: FieldValue.delete(),
      vector_text: FieldValue.delete(), vector_image: FieldValue.delete(), gtins: [], barcodes: [],
    }, { merge: true });
    return true;
  });
  if (!marked) return false;
  let cursor: string | null = null;
  for (;;) {
    let query = merchantRef.collection("alerts").where("productId", "==", productId).orderBy(FieldPath.documentId()).limit(200);
    if (cursor) query = query.startAfter(cursor);
    const alerts = await query.get();
    const applied = await database.runTransaction(async transaction => {
      const [merchant, product] = await Promise.all([transaction.get(merchantRef), transaction.get(productRef)]);
      if (!merchant.exists || merchant.get("installationRetiredAt") || installationKey(merchant.data() || {}) !== installation ||
        !product.get("deletedAt") || !sameProductVersion(product.get("deletedSourceUpdatedAt"), incoming)) return false;
      alerts.docs.forEach(alert => transaction.set(alert.ref, {
        productDeleted: true, productDeletedAt: product.get("deletedAt"), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }));
      if (alerts.size < 200) transaction.set(productRef, { deletionCleanupCompletedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!applied) return false;
    if (alerts.size < 200) return true;
    cursor = alerts.docs[alerts.docs.length - 1].id;
  }
}
