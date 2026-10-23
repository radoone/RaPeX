import assert from "node:assert/strict";
import test from "node:test";
import { renderAlertEmail, renderWeeklyEmail, renderVerificationEmail, renderScanReportEmail } from "../lib/email-templates.js";

const app = "https://admin.shopify.com/store/example/apps/zerorecall/app";
const details = { productTitle: 'Toy <img src=x onerror="alert(1)">', riskLevel: "High", overallSimilarity: null, safetyGateProduct: "Toy & parts", reason: "Compare <model> & batch", safetyGateImage: "javascript:alert(1)" };

test("alert renders untrusted fields as text and omits unsafe photos and missing scores", () => {
  const content = renderAlertEmail("en", details, "example.myshopify.com", `${app}/alerts?open=a&source=email`, `${app}/settings`);
  assert.doesNotMatch(content.htmlContent, /<img|javascript:/);
  assert.match(content.htmlContent, /&lt;img/);
  assert.match(content.htmlContent, /Toy &amp; parts/);
  assert.match(content.htmlContent, /Not available/);
  assert.match(content.htmlContent, /open=a&amp;source=email/);
  assert.match(content.textContent, /does not confirm/);
  assert.throws(() => renderAlertEmail("en", details, "example.myshopify.com", "javascript:alert(1)", `${app}/settings`), /HTTPS/);
});

test("confirmation preserves single-use token and explains start, expiry and ignored requests in both languages", () => {
  const url = "https://zerorecall.online/index.html?lang=sk#verify=EXAMPLE.token_only_for_preview";
  for (const language of ["sk", "en"]) {
    const content = renderVerificationEmail(language, "example.myshopify.com", url);
    assert.ok(content.htmlContent.includes(url));
    assert.ok(content.textContent.includes(url));
    assert.match(content.textContent, /30/);
    assert.match(content.textContent, language === "sk" ? /Bez potvrdenia sa sken nespustí/ : /will not start without confirmation/);
    assert.doesNotMatch(content.htmlContent, /Email preferences|Nastavenia e-mailov/);
    assert.match(content.htmlContent, new RegExp(`<html lang="${language}"`));
  }
});

test("report links stay on the requested shop, escapes titles and limits the email to five matches", () => {
  const lead = { totalProductsScanned: 100, flaggedProductsCount: 7, matches: Array.from({ length: 7 }, (_, i) => ({ productTitle: `Product <${i}>`, productUrl: i === 0 ? "https://example.myshopify.com.evil.test/p" : `https://example.myshopify.com/products/${i}`, result: { warnings: [{ alertId: 'internal-id', alertDetails: { fields: { caseNumber: 'A/1 <test>' } } }] } })) };
  const content = renderScanReportEmail("en", "example.myshopify.com", lead);
  assert.doesNotMatch(content.htmlContent, /evil\.test|Product &lt;5&gt;/);
  assert.match(content.htmlContent, /Product &lt;0&gt;/);
  assert.match(content.htmlContent, /https:\/\/example.myshopify.com\/products\/1/);
  assert.match(content.htmlContent, /A\/1 &lt;test&gt;/);
  assert.match(content.textContent, /does not certify/);
  assert.match(content.htmlContent, /up to five products/);
  assert.match(content.textContent, /up to five products/);
});

test("reports provide actual official evidence, omit internal IDs and preserve the selected language", () => {
  const internalId = "d92d5b51-79c4-4b7e-9532-d5db343558fe";
  const record = "https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/EXAMPLE";
  const match = { productTitle: "Toy", productUrl: "https://example.myshopify.com/products/toy", result: { warnings: [{ alertId: internalId, reason: "Compare <model> and batch", alertDetails: { fields: { url: record, caseNumber: "A12/EXAMPLE/26", type_numberOfModel: "Model <1>" } } }] } };
  const content = renderScanReportEmail("sk", "example.myshopify.com", { totalProductsScanned: 10, flaggedProductsCount: 1, matches: [match] });
  assert.ok(content.textContent.includes(record));
  assert.match(content.htmlContent, /A12\/EXAMPLE\/26|Model &lt;1&gt;/);
  assert.match(content.htmlContent, /Compare &lt;model&gt; and batch/);
  assert.doesNotMatch(content.htmlContent + content.textContent, new RegExp(internalId));
  assert.match(content.htmlContent, /href="https:\/\/zerorecall.online\/\?lang=sk#pricing"/);
  assert.ok(content.textContent.includes("https://zerorecall.online/?lang=sk#pricing"));
  for (const url of ["https://ec.europa.eu.evil.test/record", "javascript:alert(1)", "https://example.com/record"]) {
    const unsafe = structuredClone(match);
    unsafe.result.warnings[0].alertDetails.fields.url = url;
    const message = renderScanReportEmail("en", "example.myshopify.com", { totalProductsScanned: 10, flaggedProductsCount: 1, matches: [unsafe] });
    assert.ok(!message.htmlContent.includes(url));
    assert.ok(!message.textContent.includes(url));
  }
});

