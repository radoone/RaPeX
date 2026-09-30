import { sessionStorage } from "../shopify.server";
import { firestore } from "../firestore.server";

const SESSION_COLLECTION = "shopify_sessions";

/** Copy the app's offline OAuth session to the private worker-readable collection. */
export async function mirrorOfflineSessionForCatalogAudit(shop: string): Promise<void> {
  const sessions = await sessionStorage.findSessionsByShop(shop);
  const offlineSession = sessions.find((session) => !session.isOnline && Boolean(session.accessToken));
  if (!offlineSession) throw new Error("Offline Shopify session is not available for catalog audit");
  await firestore.collection(SESSION_COLLECTION).doc(encodeURIComponent(offlineSession.id)).set({
    ...offlineSession.toObject(),
    updatedAt: new Date(),
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
