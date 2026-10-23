import type { DocumentReference } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { db } from "./firebase-admin.js";
import { emailAttemptPolicy, EMAIL_LEASE_MS, EmailProviderRejection } from "./email-delivery.js";

/** Durable report submission; never resend an uncertain acceptance after provider-key expiry. */
export async function submitScanReportOnce(ref: DocumentReference, send: () => Promise<void>): Promise<void> {
  const leaseId = randomUUID();
  const claimed = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Scan request no longer exists");
    const state = snapshot.get("reportSubmission") || {};
    const policy = emailAttemptPolicy({ ...state,
      leaseUntil: state.leaseUntil instanceof Timestamp ? state.leaseUntil.toMillis() : undefined,
      ambiguousSince: state.ambiguousSince instanceof Timestamp ? state.ambiguousSince.toMillis() : undefined,
    }, Date.now());
    if (policy === "skip" && state.status === "accepted") return null;
    if (policy !== "send") throw new Error(`Report submission cannot resume: ${policy}`);
    const value = { ...state, status: "pending", attempts: Number(state.attempts || 0) + 1,
      leaseId, leaseUntil: Timestamp.fromMillis(Date.now() + EMAIL_LEASE_MS),
      ambiguousSince: state.ambiguousSince || Timestamp.now(),
    };
    transaction.update(ref, { reportSubmission: value });
    return { hadAmbiguity: state.ambiguousSince instanceof Timestamp };
  });
  if (!claimed) return;
  try {
    await send();
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.get("reportSubmission.leaseId") !== leaseId) throw new Error("Report lease changed");
      transaction.update(ref, { reportSubmission: { status: "accepted", acceptedAt: FieldValue.serverTimestamp() } });
    });
  } catch (error) {
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const state = snapshot.get("reportSubmission");
      if (!state || state.leaseId !== leaseId || state.status === "accepted") return;
      const { ambiguousSince, ...rest } = state;
      delete rest.leaseUntil;
      transaction.update(ref, { reportSubmission: { ...rest, status: "failed",
        ...(!(error instanceof EmailProviderRejection) || claimed.hadAmbiguity ? { ambiguousSince } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      } });
    });
    throw error;
  }
}
