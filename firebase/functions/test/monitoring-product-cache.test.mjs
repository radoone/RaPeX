import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitoringProductCache, MONITORING_PRODUCT_FIELDS } from '../lib/monitoring-product-cache.js';
import { sourceFunction as fn, collections } from './helpers/isolated-source.mjs';
const hit = (id, sourceUpdatedAt = 'v1') => ({ id, sourceUpdatedAt });
const row = (id, extra = {}) => ({ id, data: { productId: id, sourceUpdatedAt: 'v1', ...extra } });

test('overlapping concurrent sources share pending and completed facts, but keep versions separate', async () => {
  const batches = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const load = createMonitoringProductCache(async ids => { batches.push(ids); await gate; return ids.map(id => row(id)); });
  const first = load([hit('a'), hit('b')]);
  const second = load([hit('b'), hit('c'), hit('c')]);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(batches, [['a', 'b'], ['c']]);
  assert.equal(a.get('b'), b.get('b'));
  await load([hit('a'), hit('b')]);
  assert.equal(batches.length, 2);
  assert.equal((await load([hit('a', 'v2')])).size, 0);
  assert.equal(batches.length, 3);
});

test('missing, changed and deleted products cannot be hydrated from stale metadata', async () => {
  const load = createMonitoringProductCache(async () => [row('changed', { sourceUpdatedAt: 'v2' }), row('deleted', { deletedAt: true }), row('live')]);
  assert.deepEqual([...(await load(['changed', 'deleted', 'missing', 'live'].map(id => hit(id)))).keys()], ['live']);
});

test('network failures reject overlapping waiters and leave every batch retryable', async () => {
  let fail = true;
  const sizes = [];
  const load = createMonitoringProductCache(async ids => { sizes.push(ids.length); if (fail) throw Error('Firestore offline'); return ids.map(id => row(id)); });
  const hits = Array.from({ length: 205 }, (_, i) => hit(String(i)));
  const outcomes = await Promise.allSettled([load(hits), load([hits[0]])]);
  assert.ok(outcomes.every(result => result.status === 'rejected' && /offline/.test(result.reason.message)));
  fail = false;
  assert.equal((await load(hits)).size, 205);
  assert.deepEqual(sizes, [100, 100, 100, 5]);
});

test('retained facts are bounded by count and bytes, and never shared between pages/shops', async () => {
  for (const limits of [{ maxEntries: 1, maxBytes: 10000 }, { maxEntries: 10, maxBytes: 1 }]) {
    const batches = [];
    const load = createMonitoringProductCache(async ids => { batches.push(ids); return ids.map(id => row(id)); }, limits);
    await load([hit('a'), hit('b')]);
    assert.equal((await load([hit('a')])).get('a').productId, 'a');
    assert.equal(batches.length, 2);
  }
  let reads = 0;
  const fetch = async ids => { reads++; return ids.map(id => row(id)); };
  await createMonitoringProductCache(fetch)([hit('a')]);
  await createMonitoringProductCache(fetch)([hit('a')]);
  assert.equal(reads, 2);
});

test('owning loader projects only matcher facts and fences, with a shop-scoped batch read', async () => {
  const expected = ['shop', 'productId', 'productTitle', 'productHandle', 'name', 'category', 'description', 'imageUrl', 'imageUrls', 'brand', 'model', 'barcodes', 'sourceUpdatedAt', 'deletedAt'];
  assert.deepEqual(MONITORING_PRODUCT_FIELDS, expected);
  let calls = 0;
  const db = {
    collection: name => { assert.equal(name, 'merchants'); return { doc: shop => { assert.equal(shop, 'example.myshopify.com'); return { collection: name => { assert.equal(name, 'products'); return { doc: id => ({ id }) }; } }; } }; },
    getAll: async (...args) => {
      calls++;
      const options = args.pop(); assert.deepEqual(options, { fieldMask: expected });
      return args.map(ref => ({ id: ref.id, exists: ref.id !== 'gone', data: () => row(ref.id).data }));
    },
  };
  const factory = fn('merchant-monitoring', 'createMonitoringProductLoader', { db, FIRESTORE_COLLECTIONS: collections, createMonitoringProductCache, MONITORING_PRODUCT_FIELDS });
  const load = factory('example.myshopify.com');
  assert.deepEqual([...(await load([hit('a'), hit('gone')])).keys()], ['a']);
  await load([hit('a')]);
  assert.equal(calls, 1);
});


test('pruning never evicts pending reads', async () => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const load = createMonitoringProductCache(async ids => {
    calls++; await gate;
    return ids.map(id => row(id, { sourceUpdatedAt: undefined }));
  }, { maxEntries: 0, maxBytes: 0 });
  const first = load([{ id: 'a', sourceUpdatedAt: undefined }]);
  const legacy = load([{ id: 'legacy', sourceUpdatedAt: undefined }]);
  const overlap = load([{ id: 'legacy', sourceUpdatedAt: undefined }]);
  release();
  await first;
  assert.equal((await legacy).get('legacy'), (await overlap).get('legacy'));
  assert.equal(calls, 2);
  assert.equal((await load([{ id: 'legacy', sourceUpdatedAt: null }])).size, 0);
  assert.equal(calls, 3);
});


test('missing and null source versions never reuse the same cache entry', async () => {
  let calls = 0;
  const load = createMonitoringProductCache(async ids => { calls++; return ids.map(id => row(id, { sourceUpdatedAt: undefined })); });
  assert.equal((await load([{ id: 'a', sourceUpdatedAt: undefined }])).size, 1);
  assert.equal((await load([{ id: 'a', sourceUpdatedAt: null }])).size, 0);
  assert.equal(calls, 2);
});
