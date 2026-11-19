import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PUBLIC_SCAN_TEXT_SPEC, verifiedPublicScanDomains, compatiblePublicScanVector, loadPublicScanOnboardingVectors } from '../lib/public-scan-onboarding-cache.js';
import { PUBLIC_SCAN_COVERAGE_POLICY } from '../lib/public-scan-coverage.js';
import { productSafetyFingerprint } from '../lib/product-safety-coverage.js';
import { SafetyCheckResultSchema } from '../lib/safety-gate-checker.schemas.js';
import { createNoAlertsResult } from '../lib/safety-gate-checker-results.js';
import { sourceFunction, database, Timestamp, FieldValue, collections, logger } from './helpers/isolated-source.mjs';

const shop = 'cache.myshopify.com', domain = 'example.sk', root = `merchants/${shop}`;
const vector = Array.from({ length: 1536 }, (_, i) => i === 0 ? 1 : 0);
const cached = () => ({ productId: '1', embeddingText: 'Exact text', vector_text: FieldValue.vector(vector), expireAt: Timestamp.fromMillis(Date.now() + 3600000), ...PUBLIC_SCAN_TEXT_SPEC });
const product = { shop, productId: '1', sourceUpdatedAt: '2026-11-03T10:00:00Z', name: 'Toy', category: 'toys', description: 'Description', barcodes: [] };

test('only authenticated canonical identity plus the returned primary domain authorize lead lookup', () => {
  assert.deepEqual(verifiedPublicScanDomains(shop, { myshopifyDomain: shop, primaryDomain: { host: domain } }), [shop, domain]);
  assert.deepEqual(verifiedPublicScanDomains(shop, { myshopifyDomain: shop, primaryDomain: { host: '../other/products' } }), [shop]);
  assert.throws(() => verifiedPublicScanDomains(shop, { myshopifyDomain: 'other.myshopify.com', primaryDomain: { host: domain } }), /identity/);
  assert.throws(() => verifiedPublicScanDomains(shop, undefined), /identity/);
});

test('exact text and a valid known model vector are required, including the frozen legacy cache contract', () => {
  assert.deepEqual(compatiblePublicScanVector(cached(), '1', 'Exact text'), vector);
  const legacy = cached(); delete legacy.embeddingModel; delete legacy.embeddingDimensions; delete legacy.embeddingInputVersion;
  assert.deepEqual(compatiblePublicScanVector(legacy, '1', 'Exact text'), vector);
  for (const patch of [
    { productId: '2' }, { embeddingText: 'Changed text' }, { embeddingModel: 'other' },
    { embeddingDimensions: 768 }, { embeddingInputVersion: 2 }, { expireAt: Timestamp.fromMillis(1) },
    { vector_text: [1] }, { vector_text: Array(1536).fill(0) }, { vector_text: Array(1536).fill(NaN) },
  ]) assert.equal(compatiblePublicScanVector({ ...cached(), ...patch }, '1', 'Exact text'), undefined);
});

test('batch lookup stays inside verified domains and skips incompatible canonical entries for a valid primary-domain hit', async () => {
  const db = database();
  db.rows.set(`rapex_leads/${shop}/products/1`, { ...cached(), embeddingText: 'Changed' });
  db.rows.set(`rapex_leads/${domain}/products/1`, cached());
  db.rows.set('rapex_leads/unverified.sk/products/2', { ...cached(), productId: '2' });
  const found = await loadPublicScanOnboardingVectors(db, [shop, domain], [{ productId: '1', text: 'Exact text' }, { productId: '2', text: 'Exact text' }]);
  assert.equal(found.size, 1); assert.equal(found.get('1').domain, domain);
});

