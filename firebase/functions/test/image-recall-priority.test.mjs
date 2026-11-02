import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFunction as fn } from './helpers/isolated-source.mjs';
import { prioritizeMonitoringImages } from '../lib/monitoring-images.js';
import { normalizePictures, getProductImageUrls, limitImageUrls } from '../lib/safety-gate-checker-media.js';
const merge = fn('safety-gate-checker-retrieval', 'mergeImageRecall');
const prioritize = fn('safety-gate-checker-retrieval', 'prioritizeRetrievedImages', { normalizePictures, prioritizeMonitoringImages });
const alert = (id, distance) => ({ id, meta: { recordid: id }, distance, fields: { category: 'Toys', brand: 'Midex', pictures: ['https://example.com/first.jpg', 'https://example.com/matched.jpg'] } });

test('a strong image duplicate reaches the bounded model image input instead of being discarded by the text hit', async () => {
  const candidates = Array.from({length: 5}, (_, i) => alert(String(i), .20 + i / 100));
  merge(candidates, { ...alert('4', .03), fields: {}, matchedImageUrls: ['https://example.com/matched.jpg'] });
  candidates.sort((a,b) => a.distance-b.distance);
  assert.equal(candidates.length, 5);
  assert.equal(candidates[0].id, '4');
  assert.equal(candidates[0].fields.brand, 'Midex');
  const hydrated = candidates.map(prioritize);
  const build = fn('safety-gate-checker', 'buildPromptParts', { getProductImageUrls, limitImageUrls, normalizePictures, AI_CONFIG: { maxProductImages: 2, maxAlertImages: 4 }, prepareImageMedia: async () => null });
  const input = await build({ imageUrl: 'https://example.com/product.jpg' }, hydrated, async url => ({ url, contentType: 'image/jpeg' }));
  assert.equal(input.alertImages.length, 4);
  assert.equal(input.alertImages[0].alertId, '4');
  assert.equal(input.alertImages[0].media.url, 'https://example.com/matched.jpg');
});

test('repeated image hits retain the best distance and evidence without duplicating alerts or reviving removed pictures', () => {
  const original = alert('A', .25), candidates = [original];
  merge(candidates, { ...alert('A', .02), matchedImageUrls: ['https://example.com/matched.jpg'] });
  merge(candidates, { ...alert('A', .30), matchedImageUrls: ['https://example.com/removed.jpg'] });
  assert.equal(candidates[0].distance, .02);
  assert.equal(candidates.length, 1);
  const result = prioritize(candidates[0]);
  assert.deepEqual(result.fields.pictures, ['https://example.com/matched.jpg', 'https://example.com/first.jpg']);
  assert.deepEqual(original.fields.pictures, ['https://example.com/first.jpg', 'https://example.com/matched.jpg']);
  merge(candidates, { ...alert('B', .04), matchedImageUrls: ['https://example.com/first.jpg'] });
  assert.equal(candidates.length, 2);
});
