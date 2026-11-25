type Billing = {
  developmentBypass: boolean;
  ownerTestAccess?: boolean;
  billingVerified: boolean;
  hasActivePayment: boolean;
  subscriptionActivatedAt?: Date | string | null;
  validUntil?: Date | string | null;
};

function parseTimestamp(value?: Date | string | null): number {
  if (!value) return NaN;
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/** A prior successful run is evidence of history, never of current entitlement. */
export function monitoringState(
  billing: Billing,
  status?: string | null,
  now = Date.now(),
  lastSuccess?: string | null,
  initialCheckAt?: string | null,
) {
  if (!billing.ownerTestAccess) {
    if (billing.developmentBypass) return "preview";
    if (!billing.billingVerified) return "unverified";
    if (
      !billing.hasActivePayment ||
      (billing.validUntil && new Date(billing.validUntil).getTime() <= now)
    )
      return "paused";
  }
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
  const activatedAt = parseTimestamp(billing.subscriptionActivatedAt);
  const recentlyActivated =
    Number.isFinite(activatedAt) && now - activatedAt < 48 * 60 * 60_000;
  if (lastSuccess === null) {
    const auditTime = initialCheckAt ? Date.parse(initialCheckAt) : NaN;
    return (Number.isFinite(auditTime) && now - auditTime < 48 * 60 * 60_000) ||
      recentlyActivated
      ? "starting"
      : "unknown";
  }
  const completedAt = lastSuccess ? Date.parse(lastSuccess) : NaN;
  if (Number.isFinite(completedAt) && now - completedAt > 48 * 60 * 60_000) {
    return recentlyActivated && activatedAt > completedAt
      ? "starting"
      : "delayed";
  }
  return "enabled";
}
