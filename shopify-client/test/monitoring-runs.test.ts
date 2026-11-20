import { describe, expect, it } from "vitest";
import { recentlyCheckedProductCount, summarizeMonitoringActivity, summarizeMonitoringRun, toIsoString } from "../app/services/monitoring-runs";

describe("summarizeMonitoringRun", () => {
  it("serializes the dashboard's Firestore run timestamp and rejects invalid dates", () => {
    expect(toIsoString({ toDate: () => new Date("2026-10-15T08:00:00Z") })).toBe("2026-10-15T08:00:00.000Z");
    expect(toIsoString(new Date("invalid"))).toBeNull();
    expect(toIsoString(null)).toBeNull();
  });
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

describe("summarizeMonitoringActivity", () => {
  const since = Date.parse("2026-10-21T00:00:00Z");
  const updatedAt = "2026-11-19T08:00:00Z";

  it("uses completed run results, including explicit zero, and excludes failed and old runs", () => {
    expect(summarizeMonitoringActivity([
      { status: "completed", updatedAt, rapexAlertsScanned: 700, result: { rapexAlertsScanned: 0 } },
      { status: "completed", updatedAt, completedSummary: { rapexAlertsScanned: 104 } },
      { status: "failed", updatedAt, rapexAlertsScanned: 80 },
      { status: "completed", updatedAt, completedAt: "2026-10-01T08:00:00Z", rapexAlertsScanned: 50 },
    ], since)).toEqual({ completedRuns: 2, recordsConsidered: 104 });
  });

  it("never treats missing metrics, missing runs or truncated history as a verified zero", () => {
    const row = { status: "completed", updatedAt };
    expect(summarizeMonitoringActivity([row], since)).toEqual({ completedRuns: 1, recordsConsidered: null });
    expect(summarizeMonitoringActivity([], since)).toBeNull();
    expect(summarizeMonitoringActivity(Array(101).fill(row), since)).toBeNull();
  });
});

it("counts distinct products with recorded checks after the baseline and within 30 days", () => {
  expect(recentlyCheckedProductCount([
    { productId: "1", checkedAt: "2026-11-20T10:00:00Z" },
    { productId: "gid://shopify/Product/1", checkedAt: "2026-11-19T10:00:00Z" },
    { productId: "2", checkedAt: "2026-11-10T10:00:00Z" },
    { productId: "3", checkedAt: "2026-11-01T10:00:00Z" },
    { productId: "4", checkedAt: "2026-11-21T10:00:00Z" },
  ], Date.parse("2026-11-20T12:00:00Z"), "2026-11-01T10:00:00Z")).toBe(2);
});
