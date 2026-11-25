import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

const PREFIX = "enc:v1:";
const REFRESH_AHEAD_MS = 10 * 60_000;

/** Permanent offline-token error requiring Shopify token exchange or OAuth reauthorization. */
export class ShopifyOfflineReauthError extends Error {
  readonly requiresReauth = true;
  constructor(message: string) {
    super(message);
    this.name = "ShopifyOfflineReauthError";
  }
}

export function isShopifyOfflineReauthError(error: unknown): error is ShopifyOfflineReauthError {
  return error instanceof ShopifyOfflineReauthError ||
    (typeof error === "object" && error !== null && (error as { requiresReauth?: unknown }).requiresReauth === true);
}
function encryptionKey(): Buffer {
  const secret = (process.env.SHOPIFY_SESSION_ENCRYPTION_KEY || process.env.SAFETY_GATE_API_KEY || process.env.SHOPIFY_API_SECRET || "").trim();
  if (!secret) throw new Error("Shopify session encryption is not configured");
  return createHash("sha256").update(`zerorecall-session-v1:${secret}`).digest();
}
export function encryptShopifyToken(token: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
export function decryptShopifyToken(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Shopify offline token is missing");
  if (!value.startsWith(PREFIX)) return value;
  const parts = value.slice(PREFIX.length).split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted Shopify token");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parts[0], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8");
}
export function sessionDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return value.toDate();
  return undefined;
}

/** One canonical session and a distributed lease shared by web and background workers. */
export async function ensureOfflineSession(db: Firestore, id: string, forceRefresh = false): Promise<Record<string, any> | undefined> {
  const ref = db.collection("shopify_sessions").doc(encodeURIComponent(id));
  if (!forceRefresh && typeof (ref as { get?: unknown }).get === "function") {
    const fastSnapshot = await ref.get();
    if (!fastSnapshot.exists) return undefined;
    const session = fastSnapshot.data()!;
    if (session.isOnline) return session;
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(session.shop) || id !== `offline_${session.shop}`) {
      throw new Error("Invalid Shopify offline session identity");
    }
    const expires = sessionDate(session.expires);
    if (expires && expires.getTime() > Date.now() + REFRESH_AHEAD_MS) return session;
  }
  const leaseId = randomUUID();
  for (let attempt = 0; attempt < 100; attempt++) {
    const reservation = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { kind: "missing" as const };
      const session = snapshot.data()!;
      if (session.isOnline) return { kind: "ready" as const, session };
      if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(session.shop) || id !== `offline_${session.shop}`) throw new Error("Invalid Shopify offline session identity");
      const expires = sessionDate(session.expires);
      if (!forceRefresh && expires && expires.getTime() > Date.now() + REFRESH_AHEAD_MS) return { kind: "ready" as const, session };
      if (Number(session.offlineTokenLeaseUntil || 0) > Date.now()) return { kind: "busy" as const };
      if (expires && (!session.refreshToken || (sessionDate(session.refreshTokenExpires)?.getTime() || 0) <= Date.now())) throw new ShopifyOfflineReauthError("Shopify offline session requires reauthorization");
      if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) throw new Error("Shopify offline token rotation is not configured");
      // Resolve encryption configuration before invalidating any existing credential.
      encryptionKey();
      transaction.update(ref, { offlineTokenLeaseId: leaseId, offlineTokenLeaseUntil: Date.now() + 60_000 });
      return { kind: "rotate" as const, session, migrate: !expires };
    });
    if (reservation.kind === "missing") return undefined;
    if (reservation.kind === "ready") return reservation.session;
    if (reservation.kind === "busy") { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
    const { session, migrate } = reservation;
    // Keep the lease after ambiguous failures; a retry must reload the canonical session.
    const response = await fetch(`https://${session.shop}/admin/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET,
        ...(migrate ? { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: decryptShopifyToken(session.accessToken),
          subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token", requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token", expiring: 1 }
          : { grant_type: "refresh_token", refresh_token: decryptShopifyToken(session.refreshToken) }) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const message = `Shopify offline token rotation failed (${response.status})`;
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new ShopifyOfflineReauthError(message);
      }
      throw new Error(message);
    }
    const result = await response.json() as Record<string, any>;
    if (typeof result.access_token !== "string" || !result.access_token || typeof result.refresh_token !== "string" || !result.refresh_token ||
      !Number.isFinite(result.expires_in) || result.expires_in <= 600 || !Number.isFinite(result.refresh_token_expires_in) || result.refresh_token_expires_in <= 0) throw new Error("Shopify offline token response is incomplete");
    const rotated = { accessToken: encryptShopifyToken(result.access_token), refreshToken: encryptShopifyToken(result.refresh_token),
      expires: new Date(Date.now() + result.expires_in * 1000), refreshTokenExpires: new Date(Date.now() + result.refresh_token_expires_in * 1000),
      ...(typeof result.scope === "string" ? { scope: result.scope } : {}), updatedAt: new Date() };
    await db.runTransaction(async transaction => {
      const current = await transaction.get(ref);
      if (!current.exists || current.get("offlineTokenLeaseId") !== leaseId || current.get("accessToken") !== session.accessToken) throw new Error("Shopify session changed during token rotation");
      transaction.update(ref, { ...rotated, offlineTokenLeaseId: null, offlineTokenLeaseUntil: 0 });
    });
    return { ...session, ...rotated };
  }
  throw new Error("Shopify offline token rotation is busy; retry later");
}
export async function loadOfflineAccessToken(db: Firestore, shop: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Error("Invalid Shopify shop");
  const session = await ensureOfflineSession(db, `offline_${shop}`);
  return decryptShopifyToken(session?.accessToken);
}
