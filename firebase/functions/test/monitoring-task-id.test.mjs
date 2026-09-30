import test from "node:test";
import assert from "node:assert/strict";
import { monitoringTaskId, scheduledMonitoringRunId } from "../lib/monitoring-task-id.js";

test("scheduled run IDs are stable for the same UTC calendar day", () => {
  assert.equal(
    scheduledMonitoringRunId(new Date("2026-09-30T03:47:00.000Z")),
    scheduledMonitoringRunId(new Date("2026-09-30T23:59:59.000Z")),
  );
  assert.equal(scheduledMonitoringRunId(new Date("2026-09-30T03:47:00.000Z")), "scheduled-2026-09-30");
});

test("task IDs deduplicate one shop and run without exposing the shop name", () => {
  const shop = "merchant-example.myshopify.com";
  const runId = "scheduled-2026-09-30";
  const id = monitoringTaskId(shop, runId);

  assert.match(id, /^merchant-monitor-[a-f0-9]{64}$/);
  assert.equal(monitoringTaskId(shop, runId), id);
  assert.notEqual(monitoringTaskId("another-shop.myshopify.com", runId), id);
  assert.notEqual(monitoringTaskId(shop, "scheduled-2026-10-01"), id);
  assert.equal(id.includes(shop), false);
});