test('image cache requires exact URL, model and valid dimensions', async () => {
  const db = database(), image = Array.from({ length: 1408 }, (_, i) => i === 0 ? 1 : 0);
  const row = { ...cached(), imageUrl: 'https://example.sk/1.jpg', imageEmbeddingModel: 'vertexai/multimodalembedding@001', vector_image: FieldValue.vector(image) };
  db.rows.set(`rapex_leads/${domain}/products/1`, row);
  const load = async url => (await loadPublicScanOnboardingVectors(db, [domain], [{ productId: '1', text: 'Exact text', image: url }])).get('1');
  assert.deepEqual((await load(row.imageUrl)).imageVector, image);
  assert.equal((await load('https://example.sk/changed.jpg')).imageVector, undefined);
  row.imageEmbeddingModel = 'other'; assert.equal((await load(row.imageUrl)).imageVector, undefined);
});

function coverageFixture() {
  const db = database();
  db.rows.set(root, { createdAt: Timestamp.fromMillis(1) });
  db.rows.set(`${root}/products/1`, { ...product, publicScanCacheDomains: [domain] });
  const portable = { ...cached(), safetyCoverage: { policy: PUBLIC_SCAN_COVERAGE_POLICY, fingerprint: productSafetyFingerprint(product),
    coveredThrough: Timestamp.fromMillis(Date.now() - 10000), resultJson: JSON.stringify(createNoAlertsResult(0)) } };
  const path = `rapex_leads/${domain}/products/1`;
  db.rows.set(path, portable);
  const check = sourceFunction('product-safety-coverage', 'withProductSafetyCoverage', {
    Timestamp, FieldValue, randomUUID, productSafetyFingerprint, PUBLIC_SCAN_COVERAGE_POLICY, SafetyCheckResultSchema, Buffer,
  });
  let calls = 0;
  return { db, portable, path, run: (input = product, supplement) => check(db, input, async () => { calls++; return createNoAlertsResult(0); }, supplement), calls: () => calls };
}

test('current full public coverage becomes installation-fenced merchant coverage without retrieval/model work', async () => {
  const f = coverageFixture(); await f.run(); await f.run();
  assert.equal(f.calls(), 0);
  const coverage = f.db.rows.get(`${root}/product_safety_coverage/1`);
  assert.equal(coverage.importedFromPublicScan, domain);
  assert.equal(coverage.coveredThrough, f.portable.safetyCoverage.coveredThrough);
  assert.ok(f.db.rows.get(`${root}/products/1`).safetyCoverage);
});

test('new source changes, policy/text/identifier differences, expiry and malformed results cannot be adopted', async () => {
  for (const change of [
    f => f.db.rows.set('rapex_changes/new', { changedAt: Timestamp.now() }),
    f => { f.portable.safetyCoverage.policy = 'old'; },
    f => { f.portable.safetyCoverage.fingerprint = 'different'; },
    f => { f.portable.expireAt = Timestamp.fromMillis(1); },
    f => { f.portable.safetyCoverage.resultJson = '{}'; },
    f => { f.portable.safetyCoverage.resultJson = '{broken'; },
    f => { delete f.db.rows.get(`${root}/products/1`).publicScanCacheDomains; },
  ]) {
    const f = coverageFixture(); change(f); await f.run(); assert.equal(f.calls(), 1);
    assert.equal(f.db.rows.get(`${root}/product_safety_coverage/1`).importedFromPublicScan, undefined);
  }
  const f = coverageFixture();
  await f.run({ ...product, barcodes: [{ barcode: '5901234123457' }] });
  assert.equal(f.calls(), 1);
});

test('deleted or retired merchant installations cannot adopt public coverage', async () => {
  for (const retire of [false, true]) {
    const f = coverageFixture();
    if (retire) f.db.rows.get(root).installationRetiredAt = Timestamp.now();
    else f.db.rows.get(`${root}/products/1`).deletedAt = Timestamp.now();
    await assert.rejects(f.run(), /unavailable|changed/);
    assert.equal(f.calls(), 0);
  }
});

