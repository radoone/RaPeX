import assert from "node:assert/strict";
import test from "node:test";

process.env.SHOPIFY_APP_HANDLE = "safety-gate-monitor-eu";
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
  }, "alert-1", "example.myshopify.com");
  assert.doesNotMatch(content.htmlContent, /<script>/);
  assert.match(content.htmlContent, /&lt;script&gt;/);
  assert.match(content.htmlContent, /Toy &amp; parts/);
  assert.match(content.textContent, /https:\/\/admin\.shopify\.com\/store\/example\/apps\/safety-gate-monitor-eu\/app\/alerts\?open=alert-1/);
});

test("weekly email reports findings and refuses to claim an incomplete week is clear", () => {
  const content = emailNotificationTestUtils.buildWeeklyContent("en", "example.myshopify.com", new Date("2026-09-21T06:00:00Z"), new Date("2026-09-28T06:00:00Z"), {
    products: 22,
    checks: 18,
    safetyGateRecords: 4,
    newFindings: 2,
    openFindings: 3,
    monitoringComplete: false,
    lastSuccessfulRun: null,
  });
  assert.match(content.subject, /Monitoring was incomplete/);
  assert.ok(content.textContent.includes("2\nOpen findings: 3"));
  assert.doesNotMatch(content.textContent, /No new finding was created/);
});

test("recipient validation and provider statuses are conservative", () => {
  assert.equal(emailNotificationTestUtils.normalizeEmail(" Merchant@Example.COM "), "merchant@example.com");
  assert.equal(emailNotificationTestUtils.normalizeEmail("invalid"), null);
  assert.equal(emailNotificationTestUtils.webhookStatus("delivered"), "delivered");
  assert.equal(emailNotificationTestUtils.webhookStatus("hardBounce"), "bounced");
  assert.equal(emailNotificationTestUtils.webhookStatus("blocked"), "blocked");
  assert.equal(emailNotificationTestUtils.webhookStatus("opened"), null);
});
