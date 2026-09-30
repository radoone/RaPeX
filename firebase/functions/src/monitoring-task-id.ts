import { createHash } from "node:crypto";

export function monitoringTaskId(shop: string, runId: string): string {
  const digest = createHash("sha256").update(`${shop}:${runId}`).digest("hex");
  return `merchant-monitor-${digest}`;
}

export function scheduledMonitoringRunId(date: Date): string {
  return `scheduled-${date.toISOString().slice(0, 10)}`;
}