test('Admin-only GTINs supplement a complete identifier-free public result without repeating vector/AI checks', async () => {
  const f = coverageFixture(); let identifierChecks = 0;
  Object.assign(f.portable.safetyCoverage, { identifierFree: true, similarityFingerprint: productSafetyFingerprint(product) });
  const enriched = { ...product, barcodes: [{ barcode: '5901234123457' }] };
  const output = await f.run(enriched, async base => { identifierChecks++; return base; });
  assert.equal(output.isSafe, true); assert.equal(f.calls(), 0); assert.equal(identifierChecks, 1);
  assert.equal(f.db.rows.get(`${root}/product_safety_coverage/1`).fingerprint, productSafetyFingerprint(enriched));
  await f.run(enriched, async () => { throw Error('duplicate identifier check'); });
});

test('failed identifier supplementation leaves no completed coverage and a retry can recover', async () => {
  const f = coverageFixture();
  Object.assign(f.portable.safetyCoverage, { identifierFree: true, similarityFingerprint: productSafetyFingerprint(product) });
  const enriched = { ...product, barcodes: [{ barcode: '5901234123457' }] };
  await assert.rejects(f.run(enriched, async () => { throw Error('GTIN lookup unavailable'); }), /unavailable/);
  const row = f.db.rows.get(`${root}/product_safety_coverage/1`);
  assert.equal(row.resultJson, undefined); assert.equal(row.lease, undefined);
  await f.run(enriched, async base => base);
  assert.equal(f.calls(), 0);
});

test('onboarding reuses public text vectors while still generating merchant image vectors and making no coverage claim', async () => {
  const db = database(); db.rows.set(root, { createdAt: Timestamp.fromMillis(1) });
  let textCalls = 0, imageCalls = 0;
  const upsert = sourceFunction('merchant-monitoring', 'upsertMerchantProductsBatch', {
    db, FieldValue, logger, FIRESTORE_COLLECTIONS: collections,
    buildEmbeddingText: () => 'Exact text', asVectorArray: v => v?.toArray(),
    loadPublicScanOnboardingVectors: async () => new Map([['1', { vector, domain }]]),
    embedTexts: async texts => { textCalls += texts.length; return texts.map(() => vector); },
    embedImage: async () => { imageCalls++; return [1]; },
  });
  const stats = await upsert([{ shop, productId: '1', productTitle: 'Toy', sourceUpdatedAt: product.sourceUpdatedAt, product: { ...product, imageUrl: 'https://example.sk/toy.jpg' } }], [domain]);
  assert.equal(textCalls, 0); assert.equal(imageCalls, 1);
  assert.equal(stats.publicTextVectorsReused, 1); assert.equal(stats.embedded, 0);
  assert.equal(db.rows.get(`${root}/products/1`).safetyCoverage, undefined);
  assert.deepEqual(db.rows.get(`${root}/products/1`).publicScanCacheDomains, [domain]);
});

test('public cache read failure falls back to batched embedding and never marks a safety check completed', async () => {
  const db = database(); db.rows.set(root, { createdAt: Timestamp.fromMillis(1) });
  let textCalls = 0;
  const upsert = sourceFunction('merchant-monitoring', 'upsertMerchantProductsBatch', {
    db, FieldValue, logger, FIRESTORE_COLLECTIONS: collections, buildEmbeddingText: () => 'Exact text', asVectorArray: v => v?.toArray(),
    loadPublicScanOnboardingVectors: async () => { throw Error('offline'); },
    embedTexts: async texts => { textCalls += texts.length; return texts.map(() => vector); }, embedImage: async () => undefined,
  });
  const stats = await upsert([{ shop, productId: '1', productTitle: 'Toy', sourceUpdatedAt: product.sourceUpdatedAt, product }], [domain]);
  assert.equal(textCalls, 1); assert.equal(stats.embedded, 1); assert.equal(stats.publicTextVectorsReused, 0);
  assert.equal(db.rows.get(`${root}/products/1`).lastCheckedAt, undefined);
});

