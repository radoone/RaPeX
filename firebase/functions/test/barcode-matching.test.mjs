import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { alertGtins, findBarcodeMatches, normalizeProductBarcodes, productGtins } from '../lib/product-barcodes.js';
import { completeShopifyBarcodes } from '../lib/shopify-variant-barcodes.js';
import { buildSafetyCheckResult, createNoAlertsResult } from '../lib/safety-gate-checker-results.js';
import { createMonitoringProductCache, MONITORING_PRODUCT_FIELDS } from '../lib/monitoring-product-cache.js';
import { recallWithinThreshold } from '../lib/vector-recall.js';
import { canApplyProductVersion, installationKey } from '../lib/product-lifecycle.js';
import { sourceFunction as fn, database, collections, FieldValue } from './helpers/isolated-source.mjs';

const product = { name: 'Renamed product', category: 'general', description: 'Different text', barcodes: [
  { barcode: '036000291452', variantId: 'v1', variantTitle: 'Blue' },
  { barcode: '0036000291452', variantId: 'v2', variantTitle: 'Red' },
] };
const alert = { id: 'A', meta: { recordid: 'A', alert_date: '', ingested_at: '' }, fields: { barcode: 'EAN: 00036000291452', level: 'High', batchNumber: 'affected-batch' } };
const analysis = { mode: 'text-only', scoringMode: 'text-only', productImagesProvided: 0, productImagesUsed: 0, alertImagesUsed: 0, candidateAlertsConsidered: 1 };

test('equivalent UPC/EAN representations retain every affected variant but never infer codes from SKUs', () => {
  assert.deepEqual(productGtins(product.barcodes), ['00036000291452']);
  const matches = findBarcodeMatches([...product.barcodes, product.barcodes[0]], alert.fields);
  assert.deepEqual(matches.map(m => m.variantId), ['v1', 'v2']);
  assert.equal(matches[0].alertBarcode, '00036000291452');
  assert.deepEqual(normalizeProductBarcodes([{ barcode: '4006381333932' }, { sku: '036000291452' }, { barcode: 36000291452 }]), []);
  assert.deepEqual(findBarcodeMatches(product.barcodes, { barcode: '036000291453' }), []);
  assert.deepEqual(findBarcodeMatches(product.barcodes, { barcode: '4006381333931' }), []);
  assert.deepEqual(alertGtins({ product_barcode: '4006381333931' }), ['04006381333931']);
});

function checker(extra = {}) {
  let check;
  check = fn('safety-gate-checker', 'checkProductAgainstAlerts', {
    getProductImageUrls: () => [], prepareImageMedia: async () => null,
    buildSafetyCheckResult, createNoAlertsResult,
    readCachedMatchResult: async () => { throw Error('Unexpected model/cache work'); },
    checkProductAgainstAlerts: (...args) => check(...args), ...extra,
  });
  return check;
}

test('a validated exact code produces variant evidence without Gemini or invented visual scores', async () => {
  const result = await checker()(product, [alert]);
  assert.equal(result.isSafe, false);
  assert.equal(result.warnings.length, 1);
  const warning = result.warnings[0];
  assert.equal(warning.matchBasis, 'gtin');
  assert.equal(warning.identityAssessment, 'identifier');
  assert.equal(warning.identifierMatches.length, 2);
  assert.equal(warning.alertDetails.fields.batchNumber, 'affected-batch');
  for (const key of ['imageSimilarity', 'textSimilarity', 'scoreBreakdown']) assert.equal(Object.hasOwn(warning, key), false);
  assert.match(warning.reason, /does not confirm recall applicability/);
});

test('exact matches coexist with similarity matches, and an incomplete similarity check still fails', async () => {
  const other = { ...alert, id: 'B', meta: { ...alert.meta, recordid: 'B' }, fields: { name: 'similar' } };
  const result = await checker({ readCachedMatchResult: async () => ({ ...createNoAlertsResult(0), warnings: [{ alertId: 'B', overallSimilarity: 90, matchBasis: 'similarity' }] }) })(product, [alert, other]);
  assert.deepEqual(result.warnings.map(w => w.alertId), ['A', 'B']);
  assert.equal(result.analysis.candidateAlertsConsidered, 2);
  await assert.rejects(checker()(product, [alert, other]), /Unexpected model/);
});

