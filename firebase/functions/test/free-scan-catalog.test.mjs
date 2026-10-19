import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPublicCatalogPage, freeScanPageTaskId, runFreeScanCatalogPage } from '../lib/free-scan-catalog.js';
const requestId = 'Abcdef12345678901234';
function harness(pages) {
  const state = { domain: 'example.myshopify.com', status: 'queued', nextPage: 0, checkedProducts: 0, possibleMatches: 0, catalogComplete: false };
  const seen = new Set(); const queued = []; let reports = 0; let scans = 0;
  const io = {
    load: async () => ({ ...state }), fetch: async (_, index) => pages[index] || [],
    unseen: async products => products.filter(p => !seen.has(p.id)),
    scan: async (_, products) => { scans++; return { totalProductsScanned: products.length, flaggedProductsCount: products.filter(p => p.id % 17 === 0).length, matches: products.filter(p => p.id % 17 === 0).map(p => ({ productId: String(p.id) })) }; },
    commit: async (page, products, result, exhausted) => {
      if (page !== state.nextPage) return;
      products.forEach(p => seen.add(p.id)); state.nextPage++; state.checkedProducts += products.length; state.possibleMatches += result.flaggedProductsCount;
      state.catalogComplete = exhausted; state.status = exhausted ? 'reporting' : 'running';
    },
    enqueue: async index => { queued.push(index); }, report: async () => { reports++; state.status = 'completed'; },
  };
  return { state, queued, io, get reports() { return reports; }, get scans() { return scans; } };
}
const task = pageIndex => ({ requestId, pageIndex });
test('full public scan passes both old limits, counts every product and reports only after the empty terminal page', async () => {
  const pages = Array.from({ length: 202 }, (_, page) => Array.from({ length: page === 201 ? 1 : 50 }, (_, i) => ({ id: page * 50 + i + 1 })));
  const h = harness(pages);
  for (let page = 0; page < pages.length; page++) { await runFreeScanCatalogPage(task(page), h.io); assert.equal(h.reports, 0); }
  assert.equal(h.state.checkedProducts, 10051); assert.equal(h.state.possibleMatches, Math.floor(10051 / 17));
  await runFreeScanCatalogPage(task(pages.length), h.io); assert.equal(h.reports, 1); assert.equal(h.state.status, 'completed');
  await runFreeScanCatalogPage(task(0), h.io); assert.equal(h.reports, 1);
});
test('a committed-page retry repairs a failed continuation enqueue without rescanning or double counting', async () => {
  const h = harness([[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]]);
  const enqueue = h.io.enqueue; h.io.enqueue = async () => { throw new Error('queue unavailable'); };
  await assert.rejects(runFreeScanCatalogPage(task(0), h.io), /queue unavailable/);
  assert.equal(h.state.checkedProducts, 2); h.io.enqueue = enqueue;
  await runFreeScanCatalogPage(task(0), h.io); assert.equal(h.scans, 1); assert.deepEqual(h.queued, [1]);
  await runFreeScanCatalogPage(task(1), h.io); assert.equal(h.state.checkedProducts, 3);
});
test('fetch or matcher failure never advances the cursor or sends a clear report', async () => {
  for (const failing of ['fetch', 'scan']) {
    const h = harness([[{ id: 1 }]]); h.io[failing] = async () => { throw new Error('temporary failure'); };
    await assert.rejects(runFreeScanCatalogPage(task(0), h.io), /temporary failure/);
    assert.equal(h.state.nextPage, 0); assert.equal(h.state.checkedProducts, 0); assert.equal(h.reports, 0);
  }
});
test('short pages continue, repeated pagination and empty catalogs fail instead of claiming complete', async () => {
  const h = harness([[{ id: 1 }], [{ id: 1 }]]); await runFreeScanCatalogPage(task(0), h.io);
  assert.equal(h.state.catalogComplete, false);
  await assert.rejects(runFreeScanCatalogPage(task(1), h.io), /repeated/); assert.equal(h.reports, 0);
  const empty = harness([]); await assert.rejects(runFreeScanCatalogPage(task(0), empty.io), /no products/); assert.equal(empty.reports, 0);
});
test('report retries use saved completed counts and do not refetch or recheck the catalog', async () => {
  const h = harness([[{ id: 17 }]]); await runFreeScanCatalogPage(task(0), h.io);
  const report = h.io.report; h.io.report = async () => { throw new Error('Brevo unavailable'); };
  await assert.rejects(runFreeScanCatalogPage(task(1), h.io), /Brevo unavailable/);
  assert.equal(h.state.status, 'reporting'); h.io.fetch = async () => { throw new Error('must not fetch'); }; h.io.report = report;
  await runFreeScanCatalogPage(task(1), h.io); assert.equal(h.state.checkedProducts, 1); assert.equal(h.reports, 1);
});
test('tasks are versioned per page and reject unconfirmed, expired, invalid or future requests', async () => {
  assert.equal(freeScanPageTaskId(task(1)), freeScanPageTaskId(task(1))); assert.notEqual(freeScanPageTaskId(task(1)), freeScanPageTaskId(task(2)));
  const h = harness([[{ id: 1 }]]); h.state.status = 'awaiting_verification'; await runFreeScanCatalogPage(task(0), h.io); assert.equal(h.scans, 0);
  h.io.load = async () => null; await runFreeScanCatalogPage(task(0), h.io); assert.equal(h.reports, 0);
  await assert.rejects(runFreeScanCatalogPage({ requestId: '../bad', pageIndex: 0 }, h.io), /Invalid/);
  const future = harness([]); await assert.rejects(runFreeScanCatalogPage(task(1), future.io), /ahead/);
});
test('public catalog page fetch validates Shopify host, HTTP/JSON success, IDs and page bounds', async () => {
  const original = global.fetch; const urls = [];
  try {
    global.fetch = async url => { urls.push(url); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ products: [{ id: 123 }] }) }; };
    assert.deepEqual(await fetchPublicCatalogPage('example.myshopify.com', 7), [{ id: 123 }]); assert.match(urls[0], /limit=50&page=8$/);
    await assert.rejects(fetchPublicCatalogPage('127.0.0.1', 0), /Invalid/);
    global.fetch = async () => ({ ok: false, status: 429 }); await assert.rejects(fetchPublicCatalogPage('example.myshopify.com', 0), /429/);
    global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ products: [{ id: 1 }, { id: 1 }] }) });
    await assert.rejects(fetchPublicCatalogPage('example.myshopify.com', 0), /Invalid product IDs/);
  } finally { global.fetch = original; }
});
