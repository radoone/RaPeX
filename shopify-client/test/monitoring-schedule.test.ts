import { describe, expect, it } from "vitest";
import { nextScheduledMonitoringAt, plannedMonitoringAt } from "../app/services/monitoring-schedule";

describe("next daily Safety Gate monitoring slot", () => {
  it.each([
    ["2026-11-20T02:46:59Z", "2026-11-20T02:47:00.000Z"],
    ["2026-11-20T02:47:00Z", "2026-11-21T02:47:00.000Z"],
    ["2026-03-28T08:00:00Z", "2026-03-29T01:47:00.000Z"],
    ["2026-10-24T08:00:00Z", "2026-10-25T02:47:00.000Z"],
  ])("keeps 03:47 Bratislava time after %s", (now, expected) => {
    expect(nextScheduledMonitoringAt(Date.parse(now))).toBe(expected);
  });
  it("reports the scheduled slot for the first run and later eligible runs only", () => {
    const now = Date.parse("2026-11-20T20:00:00Z");
    expect(plannedMonitoringAt(true, "starting", now)).toBe("2026-11-21T02:47:00.000Z");
    expect(plannedMonitoringAt(true, "enabled", now)).toBe("2026-11-21T02:47:00.000Z");
    expect(plannedMonitoringAt(false, "starting", now)).toBeNull();
    expect(plannedMonitoringAt(true, "paused", now)).toBeNull();
  });
});
