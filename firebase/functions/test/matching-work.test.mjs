import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBounded, loadFirstSuccessful, memoizeBounded } from '../lib/matching-work.js';

test('model batches overlap within their bound and retain every candidate in order', async () => {
  let active = 0, peak = 0;
  const result = await mapBounded([[1,2],[3,4],[5]], 2, async ids => {
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active--;
    return ids;
  });
  assert.equal(peak, 2);
  assert.deepEqual(result.flat(), [1,2,3,4,5]);
});

test('media downloads retain the original first successful images and stop bounded prefetch', async () => {
  let active = 0, peak = 0;
  const calls = [];
  const result = await loadFirstSuccessful([0,1,2,3,4,5,6,7], 3, 4, async id => {
    calls.push(id); peak = Math.max(peak, ++active);
    await Promise.resolve(); active--;
    return id === 1 ? null : `image-${id}`;
  });
  assert.equal(peak, 4);
  assert.deepEqual(calls, [0,1,2,3]);
  assert.deepEqual(result.map(x => x.item), [0,2,3]);
});

test('failed media does not hide remaining candidates and failed model batches reject', async () => {
  const calls = [];
  assert.deepEqual(await loadFirstSuccessful([1,2,3,4,5], 4, 2, async id => { calls.push(id); return null; }), []);
  assert.deepEqual(calls, [1,2,3,4,5]);
  await assert.rejects(mapBounded([1,2,3], 2, async id => { if (id === 2) throw new Error('model unavailable'); return id; }), /model unavailable/);
});

test('concurrent duplicate images share one download and the cache is request bounded', async () => {
  const calls = [];
  const load = memoizeBounded(async url => { calls.push(url); await Promise.resolve(); return url; }, 1);
  assert.deepEqual(await Promise.all([load('a'), load('a')]), ['a','a']);
  await load('b'); await load('b'); await load('a');
  assert.deepEqual(calls, ['a','b','b']);
});
