import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicMonitoringCache } from '../lib/monitoring-public-cache.js';
const doc = (id, nanos = 1, data = { fields: { name: id }, vector_text: [1] }, collection = 'rapex_alerts') => ({ id, ref: { path: `${collection}/${id}` }, exists: true, updateTime: { seconds: 1000, nanoseconds: nanos }, data: () => data });
const fetcher = (documents, reads) => async refs => { reads.push(refs.map(ref => ref.path)); return refs.map(ref => documents.find(doc => doc.ref.path === ref.path)); };

test('overlapping shops share pending and resolved public facts in batches, without private fields', async () => {
  const a = doc('a', 1, { fields: { name: 'a' }, vector_text: [1], shop: 'private', token: 'private' }), b = doc('b');
  const cache = createPublicMonitoringCache(), reads = [];let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetch = async refs => { await gate; return fetcher([a, b], reads)(refs); };
  const first = cache.load([a, b], fetch), second = cache.load([b], fetch);release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(reads.length, 1);assert.equal(left[1].data, right[0].data);
  assert.deepEqual(left[0].data, { fields: { name: 'a' }, vector_text: [1] });
  await cache.load([a], fetch);assert.equal(reads.length, 1);
});

test('native nanosecond revisions invalidate corrected source and re-embedded images', async () => {
  for (const collection of ['rapex_alerts', 'rapex_alert_images']) {
    const cache = createPublicMonitoringCache(), reads = [];
    const old = doc('a', 1, { vector_image: [1], fields: { name: 'old' } }, collection), fresh = doc('a', 2, { vector_image: [2], fields: { name: 'new' } }, collection);
    await cache.load([old], fetcher([old], reads));
    const result = await cache.load([fresh], fetcher([fresh], reads));
    assert.equal(reads.length, 2);assert.deepEqual(result[0].data.vector_image, [2]);
  }
});

test('concurrent corrections, deleted sources and failed reads are unavailable and retryable', async () => {
  for (const response of [doc('a', 2), { ...doc('a'), exists: false }]) {
    const cache = createPublicMonitoringCache(), probe = doc('a');
    await assert.rejects(cache.load([probe], async () => [response]), /revision|changed/);
    assert.equal((await cache.load([probe], async () => [probe])).length, 1);
  }
  const cache = createPublicMonitoringCache(), probes = Array.from({ length: 205 }, (_, i) => doc(String(i)));
  await assert.rejects(cache.load(probes, async () => { throw Error('offline'); }), /offline/);
  const reads = [];assert.equal((await cache.load(probes, fetcher(probes, reads))).length, 205);
  assert.deepEqual(reads.map(x => x.length), [100, 100, 5]);
});

test('private paths and missing versions are rejected before reads or cache lookup', async () => {
  const cache = createPublicMonitoringCache();let calls = 0;
  const fetch = async () => { calls++;return []; };
  for (const path of ['merchants/a/products/b', 'rapex_alerts/a/private/b', 'shopify_sessions/a']) {
    await assert.rejects(cache.load([{ ...doc('a'), ref: { path } }], fetch), /public/);
  }
  await assert.rejects(cache.load([{ ...doc('a'), updateTime: undefined }], fetch), /revision/);
  assert.equal(calls, 0);
});

test('age, entry and byte limits evict resolved facts and cold instances read independently', async () => {
  for (const limits of [{ maxEntries: 1, maxBytes: 99999, ttlMs: 100 }, { maxEntries: 10, maxBytes: 1, ttlMs: 100 }]) {
    const reads = [], docs = [doc('a'), doc('b')], cache = createPublicMonitoringCache(limits);
    await cache.load(docs, fetcher(docs, reads));
    await cache.load([docs[0]], fetcher(docs, reads));assert.equal(reads.length, 2);
  }
  let now = 0;const reads = [], a = doc('a');
  const cache = createPublicMonitoringCache({ maxEntries: 10, maxBytes: 9999, ttlMs: 100 }, () => now);
  await cache.load([a], fetcher([a], reads));now = 101;
  await cache.load([a], fetcher([a], reads));assert.equal(reads.length, 2);
  await createPublicMonitoringCache().load([a], fetcher([a], reads));assert.equal(reads.length, 3);
});
