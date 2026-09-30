import { describe, expect, it } from "vitest";
import { summarizeMonitoringRun } from "../app/services/monitoring-runs";

describe("summarizeMonitoringRun", () => {
  it("returns only merchant-safe progress and normalizes Firestore timestamps", () => {
    const result = summarizeMonitoringRun("daily-1", {
      status: "completed",
      updatedAt: { toDate: () => new Date("2026-09-30T01:00:00Z") },
      productsScanned: 4.8,
      alertsCreated: 2,
      lastError: "sensitive internal error details",
    });

    expect(result).toEqual({
      id: "daily-1",
      status: "completed",
      updatedAt: "2026-09-30T01:00:00.000Z",
      productsScanned: 4,
      rapexAlertsScanned: 0,
      alertsCreated: 2,
      attemptCount: 0,
    });
    expect(result).not.toHaveProperty("lastError");
  });

  it("falls back to queued time and bounds malformed counts", () => {
    const result = summarizeMonitoringRun("queued-1", {
      status: "queued",
      queuedAt: "2026-09-30T02:00:00Z",
      productsScanned: -4,
      alertsCreated: Number.NaN,
      attemptCount: 1,
    });

    expect(result.updatedAt).toBe("2026-09-30T02:00:00.000Z");
    expect(result.productsScanned).toBe(0);
    expect(result.alertsCreated).toBe(0);
    expect(result.attemptCount).toBe(1);
  });
});