test('exact GTIN evidence is first and survives conflicting text models without visual measurements', async () => {
  const result = await checker()({ ...product, model: 'OTHER-MODEL' }, [{ ...alert, fields: { ...alert.fields, type_numberOfModel: 'RECALLED-MODEL' } }]);
  assert.equal(result.warnings[0].matchBasis, 'gtin');
  assert.equal(result.warnings[0].identityAssessment, 'identifier');
  assert.equal(result.warnings[0].imageSimilarity, undefined);
});

test('manual retrieval retains exact candidates outside the cached vector shortlist', async () => {
  const exact = { ...alert, fields: { ...alert.fields, category: 'Other' } };
  const order = [];
  const retrieve = fn('safety-gate-checker-retrieval', 'retrieveAlertsWithRag', {
    retrieveAlertsByGtins: async () => { order.push('gtin'); return [exact]; },
    retrieveAlertsFromCachedVectors: async () => { order.push('vectors'); return [exact, { ...alert, id: 'B' }]; }, hydrateAlertsIfMissing: async x => x,
  });
  assert.deepEqual((await retrieve(product)).map(a => a.id), ['A', 'B']);
  assert.deepEqual(order, ['gtin', 'vectors']);
});

test('indexed barcode retrieval paginates all source matches', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({ id: String(i), data: () => ({ fields: alert.fields, meta: { recordid: String(i) } }) }));
  let queries = 0;
  const query = (after = 0) => ({
    where: (key, op, codes) => { assert.equal(key, 'gtins'); assert.equal(op, 'array-contains-any'); assert.deepEqual(codes, ['00036000291452']); queries++; return query(); },
    orderBy: () => query(after), limit: () => query(after), startAfter: doc => query(Number(doc.id) + 1),
    get: async () => { const docs = rows.slice(after, after + 200); return { docs, empty: !docs.length, size: docs.length }; },
  });
  const retrieve = fn('safety-gate-checker-retrieval', 'retrieveAlertsByGtins', {
    FieldPath: { documentId: () => '__name__' }, getFirestore: () => ({ collection: () => query() }),
    FIRESTORE_COLLECTIONS: collections, normalizeRetrieverDocument: doc => ({ ...doc.metadata, id: doc.metadata.id }),
  });
  assert.equal((await retrieve(product)).length, 201);
  assert.equal(queries, 1);
  assert.deepEqual(await retrieve({ barcodes: [{ barcode: 'bad' }] }), []);
});

test('delta monitoring finds exact products outside vector thresholds, within the current tenant only', async () => {
  const db = database(), shop = 'a.myshopify.com';
  const live = { productId: '1', barcodes: product.barcodes, gtins: productGtins(product.barcodes) };
  db.rows.set(`merchants/${shop}/products/1`, live);
  db.rows.set(`merchants/${shop}/products/2`, { ...live, deletedAt: true });
  db.rows.set('merchants/b.myshopify.com/products/3', live);
  const collection = db.collection.bind(db);
  db.collection = name => {
    const root = collection(name), doc = root.doc.bind(root);
    return { ...root, doc: id => {
      const ref = doc(id), child = ref.collection.bind(ref);
      return { ...ref, collection: path => ({ ...child(path), select: () => ({ findNearest: () => ({ get: async () => ({ docs: [] }) }) }) }) };
    } };
  };
  const find = fn('merchant-monitoring', 'findCandidateProductsForAlert', {
    db, FIRESTORE_COLLECTIONS: collections, createMonitoringProductLoader: fn('merchant-monitoring', 'createMonitoringProductLoader', { db, FIRESTORE_COLLECTIONS: collections, createMonitoringProductCache, MONITORING_PRODUCT_FIELDS }), FieldPath: { documentId: () => '__name__' }, recallWithinThreshold,
    MONITOR_TEXT_CANDIDATE_LIMIT: 8, MONITOR_IMAGE_CANDIDATE_LIMIT: 5,
    MATCHING_THRESHOLDS: { textDistance: .38, imageDistance: .35 },
  });
  assert.deepEqual((await find(shop, { alert, textVector: [1] })).map(p => p.id), ['1']);
});

