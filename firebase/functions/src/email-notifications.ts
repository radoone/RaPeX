import { createHash, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import type { CloudEvent } from "firebase-functions/v2";
import type { FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore";
import type { Request } from "firebase-functions/v2/https";
import { db } from "./firebase-admin.js";
import { FIRESTORE_COLLECTIONS } from "./safety-gate-config.js";

export type EmailNotificationType = "immediate_alert" | "weekly_clear_summary";
export type EmailNotificationStatus = "pending" | "accepted" | "delivered" | "bounced" | "blocked" | "failed";

type ResponseShape = {
  status(code: number): ResponseShape;
  json(payload: unknown): void;
};

type MerchantSettings = {
  shop: string;
  emailNotifications: boolean;
  notificationEmail: string | null;
  notificationLanguage: string;
};

type AlertEmailDetails = {
  productTitle: string;
  productHandle?: string;
  riskLevel: string;
  overallSimilarity: number | null;
  safetyGateProduct: string;
  reason: string;
};

type EmailContent = {
  subject: string;
  htmlContent: string;
  textContent: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTIFICATION_SUBCOLLECTION = "email_notifications";
const WEBHOOK_INDEX_COLLECTION = "email_notification_index";
const APP_TIME_ZONE = "Europe/Bratislava";

function getMerchantRef(shop: string) {
  return db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(shop));
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return EMAIL_PATTERN.test(email) ? email : null;
}

function sanitizeSubject(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

function readMerchantSettings(shop: string, data: Record<string, unknown>): MerchantSettings {
  return {
    shop,
    emailNotifications: data.emailNotifications !== false,
    notificationEmail: normalizeEmail(data.notificationEmail),
    notificationLanguage: typeof data.notificationLanguage === "string" ? data.notificationLanguage : "en",
  };
}

function parseAlertDetails(data: Record<string, unknown>): AlertEmailDetails {
  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(String(data.checkResult || "{}")) as Record<string, unknown>;
  } catch {
    logger.warn("Could not parse alert check result for email content");
  }

  const warnings = Array.isArray(result.warnings) ? result.warnings as Array<Record<string, unknown>> : [];
  const warning = warnings[0] || {};
  const alertDetails = warning.alertDetails && typeof warning.alertDetails === "object"
    ? warning.alertDetails as Record<string, unknown>
    : {};
  const fields = alertDetails.fields && typeof alertDetails.fields === "object"
    ? alertDetails.fields as Record<string, unknown>
    : {};
  const similarity = Number(warning.overallSimilarity);

  return {
    productTitle: String(data.productTitle || "Shopify product"),
    productHandle: typeof data.productHandle === "string" ? data.productHandle : undefined,
    riskLevel: String(data.riskLevel || warning.riskLevel || fields.risk_level || fields.alert_level || "Unknown"),
    overallSimilarity: Number.isFinite(similarity) ? similarity : null,
    safetyGateProduct: String(fields.product_name || fields.product_description || fields.product_brand || "Safety Gate alert"),
    reason: String(warning.reasoning || warning.explanation || result.recommendation || "Review the product and Safety Gate record in the app."),
  };
}

function appAlertUrl(alertId: string): string {
  const baseUrl = (process.env.APP_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("APP_PUBLIC_URL is not configured");
  }
  return `${baseUrl}/app/alerts?alertId=${encodeURIComponent(alertId)}`;
}

function emailShell(title: string, body: string, actionLabel: string, actionUrl: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f3f3f3;font-family:Arial,sans-serif;color:#202223">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:12px;border:1px solid #ddd;overflow:hidden">
  <tr><td style="padding:24px"><p style="margin:0 0 8px;color:#616161;font-size:13px">SAFETY GATE MONITOR</p><h1 style="font-size:24px;margin:0 0 20px">${title}</h1>${body}
  <p style="margin:24px 0 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#008060;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">${actionLabel}</a></p>
  </td></tr></table></td></tr></table></body></html>`;
}

function buildImmediateContent(language: string, details: AlertEmailDetails, alertId: string): EmailContent {
  const slovak = language === "sk";
  const similarity = details.overallSimilarity === null ? (slovak ? "Neuvedená" : "Not available") : `${Math.round(details.overallSimilarity)}%`;
  const url = appAlertUrl(alertId);
  const title = slovak ? "Produkt vyžaduje bezpečnostnú kontrolu" : "A product needs a safety review";
  const body = `<p>${slovak ? "Našli sme možnú zhodu medzi produktom vo vašom Shopify katalógu a záznamom EÚ Safety Gate." : "We found a possible match between a product in your Shopify catalog and an EU Safety Gate record."}</p>
  <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:20px">
  <tr><td style="padding:8px 0;color:#616161">${slovak ? "Shopify produkt" : "Shopify product"}</td><td style="padding:8px 0"><strong>${escapeHtml(details.productTitle)}</strong></td></tr>
  <tr><td style="padding:8px 0;color:#616161">${slovak ? "Safety Gate zhoda" : "Safety Gate match"}</td><td style="padding:8px 0">${escapeHtml(details.safetyGateProduct)}</td></tr>
  <tr><td style="padding:8px 0;color:#616161">${slovak ? "Riziko" : "Risk"}</td><td style="padding:8px 0">${escapeHtml(details.riskLevel)}</td></tr>
  <tr><td style="padding:8px 0;color:#616161">${slovak ? "Celková zhoda" : "Overall match"}</td><td style="padding:8px 0">${similarity}</td></tr></table>
  <p><strong>${slovak ? "Prečo bola zhoda vytvorená:" : "Why this match was created:"}</strong><br>${escapeHtml(details.reason)}</p>`;
  const action = slovak ? "Skontrolovať nález" : "Review finding";

  return {
    subject: slovak ? `Safety Gate nález: ${details.productTitle}` : `Safety Gate finding: ${details.productTitle}`,
    htmlContent: emailShell(title, body, action, url),
    textContent: slovak
      ? `${title}\n\nProdukt: ${details.productTitle}\nSafety Gate zhoda: ${details.safetyGateProduct}\nRiziko: ${details.riskLevel}\nCelková zhoda: ${similarity}\nDôvod: ${details.reason}\n\n${url}`
      : `${title}\n\nProduct: ${details.productTitle}\nSafety Gate match: ${details.safetyGateProduct}\nRisk: ${details.riskLevel}\nOverall match: ${similarity}\nReason: ${details.reason}\n\n${url}`,
  };
}

function formatDate(date: Date, language: string): string {
  return new Intl.DateTimeFormat(language === "sk" ? "sk-SK" : "en-GB", {
    dateStyle: "medium",
    timeZone: APP_TIME_ZONE,
  }).format(date);
}

function buildWeeklyContent(language: string, start: Date, end: Date, metrics: {
  products: number;
  checks: number;
  safetyGateRecords: number;
}): EmailContent {
  const slovak = language === "sk";
  const appUrl = (process.env.APP_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (!appUrl) throw new Error("APP_PUBLIC_URL is not configured");
  const url = `${appUrl}/app`;
  const period = `${formatDate(start, language)} – ${formatDate(end, language)}`;
  const title = slovak ? "Týždenný monitoring: žiadne nové nálezy" : "Weekly monitoring: no new findings";
  const body = `<p>${slovak ? "Za posledných sedem dní sme vo vašom monitorovanom katalógu nevytvorili žiadny nový Safety Gate nález." : "No new Safety Gate finding was created for your monitored catalog during the last seven days."}</p>
  <p><strong>${escapeHtml(period)}</strong></p><table role="presentation" width="100%" style="border-collapse:collapse">
  <tr><td style="padding:8px 0;color:#616161">${slovak ? "Monitorované produkty" : "Monitored products"}</td><td>${metrics.products}</td></tr>
  <tr><td style="padding:8px 0;color:#616161">${slovak ? "Vykonané kontroly" : "Checks completed"}</td><td>${metrics.checks}</td></tr>
  <tr><td style="padding:8px 0;color:#616161">${slovak ? "Nové záznamy Safety Gate" : "New Safety Gate records"}</td><td>${metrics.safetyGateRecords}</td></tr>
  <tr><td style="padding:8px 0;color:#616161">${slovak ? "Nové nálezy" : "New findings"}</td><td><strong>0</strong></td></tr></table>`;

  return {
    subject: slovak ? "Safety Gate: týždeň bez nových nálezov" : "Safety Gate: a week with no new findings",
    htmlContent: emailShell(title, body, slovak ? "Otvoriť prehľad" : "Open dashboard", url),
    textContent: `${title}\n${period}\n${slovak ? "Monitorované produkty" : "Monitored products"}: ${metrics.products}\n${slovak ? "Vykonané kontroly" : "Checks completed"}: ${metrics.checks}\n${slovak ? "Nové záznamy Safety Gate" : "New Safety Gate records"}: ${metrics.safetyGateRecords}\n${slovak ? "Nové nálezy" : "New findings"}: 0\n\n${url}`,
  };
}

async function sendBrevoEmail(params: {
  shop: string;
  notificationId: string;
  to: string;
  content: EmailContent;
}): Promise<string> {
  const apiKey = (process.env.BREVO_API_KEY || "").trim();
  const senderEmail = normalizeEmail(process.env.BREVO_SENDER_EMAIL);
  const senderName = (process.env.BREVO_SENDER_NAME || "Safety Gate Monitor").trim();
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured");
  if (!senderEmail) throw new Error("BREVO_SENDER_EMAIL is not configured or invalid");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: params.to }],
      subject: sanitizeSubject(params.content.subject),
      htmlContent: params.content.htmlContent,
      textContent: params.content.textContent,
      tags: ["safety-gate"],
      headers: {
        "Idempotency-Key": params.notificationId,
        "X-Mailin-custom": `notification_id:${params.notificationId}|shop_key:${encodeURIComponent(params.shop)}`,
      },
    }),
  });
  const payload = await response.json() as { messageId?: string; message?: string };
  if (!response.ok || !payload.messageId) {
    throw new Error(`Brevo rejected email (${response.status}): ${payload.message || "unknown error"}`);
  }
  return payload.messageId.replace(/^<|>$/g, "");
}

async function createAndSendNotification(params: {
  shop: string;
  notificationId: string;
  type: EmailNotificationType;
  recipient: string;
  content: EmailContent;
  sourceAlertId?: string;
  periodStart?: Date;
  periodEnd?: Date;
}): Promise<boolean> {
  const merchantRef = getMerchantRef(params.shop);
  const notificationRef = merchantRef.collection(NOTIFICATION_SUBCOLLECTION).doc(params.notificationId);
  try {
    await notificationRef.create({
      shop: params.shop,
      type: params.type,
      status: "pending" satisfies EmailNotificationStatus,
      recipient: params.recipient,
      subject: sanitizeSubject(params.content.subject),
      sourceAlertId: params.sourceAlertId || null,
      periodStart: params.periodStart ? Timestamp.fromDate(params.periodStart) : null,
      periodEnd: params.periodEnd ? Timestamp.fromDate(params.periodEnd) : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 6 || code === "already-exists") {
      logger.info("Skipping duplicate email notification", { shop: params.shop, notificationId: params.notificationId });
      return false;
    }
    throw error;
  }

  try {
    const messageId = await sendBrevoEmail({
      shop: params.shop,
      notificationId: params.notificationId,
      to: params.recipient,
      content: params.content,
    });
    await Promise.all([
      db.runTransaction(async (transaction) => {
        const current = await transaction.get(notificationRef);
        const currentStatus = current.get("status") as EmailNotificationStatus | undefined;
        const terminalStatus = currentStatus === "delivered" || currentStatus === "bounced" || currentStatus === "blocked";
        transaction.set(notificationRef, {
          ...(terminalStatus ? {} : { status: "accepted" satisfies EmailNotificationStatus }),
          providerMessageId: messageId,
          acceptedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }),
      db.collection(WEBHOOK_INDEX_COLLECTION).doc(createHash("sha256").update(messageId).digest("hex")).set({
        shop: params.shop,
        notificationId: params.notificationId,
        createdAt: FieldValue.serverTimestamp(),
      }),
    ]);
    return true;
  } catch (error) {
    await notificationRef.set({
      status: "failed" satisfies EmailNotificationStatus,
      error: error instanceof Error ? error.message : String(error),
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    logger.error("Email notification failed", { shop: params.shop, notificationId: params.notificationId, error });
    return false;
  }
}

export async function handleImmediateAlertCreated(
  event: FirestoreEvent<QueryDocumentSnapshot | undefined, { shopId: string; alertId: string }>,
): Promise<void> {
  const snapshot = event.data;
  if (!snapshot) return;
  const data = snapshot.data() as Record<string, unknown>;
  const shop = typeof data.shop === "string" ? data.shop : decodeURIComponent(event.params.shopId);
  const merchantSnapshot = await getMerchantRef(shop).get();
  const settings = readMerchantSettings(shop, (merchantSnapshot.data() || {}) as Record<string, unknown>);
  if (!settings.emailNotifications || !settings.notificationEmail) {
    logger.info("Immediate email skipped by merchant settings", { shop, hasRecipient: Boolean(settings.notificationEmail) });
    return;
  }

  let content: EmailContent;
  try {
    content = buildImmediateContent(settings.notificationLanguage, parseAlertDetails(data), event.params.alertId);
  } catch (error) {
    logger.error("Immediate email content could not be created", { shop, alertId: event.params.alertId, error });
    return;
  }
  await createAndSendNotification({
    shop,
    notificationId: `immediate_alert__${event.params.alertId}`,
    type: "immediate_alert",
    recipient: settings.notificationEmail,
    content,
    sourceAlertId: event.params.alertId,
  });
}

function zonedParts(date: Date): Record<string, number> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

function zonedDateTimeToUtc(parts: Record<string, number>): Date {
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let candidate = new Date(wallClockAsUtc);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const candidateParts = zonedParts(candidate);
    const candidateWallClock = Date.UTC(
      candidateParts.year,
      candidateParts.month - 1,
      candidateParts.day,
      candidateParts.hour,
      candidateParts.minute,
      candidateParts.second,
    );
    candidate = new Date(candidate.getTime() + wallClockAsUtc - candidateWallClock);
  }
  return candidate;
}

export function weeklyWindow(end: Date): { start: Date; end: Date } {
  const endParts = zonedParts(end);
  const previousDate = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day - 7));
  const start = zonedDateTimeToUtc({
    year: previousDate.getUTCFullYear(),
    month: previousDate.getUTCMonth() + 1,
    day: previousDate.getUTCDate(),
    hour: endParts.hour,
    minute: endParts.minute,
    second: endParts.second,
  });
  return { start, end };
}

function weekKey(end: Date): string {
  const parts = zonedParts(end);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export async function runWeeklyClearSummaries(end = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const { start } = weeklyWindow(end);
  const merchants = await db.collection(FIRESTORE_COLLECTIONS.merchants).get();
  const safetyGateRecords = (await db.collection(FIRESTORE_COLLECTIONS.alerts)
    .where("meta.alert_date", ">=", Timestamp.fromDate(start))
    .where("meta.alert_date", "<", Timestamp.fromDate(end))
    .count().get()).data().count;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const merchant of merchants.docs) {
    const data = merchant.data() as Record<string, unknown>;
    const shop = typeof data.shop === "string" ? data.shop : decodeURIComponent(merchant.id);
    const settings = readMerchantSettings(shop, data);
    if (!settings.emailNotifications || !settings.notificationEmail) {
      skipped += 1;
      continue;
    }
    const alerts = merchant.ref.collection(FIRESTORE_COLLECTIONS.subAlerts)
      .where("createdAt", ">=", Timestamp.fromDate(start))
      .where("createdAt", "<", Timestamp.fromDate(end))
      .limit(1).get();
    const [alertSnapshot, productsCount, checksCount] = await Promise.all([
      alerts,
      merchant.ref.collection(FIRESTORE_COLLECTIONS.subProducts).count().get(),
      merchant.ref.collection(FIRESTORE_COLLECTIONS.subChecks)
        .where("createdAt", ">=", Timestamp.fromDate(start))
        .where("createdAt", "<", Timestamp.fromDate(end))
        .count().get(),
    ]);
    if (!alertSnapshot.empty) {
      skipped += 1;
      continue;
    }
    try {
      const content = buildWeeklyContent(settings.notificationLanguage, start, end, {
        products: productsCount.data().count,
        checks: checksCount.data().count,
        safetyGateRecords,
      });
      const accepted = await createAndSendNotification({
        shop,
        notificationId: `weekly_clear_summary__${weekKey(end)}`,
        type: "weekly_clear_summary",
        recipient: settings.notificationEmail,
        content,
        periodStart: start,
        periodEnd: end,
      });
      if (accepted) {
        sent += 1;
        await merchant.ref.set({
          lastWeeklySummaryAt: Timestamp.fromDate(end),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else skipped += 1;
    } catch (error) {
      failed += 1;
      logger.error("Weekly clear summary failed", { shop, error });
    }
  }
  return { sent, skipped, failed };
}

function secureEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function webhookStatus(eventName: string): EmailNotificationStatus | null {
  const normalized = eventName.toLowerCase();
  if (normalized === "delivered") return "delivered";
  if (["hard_bounce", "hardbounce", "soft_bounce", "softbounce", "invalid", "error"].includes(normalized)) return "bounced";
  if (["blocked", "spam", "unsubscribed"].includes(normalized)) return "blocked";
  return null;
}

export async function handleBrevoWebhook(request: Request, response: ResponseShape): Promise<void> {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }
  const expectedSecret = (process.env.BREVO_WEBHOOK_SECRET || "").trim();
  const authHeader = String(request.headers.authorization || "");
  const providedSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!expectedSecret || !providedSecret || !secureEquals(providedSecret, expectedSecret)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = (request.body || {}) as Record<string, unknown>;
  const status = webhookStatus(String(body.event || ""));
  const messageId = String(body["message-id"] || body.messageId || "").replace(/^<|>$/g, "");
  if (!status || !messageId) {
    response.status(202).json({ ignored: true });
    return;
  }
  const indexSnapshot = await db.collection(WEBHOOK_INDEX_COLLECTION)
    .doc(createHash("sha256").update(messageId).digest("hex")).get();
  let index = indexSnapshot.data() as { shop: string; notificationId: string } | undefined;
  if (!index) {
    const customHeader = String(body["X-Mailin-custom"] || body["x-mailin-custom"] || "");
    const values = Object.fromEntries(customHeader.split("|").map((entry) => {
      const separator = entry.indexOf(":");
      return separator > 0 ? [entry.slice(0, separator), entry.slice(separator + 1)] : [entry, ""];
    }));
    if (values.notification_id && values.shop_key) {
      index = {
        shop: decodeURIComponent(values.shop_key),
        notificationId: values.notification_id,
      };
    }
  }
  if (!index) {
    logger.warn("Brevo webhook did not match a notification", { messageId, event: body.event });
    response.status(202).json({ ignored: true });
    return;
  }
  const notificationRef = getMerchantRef(index.shop).collection(NOTIFICATION_SUBCOLLECTION).doc(index.notificationId);
  const notificationSnapshot = await notificationRef.get();
  if (!notificationSnapshot.exists) {
    logger.warn("Brevo webhook referenced an unknown notification", { notificationId: index.notificationId });
    response.status(202).json({ ignored: true });
    return;
  }
  await notificationRef.set({
    status,
    providerEvent: String(body.event || ""),
    providerEventAt: typeof body.ts_event === "number" ? Timestamp.fromMillis(body.ts_event * 1000) : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  if (status === "delivered") {
    const activityRef = getMerchantRef(index.shop)
      .collection(FIRESTORE_COLLECTIONS.subActivityLogs)
      .doc(`email_delivery__${index.notificationId}`);
    try {
      await activityRef.create({
        shop: index.shop,
        type: "automatic",
        action: "check",
        details: `Safety Gate email delivered (${index.notificationId}).`,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      const code = (error as { code?: number | string }).code;
      if (code !== 6 && code !== "already-exists") throw error;
    }
  }
  response.status(200).json({ success: true });
}

export type WeeklySchedulerEvent = CloudEvent<{ scheduleTime?: string }>;

export const emailNotificationTestUtils = {
  escapeHtml,
  normalizeEmail,
  buildImmediateContent,
  webhookStatus,
};
