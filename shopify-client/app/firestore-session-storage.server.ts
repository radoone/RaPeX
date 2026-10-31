import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import type { Firestore } from "firebase-admin/firestore";

const SESSION_COLLECTION = "shopify_sessions";
const ENCRYPTED_TOKEN_PREFIX = "enc:v1:";

function deriveSessionEncryptionKey(): Buffer | null {
  const rawSecret = (
    process.env.SHOPIFY_SESSION_ENCRYPTION_KEY ||
    process.env.SAFETY_GATE_API_KEY ||
    process.env.SHOPIFY_API_SECRET ||
    ""
  ).trim();
  if (!rawSecret) return null;
  return createHash("sha256").update(`zerorecall-session-v1:${rawSecret}`).digest();
}

export function encryptSessionAccessToken(token: unknown): unknown {
  if (typeof token !== "string" || !token || token.startsWith(ENCRYPTED_TOKEN_PREFIX)) {
    return token;
  }
  const key = deriveSessionEncryptionKey();
  if (!key) return token;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTED_TOKEN_PREFIX}${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSessionAccessToken(stored: unknown): string | undefined {
  if (typeof stored !== "string" || !stored) return undefined;
  if (!stored.startsWith(ENCRYPTED_TOKEN_PREFIX)) return stored;
  const key = deriveSessionEncryptionKey();
  if (!key) throw new Error("Cannot decrypt Shopify session token: encryption key is not configured");
  const parts = stored.slice(ENCRYPTED_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted Shopify session token format");
  const [ivB64, tagB64, ciphertextB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate();
  }
  return undefined;
}

function toShopifySession(data: Record<string, unknown>): Session {
  const accessToken = decryptSessionAccessToken(data.accessToken);
  return new Session({
    ...data,
    ...(accessToken !== undefined ? { accessToken } : {}),
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
    const serialized = session.toObject();
    await this.sessionRef(session.id).set({
      ...serialized,
      ...(serialized.accessToken ? { accessToken: encryptSessionAccessToken(serialized.accessToken) } : {}),
      updatedAt: new Date(),
    });
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
