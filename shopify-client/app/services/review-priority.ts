import { isWaitingForSupplier } from "./review-evidence";
function severity(alert: any): number {
  let level = alert.riskLevel;
  try {
    const warning = JSON.parse(alert.checkResult || "{}").warnings?.[0];
    const fields = warning?.alertDetails?.fields;
    level =
      fields?.level ||
      fields?.alert_level ||
      fields?.risk_level ||
      warning?.riskLevel ||
      level;
  } catch {
    /* Use recorded severity for legacy payloads. */
  }
  const value = String(level || "").toLowerCase();
  return /serious|high/.test(value) || value === "1" || value === "2"
    ? 0
    : /medium/.test(value)
      ? 1
      : /low/.test(value)
        ? 2
        : 3;
}
/** Review required, official severity, then oldest finding; stable across pages. */
export function compareReviewPriority(a: any, b: any): number {
  const state = (item: any) =>
    item.status !== "active" ? 2 : isWaitingForSupplier(item) ? 1 : 0;
  const time = (item: any) => {
    const value = new Date(item.createdAt).getTime();
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  };
  return (
    state(a) - state(b) ||
    severity(a) - severity(b) ||
    time(a) - time(b) ||
    String(a.id).localeCompare(String(b.id))
  );
}
