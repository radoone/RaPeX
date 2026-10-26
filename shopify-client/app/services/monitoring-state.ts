type Billing = {
  developmentBypass: boolean;
  billingVerified: boolean;
  hasActivePayment: boolean;
  validUntil?: Date | string | null;
};
/** A prior successful run is evidence of history, never of current entitlement. */
export function monitoringState(
  billing: Billing,
  status?: string | null,
  now = Date.now(),
  lastSuccess?: string | null,
) {
  if (billing.developmentBypass) return "preview";
  if (!billing.billingVerified) return "unverified";
  if (
    !billing.hasActivePayment ||
    (billing.validUntil && new Date(billing.validUntil).getTime() <= now)
  )
    return "paused";
  if (
    status === "FAILURE" ||
    status === "failed" ||
    status === "enqueue_failed"
  )
    return "failed";
  if (
    ["IN_PROGRESS", "queued", "processing", "retrying"].includes(status || "")
  )
    return "processing";
  const completedAt = lastSuccess ? Date.parse(lastSuccess) : NaN;
  if (Number.isFinite(completedAt) && now - completedAt > 48 * 60 * 60_000)
    return "delayed";
  return "enabled";
}
