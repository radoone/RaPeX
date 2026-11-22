export type MonitoringRunSummary = {
  id: string;
  status: string;
  hasMore?: boolean;
  updatedAt: string | null;
  productsScanned: number | null;
  rapexAlertsScanned: number;
  alertsCreated: number | null;
  attemptCount: number;
};

export function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function recentlyCheckedProductCount(
  checks: ReadonlyArray<{ productId?: string | null; checkedAt?: Date | string | null }>,
  observedAt: number,
  baselineAt: string | null,
): number | null {
  if (!baselineAt) return null;
  const since = Math.max(Date.parse(baselineAt), observedAt - 30 * 24 * 60 * 60_000);
  const products = new Set<string>();
  for (const check of checks) {
    const time = check.checkedAt ? new Date(check.checkedAt).getTime() : NaN;
    if (time > since && time <= observedAt && check.productId) {
      products.add(check.productId.replace("gid://shopify/Product/", ""));
    }
  }
  return products.size;
}

export function summarizeMonitoringActivity(rows: Record<string, unknown>[], since: number) {
  if (rows.length > 100) return null;
  const completed = rows.filter(row => {
    const date = toIsoString(row.completedAt ?? row.updatedAt);
    return row.status === "completed" && date !== null && Date.parse(date) > since;
  });
  if (!completed.length) return null;
  const records = completed.map(row => monitoringCount(row, "rapexAlertsScanned"));
  return {
    completedRuns: completed.length,
    recordsConsidered: records.every(count => count !== null)
      ? records.reduce<number>((sum, count) => sum + (count ?? 0), 0)
      : null,
  };
}

function monitoringCount(data: Record<string, unknown>, key: string): number | null {
  const result = data.result as Record<string, unknown> | undefined;
  const summary = data.completedSummary as Record<string, unknown> | undefined;
  const value = result?.[key] ?? summary?.[key] ?? data[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function summarizeMonitoringRun(id: string, data: Record<string, unknown>): MonitoringRunSummary {
  const result = data.result as Record<string, unknown> | undefined;
  const completedSummary = data.completedSummary as Record<string, unknown> | undefined;
  const hasMore = result?.hasMore ?? completedSummary?.hasMore;
  return {
    id,
    status: typeof data.status === "string" ? data.status : "unknown",
    updatedAt: toIsoString((data.status === "completed" && data.completedAt) || data.updatedAt || data.queuedAt || data.createdAt),
    ...(typeof hasMore === "boolean" ? { hasMore } : {}),
    productsScanned: monitoringCount(data, "productsScanned"),
    rapexAlertsScanned: monitoringCount(data, "rapexAlertsScanned") ?? toCount(data.rapexAlertsScanned),
    alertsCreated: monitoringCount(data, "alertsCreated"),
    attemptCount: toCount(data.attemptCount),
  };
}
