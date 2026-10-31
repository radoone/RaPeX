import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { URL } from "node:url";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import type { CloudEvent } from "firebase-functions/v2";
import type { FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore";
import type { Request } from "firebase-functions/v2/https";
import { db } from "./firebase-admin.js";
import { mapBounded } from "./matching-work.js";
import { emailAttemptPolicy, emailIdempotencyKey, EMAIL_LEASE_MS, EMAIL_TERMINAL, EmailProviderRejection } from "./email-delivery.js";
import { FIRESTORE_COLLECTIONS } from "./safety-gate-config.js";
import { escapeEmailHtml as escapeHtml, renderAlertEmail, renderWeeklyEmail } from "./email-templates.js";
import type { AlertEmailDetails, EmailContent, WeeklyEmailMetrics, WeeklyEmailFinding } from "./email-templates.js";

export type EmailNotificationType = "immediate_alert" | "weekly_summary";
export type EmailNotificationStatus = "pending" | "accepted" | "delivered" | "bounced" | "blocked" | "failed";

type ResponseShape = {
  status(code: number): ResponseShape;
  json(payload: unknown): void;
};

type MerchantSettings = {
  shop: string;
  emailNotifications: boolean;
  immediateAlertEmails?: boolean;
  weeklySummaryEmails?: boolean;
  notificationEmail: string | null;
  notificationLanguage: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTIFICATION_SUBCOLLECTION = "email_notifications";
const WEBHOOK_INDEX_COLLECTION = "email_notification_index";
const WEBHOOK_INDEX_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const APP_TIME_ZONE = "Europe/Bratislava";

function getMerchantRef(shop: string) {
  return db.collection(FIRESTORE_COLLECTIONS.merchants).doc(encodeURIComponent(shop));
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
    immediateAlertEmails: typeof data.immediateAlertEmails === "boolean" ? data.immediateAlertEmails : data.emailNotifications !== false,
    weeklySummaryEmails: typeof data.weeklySummaryEmails === "boolean" ? data.weeklySummaryEmails : data.emailNotifications !== false,
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
  const similarity = typeof warning.overallSimilarity === "number" ? warning.overallSimilarity : NaN;

  return {
    productTitle: String(data.productTitle || "Shopify product"),
    productHandle: typeof data.productHandle === "string" ? data.productHandle : undefined,
    riskLevel: String(data.riskLevel || warning.riskLevel || fields.level || fields.risk_level || fields.alert_level || "Unknown"),
    overallSimilarity: Number.isFinite(similarity) ? similarity : null,
    safetyGateProduct: String(fields.name || fields.product || fields.product_name || fields.product_description || fields.product_brand || "Safety Gate alert"),
    safetyGateImage: Array.isArray(fields.pictures) && typeof fields.pictures[0] === "string" ? fields.pictures[0] : typeof fields.product_image === "string" ? fields.product_image : undefined,
    alertReference: typeof fields.caseNumber === "string" ? fields.caseNumber : typeof fields.alert_number === "string" ? fields.alert_number : undefined,
    model: typeof fields.type_numberOfModel === "string" ? fields.type_numberOfModel : typeof fields.product_model === "string" ? fields.product_model : undefined,
    riskType: typeof fields.riskType === "string" ? fields.riskType : undefined,
    reason: String(warning.reason || warning.reasoning || warning.explanation || result.recommendation || "Review the product and Safety Gate record in the app."),
  };
}

function shopifyAdminAppUrl(shop: string, path: string, query?: Record<string, string>): string {
  const handle = (process.env.SHOPIFY_APP_HANDLE || "").trim();
  if (!handle) throw new Error("SHOPIFY_APP_HANDLE is not configured");
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  const url = new URL(`https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/apps/${encodeURIComponent(handle)}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  return url.toString();
}

function buildImmediateContent(language: string, details: AlertEmailDetails, alertId: string, shop: string): EmailContent {
  return renderAlertEmail(language, details, shop,
    shopifyAdminAppUrl(shop, "app/alerts", { open: alertId }), shopifyAdminAppUrl(shop, "app/settings"));
}

function buildWeeklyContent(language: string, shop: string, start: Date, end: Date, metrics: WeeklyEmailMetrics): EmailContent {
  return renderWeeklyEmail(language, shop, start, end, metrics,
    shopifyAdminAppUrl(shop, "app"), shopifyAdminAppUrl(shop, "app/settings"));
}

function buildWeeklyFindings(shop: string, recent: Array<{ id: string; data: Record<string, unknown> }>, open: Array<{ id: string; data: Record<string, unknown> }>): WeeklyEmailFinding[] {
  const selected = new Map<string, WeeklyEmailFinding>();
  for (const [records, isNew] of [[recent, true], [open, false]] as const) {
    for (const record of records) {
      if (selected.has(record.id)) continue;
      const { data } = record;
      const reviewState = data.status === "resolved" || data.status === "dismissed" ? data.status
        : data.status !== "active" ? "unknown"
          : data.reviewState === "waiting_for_supplier" || data.reviewState === "contacted_supplier" ? "waiting_for_supplier" : "needs_review";
      selected.set(record.id, {
        ...parseAlertDetails(data),
        url: shopifyAdminAppUrl(shop, "app/alerts", { open: record.id }),
        reviewState,
        isNew,
      });
      if (selected.size === 5) return [...selected.values()];
    }
  }
  return [...selected.values()];
}

async function sendBrevoEmail(params: {
  shop: string;
  notificationId: string;
  to: string;
  content: EmailContent;
}): Promise<string | null> {
  const apiKey = (process.env.BREVO_API_KEY || "").trim();
  const senderEmail = normalizeEmail(process.env.BREVO_SENDER_EMAIL);
  const senderName = (process.env.BREVO_SENDER_NAME || "ZeroRecall").trim();
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured");
  if (!senderEmail) throw new Error("BREVO_SENDER_EMAIL is not configured or invalid");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: params.to }],
      replyTo: { email: senderEmail, name: senderName },
      subject: sanitizeSubject(params.content.subject),
      htmlContent: params.content.htmlContent,
      textContent: params.content.textContent,
      tags: ["safety-gate"],
      headers: {
        idempotencyKey: emailIdempotencyKey(params.shop, params.notificationId),
        "X-Mailin-custom": `notification_id:${params.notificationId}|shop_key:${encodeURIComponent(params.shop)}`,
      },
    }),
    signal: globalThis.AbortSignal.timeout(20_000),
  });
  const payload = await response.json() as { messageId?: string; message?: string; code?: string };
  if (!response.ok && payload.code === "duplicate_parameter" && /idempotenc/i.test(payload.message || "")) return null;
  if (!response.ok) throw new EmailProviderRejection(`Brevo rejected email (${response.status})`);
  if (!payload.messageId) throw new Error("Brevo acceptance was not confirmed");
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
  const leaseId = randomUUID();
  const millis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : undefined;
  const claimed = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(notificationRef);
    const existing = snapshot.data() || {};
    const policy = emailAttemptPolicy({ ...existing, leaseUntil: millis(existing.leaseUntil), ambiguousSince: millis(existing.ambiguousSince) }, Date.now());
    if (policy === "skip") return null;
    if (policy === "busy") throw new Error("Email submission is already in progress");
    if (policy !== "send") {
      transaction.set(notificationRef, { status: "failed", retryable: false, failureCode: policy, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      logger.error("Email requires operator review", { shop: params.shop, notificationId: params.notificationId, reason: policy });
      return null;
    }
    // Freeze recipient and content for every retry of this logical notification.
    const recipient = existing.recipient || params.recipient;
    const content = existing.content || { ...params.content, subject: sanitizeSubject(params.content.subject) };
    transaction.set(notificationRef, {
      shop: params.shop, type: params.type, recipient, content, subject: content.subject,
      sourceAlertId: params.sourceAlertId || null,
      periodStart: params.periodStart ? Timestamp.fromDate(params.periodStart) : null,
      periodEnd: params.periodEnd ? Timestamp.fromDate(params.periodEnd) : null,
      createdAt: existing.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      status: "pending", retryable: true, attempts: Number(existing.attempts || 0) + 1,
      leaseId, leaseUntil: Timestamp.fromMillis(Date.now() + EMAIL_LEASE_MS),
      ambiguousSince: existing.ambiguousSince || Timestamp.now(),
    }, { merge: true });
    return { recipient: String(recipient), content: content as EmailContent, hadAmbiguity: existing.ambiguousSince instanceof Timestamp };
  });
  if (!claimed) return false;
  try {
    const messageId = await sendBrevoEmail({ shop: params.shop, notificationId: params.notificationId, to: claimed.recipient, content: claimed.content });
    // Persist the provider index first with a 90-day TTL so webhook lookup documents do not linger forever.
    if (messageId) {
      await db.collection(WEBHOOK_INDEX_COLLECTION).doc(createHash("sha256").update(messageId).digest("hex")).set({
        shop: params.shop,
        notificationId: params.notificationId,
        createdAt: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + WEBHOOK_INDEX_TTL_MS),
      });
    }
    await db.runTransaction(async transaction => {
      const current = await transaction.get(notificationRef);
      if (current.get("leaseId") !== leaseId) return;
      transaction.set(notificationRef, {
        ...(EMAIL_TERMINAL.has(current.get("status")) ? {} : { status: "accepted" }),
        ...(messageId ? { providerMessageId: messageId } : { duplicateAccepted: true }),
        acceptedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        leaseUntil: FieldValue.delete(), ambiguousSince: FieldValue.delete(), retryable: false,
      }, { merge: true });
    });
    return true;
  } catch (error) {
    await db.runTransaction(async transaction => {
      const current = await transaction.get(notificationRef);
      if (current.get("leaseId") !== leaseId || EMAIL_TERMINAL.has(current.get("status"))) return;
      transaction.set(notificationRef, {
        status: "failed", failedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        failureCode: error instanceof EmailProviderRejection ? "provider_rejected" : "acceptance_unknown",
        leaseUntil: FieldValue.delete(),
        ...(error instanceof EmailProviderRejection && !claimed.hadAmbiguity ? { ambiguousSince: FieldValue.delete() } : {}),
      }, { merge: true });
    });
    // Both the immediate event and weekly scheduler must retry a failed submission.
    throw error;
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
  const merchantData = (merchantSnapshot.data() || {}) as Record<string, unknown>;
  const settings = readMerchantSettings(shop, merchantData);
  if (!hasCurrentMonitoringEntitlement(merchantData)) {
    logger.info("Immediate email skipped without a current monitoring entitlement", { shop, alertId: event.params.alertId });
    return;
  }
  if (!settings.immediateAlertEmails || !settings.notificationEmail) {
    logger.info("Immediate email skipped by merchant settings", { shop, hasRecipient: Boolean(settings.notificationEmail) });
    return;
  }

  let content: EmailContent;
  try {
    content = buildImmediateContent(settings.notificationLanguage, parseAlertDetails(data), event.params.alertId, shop);
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

  await mapBounded(merchants.docs, 6, async (merchant) => {
    const data = merchant.data() as Record<string, unknown>;
    const shop = typeof data.shop === "string" ? data.shop : decodeURIComponent(merchant.id);
    const settings = readMerchantSettings(shop, data);
    if (!hasCurrentMonitoringEntitlement(data) || !settings.weeklySummaryEmails || !settings.notificationEmail) {
      skipped += 1;
      return;
    }
    const newFindings = merchant.ref.collection(FIRESTORE_COLLECTIONS.subAlerts)
      .where("createdAt", ">=", Timestamp.fromDate(start))
      .where("createdAt", "<", Timestamp.fromDate(end))
      .count().get();
    const openFindings = merchant.ref.collection(FIRESTORE_COLLECTIONS.subAlerts)
      .where("status", "==", "active")
      .count().get();
    const monitorState = data as Record<string, unknown>;
    const lastMonitorRunEndValue = monitorState.lastMonitorRunEnd;
    const lastSuccessfulRun = lastMonitorRunEndValue instanceof Timestamp
      ? lastMonitorRunEndValue.toDate()
      : lastMonitorRunEndValue instanceof Date
        ? lastMonitorRunEndValue
        : null;
    const monitoringComplete = monitorState.lastMonitorStatus === "SUCCESS" &&
      Boolean(lastSuccessfulRun && lastSuccessfulRun >= start && lastSuccessfulRun <= end);
    const [newFindingsCount, openFindingsCount, productsCount, checksCount] = await Promise.all([
      newFindings,
      openFindings,
      merchant.ref.collection(FIRESTORE_COLLECTIONS.subProducts).count().get(),
      merchant.ref.collection(FIRESTORE_COLLECTIONS.subChecks)
        .where("createdAt", ">=", Timestamp.fromDate(start))
        .where("createdAt", "<", Timestamp.fromDate(end))
        .count().get(),
    ]);
    try {
      // Bounded, tenant-scoped previews. Prefer new findings, then older open findings.
      const [recentPreview, openPreview] = await Promise.all([
        newFindingsCount.data().count > 0 ? merchant.ref.collection(FIRESTORE_COLLECTIONS.subAlerts)
          .where("createdAt", ">=", Timestamp.fromDate(start))
          .where("createdAt", "<", Timestamp.fromDate(end))
          .orderBy("createdAt", "desc").limit(5).get() : null,
        openFindingsCount.data().count > 0 ? merchant.ref.collection(FIRESTORE_COLLECTIONS.subAlerts)
          .where("status", "==", "active").limit(5).get() : null,
      ]);
      const findings = buildWeeklyFindings(shop,
        recentPreview?.docs.map(doc => ({ id: doc.id, data: doc.data() })) || [],
        openPreview?.docs.map(doc => ({ id: doc.id, data: doc.data() })) || []);
      const content = buildWeeklyContent(settings.notificationLanguage, shop, start, end, {
        products: productsCount.data().count,
        checks: checksCount.data().count,
        safetyGateRecords,
        newFindings: newFindingsCount.data().count,
        openFindings: openFindingsCount.data().count,
        monitoringComplete,
        lastSuccessfulRun,
        findings,
      });
      const accepted = await createAndSendNotification({
        shop,
        notificationId: `weekly_summary__${weekKey(end)}`,
        type: "weekly_summary",
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
  });
  if (failed) throw new Error(`${failed} weekly email submissions need retry`);
  return { sent, skipped, failed };
}

function hasCurrentMonitoringEntitlement(data: Record<string, unknown>): boolean {
  if (data.subscriptionStatus !== "active" || data.monitoringEntitled !== true) return false;
  const validUntil = data.subscriptionValidUntil;
  const expiry = validUntil instanceof Timestamp ? validUntil.toMillis() : validUntil instanceof Date ? validUntil.getTime() : null;
  return expiry !== null && Number.isFinite(expiry) && expiry > Date.now();
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
  const eventAt = typeof body.ts_event === "number" && Number.isFinite(body.ts_event)
    ? Timestamp.fromMillis(body.ts_event * 1000) : null;
  await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(notificationRef);
    if (!latest.exists) return;
    const previousAt = latest.get("providerEventAt");
    // Undated or older events cannot overwrite an established provider state.
    if (previousAt instanceof Timestamp && (!eventAt || eventAt.toMillis() < previousAt.toMillis())) return;
    if (["delivered", "bounced", "blocked"].includes(String(latest.get("status"))) && status === "accepted") return;
    transaction.set(notificationRef, {
      status, providerEvent: String(body.event || ""),
      providerEventAt: eventAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
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
  createAndSendNotification,
  sendBrevoEmail,
  escapeHtml,
  normalizeEmail,
  parseAlertDetails,
  buildImmediateContent,
  buildWeeklyContent,
  buildWeeklyFindings,
  webhookStatus,
  hasCurrentMonitoringEntitlement,
};
