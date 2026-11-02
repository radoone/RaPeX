import { firestore } from "../firestore.server";
import { ownerTestAccessGranted } from "./owner-test-access";

export async function hasOwnerTestAccess(shop: string): Promise<boolean> {
  try {
    const snapshot = await firestore.collection("merchants").doc(encodeURIComponent(shop)).get();
    return snapshot.exists && ownerTestAccessGranted(snapshot.data() || {}, shop);
  } catch { return false; }
}
