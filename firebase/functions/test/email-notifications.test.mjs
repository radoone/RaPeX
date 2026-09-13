import assert from "node:assert/strict";
import test from "node:test";

process.env.APP_PUBLIC_URL = "https://safety.example";
const { emailNotificationTestUtils, weeklyWindow } = await import("../lib/email-notifications.js");

test("weekly window preserves Bratislava wall-clock time across spring DST", () => {
  const end = new Date("2026-03-30T06:00:00.000Z"); // Monday 08:00 CEST
  const window = weeklyWindow(end);
  assert.equal(window.end.toISOString(), end.toISOString());
  assert.equal(window.start.toISOString(), "2026-03-23T07:00:00.000Z"); // Monday 08:00 CET
});

test("weekly window preserves Bratislava wall-clock time across autumn DST", () => {
  const end = new Date("2026-10-26T07:00:00.000Z"); // Monday 08:00 CET
  const window = weeklyWindow(end);
  assert.equal(window.start.toISOString(), "2026-10-19T06:00:00.000Z"); // Monday 08:00 CEST
});

test("immediate email escapes merchant and Safety Gate content", () => {
  const content = emailNotificationTestUtils.buildImmediateContent("en", {
    productTitle: '<script>alert("x")</script>',
    riskLevel: "Serious",
    overallSimilarity: 96,
    safetyGateProduct: "Toy & parts",
    reason: "Review <now>",
  }, "alert-1");
  assert.doesNotMatch(content.htmlContent, /<script>/);
  assert.match(content.htmlContent, /&lt;script&gt;/);
  assert.match(content.htmlContent, /Toy &amp; parts/);
  assert.match(content.textContent, /https:\/\/safety\.example\/app\/alerts\?alertId=alert-1/);
});

test("recipient validation and provider statuses are conservative", () => {
  assert.equal(emailNotificationTestUtils.normalizeEmail(" Merchant@Example.COM "), "merchant@example.com");
  assert.equal(emailNotificationTestUtils.normalizeEmail("invalid"), null);
  assert.equal(emailNotificationTestUtils.webhookStatus("delivered"), "delivered");
  assert.equal(emailNotificationTestUtils.webhookStatus("hardBounce"), "bounced");
  assert.equal(emailNotificationTestUtils.webhookStatus("blocked"), "blocked");
  assert.equal(emailNotificationTestUtils.webhookStatus("opened"), null);
});
