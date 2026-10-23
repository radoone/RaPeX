import { createHash } from "node:crypto";

export const EMAIL_LEASE_MS = 90_000;
export const EMAIL_AMBIGUITY_WINDOW_MS = 25 * 60_000; // Brevo retains keys for 30 minutes.
export const EMAIL_MAX_ATTEMPTS = 8;
export const EMAIL_TERMINAL = new Set(["accepted", "delivered", "bounced", "blocked"]);

/** Brevo requires a UUID. Include the tenant: weekly IDs repeat across shops. */
export function emailIdempotencyKey(shop: string, id: string): string {
  const hex = createHash("sha256").update(JSON.stringify([shop, id])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function emailAttemptPolicy(data: { status?: string; attempts?: number; leaseUntil?: number; ambiguousSince?: number; retryable?: boolean }, now: number): "skip" | "busy" | "exhausted" | "uncertain" | "send" {
  if (EMAIL_TERMINAL.has(data.status || "") || data.retryable === false) return "skip";
  if ((data.leaseUntil || 0) > now) return "busy";
  if (["pending", "failed"].includes(data.status || "") && data.attempts === undefined) return "uncertain";
  if (data.ambiguousSince && now - data.ambiguousSince >= EMAIL_AMBIGUITY_WINDOW_MS) return "uncertain";
  if ((data.attempts || 0) >= EMAIL_MAX_ATTEMPTS) return "exhausted";
  return "send";
}

export class EmailProviderRejection extends Error {}
