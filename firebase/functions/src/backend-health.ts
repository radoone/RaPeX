import { Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./firebase-admin.js";

export function staleTimestamp(value: unknown, ageMs: number, now = Date.now()): boolean {
  return !(value instanceof Timestamp) || now - value.toMillis() > ageMs;
}

/** Read-only health probe. Bounded queries; errors are routed by the operations log alert. */
export async function checkBackendHealth(): Promise<{ problems: string[] }> {
  const problems: string[] = [];
  const loader = await db.doc("rapex_meta/loader_state").get();
  if (loader.get("last_run_status") !== "SUCCESS" || staleTimestamp(loader.get("last_run_end"), 36 * 3600_000)) problems.push("safety_gate_import_failed_or_stale");
  if (staleTimestamp(loader.get("last_alert_date"), 14 * 24 * 3600_000)) problems.push("safety_gate_publications_stale");
  const scans = await db.collection("free_scan_requests").where("status", "in", ["queued", "processing", "scanning", "reporting"]).limit(100).get();
  if (scans.size === 100) problems.push("free_scan_backlog_limit_reached");
  if (scans.docs.some((scan) => staleTimestamp(scan.get("updatedAt"), 2 * 3600_000))) problems.push("free_scan_stalled");
  const merchants = await db.collection("merchants").select("monitoringEntitled", "subscriptionValidUntil", "lastMonitorStatus", "lastMonitorRunEnd", "lastMonitorRunStart").get();
  for (const merchant of merchants.docs) {
    if (merchant.get("monitoringEntitled") !== true) continue;
    const validUntil = merchant.get("subscriptionValidUntil");
    if (!(validUntil instanceof Timestamp) || validUntil.toMillis() <= Date.now()) {
      problems.push("billing_entitlement_expired");
      continue;
    }
    const status = merchant.get("lastMonitorStatus");
    if (status === "FAILURE") problems.push("merchant_monitoring_failed");
    if (status === "IN_PROGRESS" && staleTimestamp(merchant.get("lastMonitorRunStart"), 2 * 3600_000)) problems.push("merchant_monitoring_stalled");
    if (status !== "IN_PROGRESS" && staleTimestamp(merchant.get("lastMonitorRunEnd"), 36 * 3600_000)) problems.push("merchant_monitoring_stale");
    const mail = await merchant.ref.collection("email_notifications").where("status", "in", ["failed", "operator_review"]).limit(20).get();
    if (mail.docs.some((item) => item.get("retryable") === false || Number(item.get("attempts")) >= 8)) problems.push("merchant_email_needs_operator");
  }
  const unique = [...new Set(problems)];
  if (unique.length) logger.error("ZeroRecall backend health requires attention", { code: "backend_health", problems: unique });
  else logger.info("ZeroRecall backend health passed", { code: "backend_health" });
  return { problems: unique };
}
