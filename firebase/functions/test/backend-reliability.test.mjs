import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createUnavailableAnalysisResult, parseAnalysisMatches, buildSafetyCheckResult } from '../lib/safety-gate-checker-results.js';
import { recallWithinThreshold } from '../lib/vector-recall.js';
import { canApplyProductVersion, installationKey, isProductChangeSupersededByDeletion } from '../lib/product-lifecycle.js';
import { sourceFunction as fn, database, Timestamp, FieldValue, collections, logger } from './helpers/isolated-source.mjs';

const analysis = { mode: 'text-only', scoringMode: 'text-only', productImagesProvided: 0, productImagesUsed: 0, alertImagesUsed: 0, candidateAlertsConsidered: 1 };
const shop = 'example.myshopify.com', merchantPath = `merchants/${shop}`, productPath = `${merchantPath}/products/1`;
function fixture() {
  const db = database();
  db.rows.set(merchantPath, { shop, createdAt: Timestamp.fromMillis(1), subscriptionStatus: 'active', monitoringEntitled: true, subscriptionValidUntil: Timestamp.fromMillis(Date.now() + 3600000) });
  db.rows.set(productPath, { productId: '1', name: 'Example', sourceUpdatedAt: '2026-10-23T10:00:00Z', vector_text: FieldValue.vector([.1]) });
  return db;
}
const deps = db => ({ db, logger, FieldValue, Timestamp, FIRESTORE_COLLECTIONS: collections, createHash, installationKey, canApplyProductVersion });
const writer = (db, embedText = async () => [.2]) => fn('merchant-monitoring', 'upsertMerchantProduct', {
  ...deps(db), buildEmbeddingText: () => 'changed product', asVectorArray: value => value?.toArray(), embedText, embedImage: async () => undefined,
});
const input = { shop, productId: '1', productTitle: 'Changed', sourceUpdatedAt: '2026-10-23T10:01:00Z', product: { name: 'Changed', category: 'toys', description: 'Changed' } };

test('model unavailability and malformed output fail closed; a valid empty list remains valid', () => {
  assert.throws(() => createUnavailableAnalysisResult(analysis), /unavailable/);
  for (const text of ['broken', 'null', 'false', '[{}]', '[{"alertId":"A","overallSimilarity":"90"}]']) assert.throws(() => parseAnalysisMatches({ text }), /Invalid/);
  assert.deepEqual(parseAnalysisMatches({ text: '[]' }), []);
  assert.deepEqual(parseAnalysisMatches({ output: [], text: '' }), []);
  assert.throws(() => buildSafetyCheckResult([{ alertId: 'invented', overallSimilarity: 90 }], [], analysis), /unknown candidate/);
});

test('13 eligible alerts are all evaluated in batches no larger than 12', async () => {
  const sizes = [];
  let checker;
  checker = fn('safety-gate-checker', 'checkProductAgainstAlerts', {
    getProductImageUrls: () => [], prepareImageMedia: async () => null, readCachedMatchResult: async () => null,
    buildComparisonPrompt: (_p, alerts) => { sizes.push(alerts.length); return ''; },
    analyzeProductMatches: async () => ({ response: { text: '[]' }, analysis }),
    parseAnalysisMatches, buildSafetyCheckResult, writeCachedMatchResult: async () => {}, createUnavailableAnalysisResult,
    checkProductAgainstAlerts: (...args) => checker(...args),
  });
  const result = await checker(input.product, Array.from({ length: 13 }, (_, i) => ({ id: String(i) })));
  assert.deepEqual(sizes, [12, 1]);
  assert.equal(result.analysis.candidateAlertsConsidered, 13);
});

test('KNN expands past small caps and refuses success when the 1000 row boundary is saturated', async () => {
  const rows = Array.from({ length: 17 }, (_, i) => ({ distance: i < 16 ? .1 : .9 }));
  const limits = [];
  const result = await recallWithinThreshold({ initialLimit: 8, maxDistance: .38, fetch: async limit => { limits.push(limit); return rows.slice(0, limit); }, distance: row => row.distance });
  assert.equal(result.length, 16); assert.deepEqual(limits, [8, 32]);
  await assert.rejects(recallWithinThreshold({ initialLimit: 8, maxDistance: .38, fetch: async limit => Array.from({ length: limit }, () => .1), distance: n => n }), /saturated/);
});

