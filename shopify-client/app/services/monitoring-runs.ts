export type MonitoringRunSummary = {
  id: string;
  status: string;
  updatedAt: string | null;
  productsScanned: number;
  rapexAlertsScanned: number;
  alertsCreated: number;
  attemptCount: number;
};

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
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

export function summarizeMonitoringRun(id: string, data: Record<string, unknown>): MonitoringRunSummary {
  return {
    id,
    status: typeof data.status === "string" ? data.status : "unknown",
    updatedAt: toIsoString(data.updatedAt || data.queuedAt || data.createdAt),
    productsScanned: toCount(data.productsScanned),
    rapexAlertsScanned: toCount(data.rapexAlertsScanned),
    alertsCreated: toCount(data.alertsCreated),
    attemptCount: toCount(data.attemptCount),
  };
}
