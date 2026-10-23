import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { emailIdempotencyKey } from "./email-delivery.js";
import { db } from "./firebase-admin.js";
import { renderFreeScanOwnerEmail } from "./email-templates.js";

type OwnerRequest = { domain: string; email: string; requestedAt: Date };
type Receipt = { messageId: string | null; duplicateAccepted: boolean };
type OwnerNotificationIO = {
  claim(): Promise<OwnerRequest | null>;
  send(data: OwnerRequest): Promise<Receipt>;
  accept(receipt: Receipt): Promise<void>;
  fail(): Promise<void>;
};

export async function deliverOwnerNotification(io: OwnerNotificationIO): Promise<void> {
  const data = await io.claim();
  if (!data) return;
  try {
    const receipt = await io.send(data);
    await io.accept(receipt);
  } catch (error) {
    await io.fail();
    throw error;
  }
}

export async function sendFreeScanOwnerEmail(requestId: string, data: OwnerRequest): Promise<Receipt> {
  const apiKey = (process.env.BREVO_API_KEY || "").trim();
  const sender = (process.env.BREVO_SENDER_EMAIL || "").trim();
  const recipient = (process.env.FREE_SCAN_OWNER_EMAIL || "").trim();
  if (!apiKey || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(sender) || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(recipient)) throw new Error("Owner notification sender/recipient is not configured");
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": apiKey, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: (process.env.BREVO_SENDER_NAME || "ZeroRecall").trim(), email: sender },
      replyTo: { email: sender }, to: [{ email: recipient }],
      ...renderFreeScanOwnerEmail(data), tags: ["free-scan-owner"],
      headers: { idempotencyKey: emailIdempotencyKey(data.domain, `free-scan-owner-${requestId}`) },
    }), signal: globalThis.AbortSignal.timeout(20_000),
  });
  const body = await response.json() as { messageId?: string; code?: string; message?: string };
  // A provider duplicate response confirms a previous submission, not inbox delivery.
  if (!response.ok && body.code === "duplicate_parameter" && /idempotenc/i.test(body.message || "")) return { messageId: null, duplicateAccepted: true };
  if (!response.ok || typeof body.messageId !== "string" || !body.messageId) throw new Error(`Owner notification rejected (${response.status})`);
  return { messageId: body.messageId, duplicateAccepted: false };
}

/** Separate creation trigger: owner-mail outages never fail a visitor's request. */
export async function handleFreeScanOwnerCreated(requestId: string): Promise<void> {
  if (!/^[A-Za-z0-9]{20}$/.test(requestId)) return;
  const ref = db.collection("free_scan_requests").doc(requestId);
  const leaseId = randomUUID();
  await deliverOwnerNotification({
    claim: () => db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.get("ownerNotification.status") === "accepted") return null;
      const leaseUntil = snapshot.get("ownerNotification.leaseUntil");
      if (leaseUntil instanceof Timestamp && leaseUntil.toMillis() > Date.now()) throw new Error("Owner notification is already being submitted");
      const data = snapshot.data()!;
      if (!/^[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com$/.test(String(data.domain)) || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(String(data.email)) || !(data.createdAt instanceof Timestamp)) return null;
      transaction.update(ref, { ownerNotification: { status: "sending", leaseId, leaseUntil: Timestamp.fromMillis(Date.now() + 90_000) } });
      return { domain: data.domain, email: data.email, requestedAt: data.createdAt.toDate() };
    }),
    send: data => sendFreeScanOwnerEmail(requestId, data),
    accept: receipt => db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.get("ownerNotification.leaseId") !== leaseId) return;
      transaction.update(ref, { ownerNotification: { status: "accepted", acceptedAt: FieldValue.serverTimestamp(), brevoMessageId: receipt.messageId, duplicateAccepted: receipt.duplicateAccepted } });
    }),
    fail: () => db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.get("ownerNotification.leaseId") !== leaseId) return;
      transaction.update(ref, { ownerNotification: { status: "retry", updatedAt: FieldValue.serverTimestamp() } });
    }),
  });
}