test('missing vector indexes throw and deleted products never become candidates', async () => {
  const db = fixture();
  const finder = fn('merchant-monitoring', 'findCandidateProductsForAlert', { ...deps(db), recallWithinThreshold, MONITOR_TEXT_CANDIDATE_LIMIT: 8, MONITOR_IMAGE_CANDIDATE_LIMIT: 5, MATCHING_THRESHOLDS: { textDistance: .38, imageDistance: .35 } });
  db.indexFailure = true;
  await assert.rejects(finder(shop, { alert: { id: 'A' }, textVector: [1] }), /Missing vector index/);
  db.indexFailure = false; db.rows.get(productPath).deletedAt = Timestamp.now();
  assert.deepEqual(await finder(shop, { alert: { id: 'A' }, textVector: [1] }), []);
});

test('concurrent repeats create one finding; a new source creates another and preserves decisions', async () => {
  const db = fixture(), upsert = fn('merchant-monitoring', 'upsertAlertForProduct', deps(db));
  const params = { shop, productId: '1', productTitle: 'Example', resultJson: JSON.stringify({ warnings: [{ alertId: 'A', overallSimilarity: 90 }] }), riskLevel: 'Serious' };
  await Promise.all([upsert(params), upsert(params)]);
  let findings = [...db.rows.entries()].filter(([key]) => key.includes('/alerts/'));
  assert.equal(findings.length, 1);
  findings[0][1].status = 'dismissed'; findings[0][1].notes = 'Supplier evidence';
  await upsert(params);
  await upsert({ ...params, resultJson: JSON.stringify({ warnings: [{ alertId: 'B', overallSimilarity: 95 }] }) });
  findings = [...db.rows.values()].filter(row => row.checkResult);
  assert.equal(findings.length, 2);
  assert.equal(findings.find(row => row.sourceAlertId === 'A').status, 'dismissed');
  assert.equal(findings.find(row => row.sourceAlertId === 'A').notes, 'Supplier evidence');
  assert.equal(findings.find(row => row.sourceAlertId === 'B').status, 'active');
});

test('legacy reviewed evidence is preserved without creating a duplicate finding', async () => {
  const db = fixture();
  db.rows.set(`${merchantPath}/alerts/legacy`, { productId: '1', status: 'resolved', checkResult: JSON.stringify({ warnings: [{ alertId: 'A' }] }) });
  const upsert = fn('merchant-monitoring', 'upsertAlertForProduct', deps(db));
  await upsert({ shop, productId: '1', productTitle: 'Example', resultJson: JSON.stringify({ warnings: [{ alertId: 'A' }, { alertId: 'B' }] }), riskLevel: 'Serious' });
  assert.equal([...db.rows.values()].filter(row => row.checkResult).length, 2);
  assert.equal(db.rows.get(`${merchantPath}/alerts/legacy`).status, 'resolved');
});

test('failed embeddings never advance the source version and retry on the next call', async () => {
  const db = fixture(); let attempts = 0;
  const upsert = writer(db, async () => { attempts++; return undefined; });
  await assert.rejects(upsert(input), /embedding unavailable/);
  await assert.rejects(upsert(input), /embedding unavailable/);
  assert.equal(attempts, 2);
  assert.equal(db.rows.get(productPath).sourceUpdatedAt, '2026-10-23T10:00:00Z');
  assert.deepEqual(db.rows.get(productPath).vector_text.toArray(), [.1]);
});

test('a delete during embedding prevents a late product update and removes its image vector on a valid newer update', async () => {
  const db = fixture();
  await writer(db, async () => { db.rows.get(productPath).deletedAt = Timestamp.now(); db.rows.get(productPath).deletedSourceUpdatedAt = '2026-10-23T10:02:00Z'; return [.2]; })(input);
  assert.ok(db.rows.get(productPath).deletedAt);
  assert.equal(db.rows.get(productPath).sourceUpdatedAt, '2026-10-23T10:00:00Z');
  db.rows.get(productPath).vector_image = FieldValue.vector([.3]);
  await writer(db)({ ...input, sourceUpdatedAt: '2026-10-23T10:03:00Z' });
  assert.equal(db.rows.get(productPath).vector_image, undefined);
});

