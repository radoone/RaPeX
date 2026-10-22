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

test("only send email for a current, active monitoring entitlement", () => {
  assert.equal(emailNotificationTestUtils.hasCurrentMonitoringEntitlement({
    subscriptionStatus: "active",
    monitoringEntitled: true,
  }), true);
  assert.equal(emailNotificationTestUtils.hasCurrentMonitoringEntitlement({
    subscriptionStatus: "active",
    monitoringEntitled: true,
    subscriptionValidUntil: new Date("2020-01-01T00:00:00.000Z"),
  }), false);
  assert.equal(emailNotificationTestUtils.hasCurrentMonitoringEntitlement({
    subscriptionStatus: "inactive",
    monitoringEntitled: true,
  }), false);
});

test("recipient validation and provider statuses are conservative", () => {
  assert.equal(emailNotificationTestUtils.normalizeEmail(" Merchant@Example.COM "), "merchant@example.com");
  assert.equal(emailNotificationTestUtils.normalizeEmail("invalid"), null);
  assert.equal(emailNotificationTestUtils.webhookStatus("delivered"), "delivered");
  assert.equal(emailNotificationTestUtils.webhookStatus("hardBounce"), "bounced");
  assert.equal(emailNotificationTestUtils.webhookStatus("blocked"), "blocked");
  assert.equal(emailNotificationTestUtils.webhookStatus("opened"), null);
});

test("alert email uses canonical Safety Gate fields and matcher reason", () => {
  const parsed = emailNotificationTestUtils.parseAlertDetails({ productTitle: "Example", checkResult: JSON.stringify({ warnings: [{ overallSimilarity: null, reason: "Same model", alertDetails: { fields: { name: "Alert product", level: "High", caseNumber: "A/EXAMPLE", type_numberOfModel: "MODEL", pictures: ["https://example.com/product.jpg"] } } }] }) });
  assert.equal(parsed.reason, "Same model");
  assert.equal(parsed.safetyGateProduct, "Alert product");
  assert.equal(parsed.overallSimilarity, null);
  assert.equal(parsed.alertReference, "A/EXAMPLE");
  assert.equal(parsed.safetyGateImage, "https://example.com/product.jpg");
});

test("weekly previews prioritise new findings, deduplicate and preserve closed review states", () => {
  const findings = emailNotificationTestUtils.buildWeeklyFindings("example.myshopify.com", [
    { id: "new", data: { productTitle: "New product", status: "resolved", reviewState: "needs_review" } },
  ], [
    { id: "new", data: { productTitle: "Duplicate", status: "active" } },
    { id: "older", data: { productTitle: "Older product", status: "active", reviewState: "waiting_for_supplier" } },
    ...Array.from({ length: 7 }, (_, i) => ({ id: `old-${i}`, data: { status: "active" } })),
  ]);
  assert.equal(findings.length, 5);
  assert.equal(findings[0].productTitle, "New product");
  assert.equal(findings[0].reviewState, "resolved");
  assert.equal(findings[0].isNew, true);
  assert.equal(findings[1].reviewState, "waiting_for_supplier");
  assert.equal(findings[1].isNew, false);
  assert.match(findings[1].url, /\/store\/example\/.*open=older$/);
});