test('compatible public image vectors skip image embedding at import too', async () => {
  const db = database(); db.rows.set(root, { createdAt: Timestamp.fromMillis(1) });
  const upsert = sourceFunction('merchant-monitoring', 'upsertMerchantProductsBatch', {
    db, FieldValue, logger, FIRESTORE_COLLECTIONS: collections, buildEmbeddingText: () => 'Exact text', asVectorArray: v => v?.toArray(),
    loadPublicScanOnboardingVectors: async () => new Map([['1', { vector, domain, imageVector: [1] }]]),
    embedTexts: async input => { assert.equal(input.length, 0); return []; },
    embedImage: async () => { throw Error('duplicate image embedding'); },
  });
  await upsert([{ shop, productId: '1', productTitle: 'Toy', sourceUpdatedAt: product.sourceUpdatedAt, product: { ...product, imageUrl: 'https://example.sk/1.jpg' } }], [domain]);
  assert.deepEqual(db.rows.get(`${root}/products/1`).vector_image.toArray(), [1]);
});

function scannerFixture(fail = false) {
  const db = database(), retrievals = [], texts = [], images = [];
  db.batch = () => {
    const writes = [];
    return { set: (ref, data) => writes.push([ref, data]), commit: async () => { for (const [ref, data] of writes) await ref.set(data); } };
  };
  const raw = [1, 2].map(id => ({ id, title: `Toy ${id}`, input: { ...product, productId: String(id), imageUrl: `https://example.sk/${id}.jpg` } }));
  const scan = sourceFunction('public-store-scanner', 'scanPublicCatalogProducts', {
    db, FieldValue, Timestamp, logger, Buffer, PUBLIC_SCAN_COVERAGE_POLICY, PUBLIC_SCAN_RETENTION_MS: 90 * 86400000,
    publicScanCoverageFingerprint: productSafetyFingerprint, buildEmbeddingText: p => p.title,
    shopifyRawToProductInput: raw => raw.input, updateScanProgress: async () => {},
    // A matching updatedAt must not override a different embeddingText.
    loadCachedProductVectors: async () => new Map([['1', { vector: [99], embeddingText: 'Old text', sourceUpdatedAt: product.sourceUpdatedAt }]]),
    saveProductVectors: async () => {},
    embedTexts: async input => { texts.push(...input); return input.map(() => vector); },
    embedImage: async url => { images.push(url); return [1, 0]; },
    retrieveAlertsWithRag: async (input, supplied) => { retrievals.push(supplied); return input.productId === '1' ? [{ id: 'A' }] : []; },
    checkProductAgainstAlerts: async (input, alerts) => {
      assert.equal(input.shop, undefined);
      if (fail && alerts.length) throw Error('provider failed');
      const result = createNoAlertsResult(1);
      return alerts.length ? { ...result, isSafe: false, warnings: [{ alertId: 'A', overallSimilarity: 65 }] } : result;
    },
    computeScore: () => ({ leadScore: 0, priorityLevel: 'low', totalWarningsCount: 0, seriousRiskCount: 0, highestSimilarity: 0, summary: '' }),
  });
  return { db, retrievals, texts, images, run: () => scan(domain, raw, 80, false) };
}

test('public scanner uses the shared text+image retrieval and saves unfiltered positive and negative full coverage', async () => {
  const f = scannerFixture(), output = await f.run();
  assert.equal(f.texts.length, 2); assert.equal(f.images.length, 2);
  assert.equal(f.retrievals.length, 2);
  assert.deepEqual(f.retrievals[0], { textVector: vector, imageVector: [1, 0] });
  assert.equal(output.flaggedProductsCount, 0); // display threshold only
  const one = f.db.rows.get(`rapex_leads/${domain}/products/1`).safetyCoverage;
  const two = f.db.rows.get(`rapex_leads/${domain}/products/2`).safetyCoverage;
  assert.equal(JSON.parse(one.resultJson).warnings[0].overallSimilarity, 65);
  assert.equal(JSON.parse(two.resultJson).isSafe, true);
  assert.ok(one.coveredThrough instanceof Timestamp);
  assert.equal(one.policy, PUBLIC_SCAN_COVERAGE_POLICY);
});

test('a failed public model check cannot publish portable successful coverage', async () => {
  const f = scannerFixture(true);
  await assert.rejects(f.run(), /incomplete/);
  assert.equal([...f.db.rows.values()].some(row => row.safetyCoverage), false);
});
