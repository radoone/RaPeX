import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { selectMonitoringImages, prioritizeMonitoringImages } from '../lib/monitoring-images.js';
import { recallWithinThreshold } from '../lib/vector-recall.js';
import { loadFirstSuccessful } from '../lib/matching-work.js';
import { sourceFunction as fn } from './helpers/isolated-source.mjs';

const vector = n => Array.from({ length: 1408 }, (_, index) => index ? 0 : n);
const picture = n => `https://ec.europa.eu/safety-gate-alerts/public/api/notification/image/${n}`;
const alert = (id = 'A', pictures = [picture(1), picture(2)]) => ({ id, meta: { recordid: id, alert_date: '2026-10-23', ingested_at: '', record_timestamp: 'revision' }, fields: { pictures, product_image: pictures[0] } });
const normalizePictures = fields => [...(fields.pictures || []), ...(fields.product_image ? [fields.product_image] : [])];

test('uses every current shared image, filters obsolete images and repeated URLs', () => {
  const pictures = Array.from({ length: 7 }, (_, i) => picture(i + 1));
  const stored = pictures.map((imageUrl, i) => ({ imageUrl, vector: vector(i + 1) }));
  stored.push({ imageUrl: picture(999), vector: vector(9) });
  const images = selectMonitoringImages([...pictures, pictures[0]], stored);
  assert.equal(images.length, 7);
  assert.equal(images[0].vector[0], 1);
  assert.deepEqual(images.map(x => x.imageUrl), pictures);
});

test('unavailable photos do not invent embeddings or fall back to inline copies; official thumbnails remain usable', () => {
  const thumbnail = picture(2).replace('/image/', '/thumbnail/');
  const images = selectMonitoringImages([picture(1), picture(2), picture(3)], [{ imageUrl: picture(2), embeddingSourceUrl: thumbnail, vector: vector(2) }]);
  assert.equal(images.length, 1);
  assert.equal(images[0].mediaUrl, thumbnail);
  assert.equal(selectMonitoringImages([picture(1)], [{ imageUrl: picture(1), embeddingSourceUrl: 'https://untrusted.example/photo', vector: vector(1) }])[0].mediaUrl, picture(1));
  assert.deepEqual(selectMonitoringImages([], []), []);
  assert.throws(() => selectMonitoringImages([picture(1)], [{ imageUrl: picture(1), vector: [1] }]), /Invalid/);
});

test('batched hydration covers publication and correction candidates, with all vector-read failures propagated', async () => {
  const batches = [];
  const candidates = Array.from({ length: 31 }, (_, i) => ({ alert: alert(String(i)), imageVector: vector(1) }));
  const loader = fn('merchant-monitoring', 'loadMonitoringImages', {
    FIRESTORE_COLLECTIONS: { alertImages: 'rapex_alert_images' }, normalizePictures, selectMonitoringImages,
    asVectorArray: value => value?.toArray(),
    db: { collection: () => ({ where: (_field, _op, ids) => ({ select: () => ({ get: async () => { batches.push(ids); return { docs: ids.map(id => ({ data: () => ({ alertId: id, imageUrl: picture(2), vector_image: { toArray: () => vector(2) } }) })) }; } }) }) }) },
  });
  await loader(candidates);
  assert.deepEqual(batches.map(x => x.length), [30, 1]);
  assert.ok(candidates.every(x => x.images.length === 1));
  const failing = fn('merchant-monitoring', 'loadMonitoringImages', { FIRESTORE_COLLECTIONS: { alertImages: 'images' }, db: { collection: () => ({ where: () => ({ select: () => ({ get: async () => { throw Error('Firestore unavailable'); } }) }) }) } });
  await assert.rejects(failing(candidates), /Firestore unavailable/);
});