function handler(db, checkProductSafety) {
  return fn('merchant-monitoring', 'handleShopifyProductChangeTask', {
    ...deps(db), AI_CONFIG: { checkHistoryTtlDays: 90 },
    productChangeJobId: payload => `${payload.operation || 'upsert'}-${payload.sourceUpdatedAt}`,
    productChangeJobRef: (_shop, id) => db.doc(`${merchantPath}/product_change_jobs/${id}`),
    currentEntitlement: fn('merchant-monitoring', 'currentEntitlement', { Timestamp }),
    isProductChangeSupersededByDeletion, upsertMerchantProduct: writer(db), checkProductSafety,
    upsertAlertForProduct: fn('merchant-monitoring', 'upsertAlertForProduct', deps(db)),
  });
}
test('delete during model analysis remains deleted and writes no successful late check', async () => {
  const db = fixture(); let task;
  task = handler(db, async () => {
    await task({ operation: 'delete', shop, productId: '1', sourceUpdatedAt: '2026-10-23T10:02:00Z' });
    assert.ok(db.rows.get(productPath).deletedAt);
    return { isSafe: true, warnings: [], checkedAt: new Date().toISOString() };
  });
  await task({ ...input });
  assert.ok(db.rows.get(productPath).deletedAt);
  assert.equal(db.rows.get(productPath).vector_text, undefined);
  assert.equal([...db.rows.keys()].filter(key => key.includes('/checks/')).length, 0);
});

test('delete before first import creates a tombstone and blocks delayed updates', async () => {
  const db = fixture(); db.rows.delete(productPath);
  const task = handler(db, async () => { throw new Error('should not analyze'); });
  await task({ operation: 'delete', shop, productId: '1', sourceUpdatedAt: '2026-10-23T10:02:00Z' });
  await task(input);
  assert.ok(db.rows.get(productPath).deletedAt);
});

test('an in-flight product worker cannot recreate a purged tenant or its job', async () => {
  const db = fixture();
  const task = handler(db, async () => { db.rows.clear(); return { isSafe: true, warnings: [], checkedAt: new Date().toISOString() }; });
  await task(input);
  assert.equal(db.rows.size, 0);
});

function monitor(db, dateCandidates = [], check = async () => ({ isSafe: true, warnings: [], checkedAt: new Date().toISOString() })) {
  const normalize = fn('merchant-monitoring', 'normalizeAlertDate', { Timestamp });
  return fn('merchant-monitoring', 'runMerchantDeltaMonitoringForShop', {
    ...deps(db), getMonitorState: async () => db.rows.get(merchantPath), randomUUID: () => 'run',
    resolveMonitoringWindow: ({ currentState }) => ({ mode: 'delta', strategy: 'since-last-check', days: null, checkpointDate: normalize(currentState.lastRapexAlertDate) || new Date('2026-01-01'), checkpointRecordTimestamp: null }),
    loadRapexAlertCandidatesSince: async () => dateCandidates,
    findCandidateProductsForAlert: fn('merchant-monitoring', 'findCandidateProductsForAlert', { ...deps(db), recallWithinThreshold, MONITOR_TEXT_CANDIDATE_LIMIT: 8, MONITOR_IMAGE_CANDIDATE_LIMIT: 5, MATCHING_THRESHOLDS: { textDistance: .38, imageDistance: .35 } }),
    toProductInput: x => x, checkProductAgainstAlerts: check, normalizeAlertDate: normalize,
    normalizeRapexAlert: (id, data) => ({ id, ...data }), asVectorArray: x => x?.toArray(),
    AI_CONFIG: { checkHistoryTtlDays: 90 }, monitoringTaskId: (_shop, id) => `check-${id}`,
    coerceString: x => typeof x === 'string' ? x : undefined,
    upsertAlertForProduct: fn('merchant-monitoring', 'upsertAlertForProduct', deps(db)),
    monitoringRunRef: (_shop, id, collection = 'monitoring_runs') => db.doc(`${merchantPath}/${collection}/${id}`),
    FieldPath: { documentId: () => '__name__' },
  });
}
const candidate = i => ({ alert: { id: `A${i}`, meta: { alert_date: '2026-10-23T00:00:00Z', record_timestamp: String(i) } }, textVector: [1] });

