import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { productSafetyFingerprint } from '../lib/product-safety-coverage.js';
import { productPairCacheId, capturePairCacheInstallation, readPairMatchResults, writePairMatchResults, mergeSafetyResults } from '../lib/product-pair-cache.js';
import { createNoAlertsResult, buildSafetyCheckResult, parseAnalysisMatches } from '../lib/safety-gate-checker-results.js';
import { sourceFunction, database, Timestamp, FieldValue } from './helpers/isolated-source.mjs';
import { MONITORING_PRODUCT_FIELDS } from '../lib/monitoring-product-cache.js';
import { processMonitoringProducts } from '../lib/monitoring-work.js';

const shop = 'coverage.myshopify.com', root = `merchants/${shop}`;
const product = { shop, productId: '1', sourceUpdatedAt: '2026-11-03T10:00:00Z', name: 'Toy', category: 'toys', description: 'Toy description', barcodes: [] };
const result = () => createNoAlertsResult(0);
function fixture() {
  const db = database();
  db.rows.set(root, { createdAt: Timestamp.fromMillis(1) });
  db.rows.set(`${root}/products/1`, { ...product });
  const check = sourceFunction('product-safety-coverage', 'withProductSafetyCoverage', {
    Timestamp, FieldValue, randomUUID, productSafetyFingerprint, Buffer,
  });
  return { db, check: (input, work) => check(db, input, work), coverage: () => db.rows.get(`${root}/product_safety_coverage/1`) };
}

test('a completed unchanged product reuses durable current-state coverage, including a negative result', async () => {
  const { db, check, coverage } = fixture(); let calls = 0;
  const work = async () => { calls++; return result(); };
  await check(product, work); await check(product, work);
  assert.equal(calls, 1);
  assert.equal(coverage().fingerprint, productSafetyFingerprint(product));
  assert.ok(db.rows.get(`${root}/products/1`).safetyCoverage.coveredThrough instanceof Timestamp);
  assert.equal(coverage().expireAt, undefined);
});

test('an older matcher policy is refreshed on an explicit check without deleting baseline or decisions', async () => {
  const { db, check, coverage } = fixture();
  await check(product,async()=>result());
  coverage().matcherPolicy = -1;
  db.rows.get(root).monitoringBaselineAt = Timestamp.fromMillis(10);
  db.rows.set(`${root}/alerts/reviewed`,{status:'dismissed',notes:'Owner decision'});
  let calls=0; await check(product,async()=>{calls++;return result();});
  assert.equal(calls,1);
  assert.equal(db.rows.get(root).monitoringBaselineAt.toMillis(),10);
  assert.equal(db.rows.get(`${root}/alerts/reviewed`).notes,'Owner decision');
  await check(product,async()=>{throw Error('must reuse current policy');});
});

test('changes committed during a full check remain eligible, instead of being hidden by completion time', async () => {
  const { db, check, coverage } = fixture(); let calls = 0;
  await check(product, async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    db.rows.set('rapex_changes/new', { changedAt: Timestamp.now(), alertId: 'new' });
    return result();
  });
  assert.ok(db.rows.get('rapex_changes/new').changedAt > coverage().coveredThrough);
  await check(product, async () => { calls++; return result(); });
  assert.equal(calls, 2);
  // Changes older than the captured point do not invalidate the completed check.
  db.rows.set('rapex_changes/old', { changedAt: Timestamp.fromMillis(1), alertId: 'old' });
  await check(product, async () => { throw Error('must reuse coverage'); });
});

test('failed checks never publish completed coverage and can be retried', async () => {
  const { check, coverage } = fixture();
  await assert.rejects(check(product, async () => { throw Error('provider unavailable'); }), /provider unavailable/);
  assert.equal(coverage().resultJson, undefined);
  assert.equal(coverage().lease, undefined);
  await check(product, async () => result());
  assert.ok(coverage().resultJson);
});

test('concurrent checks have one model owner, and a changed product version invalidates coverage', async () => {
  const { db, check } = fixture(); let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = check(product, async () => { started(); await new Promise(resolve => { release = resolve; }); return result(); });
  await ready;
  await assert.rejects(check(product, async () => { throw Error('duplicate model call'); }), /already processing/);
  release(); await pending;
  const next = { ...product, name: 'Changed toy', sourceUpdatedAt: '2026-11-03T11:00:00Z' };
  db.rows.set(`${root}/products/1`, next);
  let calls = 0; await check(next, async () => { calls++; return result(); });
  assert.equal(calls, 1);
});

test('deletion or installation removal during matching cannot publish a successful result or recreate the tenant', async () => {
  for (const purge of [false, true]) {
    const { db, check, coverage } = fixture();
    await assert.rejects(check(product, async () => {
      if (purge) db.rows.clear(); else db.rows.get(`${root}/products/1`).deletedAt = Timestamp.now();
      return result();
    }), /changed during safety check/);
    if (purge) assert.equal(db.rows.size, 0);
    else assert.equal(coverage().resultJson, undefined);
  }
});