test("official risk values are localized and highlighted, including the 'risk' suffix", () => {
  for (const [riskLevel, label] of [["Serious risk", "Závažná"], [" HIGH RISK ", "Vysoká"]]) {
    const content = renderAlertEmail("sk", { ...details, productTitle: "Toy", riskLevel }, "example.myshopify.com", app, app);
    assert.match(content.htmlContent, new RegExp(`color:#93421f[^>]*>${label}`));
    assert.ok(content.textContent.includes(label));
    assert.ok(!content.textContent.includes(riskLevel));
  }
  const unknown = renderAlertEmail("en", { ...details, riskLevel: "constructor" }, "example.myshopify.com", app, app);
  assert.match(unknown.textContent, /Risk level: constructor\n/);
});

test("weekly zero findings never certifies safety and incomplete monitoring takes priority over zero findings", () => {
  const metrics = { products: 100, checks: 24, safetyGateRecords: 6, newFindings: 0, openFindings: 2, monitoringComplete: true, lastSuccessfulRun: new Date("2026-10-19T06:00:00Z") };
  for (const language of ["sk", "en"]) {
    const complete = renderWeeklyEmail(language, "example.myshopify.com", new Date("2026-10-12T06:00:00Z"), new Date("2026-10-19T06:00:00Z"), metrics, app, `${app}/settings`);
    assert.match(complete.textContent, language === "sk" ? /nepotvrdzuje bezpečnosť/ : /does not certify the safety/);
    const partial = renderWeeklyEmail(language, "example.myshopify.com", new Date("2026-10-12T06:00:00Z"), new Date("2026-10-19T06:00:00Z"), { ...metrics, monitoringComplete: false }, app, `${app}/settings`);
    assert.doesNotMatch(partial.htmlContent, /No new findings|Bez nových nálezov/);
    assert.match(partial.subject, language === "sk" ? /nebol celý dokončený/ : /Monitoring was incomplete/);
  }
});

test("weekly findings include safe photos, escaped details and individual links in HTML and text", () => {
  const finding = { productTitle: "Product <example>", safetyGateProduct: "Alert & toy", riskLevel: "High", overallSimilarity: 92, reason: "Compare <model>", safetyGateImage: "https://example.com/toy.jpg", url: `${app}/alerts?open=a&source=weekly`, reviewState: "resolved", isNew: true };
  const metrics = { products: 100, checks: 24, safetyGateRecords: 6, newFindings: 7, openFindings: 2, monitoringComplete: true, lastSuccessfulRun: null, findings: [finding, { ...finding, productTitle: "No image", safetyGateImage: "data:text/html,bad", reviewState: "needs_review", isNew: false }, ...Array.from({ length: 5 }, (_, i) => ({ ...finding, productTitle: `Extra ${i}` }))] };
  for (const language of ["en", "sk"]) {
    const content = renderWeeklyEmail(language, "example.myshopify.com", new Date("2026-10-12T06:00:00Z"), new Date("2026-10-19T06:00:00Z"), metrics, app, `${app}/settings`);
    assert.match(content.htmlContent, /src="https:\/\/example.com\/toy.jpg"/);
    assert.match(content.htmlContent, /Product &lt;example&gt;/);
    assert.match(content.htmlContent, /Alert &amp; toy/);
    assert.match(content.htmlContent, /open=a&amp;source=weekly/);
    assert.match(content.textContent, /open=a&source=weekly/);
    assert.match(content.htmlContent, language === "sk" ? /Vyriešené/ : /Resolved/);
    assert.match(content.htmlContent, language === "sk" ? /STARŠÍ OTVORENÝ/ : /OLDER OPEN/);
    assert.match(content.htmlContent, /No image/);
    assert.doesNotMatch(content.htmlContent, /data:text|Extra 3|Extra 4/);
  }
});