test('missing index or AI failure cannot advance a monitoring checkpoint or write a successful check', async () => {
  for (const mode of ['index', 'model']) {
    const db = fixture(); db.indexFailure = mode === 'index';
    await assert.rejects(monitor(db, [candidate(1)], async () => { throw new Error('model unavailable'); })({ shop }));
    assert.equal(db.rows.get(merchantPath).lastMonitorStatus, 'FAILURE');
    assert.equal(db.rows.get(merchantPath).lastRapexAlertDocId, undefined);
    assert.equal([...db.rows.keys()].some(key => key.includes('/checks/')), false);
  }
});

test('monitoring passes every eligible candidate and keeps the page incomplete at its boundary', async () => {
  const db = fixture(); let evaluated = 0;
  const summary = await monitor(db, Array.from({ length: 13 }, (_, i) => candidate(i)), async (_p, alerts) => { evaluated += alerts.length; return { isSafe: true, warnings: [], checkedAt: new Date().toISOString() }; })({ shop, limit: 13 });
  assert.equal(evaluated, 13); assert.equal(summary.hasMore, true);
  assert.equal(db.rows.get(merchantPath).lastMonitorStatus, 'IN_PROGRESS');
});

test('history/windowed audits keep their checkpoint separate from daily monitoring', async () => {
  const db = fixture(), oldCheckpoint = Timestamp.fromDate(new Date('2026-10-20T00:00:00Z'));
  db.rows.get(merchantPath).lastRapexAlertDate = oldCheckpoint;
  await monitor(db, [candidate(1)])({ shop, checkpointScope: 'catalog-test' });
  assert.equal(db.rows.get(merchantPath).lastRapexAlertDate, oldCheckpoint);
  assert.equal(db.rows.get(`${merchantPath}/monitor_checkpoints/catalog-test`).lastRapexAlertDocId, 'A1');
});

test('corrections to old publications are monitored through the change journal', async () => {
  const db = fixture(); let evaluated = 0;
  db.rows.set('rapex_changes/2026-10-23_revision-A', { alertId: 'old-A', changedAt: Timestamp.now() });
  db.rows.set('rapex_alerts/old-A', { meta: { alert_date: '2020-01-01T00:00:00Z', record_timestamp: '2026-10-23T00:00:00Z' }, fields: {}, vector_text: FieldValue.vector([1]) });
  await monitor(db, [], async (_p, alerts) => { evaluated += alerts.length; return { isSafe: true, warnings: [], checkedAt: new Date().toISOString() }; })({ shop });
  assert.equal(evaluated, 1);
  assert.equal(db.rows.get(merchantPath).lastRapexChangeId, '2026-10-23_revision-A');
  assert.equal(db.rows.get(merchantPath).lastRapexAlertDocId, null);
});

test('changed Safety Gate facts re-embed and publish a revision; unchanged imports reuse vectors', async () => {
  const db = database(); let embeddings = 0;
  const ingest = fn('safety-gate-weekly-loader', 'ingestWeeklyNotification', {
    ...deps(db), parseReportDate: value => new Date(value),
    buildWeeklyAlertFields: data => ({ name: data.name, pictures: [] }),
    findExistingAlertDocId: async () => db.rows.has('rapex_alerts/A') ? 'A' : undefined,
    buildEmbeddingText: data => data.title, embedText: async () => { embeddings++; return [.2]; },
    embedImage: async () => undefined,
  });
  const notification = { caseNumber: 'A12', name: 'Original', reportDate: '2020-01-01', pictures: [] };
  const actualId = createHash('sha1').update('ec-safety-gate-A12').digest('hex');
  await ingest(notification);
  db.rows.set('rapex_alerts/A', db.rows.get(`rapex_alerts/${actualId}`));
  const unchanged = await ingest(notification);
  assert.equal(unchanged.updated, false); assert.equal(embeddings, 1);
  await ingest({ ...notification, name: 'Corrected model' });
  assert.equal(embeddings, 2);
  assert.equal(db.rows.get('rapex_alerts/A').fields.name, 'Corrected model');
  assert.ok([...db.rows.values()].some(row => row.alertId === 'A'));
});

test('imports require a live installation and cannot recreate a missing tenant', async () => {
  const db = fixture(); db.rows.clear();
  await assert.rejects(writer(db)(input), /missing or retired/);
  assert.equal(db.rows.size, 0);
});

test('retiring an installation fences an in-flight worker before recursive deletion', async () => {
  const db = fixture();
  await handler(db, async () => {
    db.rows.get(merchantPath).installationRetiredAt = Timestamp.now();
    return { isSafe: false, warnings: [{ alertId: 'A' }], checkedAt: new Date().toISOString() };
  })(input);
  assert.equal([...db.rows.keys()].some(key => key.includes('/checks/') || key.includes('/alerts/')), false);
});

