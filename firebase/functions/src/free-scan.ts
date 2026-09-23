import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import * as logger from "firebase-functions/logger";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase-admin.js";
import { handleScanPublicShopifyStoreRequest } from "./public-store-scanner.js";

type FreeScanRequest = {
  domain: string;
  email: string;
  locale: "en" | "sk";
  status: "awaiting_verification" | "queued" | "running" | "completed" | "failed";
  createdAt: Timestamp;
  verificationHash?: string;
  verificationExpiresAt?: Timestamp;
};

type ScanResult = {
  success?: boolean;
  error?: string;
  lead?: {
    totalProductsScanned: number;
    flaggedProductsCount: number;
    matches?: Array<{
      productTitle?: string;
      productUrl?: string;
      result?: { warnings?: Array<{ alertId?: string; overallSimilarity?: number }> };
    }>;
  };
};

type HttpRequest = {
  method: string;
  body?: Record<string, unknown>;
  query: Record<string, unknown>;
  ip?: string;
};

type HttpResponse = {
  set(name: string, value: string): void;
  status(code: number): HttpResponse;
  json(payload: unknown): void;
  send(payload: string): void;
};

const REQUESTS = "free_scan_requests";
const LIMITS = "free_scan_limits";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const VERIFY_MS = 30 * 60 * 1000;
const MAX_PRODUCTS = 100;
const DAILY_REQUEST_LIMIT = 50;
const DAILY_SCAN_LIMIT = 20;
const TEST_TURNSTILE_SECRET = "1x0000000000000000000000000000000AA";
const MARKETING_SITE_URL = (process.env.MARKETING_SITE_URL || "https://rapex-99a2c.web.app").replace(/\/$/, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizedDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  // The scanner fetches this host server-side. Keep it on Shopify's public domain.
  return /^[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com$/.test(domain) ? domain : null;
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseConfirmationToken(value: unknown): { requestId: string; secret: string } | null {
  if (typeof value !== "string" || value.length > 120) return null;
  const match = /^([A-Za-z0-9]{20})\.([A-Za-z0-9_-]{43})$/.exec(value);
  return match ? { requestId: match[1], secret: match[2] } : null;
}

function tokenMatches(secret: string, storedHash: unknown): boolean {
  if (typeof storedHash !== "string" || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(hash(secret), "hex"), Buffer.from(storedHash, "hex"));
}

async function verifyTurnstile(token: unknown, ip: string | undefined): Promise<boolean> {
  const secret = (process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  if (secret === TEST_TURNSTILE_SECRET && process.env.FUNCTIONS_EMULATOR !== "true") return false;
  const payload = new URLSearchParams({ secret, response: token });
  if (ip) payload.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
    signal: globalThis.AbortSignal.timeout(8000),
  });
  if (!response.ok) return false;
  const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
  const expectedHost = new URL(MARKETING_SITE_URL).hostname;
  const testKey = secret === TEST_TURNSTILE_SECRET;
  const hostnameValid = result.hostname === expectedHost || (testKey && ["localhost", "127.0.0.1"].includes(result.hostname || ""));
  return result.success === true && hostnameValid && result.action === "free_scan";
}

async function preflightStore(domain: string): Promise<boolean> {
  try {
    const response = await fetch(`https://${domain}/products.json?limit=1`, {
      headers: { Accept: "application/json" },
      signal: globalThis.AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("json")) return false;
    const result = await response.json() as { products?: unknown };
    return Array.isArray(result.products) && result.products.length > 0 &&
      typeof (result.products[0] as { id?: unknown }).id === "number";
  } catch {
    return false;
  }
}

function publicStatus(data: Record<string, unknown>): Record<string, unknown> {
  return {
    status: data.status,
    checkedProducts: data.checkedProducts ?? null,
    possibleMatches: data.possibleMatches ?? null,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : null,
  };
}

export async function handleFreeScanRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
  response.set("Cache-Control", "no-store");

  if (request.method === "GET") {
    const id = typeof request.query.id === "string" ? request.query.id : "";
    if (!/^[A-Za-z0-9]{20}$/.test(id)) {
      response.status(400).json({ error: "Invalid request ID." });
      return;
    }
    const snapshot = await db.collection(REQUESTS).doc(id).get();
    if (!snapshot.exists) {
      response.status(404).json({ error: "Request not found." });
      return;
    }
    response.status(200).json(publicStatus(snapshot.data() || {}));
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const confirmation = parseConfirmationToken(request.body?.confirmationToken);
  if (confirmation) {
    await confirmFreeScan(confirmation, response);
    return;
  }

  const domain = normalizedDomain(request.body?.domain);
  const email = normalizedEmail(request.body?.email);
  const locale = request.body?.locale === "sk" ? "sk" : "en";
  if (!domain || !email) {
    response.status(400).json({ error: "Enter a valid myshopify.com domain and email address." });
    return;
  }

  let challengePassed = false;
  try {
    challengePassed = await verifyTurnstile(request.body?.turnstileToken, request.ip);
  } catch (error) {
    logger.warn("Free scan challenge could not be verified", error);
  }
  if (!challengePassed) {
    response.status(403).json({ error: "Human verification failed. Please try again." });
    return;
  }

  const ipKey = hash(request.ip || "unknown");
  const domainLimitRef = db.collection(LIMITS).doc(`domain_${hash(domain)}`);
  const ipLimitRef = db.collection(LIMITS).doc(`ip_${ipKey}`);
  const emailLimitRef = db.collection(LIMITS).doc(`email_${hash(email)}`);
  const dayKey = new Date().toISOString().slice(0, 10);
  const requestBudgetRef = db.collection(LIMITS).doc(`requests_${dayKey}`);
  const requestRef = db.collection(REQUESTS).doc();
  const now = Timestamp.now();
  const verificationSecret = randomBytes(32).toString("base64url");
  try {
    await db.runTransaction(async (transaction) => {
      const [domainLimit, ipLimit, emailLimit, requestBudget] = await Promise.all([
        transaction.get(domainLimitRef),
        transaction.get(ipLimitRef),
        transaction.get(emailLimitRef),
        transaction.get(requestBudgetRef),
      ]);
      const domainLast = domainLimit.get("lastAt") as Timestamp | undefined;
      const ipLast = ipLimit.get("lastAt") as Timestamp | undefined;
      const emailLast = emailLimit.get("lastAt") as Timestamp | undefined;
      if (
        (domainLast && now.toMillis() - domainLast.toMillis() < DAY_MS) ||
        (ipLast && now.toMillis() - ipLast.toMillis() < HOUR_MS) ||
        (emailLast && now.toMillis() - emailLast.toMillis() < DAY_MS) ||
        Number(requestBudget.get("count") || 0) >= DAILY_REQUEST_LIMIT
      ) {
        throw new Error("RATE_LIMITED");
      }
      transaction.set(domainLimitRef, { lastAt: now, expireAt: Timestamp.fromMillis(now.toMillis() + 2 * DAY_MS) });
      transaction.set(ipLimitRef, { lastAt: now, expireAt: Timestamp.fromMillis(now.toMillis() + 2 * DAY_MS) });
      transaction.set(emailLimitRef, { lastAt: now, expireAt: Timestamp.fromMillis(now.toMillis() + 2 * DAY_MS) });
      transaction.set(requestBudgetRef, { count: Number(requestBudget.get("count") || 0) + 1, expireAt: Timestamp.fromMillis(now.toMillis() + 2 * DAY_MS) });
      transaction.create(requestRef, {
        domain,
        email,
        locale,
        status: "awaiting_verification",
        verificationHash: hash(verificationSecret),
        verificationExpiresAt: Timestamp.fromMillis(now.toMillis() + VERIFY_MS),
        createdAt: now,
        updatedAt: now,
        expireAt: Timestamp.fromMillis(now.toMillis() + 30 * DAY_MS),
      } satisfies FreeScanRequest & { updatedAt: Timestamp; expireAt: Timestamp });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      response.status(429).json({ error: "A scan was requested recently. Please try again later." });
      return;
    }
    logger.error("Could not queue free scan", error);
    response.status(503).json({ error: "Could not start the scan. Please try again later." });
    return;
  }

  try {
    await sendVerificationEmail(requestRef.id, verificationSecret, { domain, email, locale });
  } catch (error) {
    logger.error("Could not send free scan verification email", { requestId: requestRef.id, error });
    await requestRef.update({ status: "failed", updatedAt: FieldValue.serverTimestamp() });
    response.status(503).json({ error: "Could not send the verification email. Please try later." });
    return;
  }

  response.status(202).json({ id: requestRef.id, status: "awaiting_verification" });
}

async function confirmFreeScan(
  confirmation: { requestId: string; secret: string },
  response: HttpResponse,
): Promise<void> {
  const requestRef = db.collection(REQUESTS).doc(confirmation.requestId);
  const snapshot = await requestRef.get();
  const data = snapshot.data() as FreeScanRequest | undefined;
  if (!data || data.status !== "awaiting_verification" ||
    !tokenMatches(confirmation.secret, data.verificationHash) ||
    !(data.verificationExpiresAt instanceof Timestamp) ||
    data.verificationExpiresAt.toMillis() <= Date.now()) {
    response.status(400).json({ error: "Verification link is invalid or expired." });
    return;
  }

  if (!await preflightStore(data.domain)) {
    response.status(422).json({ error: "This store has no accessible public Shopify catalog." });
    return;
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const scanBudgetRef = db.collection(LIMITS).doc(`scans_${dayKey}`);
  try {
    await db.runTransaction(async (transaction) => {
      const [current, budget] = await Promise.all([transaction.get(requestRef), transaction.get(scanBudgetRef)]);
      const currentData = current.data() as FreeScanRequest | undefined;
      if (!currentData || currentData.status !== "awaiting_verification" ||
        !tokenMatches(confirmation.secret, currentData.verificationHash) ||
        !(currentData.verificationExpiresAt instanceof Timestamp) ||
        currentData.verificationExpiresAt.toMillis() <= Date.now()) throw new Error("INVALID_CONFIRMATION");
      if (Number(budget.get("count") || 0) >= DAILY_SCAN_LIMIT) throw new Error("DAILY_LIMIT");
      transaction.set(scanBudgetRef, {
        count: Number(budget.get("count") || 0) + 1,
        expireAt: Timestamp.fromMillis(Date.now() + 2 * DAY_MS),
      });
      transaction.update(requestRef, {
        status: "queued",
        verificationHash: FieldValue.delete(),
        verificationExpiresAt: FieldValue.delete(),
        verifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    const limited = error instanceof Error && error.message === "DAILY_LIMIT";
    response.status(limited ? 429 : 400).json({ error: limited ? "Today's scan capacity is full." : "Verification link is invalid or expired." });
    return;
  }
  response.status(202).json({ id: confirmation.requestId, status: "queued" });
}

async function runProtectedScanner(domain: string): Promise<ScanResult> {
  let statusCode = 200;
  let payload: ScanResult = {};
  await handleScanPublicShopifyStoreRequest(
    {
      method: "POST",
      body: { domain, maxProducts: MAX_PRODUCTS, similarityThreshold: 80 },
      headers: { "x-api-key": process.env.SAFETY_GATE_API_KEY || "" },
      query: {},
    },
    {
      set: () => undefined,
      status(code: number) { statusCode = code; return this; },
      json(value: unknown) { payload = value as ScanResult; },
      send: () => undefined,
    },
  );
  if (statusCode !== 200 || !payload.success || !payload.lead) {
    throw new Error(`Scanner failed (${statusCode}): ${payload.error || "unknown error"}`);
  }
  return payload;
}

async function sendVerificationEmail(
  requestId: string,
  secret: string,
  data: { domain: string; email: string; locale: "en" | "sk" },
): Promise<void> {
  const apiKey = (process.env.BREVO_API_KEY || "").trim();
  const senderEmail = (process.env.BREVO_SENDER_EMAIL || "").trim();
  if (!apiKey || !senderEmail) throw new Error("Brevo sender is not configured");
  const slovak = data.locale === "sk";
  const url = `${MARKETING_SITE_URL}/index.html?lang=${data.locale}#verify=${requestId}.${secret}`;
  const content = slovak
    ? `Požiadali ste o bezplatný sken verejného katalógu ${data.domain}.\n\nPotvrďte svoju e-mailovú adresu a spustite sken na tejto stránke:\n${url}\n\nOdkaz platí 30 minút. Ak ste o sken nežiadali, tento e-mail ignorujte.`
    : `You requested a free public-catalog scan for ${data.domain}.\n\nConfirm your email address and start the scan on this page:\n${url}\n\nThis link expires in 30 minutes. If you did not request a scan, ignore this email.`;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Safety Gate Monitor", email: senderEmail },
      to: [{ email: data.email }],
      subject: slovak ? `Potvrďte sken obchodu ${data.domain}` : `Confirm the scan for ${data.domain}`,
      textContent: content,
      tags: ["free-scan-verification"],
    }),
  });
  if (!response.ok) throw new Error(`Brevo rejected verification email (${response.status})`);
  const delivery = await response.json() as { messageId?: unknown };
  if (typeof delivery.messageId !== "string" || !delivery.messageId) {
    throw new Error("Brevo did not confirm verification email acceptance");
  }
}

async function sendReport(requestId: string, data: FreeScanRequest, result: ScanResult): Promise<void> {
  const apiKey = (process.env.BREVO_API_KEY || "").trim();
  const senderEmail = (process.env.BREVO_SENDER_EMAIL || "").trim();
  if (!apiKey || !senderEmail) throw new Error("Brevo sender is not configured");
  const lead = result.lead!;
  const slovak = data.locale === "sk";
  const lines = slovak
    ? [
      `Bezplatný prehľad verejného katalógu: ${data.domain}`,
      `Preverených produktov: ${lead.totalProductsScanned} (limit ${MAX_PRODUCTS})`,
      `Možných zhôd na kontrolu: ${lead.flaggedProductsCount}`,
      "",
      "Výsledky sú orientačné. Možnú zhodu overte podľa modelu, fotografie, šarže a oficiálneho záznamu Safety Gate. Nulový počet zhôd nie je potvrdením bezpečnosti celého katalógu.",
    ]
    : [
      `Free public catalog scan: ${data.domain}`,
      `Products checked: ${lead.totalProductsScanned} (limit ${MAX_PRODUCTS})`,
      `Potential matches to review: ${lead.flaggedProductsCount}`,
      "",
      "These are indicative results. Check any potential match against the model, photo, batch and official Safety Gate record. Zero matches does not certify the safety of your entire catalog.",
    ];
  if (lead.matches?.length) {
    lines.push("", slovak ? "Možné zhody:" : "Potential matches:");
    for (const match of lead.matches.slice(0, 5)) {
      lines.push(`- ${match.productTitle || "Product"}`);
      if (match.productUrl?.startsWith(`https://${data.domain}/`)) lines.push(`  ${match.productUrl}`);
      const alertId = match.result?.warnings?.[0]?.alertId;
      if (alertId) lines.push(`  Safety Gate record: ${alertId}`);
    }
  }
  lines.push("", "https://ec.europa.eu/safety-gate-alerts/");
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Safety Gate Monitor", email: senderEmail },
      to: [{ email: data.email }],
      subject: slovak ? `Výsledok kontroly katalógu: ${data.domain}` : `Catalog scan result: ${data.domain}`,
      textContent: lines.join("\n"),
      tags: ["free-scan"],
      headers: { "Idempotency-Key": `free-scan-${requestId}` },
    }),
  });
  if (!response.ok) throw new Error(`Brevo rejected report (${response.status})`);
  const delivery = await response.json() as { messageId?: unknown };
  if (typeof delivery.messageId !== "string" || !delivery.messageId) {
    throw new Error("Brevo did not confirm report acceptance");
  }
}

export async function processFreeScanRequest(requestId: string): Promise<void> {
  const requestRef = db.collection(REQUESTS).doc(requestId);
  let data: FreeScanRequest | undefined;
  const claimed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists || snapshot.get("status") !== "queued") return false;
    data = snapshot.data() as FreeScanRequest;
    transaction.update(requestRef, { status: "running", updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed || !data) return;
  try {
    const result = await runProtectedScanner(data.domain);
    const checkedProducts = result.lead!.totalProductsScanned;
    if (checkedProducts === 0) throw new Error("The public catalog returned no products");
    await sendReport(requestId, data, result);
    await requestRef.update({
      status: "completed",
      checkedProducts,
      possibleMatches: result.lead!.flaggedProductsCount,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    logger.error("Free scan failed", { requestId, domain: data.domain, error });
    await requestRef.update({ status: "failed", updatedAt: FieldValue.serverTimestamp() });
  }
}

export const freeScanTestUtils = {
  normalizedDomain,
  normalizedEmail,
  parseConfirmationToken,
  tokenMatches,
  verifyTurnstile,
  preflightStore,
  publicStatus,
};
