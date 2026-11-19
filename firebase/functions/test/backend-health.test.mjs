import assert from "node:assert/strict";
import { test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { monitoringIsStale } from "../lib/backend-health.js";

const now = Date.parse("2026-11-18T11:00:00Z");
const hoursAgo = (hours) => Timestamp.fromMillis(now - hours * 3_600_000);

test("a first monitoring run has time to reach the daily schedule", () => {
  assert.equal(monitoringIsStale(null, null, hoursAgo(1), now), false);
  assert.equal(monitoringIsStale(null, hoursAgo(25), hoursAgo(1), now), false);
});

test("hourly billing verification does not perpetually defer the first run alert", () => {
  assert.equal(monitoringIsStale(null, hoursAgo(37), hoursAgo(1), now), true);
  assert.equal(monitoringIsStale(null, null, null, now), true);
});

test("completed runs retain the normal freshness threshold", () => {
  assert.equal(monitoringIsStale(hoursAgo(37), hoursAgo(1), hoursAgo(1), now), true);
  assert.equal(monitoringIsStale(hoursAgo(1), null, null, now), false);
});