test('all Shopify variant pages are consumed; changed versions, missing cursors and API errors cannot report completion', async () => {
  const product = { id: 'gid://shopify/Product/1', updatedAt: 'version-1', variants: { nodes: [{ id: 'v1', barcode: '036000291452' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } };
  let calls = 0;
  const load = async (_query, variables) => {
    calls++; assert.equal(variables.after, 'next');
    return { data: { product: { updatedAt: 'version-1', variants: { nodes: [{ id: 'v251', barcode: '4006381333931' }], pageInfo: { hasNextPage: false } } } } };
  };
  assert.deepEqual((await completeShopifyBarcodes(product, load)).map(x => x.variantId), ['v1', 'v251']);
  assert.equal(calls, 1);
  await assert.rejects(completeShopifyBarcodes(product, async () => ({ errors: [{}] })), /Could not load/);
  await assert.rejects(completeShopifyBarcodes(product, async () => ({ data: { product: { updatedAt: 'version-2', variants: {} } } })), /changed/);
  await assert.rejects(completeShopifyBarcodes({ ...product, variants: { nodes: [], pageInfo: { hasNextPage: true } } }, load), /cursor/);
  await assert.rejects(completeShopifyBarcodes({ ...product, variants: undefined }, load), /did not return/);
});

test('barcode-only changes invalidate AI cache fingerprints and source signatures', () => {
  const hashValue = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const fingerprint = fn('safety-gate-checker', 'buildProductFingerprint', { hashValue });
  assert.notEqual(fingerprint(product), fingerprint({ ...product, barcodes: [] }));
  const signature = fn('safety-gate-checker', 'buildAlertSignature', { hashValue, normalizePictures: () => [] });
  assert.notEqual(signature([alert]), signature([{ ...alert, fields: { barcode: '4006381333931' } }]));
});

test('HTTP ingestion preserves variant barcodes instead of stripping exact identifiers', () => {
  const coerceString = value => typeof value === 'string' ? value : undefined;
  const read = fn('safety-gate-http', 'readProductData', { coerceString, coerceStringArray: () => undefined,
    MAX_NAME_CHARS: 300, MAX_CATEGORY_CHARS: 120, MAX_DESCRIPTION_CHARS: 4000, MAX_URL_CHARS: 2048, MAX_BRAND_MODEL_CHARS: 200 });
  assert.deepEqual(read({ method: 'POST', body: product }).barcodes, product.barcodes);
});

test('cached embeddings are reused while barcode-only refreshes update and clear the merchant index', async () => {
  const db = database(), shop = 'a.myshopify.com', path = `merchants/${shop}/products/1`, version = '2026-11-02T10:00:00Z';
  db.rows.set(`merchants/${shop}`, {});
  db.rows.set(path, { sourceUpdatedAt: version, embeddingVersion: 2, vector_text: FieldValue.vector([1]) });
  const upsert = fn('merchant-monitoring', 'upsertMerchantProduct', {
    db, FIRESTORE_COLLECTIONS: collections, FieldValue, canApplyProductVersion, installationKey,
    buildEmbeddingText: () => 'text', asVectorArray: v => v?.toArray(),
    embedText: async () => { throw Error('Must reuse embeddings'); }, embedImage: async () => undefined,
  });
  const input = { shop, productId: '1', productTitle: 'Product', sourceUpdatedAt: version, product };
  await upsert(input);
  assert.deepEqual(db.rows.get(path).gtins, ['00036000291452']);
  await upsert({ ...input, product: { ...product, barcodes: [] } });
  assert.deepEqual(db.rows.get(path).gtins, []);
  assert.deepEqual(db.rows.get(path).barcodes, []);
  assert.deepEqual(db.rows.get(path).vector_text.toArray(), [1]);
});

test('variant import respects Shopify throttling and fails after a bounded retry budget', async () => {
  let calls = 0;
  const waits = [];
  const request = fn('merchant-catalog-audit', 'requestShopifyBarcodes', {
    fetch: async () => ({ ok: true, status: 200, json: async () => ++calls === 1
      ? { errors: [{ extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 250, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } } } }
      : { data: { product: {} } } }),
    setTimeout: (resolve, delay) => { waits.push(delay); resolve(); },
  });
  assert.deepEqual(await request('example.myshopify.com', 'test-only', 'query', {}), { data: { product: {} } });
  assert.equal(calls, 2);
  assert.ok(waits[0] >= 5000);
  calls = 0;
  const failing = fn('merchant-catalog-audit', 'requestShopifyBarcodes', {
    fetch: async () => { calls++; return { ok: false, status: 429 }; }, setTimeout: resolve => resolve(),
  });
  await assert.rejects(failing('example.myshopify.com', 'test-only', 'query', {}), /remain throttled/);
  assert.equal(calls, 6);
});