test('global source retrieval keeps a bounded shortlist and propagates provider failures', async () => {
  let broken = false, calls = 0;
  const retrieve = fn('safety-gate-checker-retrieval', 'retrieveAlertsWithRag', {
    retrieveAlertsFromCachedVectors: async () => [], ensureTextRetriever: () => ({}), ensureImageRetriever: () => null,
    buildEmbeddingText: () => 'Specific model', RAG_TEXT_LIMIT: 12, RAG_IMAGE_LIMIT: 6,
    getProductImageUrls: () => [], MATCHING_THRESHOLDS: { textDistance: .38 },
    normalizeRetrieverDocument: doc => doc, hydrateAlertsIfMissing: async rows => rows,
    functionsAi: { retrieve: async ({ options }) => {
      calls++; if (broken) throw new Error('retrieval provider unavailable');
      return Array.from({ length: options.limit }, (_, id) => ({ id: String(id), distance: .1 }));
    } },
  });
  const rows = await retrieve(input.product);
  assert.equal(rows.length, 12); assert.equal(calls, 1);
  broken = true;
  await assert.rejects(retrieve(input.product), /provider unavailable/);
});

test('daily monitoring applies the merchant-root review threshold', async () => {
  const db = fixture(); db.rows.get(merchantPath).similarityThreshold = 90;
  const summary = await monitor(db, [candidate(1)], async () => ({ isSafe: false, warnings: [{ alertId: 'A1', overallSimilarity: 80 }], checkedAt: new Date().toISOString() }))({ shop });
  assert.equal(summary.matchesFound, 0);
  assert.equal([...db.rows.keys()].some(key => key.includes('/alerts/')), false);
});

test('a source photograph alone cannot produce a merchant-image similarity score', () => {
  const alert = { id: 'A', meta: { recordid: 'A', alert_date: '', ingested_at: '' }, fields: { name: 'Example', level: 'High' } };
  const result = buildSafetyCheckResult([{ alertId: 'A', textSimilarity: 90, imageSimilarity: 99 }], [alert], { ...analysis, mode: 'with-image', scoringMode: 'image-first', productImagesUsed: 0, alertImagesUsed: 1 });
  assert.equal(result.warnings[0].overallSimilarity, 90);
  assert.equal(result.warnings[0].imageSimilarity, undefined);
  assert.equal(result.warnings[0].scoreBreakdown.visualWeight, 0);
  assert.equal(result.analysis.scoringMode, 'text-only');
});

test('global retrieval preserves official evidence and source revisions for cache invalidation', () => {
  const normalize = fn('safety-gate-checker-retrieval', 'normalizeRetrieverDocument', { normalizeTimestamp: value => String(value || ''), normalizePictures: fields => fields.pictures || [] });
  const first = normalize({ metadata: { meta: { recordid: 'A', alert_date: '2020-01-01', record_timestamp: '2026-10-22' }, fields: { caseNumber: 'SR/12345/26', category: 'Toys', name: 'Example', type_numberOfModel: 'M1', url: 'https://ec.europa.eu/safety-gate-alerts/record/A' }, distance: .1 } });
  assert.equal(first.fields.caseNumber, 'SR/12345/26');
  assert.equal(first.fields.type_numberOfModel, 'M1');
  assert.equal(first.fields.url, 'https://ec.europa.eu/safety-gate-alerts/record/A');
  const signature = fn('safety-gate-checker', 'buildAlertSignature');
  assert.notEqual(signature([first]), signature([{ ...first, meta: { ...first.meta, record_timestamp: '2026-10-23' } }]));
});

test('monitoring progress cannot recreate an orphaned run after the tenant is purged', async () => {
  const db = fixture(), transact = db.runTransaction;
  let purged = false;
  db.runTransaction = async callback => {
    const result = await transact(callback);
    if (!purged && [...db.rows.keys()].some(key => key.includes('/checks/'))) { purged = true; db.rows.clear(); }
    return result;
  };
  await assert.rejects(monitor(db, [candidate(1)])({ shop, runId: 'purged-progress' }), /installation changed/);
  assert.equal(purged, true);
  assert.equal(db.rows.size, 0);
});
