import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import type { Firestore } from "firebase-admin/firestore";

const SESSION_COLLECTION = "shopify_sessions";

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate();
  }
  return undefined;
}

function toShopifySession(data: Record<string, unknown>): Session {
  return new Session({
    ...data,
    id: String(data.id || ""),
    shop: String(data.shop || ""),
    state: String(data.state || ""),
    isOnline: Boolean(data.isOnline),
    expires: asDate(data.expires),
    refreshTokenExpires: asDate(data.refreshTokenExpires),
  });
}

/** Durable Shopify OAuth sessions for hosted app and task-worker runtimes. */
export class FirestoreSessionStorage implements SessionStorage {
  constructor(private readonly db: Firestore) {}

  private sessionRef(id: string) {
    return this.db.collection(SESSION_COLLECTION).doc(encodeURIComponent(id));
  }

  async storeSession(session: Session): Promise<boolean> {
    await this.sessionRef(session.id).set({ ...session.toObject(), updatedAt: new Date() });
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const snapshot = await this.sessionRef(id).get();
    if (!snapshot.exists) return undefined;
    return toShopifySession(snapshot.data() || {});
  }

  async deleteSession(id: string): Promise<boolean> {
    await this.sessionRef(id).delete();
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    for (let start = 0; start < ids.length; start += 500) {
      const batch = this.db.batch();
      ids.slice(start, start + 500).forEach((id) => batch.delete(this.sessionRef(id)));
      await batch.commit();
    }
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const snapshot = await this.db.collection(SESSION_COLLECTION).where("shop", "==", shop).get();
    return snapshot.docs.map((doc) => toShopifySession(doc.data()));
  }
}
