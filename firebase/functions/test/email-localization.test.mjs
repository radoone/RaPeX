import assert from 'node:assert/strict';
import test from 'node:test';
import { EMAIL_LANGUAGES, normalizeEmailLanguage } from '../lib/email-localization.js';
import { EMAIL_LOCALES } from '../lib/email-locales.js';
import { renderAlertEmail, renderWeeklyEmail, renderVerificationEmail, renderScanReportEmail } from '../lib/email-templates.js';

test('all four email types render all EU languages without missing copy or broken confirmation tokens', () => {
  assert.equal(EMAIL_LANGUAGES.length, 24);
  const url = 'https://zerorecall.online/index.html?lang=fr#verify=example.token';
  const app = 'https://admin.shopify.com/store/example/apps/zerorecall/app';
  for (const language of EMAIL_LANGUAGES) {
    const details = { productTitle: 'Product <model>', safetyGateProduct: 'Example', riskLevel: 'High', overallSimilarity: 92, reason: 'Official record details' };
    const metrics = { products: 100, checks: 30, safetyGateRecords: 7, newFindings: 1, openFindings: 1, monitoringComplete: false, lastSuccessfulRun: null, findings: [{ ...details, url: app, reviewState: 'needs_review', isNew: true }] };
    const messages = [renderAlertEmail(language, details, 'example.myshopify.com', app, app), renderWeeklyEmail(language, 'example.myshopify.com', new Date('2026-10-12'), new Date('2026-10-19'), metrics, app, app), renderVerificationEmail(language, 'example.myshopify.com', url), renderScanReportEmail(language, 'example.myshopify.com', { totalProductsScanned: 100, flaggedProductsCount: 0 })];
    for (const message of messages) {
      assert.ok(message.subject.trim(), language);
      assert.match(message.htmlContent, new RegExp(`<html lang="${language}">`));
      assert.doesNotMatch(message.htmlContent + message.textContent, /\{\{|undefined|NaN/);
      assert.match(message.htmlContent, /info@zerorecall.online/);
    }
    assert.ok(messages[2].textContent.includes(url), language);
    assert.ok(messages[1].subject.includes(EMAIL_LOCALES[language].monitoring_was_incomplete), language);
    assert.match(messages[0].htmlContent, /Product &lt;model&gt;/);
    assert.equal(normalizeEmailLanguage(`${language.toUpperCase()}-XX`), language);
  }
  assert.equal(normalizeEmailLanguage('unsupported'), 'en');
  assert.equal(normalizeEmailLanguage('__proto__'), 'en');
});