function finder(search) {
  return fn('merchant-monitoring', 'findCandidateProductsForAlert', {
    db: { collection: () => ({ doc: () => ({ collection: () => ({ findNearest: options => ({ get: async () => ({ docs: await search(options) }) }) }) }) }) },
    FIRESTORE_COLLECTIONS: { merchants: 'merchants', subProducts: 'products' }, recallWithinThreshold,
    MONITOR_TEXT_CANDIDATE_LIMIT: 8, MONITOR_IMAGE_CANDIDATE_LIMIT: 5,
    MATCHING_THRESHOLDS: { textDistance: .38, imageDistance: .35 },
  });
}
const doc = (id, distance = .1, deleted = false) => ({ id, data: () => ({ productId: id, ...(deleted ? { deletedAt: true } : {}) }), get: key => key === 'distance' ? distance : undefined });

test('a product found only by the seventh photo is included once, with strongest matching media first', async () => {
  const searches = [];
  const find = finder(async options => {
    searches.push(options.vectorField === 'vector_text' ? 'text' : options.queryVector[0]);
    if (options.vectorField === 'vector_text') return [doc('shared')];
    if (options.queryVector[0] === 7) return [doc('shared', .01), doc('seventh-only', .02), doc('deleted', .01, true)];
    return options.queryVector[0] === 1 ? [doc('shared', .2)] : [];
  });
  const images = selectMonitoringImages(Array.from({ length: 7 }, (_, i) => picture(i + 1)), Array.from({ length: 7 }, (_, i) => ({ imageUrl: picture(i + 1), vector: vector(i + 1) })));
  const found = await find('shop.myshopify.com', { alert: alert(), textVector: [1], images });
  assert.deepEqual(searches, ['text', 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(found.map(x => x.id), ['shared', 'seventh-only']);
  assert.deepEqual(found[0].matchedImageUrls, [picture(7), picture(1)]);
});

test('secondary-image recall expands and a secondary query error cannot become a completed clean check', async () => {
  const find = finder(async options => options.vectorField === 'vector_text' ? [] : Array.from({ length: 26 }, (_, i) => doc(String(i), i < 25 ? .1 : .9)).slice(0, options.limit));
  assert.equal((await find('shop', { alert: alert(), textVector: [1], images: [{ vector: vector(2), mediaUrl: picture(2) }] })).length, 25);
  const broken = finder(async options => { if (options.vectorField === 'vector_image') throw Error('Missing index'); return []; });
  await assert.rejects(broken('shop', { alert: alert(), textVector: [1], images: [{ vector: vector(2), mediaUrl: picture(2) }] }), /Missing index/);
});

test('matching photo reaches analysis without changing source facts, and image order isolates old cached results', () => {
  const original = alert();
  const prioritized = prioritizeMonitoringImages(original, [picture(2)]);
  assert.deepEqual(original.fields.pictures, [picture(1), picture(2)]);
  assert.equal(prioritized.fields.pictures[0], picture(2));
  const signature = fn('safety-gate-checker', 'buildAlertSignature', { normalizePictures, hashValue: value => createHash('sha256').update(JSON.stringify(value)).digest('hex') });
  assert.notEqual(signature([original]), signature([prioritized]));
  assert.equal(prioritized.meta, original.meta);
});

test('the real media preparation gives the matcher the secondary retrieval photo before the image cap', async () => {
  const source = alert('A', Array.from({ length: 7 }, (_, i) => picture(i + 1)));
  const prepare = fn('safety-gate-checker', 'buildPromptParts', {
    getProductImageUrls: () => [], normalizePictures,
    limitImageUrls: (urls, limit) => [...new Set(urls)].slice(0, limit),
    prepareImageMedia: async url => ({ url, contentType: 'image/jpeg' }), loadFirstSuccessful,
    AI_CONFIG: { maxAlertImages: 4 },
  });
  const input = await prepare({}, [prioritizeMonitoringImages(source, [picture(7)])], async url => ({ url, contentType: 'image/jpeg' }));
  assert.equal(input.alertImages[0].media.url, picture(7));
  assert.equal(input.alertImages.length, 2);
  assert.equal(source.fields.product_image, picture(1));
});
