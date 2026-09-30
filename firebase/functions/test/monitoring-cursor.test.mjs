import assert from "node:assert/strict";
import test from "node:test";
import { buildMonitoringCursorValues } from "../lib/monitoring-cursor.js";

test("legacy timestamp checkpoint without a document ID is replayed inclusively", () => {
  const date = new Date("2026-09-28T00:00:00.000Z");
  assert.equal(buildMonitoringCursorValues(date, "2026-09-28T12:00:00Z", null), null);
  assert.equal(buildMonitoringCursorValues(date, "2026-09-28T12:00:00Z", ""), null);
});

test("complete checkpoint uses alert date, timestamp, and document ID as a stable cursor", () => {
  const date = new Date("2026-09-28T00:00:00.000Z");
  assert.deepEqual(
    buildMonitoringCursorValues(date, "2026-09-28T12:00:00Z", "alert-009"),
    [date, "2026-09-28T12:00:00Z", "alert-009"],
  );
});