const alert = id => ({ id, meta: { recordid: id, record_timestamp: 'old' }, fields: { name: `Toy ${id}`, pictures: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] } });
test('pair cache ignores batch composition, technical revisions and image priority but invalidates actual facts', () => {
  const a = alert('A');
  const id = productPairCacheId(product, a);
  assert.equal(id, productPairCacheId(product, { ...a, meta: { record_timestamp: 'new' }, fields: { ...a.fields, pictures: [...a.fields.pictures].reverse() } }));
  assert.notEqual(id, productPairCacheId(product, { ...a, fields: { ...a.fields, brand: 'Different' } }));
  assert.notEqual(id, productPairCacheId({ ...product, productId: '2' }, a));
});

test('positive and negative pair outcomes persist separately, without TTL and with tenant/version fences', async () => {
  const { db } = fixture(); const a = alert('A'), b = alert('B');
  const installation = await capturePairCacheInstallation(db, product);
  const full = { ...result(), isSafe: false, warnings: [{ alertId: 'B', overallSimilarity: 80 }] };
  await writePairMatchResults(db, product, [a, b], full, installation);
  const hits = await readPairMatchResults(db, product, [b, a], installation);
  assert.equal(hits[0].result.isSafe, false); assert.equal(hits[1].result.isSafe, true);
  assert.equal(mergeSafetyResults(hits.map(hit => hit.result), 2).isSafe, false);
  assert.ok([...db.rows.entries()].filter(([path]) => path.includes('/product_match_results/')).every(([, row]) => !row.expireAt));
  db.rows.get(root).createdAt = Timestamp.fromMillis(2);
  await assert.rejects(writePairMatchResults(db, product, [a], result(), installation), /installation changed/);
  assert.deepEqual(await readPairMatchResults(db, product, [a], '2'), []);
});

test('regrouping previously checked candidates invokes the model only for the new pair', async () => {
  const cached = new Map(), calls = [];
  let check;
  check = sourceFunction('safety-gate-checker', 'checkProductAgainstAlerts', {
    db: {}, getProductImageUrls: () => [], prepareImageMedia: async () => null,
    capturePairCacheInstallation: async () => '1', readCachedMatchResult: async () => null,
    readPairMatchResults: async (_db, _product, alerts) => alerts.filter(a => cached.has(a.id)).map(a => ({ alertId: a.id, result: cached.get(a.id) })),
    writePairMatchResults: async (_db, _product, alerts, value) => { for (const a of alerts) cached.set(a.id, value); },
    writeCachedMatchResult: async () => {}, buildComparisonPrompt: () => '',
    analyzeProductMatches: async (_product, alerts) => { calls.push(alerts.map(a => a.id)); return { response: { text: '[]' }, analysis: result().analysis }; },
    parseAnalysisMatches, buildSafetyCheckResult, mergeSafetyResults,
    checkProductAgainstAlerts: (...args) => check(...args),
  });
  await check(product, [alert('A'), alert('B')]);
  await check(product, [alert('B'), alert('C')]);
  assert.deepEqual(calls, [['A', 'B'], ['C']]);
});

test('first audit checks a bounded product page against the global index once, and retry reuses coverage', async () => {
  const { db, check } = fixture();
  for (const id of ['2', '3', '4', '5']) db.rows.set(`${root}/products/${id}`, { ...product, productId: id });
  let modelCalls = 0;
  const page = sourceFunction('merchant-monitoring', 'runMerchantCatalogProductPage', {
    db, FieldValue, Timestamp, FieldPath: { documentId: () => '__name__' }, MONITORING_PRODUCT_FIELDS, processMonitoringProducts,
    FIRESTORE_COLLECTIONS: { merchants: 'merchants', subProducts: 'products', subChecks: 'checks' },
    toProductInput: value => value, checkProductSafety: input => check(input, async () => { modelCalls++; return result(); }),
    monitoringTaskId: (_shop, key) => key.replaceAll(':', '_'), AI_CONFIG: { checkHistoryTtlDays: 90 },
  });
  const first = await page(shop, 'audit', null);
  assert.equal(first.productsScanned, 4); assert.equal(first.hasMore, true); assert.equal(first.lastProductId, '4');
  await page(shop, 'audit', null);
  assert.equal(modelCalls, 4);
  assert.equal([...db.rows.keys()].filter(path => path.includes('/checks/')).length, 4);
});

test('only a completed initial audit publishes the original baseline and clears an obsolete change cursor', async () => {
  const { db } = fixture();
  Object.assign(db.rows.get(root), { initialScanRunId: 'audit', lastRapexChangeAt: Timestamp.fromMillis(5), lastRapexChangeId: 'old' });
  const run = db.doc(`${root}/initial_catalog_runs/audit`), baselineAt = Timestamp.fromMillis(1000);
  db.rows.set(run.path, { baselineAt });
  const complete = sourceFunction('merchant-catalog-audit', 'completeAudit', {
    db, FieldValue, Timestamp, merchantRef: () => db.doc(root), FIRESTORE_COLLECTIONS: { subActivityLogs: 'activity_logs' },
  });
  await complete(shop, run);
  assert.equal(db.rows.get(root).monitoringBaselineAt, baselineAt);
  assert.equal(db.rows.get(root).lastRapexChangeId, undefined);
  assert.equal(db.rows.get(root).initialScanStatus, 'completed');
  assert.equal(db.rows.get(run.path).status, 'completed');
});
