import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFunction as fn } from './helpers/isolated-source.mjs';

const exact = { id: 'exact-source', fields: {} };
function retrieval(cached, exactCandidates = []) {
  let embedded = false;
  const retrieve = fn('safety-gate-checker-retrieval', 'retrieveAlertsWithRag', {
    retrieveAlertsByGtins: async () => exactCandidates,
    retrieveAlertsFromCachedVectors: async () => cached,
    hydrateAlertsIfMissing: async values => values,
    ensureTextRetriever: () => { embedded = true; throw Error('Embedding unavailable'); },
  });
  return { retrieve, embedded: () => embedded };
}

test('a successful empty cached KNN search finishes without fresh embedding or model work', async () => {
  const r = retrieval([]);
  assert.deepEqual(await r.retrieve({}), []);
  assert.equal(r.embedded(), false);
  const withExact = retrieval([], [exact]);
  assert.deepEqual(await withExact.retrieve({}), [exact]);
});

test('missing vectors still require fresh retrieval and retrieval failures are never safe results', async () => {
  const missing = retrieval(null);
  await assert.rejects(missing.retrieve({}), /Embedding unavailable/);
  const failed = fn('safety-gate-checker-retrieval', 'retrieveAlertsWithRag', {
    retrieveAlertsByGtins: async () => [],
    retrieveAlertsFromCachedVectors: async () => { throw Error('KNN unavailable'); },
  });
  await assert.rejects(failed({}), /KNN unavailable/);
});

test('cached vector availability distinguishes a real empty shortlist from an absent cache', async () => {
  const noVectors = fn('safety-gate-checker-retrieval', 'retrieveAlertsFromCachedVectors', {
    getCachedMerchantProductVectors: async () => null,
  });
  assert.equal(await noVectors({}), null);
  const noHits = fn('safety-gate-checker-retrieval', 'retrieveAlertsFromCachedVectors', {
    getCachedMerchantProductVectors: async () => ({ textVector: [1, 0] }),
    getFirestore: () => ({ collection: () => ({ findNearest: () => ({ get: async () => ({ docs: [] }) }) }) }),
    FIRESTORE_COLLECTIONS: { alerts: 'alerts' }, VECTOR_TEXT_FIELD: 'vector_text', RAG_TEXT_LIMIT: 12,
  });
  assert.deepEqual(await noHits({}), []);
});
