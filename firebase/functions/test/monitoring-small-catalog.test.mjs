import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { loadSmallMonitoringCatalog, SMALL_CATALOG_LIMITS } from '../lib/monitoring-small-catalog.js';
import { MONITORING_PRODUCT_FIELDS } from '../lib/monitoring-product-cache.js';
const native = values => ({ toArray: () => values });
const row = (id, extra = {}) => ({ id, data: () => ({ productId: id, sourceUpdatedAt: 'v1', vector_text: native([1, 0]), ...extra }) });
const source = (extra = {}) => ({ alert: { fields: {} }, textVector: [1, 0], ...extra });
const batch = Array.from({ length: 16 }, () => source());
function collection(rows, { count = rows.length, fail = false } = {}) {
  const metrics = { counts: 0, streams: 0 };
  let cap = Infinity, stream;
  const query = {
    limit: n => { cap = n; return query; },
    count: () => ({ get: async () => { metrics.counts++; return { data: () => ({ count: Math.min(count, cap) }) }; } }),
    select: (...fields) => { assert.deepEqual(fields, [...MONITORING_PRODUCT_FIELDS, 'gtins', 'vector_text', 'vector_image']); return query; },
    stream: () => { metrics.streams++; stream = fail ? Readable.from((async function* () { yield rows[0]; throw Error('Firestore offline'); })()) : Readable.from(rows.slice(0, cap)); return stream; },
  };
  return { query, metrics, destroyed: () => stream?.destroyed };
}

test('selection bounds products, bytes and minimum indexed work before downloading vectors', async () => {
  assert.equal(SMALL_CATALOG_LIMITS.maxProducts, 250);
  const big = collection([], { count: 10000 });
  assert.equal((await loadSmallMonitoringCatalog(big.query, batch)).reason, 'product-limit');
  assert.equal(big.metrics.streams, 0);
  const few = collection([row('1')]);
  assert.equal((await loadSmallMonitoringCatalog(few.query, [source()])).reason, 'small-batch');
  assert.equal(few.metrics.counts, 0);
  const cost = collection([], { count: 200 });
  assert.equal((await loadSmallMonitoringCatalog(cost.query, batch)).reason, 'small-batch');
  assert.equal(cost.metrics.streams, 0);
  const boundary = collection(Array.from({ length: 250 }, (_, i) => row(String(i))));
  assert.ok((await loadSmallMonitoringCatalog(boundary.query, Array.from({ length: 63 }, () => source()))).catalog);
});

test('concurrent growth and oversized snapshots cancel the stream and request KNN', async () => {
  const growing = collection([row('a'), row('b')], { count: 1 });
  assert.equal((await loadSmallMonitoringCatalog(growing.query, batch, { ...SMALL_CATALOG_LIMITS, maxProducts: 1 })).reason, 'catalog-grew');
  assert.equal(growing.destroyed(), true);
  const large = collection([row('a', { description: 'long'.repeat(100) })]);
  assert.equal((await loadSmallMonitoringCatalog(large.query, batch, { ...SMALL_CATALOG_LIMITS, maxBytes: 20 })).reason, 'byte-limit');
  assert.equal(large.destroyed(), true);
});

test('a full snapshot preserves exact GTIN priority, all images, deleted exclusion and allowlisted facts', async () => {
  const rows = [row('text'), row('exact', { gtins: ['00036000291452'], vector_text: native([-1, 0]) }), row('image', { vector_text: native([-1, 0]), vector_image: native([0, 1]) }), row('deleted', { deletedAt: true })];
  const { catalog } = await loadSmallMonitoringCatalog(collection(rows).query, batch);
  const input = source({ alert: { fields: { barcode: '036000291452' } }, images: Array.from({ length: 7 }, (_, i) => ({ vector: i === 6 ? [0, 1] : [0, -1], mediaUrl: `image-${i}` })) });
  const result = catalog.retrieve(input);
  assert.deepEqual(result.map(row => row.id), ['exact', 'text', 'image']);
  assert.deepEqual(result[2].matchedImageUrls, ['image-6']);
  assert.equal(result[0].data.sourceUpdatedAt, 'v1');
  assert.ok(result.every(row => !('vector_text' in row.data) && !('gtins' in row.data)));
  assert.deepEqual(catalog.retrieve(source()).map(row => row.id), ['text']);
});

test('vector norm and dimensions agree with cosine, with UTF-8 ID ordering for ties', async () => {
  const { catalog } = await loadSmallMonitoringCatalog(collection([row('a', { vector_text: native([100, 0]) }), row('Z'), row('wrong', { vector_text: native([1]) })]).query, batch);
  assert.deepEqual(catalog.retrieve(source()).map(row => row.id), ['Z', 'a']);
  assert.throws(() => catalog.retrieve(source({ textVector: undefined })), /unavailable/);
});

test('ambiguous cutoff and close image-score ordering request KNN rather than a clean result', async () => {
  const edge = .62;
  const { catalog } = await loadSmallMonitoringCatalog(collection([row('edge', { vector_text: native([edge, Math.sqrt(1 - edge * edge)]) })]).query, batch);
  assert.equal(catalog.retrieve(source()), null);
  const other = (await loadSmallMonitoringCatalog(collection([row('a', { vector_image: native([1, 0]) })]).query, batch)).catalog;
  assert.equal(other.retrieve(source({ images: [{ vector: [1, .1], mediaUrl: '1' }, { vector: [1, .10000001], mediaUrl: '2' }] })), null);
});

test('unsupported/zero/nonfinite vectors fall back; transport errors fail closed', async () => {
  for (const value of [[1, 0], native([0, 0]), native([NaN, 1]), native(Array(2049).fill(1))]) {
    assert.equal((await loadSmallMonitoringCatalog(collection([row('a', { vector_text: value })]).query, batch)).reason, 'unsupported-vector');
  }
  const failing = collection([row('a')], { fail: true });
  await assert.rejects(loadSmallMonitoringCatalog(failing.query, batch), /Firestore offline/);
  assert.equal(failing.destroyed(), true);
});

test('snapshots and per-source image ordering remain isolated between shops and invocations', async () => {
  const first = (await loadSmallMonitoringCatalog(collection([row('a', { vector_image: native([1, 0]) })]).query, batch)).catalog;
  const second = (await loadSmallMonitoringCatalog(collection([row('b')]).query, batch)).catalog;
  const a = first.retrieve(source({ images: [{ vector: [1, 0], mediaUrl: 'first' }] }));
  const b = first.retrieve(source({ images: [{ vector: [1, 0], mediaUrl: 'second' }] }));
  assert.deepEqual(a[0].matchedImageUrls, ['first']);
  assert.deepEqual(b[0].matchedImageUrls, ['second']);
  assert.deepEqual(second.retrieve(source()).map(row => row.id), ['b']);
});
