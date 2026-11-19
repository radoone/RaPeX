import { sessionStorage } from "../shopify.server";
import { firestore } from "../firestore.server";

const SESSION_COLLECTION = "shopify_sessions";

/** Ensure the canonical Firestore offline OAuth session is ready for background workers. */
export async function mirrorOfflineSessionForCatalogAudit(shop: string): Promise<void> {
  const merchantRef = firestore.collection("merchants").doc(encodeURIComponent(shop));
  const initialMerchant = await merchantRef.get();
  const installation = (data: any) => String(data?.createdAt?.toMillis?.() ?? data?.createdAt ?? "legacy");
  if (!initialMerchant.exists || initialMerchant.get("installationRetiredAt")) {
    throw new Error("Merchant installation is missing or retired");
  }
  const session = await sessionStorage.loadSession(`offline_${shop}`);
  if (!session?.accessToken) {
    throw new Error("Offline Shopify session is not available for catalog audit");
  }
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(merchantRef);
    if (
      !current.exists ||
      current.get("installationRetiredAt") ||
      installation(current.data()) !== installation(initialMerchant.data())
    ) {
      throw new Error("Merchant installation changed while preparing background access");
    }
  });
}

/** Remove worker-readable OAuth copies on uninstall and mandatory shop redaction. */
export async function deleteCatalogAuditSessions(shop: string): Promise<number> {
  const snapshot = await firestore.collection(SESSION_COLLECTION).where("shop", "==", shop).get();
  for (let start = 0; start < snapshot.docs.length; start += 500) {
    const batch = firestore.batch();
    snapshot.docs.slice(start, start + 500).forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
  return snapshot.size;
}
