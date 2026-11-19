import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFunction, Timestamp, FieldValue, collections, logger } from './helpers/isolated-source.mjs';
import { weeklyWindow } from '../lib/email-notifications.js';

test('weekly metrics count newly added checked products once and imports by ingestion, not publication', async () => {
  const shop = 'weekly.myshopify.com', root = `merchants/${shop}`;
  const start = new Date('2026-11-02T06:00:00Z'), end = new Date('2026-11-09T06:00:00Z');
  const at = value => Timestamp.fromDate(new Date(value));
  const inside = at('2026-11-05T06:00:00Z'), before = at('2026-10-01T06:00:00Z');
  const rows = new Map([
    [root, { shop, lastMonitorStatus: 'SUCCESS', lastMonitorRunEnd: inside }],
    // New product, checked repeatedly: still one product.
    [`${root}/products/new`, { createdAt: Timestamp.fromDate(start), lastCheckedAt: inside }],
    [`${root}/products/unexamined`, { createdAt: inside }],
    [`${root}/products/old`, { createdAt: before, lastCheckedAt: inside }],
    [`${root}/products/after`, { createdAt: Timestamp.fromDate(end), lastCheckedAt: Timestamp.fromDate(end) }],
    [`${root}/checks/one`, { productId: 'new', createdAt: inside }],
    [`${root}/checks/two`, { productId: 'new', createdAt: inside }],
    [`${root}/checks/three`, { productId: 'old', createdAt: inside }],
    [`${root}/checks/before`, { productId: 'old', createdAt: before }],
    ['rapex_alerts/old-publication-imported-now', { meta: { alert_date: before, ingested_at: inside } }],
    ['rapex_alerts/new-publication-imported-before', { meta: { alert_date: inside, ingested_at: before } }],
    ['rapex_alerts/start', { meta: { ingested_at: Timestamp.fromDate(start) } }],
    ['rapex_alerts/end', { meta: { ingested_at: Timestamp.fromDate(end) } }],
  ]);
  const field = (data, path) => path.split('.').reduce((value, key) => value?.[key], data);
  const query = (path, filters = []) => {
    const matches = () => [...rows].filter(([key, data]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/') && filters.every(([name, op, expected]) => {
      const value = field(data, name);
      return op === '>=' ? value >= expected : op === '<' ? value < expected : value === expected;
    }));
    return {
      where: (name, op, value) => query(path, [...filters, [name, op, value]]),
      count: () => ({ get: async () => ({ data: () => ({ count: matches().length }) }) }),
      get: async () => ({ docs: matches().map(([key, data]) => ({ id: key.split('/').at(-1), data: () => data, ref: {
        collection: name => query(`${key}/${name}`), set: async patch => rows.set(key, { ...data, ...patch }),
      } })) }),
    };
  };
  const captured = [];
  const run = sourceFunction('email-notifications', 'runWeeklyClearSummaries', {
    db: { collection: path => query(path) }, Timestamp, FieldValue, logger,
    FIRESTORE_COLLECTIONS: collections, weeklyWindow,
    mapBounded: async (items, _limit, work) => { for (const item of items) await work(item); },
    readMerchantSettings: () => ({ weeklySummaryEmails: true, notificationEmail: 'owner@example.com', notificationLanguage: 'en' }),
    hasCurrentMonitoringEntitlement: () => true,
    buildWeeklyFindings: () => [],
    buildWeeklyContent: (_language, _shop, _start, _end, metrics) => metrics,
    createAndSendNotification: async ({ content }) => { captured.push(content); return true; },
    weekKey: () => 'test',
  });
  assert.deepEqual(await run(end), { sent: 1, skipped: 0, failed: 0 });
  assert.equal(captured[0].products, 4);
  assert.equal(captured[0].checks, 3);
  assert.equal(captured[0].newProductsChecked, 1);
  assert.equal(captured[0].safetyGateRecords, 2);
});
