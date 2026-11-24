import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import {
  TEXT_VECTOR_DIMS,
  IMAGE_VECTOR_DIMS,
  encodeVectorSnapshot,
  decodeVectorSnapshot,
  patchDecodedSnapshot,
  exactCosineDistance,
  scanSnapshotTopK,
  extractVectorArray,
} from '../lib/safety-gate-vector-snapshot.js';
import { sourceFunction as fn, Timestamp } from './helpers/isolated-source.mjs';

function makeDeterministicVector(dims, seed) {
  const vec = new Array(dims);
  let state = (seed + 1) * 2654435761;
  for (let i = 0; i < dims; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    vec[i] = ((state / 0xffffffff) * 2 - 1) * (i % 7 === 0 ? 3 : 1);
  }
  return vec;
}

function addNoise(vec, scale) {
  return vec.map((v, idx) => v + Math.sin(idx * 1.7) * scale);
}

test('encodeVectorSnapshot and decodeVectorSnapshot roundtrip text and image snapshots with validation', () => {
  const vecB = makeDeterministicVector(TEXT_VECTOR_DIMS, 1);
  const vecA = makeDeterministicVector(TEXT_VECTOR_DIMS, 2);
  const vecAUpdated = makeDeterministicVector(TEXT_VECTOR_DIMS, 3);

  // Dedupe (last wins), invalid filtering, and UTF-8 ordering
  const textBuf = encodeVectorSnapshot(
    [
      { docId: 'z-alert', vector: vecB },
      { docId: 'a-alert', vector: vecA },
      { docId: 'a-alert', vector: vecAUpdated },
      { docId: 'bad-zero', vector: new Array(TEXT_VECTOR_DIMS).fill(0) },
      { docId: 'bad-dim', vector: [1, 2, 3] },
      { docId: 'bad-nan', vector: [Number.NaN, ...vecA.slice(1)] },
    ],
    TEXT_VECTOR_DIMS,
    0,
  );

  const decodedText = decodeVectorSnapshot(textBuf, TEXT_VECTOR_DIMS, 0);
  assert.equal(decodedText.count, 2);
  assert.equal(decodedText.dims, TEXT_VECTOR_DIMS);
  assert.equal(decodedText.flags, 0);
  assert.deepEqual(decodedText.docIds, ['a-alert', 'z-alert']);

  // Verify unaligned byteOffset handling works seamlessly
  const unalignedParent = Buffer.alloc(textBuf.byteLength + 3);
  textBuf.copy(unalignedParent, 1);
  const unalignedSlice = unalignedParent.subarray(1, 1 + textBuf.byteLength);
  assert.notEqual((unalignedSlice.byteOffset + 32) % 4, 0);
  const decodedUnaligned = decodeVectorSnapshot(unalignedSlice, TEXT_VECTOR_DIMS, 0);
  assert.deepEqual(decodedUnaligned.docIds, ['a-alert', 'z-alert']);
  assert.equal(decodedUnaligned.scales[0], decodedText.scales[0]);

  // Image roundtrip
  const imgVec = makeDeterministicVector(IMAGE_VECTOR_DIMS, 9);
  const imgBuf = encodeVectorSnapshot(
    [{ docId: 'img-1', alertId: 'alert-1', imageUrl: 'https://example.com/1.jpg', vector: imgVec }],
    IMAGE_VECTOR_DIMS,
    1,
  );
  const decodedImg = decodeVectorSnapshot(imgBuf, IMAGE_VECTOR_DIMS, 1);
  assert.equal(decodedImg.count, 1);
  assert.deepEqual(decodedImg.docIds, ['img-1']);
  assert.deepEqual(decodedImg.alertIds, ['alert-1']);
  assert.deepEqual(decodedImg.imageUrls, ['https://example.com/1.jpg']);

  // Corrupt magic / length / dims rejections
  const badMagic = Buffer.from(textBuf);
  badMagic.write('NOPE', 0, 'ascii');
  assert.throws(() => decodeVectorSnapshot(badMagic, TEXT_VECTOR_DIMS, 0), /magic/);

  assert.throws(() => decodeVectorSnapshot(textBuf.subarray(0, 100), TEXT_VECTOR_DIMS, 0), /length mismatch/);
  assert.throws(() => decodeVectorSnapshot(textBuf, IMAGE_VECTOR_DIMS, 0), /dimensions/);
  assert.throws(() => decodeVectorSnapshot(textBuf, TEXT_VECTOR_DIMS, 1), /flags/);
});

test('high-dimensional quantization + Stage-2 Float64 rescore matches brute-force cosine', () => {
  const query = makeDeterministicVector(TEXT_VECTOR_DIMS, 100);
  const nearExact = addNoise(query, 0.25);
  const closeTieA = addNoise(query, 0.72);
  const closeTieB = addNoise(query, 0.7205);
  const boundaryPass = addNoise(query, 0.92);
  const boundaryFail = makeDeterministicVector(TEXT_VECTOR_DIMS, 200);

  const records = [
    { docId: 'doc-tie-b', vector: closeTieB },
    { docId: 'doc-near', vector: nearExact },
    { docId: 'doc-tie-a', vector: closeTieA },
    { docId: 'doc-boundary', vector: boundaryPass },
    { docId: 'doc-far', vector: boundaryFail },
  ];
  for (let k = 0; k < 25; k++) {
    records.push({ docId: `noise-${String(k).padStart(2, '0')}`, vector: makeDeterministicVector(TEXT_VECTOR_DIMS, 300 + k) });
  }

  const maxDist = exactCosineDistance(query, boundaryPass) + 1e-9;
  assert.ok(maxDist > 0 && maxDist < 0.6);

  const encoded = encodeVectorSnapshot(records, TEXT_VECTOR_DIMS, 0);
  const decoded = decodeVectorSnapshot(encoded, TEXT_VECTOR_DIMS, 0);
  const stage1 = scanSnapshotTopK(decoded, query, maxDist, 36);
  assert.ok(Array.isArray(stage1));

  // Stage 2 exact rescore parity against brute-force Float64 cosine
  const vectorById = new Map(records.map((r) => [r.docId, r.vector]));
  const stage2 = stage1
    .map((hit) => ({ id: hit.docId, distance: exactCosineDistance(query, vectorById.get(hit.docId)) }))
    .filter((hit) => hit.distance !== null && hit.distance <= maxDist)
    .sort((a, b) => a.distance - b.distance || Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)))
    .slice(0, 12);

  const bruteForce = records
    .map((r) => ({ id: r.docId, distance: exactCosineDistance(query, r.vector) }))
    .filter((hit) => hit.distance !== null && hit.distance <= maxDist)
    .sort((a, b) => a.distance - b.distance || Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)))
    .slice(0, 12);

  assert.deepEqual(stage2, bruteForce);
});

test('patchDecodedSnapshot matches full encodeVectorSnapshot bit-for-bit', () => {
  const baseRecords = [
    { docId: 'img-a', alertId: 'alert-1', imageUrl: 'https://a', vector: makeDeterministicVector(IMAGE_VECTOR_DIMS, 1) },
    { docId: 'img-b', alertId: 'alert-2', imageUrl: 'https://b', vector: makeDeterministicVector(IMAGE_VECTOR_DIMS, 2) },
    { docId: 'img-c', alertId: 'alert-3', imageUrl: 'https://c', vector: makeDeterministicVector(IMAGE_VECTOR_DIMS, 3) },
  ];
  const baseBuf = encodeVectorSnapshot(baseRecords, IMAGE_VECTOR_DIMS, 1);
  const decodedBase = decodeVectorSnapshot(baseBuf, IMAGE_VECTOR_DIMS, 1);

  const updatedB = { docId: 'img-b', alertId: 'alert-2', imageUrl: 'https://b2', vector: makeDeterministicVector(IMAGE_VECTOR_DIMS, 22) };
  const insertedD = { docId: 'img-0', alertId: 'alert-0', imageUrl: 'https://0', vector: makeDeterministicVector(IMAGE_VECTOR_DIMS, 44) };
  const patchedBuf = patchDecodedSnapshot(decodedBase, [updatedB, insertedD], new Set(['img-c']));

  const fullReencodedBuf = encodeVectorSnapshot(
    [insertedD, baseRecords[0], updatedB],
    IMAGE_VECTOR_DIMS,
    1,
  );
  assert.equal(Buffer.compare(patchedBuf, fullReencodedBuf), 0);
});

test('delta overlay supersedes changed alertIds, serves overlay hits, and triggers fallback >250 changes', async () => {
  const query = makeDeterministicVector(TEXT_VECTOR_DIMS, 55);
  const oldAlertVec = makeDeterministicVector(TEXT_VECTOR_DIMS, 55); // exact match in base
  const newAlertVec = makeDeterministicVector(TEXT_VECTOR_DIMS, 88); // unrelated after update
  const addedVec = addNoise(query, 0.05);

  const baseBuf = encodeVectorSnapshot([{ docId: 'alert-1', vector: oldAlertVec }], TEXT_VECTOR_DIMS, 0);
  const decoded = decodeVectorSnapshot(baseBuf, TEXT_VECTOR_DIMS, 0);

  const normalizeF32 = (vec) => {
    const n = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return Float32Array.from(vec.map((v) => v / n));
  };

  // Superseded alertId skips old base vector and includes overlay vector
  const overlayHits = scanSnapshotTopK(decoded, query, 0.38, 24, {
    supersededAlertIds: new Set(['alert-1']),
    entries: [
      { docId: 'alert-1', alertId: 'alert-1', unitVector: normalizeF32(newAlertVec) },
      { docId: 'alert-2', alertId: 'alert-2', unitVector: normalizeF32(addedVec) },
    ],
  });
  assert.deepEqual(overlayHits.map((h) => h.docId), ['alert-2']);

  // >250 changes sets stale=true in loadDeltaOverlay
  const manifest = { snapshotId: 's1', coveredThrough: '2026-11-18T00:00:00.000Z' };
  const fakeChanges = Array.from({ length: 251 }, (_, i) => ({ get: () => `alert-${i}` }));
  const loadOverlay = fn('safety-gate-vector-snapshot', 'loadDeltaOverlay', {
    cachedOverlay: null,
    pendingOverlayLoad: null,
    MANIFEST_REFRESH_MS: 300000,
    MAX_DELTA_OVERLAY_CHANGES: 250,
    Timestamp,
  });
  const fakeDb = {
    collection: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => ({
            get: async () => ({ size: fakeChanges.length, docs: fakeChanges }),
          }),
        }),
      }),
    }),
  };
  const overlayState = await loadOverlay(fakeDb, manifest, false);
  assert.equal(overlayState.stale, true);

  // searchSafetyGateSnapshot returns null when overlay is stale
  const search = fn('safety-gate-vector-snapshot', 'searchSafetyGateSnapshot', {
    isVectorSnapshotEnabled: () => true,
    getFirestore: () => fakeDb,
    loadManifest: async () => manifest,
    loadChannelSnapshot: async () => decoded,
    loadDeltaOverlay: async () => overlayState,
  });
  assert.equal(await search('text', query, 12, 0.38), null);
});

test('retrieval uses snapshot with zero findNearest calls, returns [] with zero reads, and falls back when null', async () => {
  const vec = makeDeterministicVector(TEXT_VECTOR_DIMS, 7);

  // 1. Snapshot returns hit -> findNearest is never invoked
  let findNearestCalls = 0;
  const cachedWithHit = fn('safety-gate-checker-retrieval', 'retrieveAlertsFromCachedVectors', {
    getCachedMerchantProductVectors: async () => ({ textVector: vec }),
    searchSafetyGateSnapshot: async (channel) => {
      assert.equal(channel, 'text');
      return [{ id: 'A-1', data: { meta: { recordid: 'A-1' }, fields: { product_description: 'Toy' } }, distance: 0.08 }];
    },
    getFirestore: () => ({
      collection: () => ({
        findNearest: () => { findNearestCalls++; throw new Error('findNearest should not be called'); },
      }),
    }),
    normalizeRetrieverDocument: (doc, ch) => ({ id: doc.metadata.id, distance: doc.metadata.distance, [`${ch}Distance`]: doc.metadata.distance, fields: doc.metadata.fields, meta: doc.metadata.meta }),
    FIRESTORE_COLLECTIONS: { alerts: 'rapex_alerts', alertImages: 'rapex_alert_images' },
    RAG_TEXT_LIMIT: 12,
    RAG_IMAGE_LIMIT: 6,
    MATCHING_THRESHOLDS: { textDistance: 0.38, imageDistance: 0.35 },
  });
  const hits = await cachedWithHit({});
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'A-1');
  assert.equal(findNearestCalls, 0);

  // 2. Stage-1 empty -> searchSafetyGateSnapshot returns [] with 0 Firestore getAll reads
  let getAllCalls = 0;
  const zeroScan = fn('safety-gate-vector-snapshot', 'searchSafetyGateSnapshot', {
    isVectorSnapshotEnabled: () => true,
    getFirestore: () => ({
      collection: () => ({ doc: (id) => ({ id }), where: () => ({ limit: () => ({ get: async () => ({ empty: true, size: 0 }) }) }) }),
      getAll: async () => { getAllCalls++; return []; },
    }),
    loadManifest: async () => ({ snapshotId: 's1', coveredThrough: '2026-11-18T00:00:00.000Z' }),
    loadChannelSnapshot: async () => decodeVectorSnapshot(
      encodeVectorSnapshot([{ docId: 'far', vector: makeDeterministicVector(TEXT_VECTOR_DIMS, 999) }], TEXT_VECTOR_DIMS, 0),
      TEXT_VECTOR_DIMS,
      0,
    ),
    loadDeltaOverlay: async () => ({ stale: false, readThrough: Timestamp.now(), supersededAlertIds: new Set(), textEntries: [], imageEntries: [] }),
    scanSnapshotTopK: () => [],
    FIRESTORE_COLLECTIONS: { alerts: 'rapex_alerts', alertImages: 'rapex_alert_images' },
    GET_ALL_CHUNK: 100,
    exactCosineDistance,
    extractVectorArray: () => null,
    logger: { warn: () => {} },
  });
  assert.deepEqual(await zeroScan('text', vec, 12, 0.38), []);
  assert.equal(getAllCalls, 0);

  // 3. Snapshot returns null -> retrieveAlertsForVector falls back to Firestore findNearest
  let fallbackUsed = false;
  const fallbackForVec = fn('safety-gate-checker-retrieval', 'retrieveAlertsForVector', {
    searchSafetyGateSnapshot: async () => null,
    getFirestore: () => ({
      collection: () => ({
        findNearest: () => ({
          get: async () => {
            fallbackUsed = true;
            return {
              docs: [{ id: 'FB-1', data: () => ({ fields: { product_category: 'Toys', product_description: 'Desc' } }), get: (k) => (k === 'distance' ? 0.12 : undefined) }],
            };
          },
        }),
      }),
    }),
    normalizeRetrieverDocument: (doc, ch) => ({ id: doc.metadata.id, distance: doc.metadata.distance, [`${ch}Distance`]: doc.metadata.distance, fields: doc.metadata.fields, meta: {} }),
    hydrateAlertsIfMissing: async (rows) => rows,
    FIRESTORE_COLLECTIONS: { alerts: 'rapex_alerts' },
    VECTOR_TEXT_FIELD: 'vector_text',
  });
  const fbRes = await fallbackForVec(vec, 8, 0.22);
  assert.equal(fallbackUsed, true);
  assert.equal(fbRes.length, 1);
  assert.equal(fbRes[0].id, 'FB-1');
});

function searchFixture(records, { channel = 'text', limitBudget = 256, sourceChanged = false } = {}) {
  const dims = channel === 'text' ? TEXT_VECTOR_DIMS : IMAGE_VECTOR_DIMS;
  const decoded = decodeVectorSnapshot(encodeVectorSnapshot(records, dims, channel === 'text' ? 0 : 1), dims, channel === 'text' ? 0 : 1);
  let metrics;
  const fetched = [];
  const byId = new Map(records.map(row => [row.docId, row]));
  const search = fn('safety-gate-vector-snapshot', 'searchSafetyGateSnapshot', {
    isVectorSnapshotEnabled: () => true,
    getFirestore: () => ({
      collection: () => ({ doc: id => ({ id }), where: () => ({ limit: () => ({ get: async () => ({ empty: !sourceChanged, size: sourceChanged ? 1 : 0 }) }) }) }),
      getAll: async (...refs) => refs.map(ref => {
        fetched.push(ref.id);
        return { id: ref.id, exists: byId.has(ref.id), data: () => ({ vector_text: byId.get(ref.id)?.vector, vector_image: byId.get(ref.id)?.vector }) };
      }),
    }),
    loadManifest: async () => ({ snapshotId: 'v2', coveragePolicyVersion: 2 }),
    loadChannelSnapshot: async () => decoded,
    loadDeltaOverlay: async () => ({ stale: false, readThrough: Timestamp.now(), supersededAlertIds: new Set(), textEntries: [], imageEntries: [] }),
    scanSnapshotTopK, exactCosineDistance, extractVectorArray,
    MAX_EXACT_HYDRATION_ROWS: limitBudget, GET_ALL_CHUNK: 100,
    compareUtf8Ids: (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)),
    FIRESTORE_COLLECTIONS: { alerts: 'rapex_alerts', alertImages: 'rapex_alert_images' },
    logger: { warn() {} },
  });
  return {
    search: async (query, limit, cutoff) => search(channel, query, limit, cutoff, { onMetrics: value => { metrics = value; } }),
    fetched, metrics: () => metrics,
  };
}

function boundaryQuantizationFixture(dims = TEXT_VECTOR_DIMS, cosine = .620001) {
  const leading = dims === IMAGE_VECTOR_DIMS ? .82 : .8;
  const vector = [leading, ...Array(dims - 1).fill(Math.sqrt(1 - leading ** 2) / Math.sqrt(dims - 1))];
  const decoded = decodeVectorSnapshot(encodeVectorSnapshot([{ docId: 'target', vector }], dims, 0), dims, 0);
  const quantized = Array.from(decoded.vectors, value => value * decoded.scales[0]);
  const error = vector.map((value, i) => value - quantized[i]);
  const along = error.reduce((sum, value, i) => sum + value * vector[i], 0);
  const orthogonal = error.map((value, i) => value - along * vector[i]);
  const norm = Math.hypot(...orthogonal);
  const query = vector.map((value, i) => cosine * value + Math.sqrt(1 - cosine ** 2) * orthogonal[i] / norm);
  return { vector, query, quantized };
}

test('certified quantization bounds retain the previous false-negative counterexample in both dimensions', async () => {
  for (const dims of [TEXT_VECTOR_DIMS, IMAGE_VECTOR_DIMS]) {
    const { vector, query, quantized } = boundaryQuantizationFixture(dims);
    const exact = exactCosineDistance(query, vector);
    const approximate = 1 - query.reduce((sum, value, i) => sum + value * quantized[i], 0);
    assert.ok(exact < .38);
    assert.ok(approximate > .41); // previous fixed .03 margin lost the row
    const scan = scanSnapshotTopK(decodeVectorSnapshot(encodeVectorSnapshot([{ docId: 'target', vector }], dims, 0), dims, 0), query, .38, 1);
    assert.equal(scan.length, 1);
    assert.ok(scan[0].lowerBound <= exact);
    const fixture = searchFixture([{ docId: 'target', vector }], { channel: dims === TEXT_VECTOR_DIMS ? 'text' : 'image' });
    assert.equal((await fixture.search(query, 1, .38))[0].id, 'target');
  }
});

test('safe lower bounds find the true top result beyond the old 3x/24 approximate shortlist', async () => {
  const { vector, query } = boundaryQuantizationFixture(TEXT_VECTOR_DIMS, .82);
  const orth = vector.map((value, i) => value - .82 * query[i]);
  const normOrth = Math.hypot(...orth);
  const distractor = query.map((value, i) => .8 * value + .6 * orth[i] / normOrth);
  const records = Array.from({ length: 50 }, (_, i) => ({ docId: `distractor-${i}`, vector: distractor }));
  records.push({ docId: 'target', vector });
  const scan = scanSnapshotTopK(decodeVectorSnapshot(encodeVectorSnapshot(records, TEXT_VECTOR_DIMS, 0), TEXT_VECTOR_DIMS, 0), query, .38, 24);
  const oldApproximateRanking = [...scan].sort((a, b) => a.approxDistance - b.approxDistance);
  assert.equal(oldApproximateRanking.findIndex(row => row.docId === 'target'), 50);
  assert.ok(oldApproximateRanking.every(row => row.approxDistance < .38));
  const fixture = searchFixture(records);
  assert.deepEqual((await fixture.search(query, 1, .38)).map(row => row.id), ['target']);
  assert.ok(fixture.metrics().candidateRows > 24);
});

test('ambiguous exact rankings fall back at the I/O budget instead of truncating candidates', async () => {
  const query = makeDeterministicVector(TEXT_VECTOR_DIMS, 2);
  const records = Array.from({ length: 300 }, (_, i) => ({ docId: `same-${i}`, vector: query }));
  const fixture = searchFixture(records);
  assert.equal(await fixture.search(query, 1, .38), null);
  assert.equal(fixture.metrics().fallbackReason, 'exact_hydration_budget');
  assert.equal(fixture.metrics().exactDocumentReads, 256);
});

test('well-separated results stop exact reads early and report measured work', async () => {
  const query = makeDeterministicVector(TEXT_VECTOR_DIMS, 10);
  const records = [{ docId: 'target', vector: query }, ...Array.from({ length: 100 }, (_, i) => ({ docId: `far-${i}`, vector: makeDeterministicVector(TEXT_VECTOR_DIMS, 100 + i) }))];
  const fixture = searchFixture(records);
  assert.deepEqual((await fixture.search(query, 1, .38)).map(row => row.id), ['target']);
  assert.equal(fixture.metrics().exactDocumentReads, 1);
  assert.equal(fixture.metrics().scannedRows, 101);
  assert.equal(fixture.metrics().usedSnapshot, true);
});

test('changes during exact hydration invalidate both positive and empty snapshot answers', async () => {
  const query = makeDeterministicVector(TEXT_VECTOR_DIMS, 2);
  for (const records of [[{ docId: 'target', vector: query }], []]) {
    const fixture = searchFixture(records, { sourceChanged: true });
    assert.equal(await fixture.search(query, 1, .38), null);
    assert.equal(fixture.metrics().fallbackReason, 'source_changed_during_search');
  }
});

test('historical manifests require a new coverage policy before snapshot activation', () => {
  const parse = fn('safety-gate-vector-snapshot', 'parseManifestData', { VECTOR_SNAPSHOT_COVERAGE_POLICY: 2 });
  assert.equal(parse({ version: 1, snapshotId: 'legacy' }), null);
});

function manifestFixture(overrides = {}) {
  return {
    version: 1, coveragePolicyVersion: 2, snapshotId: 'base', builtAt: '2026-11-20T00:00:00.000Z', coveredThrough: '2026-11-20T00:00:00.000Z',
    bucket: 'synthetic', textObject: 'base/text', textCount: 0, textDims: TEXT_VECTOR_DIMS, textSha256: 'text', textBytes: 0,
    imageObject: 'base/image', imageCount: 0, imageDims: IMAGE_VECTOR_DIMS, imageSha256: 'image', imageBytes: 0,
    ...overrides,
  };
}

test('a later patch replays earlier missed journal changes before advancing its server checkpoint', async () => {
  const current = manifestFixture();
  const before = Timestamp.fromDate(new Date(current.coveredThrough));
  const through = Timestamp.fromDate(new Date('2026-11-20T02:30:00.000Z'));
  const journal = [
    { id: 'earlier-failed-patch', alertId: 'A', changedAt: Timestamp.fromDate(new Date('2026-11-20T01:00:00.000Z')) },
    { id: 'current', alertId: 'B', changedAt: Timestamp.fromDate(new Date('2026-11-20T02:01:00.000Z')) },
    { id: 'after-anchor', alertId: 'C', changedAt: Timestamp.fromDate(new Date('2026-11-20T03:00:00.000Z')) },
  ];
  const vector = makeDeterministicVector(TEXT_VECTOR_DIMS, 1);
  const imageVector = makeDeterministicVector(IMAGE_VECTOR_DIMS, 2);
  let published;
  const patches = [];
  const filters = [];
  const query = {
    where: (...args) => { filters.push(args); return query; }, orderBy: () => query, limit: () => query,
    get: async () => ({ empty: false, size: 2, docs: journal.filter(row => row.changedAt > before && row.changedAt <= through).map(row => ({ get: key => row[key] })) }),
  };
  const db = {
    collection: name => name === 'rapex_meta' ? { doc: () => ({ get: async () => ({ exists: true, data: () => current, readTime: through, updateTime: 'expected-version' }) }) }
      : name === 'rapex_changes' ? query : name === 'rapex_alerts' ? { doc: id => ({ id }) }
        : { where: () => ({ select: () => ({ get: async () => ({ docs: [{ id: 'image-A-current', get: key => ({ alertId: 'A', imageUrl: 'https://example.com/current.jpg', vector_image: imageVector })[key] }] }) }) }) },
    getAll: async (...refs) => refs.filter(ref => ref.id).map(ref => ({ id: ref.id, exists: true, get: () => vector })),
  };
  const patch = fn('safety-gate-vector-snapshot', 'patchVectorSnapshotIncremental', {
    getFirestore: () => db, FIRESTORE_COLLECTIONS: { meta: 'rapex_meta', alerts: 'rapex_alerts', alertImages: 'rapex_alert_images' },
    VECTOR_SNAPSHOT_META_DOC: 'vector_snapshot', Timestamp, TEXT_VECTOR_DIMS, IMAGE_VECTOR_DIMS,
    PAGINATION_LIMIT: 1000, GET_ALL_CHUNK: 100, IN_QUERY_CHUNK: 30, MAX_PATCH_JOURNAL_CHANGES: 10000,
    VECTOR_SNAPSHOT_COVERAGE_POLICY: 2, parseManifestData: value => value,
    extractVectorArray, quantizeUnitVector: value => ({ valid: Array.isArray(value) }), randomUUID,
    getVectorSnapshotBucketName: value => value,
    patchAndUploadSingleChannel: async (_bucket, _old, objectPath, dims, flags, rows, deleted, superseded) => {
      patches.push({ flags, ids: rows.map(row => row.docId), superseded: [...superseded].sort(), deleted: [...deleted] });
      return { objectPath, count: rows.length, sha256: 'next', bytes: dims };
    },
    publishManifest: async (_db, manifest, expectedVersion) => { assert.equal(expectedVersion, 'expected-version'); published = manifest; },
    logger: { warn() {} },
  });
  await patch({ textUpserts: [{ docId: 'B', vector }], imageUpserts: [], deletedImageDocIds: ['old-image-A'], coveredThrough: new Date('2026-11-20T02:00:00.000Z') });
  assert.deepEqual(patches[0].ids.sort(), ['A', 'B']);
  assert.deepEqual(patches[1].ids, ['image-A-current']);
  assert.deepEqual(patches[1].superseded, ['A', 'B']);
  assert.equal(published.coveredThrough, through.toDate().toISOString());
  assert.ok(filters.some(([field, operator, value]) => field === 'changedAt' && operator === '<=' && value.toMillis() === through.toMillis()));
  assert.equal(published.coveragePolicyVersion, 2);
});

test('patching a changed source removes all superseded image rows and retains all its current photos', () => {
  const vector = makeDeterministicVector(IMAGE_VECTOR_DIMS, 1);
  const base = decodeVectorSnapshot(encodeVectorSnapshot([
    { docId: 'removed-photo', alertId: 'A', imageUrl: 'https://example.com/old.jpg', vector },
    { docId: 'unrelated-photo', alertId: 'B', imageUrl: 'https://example.com/b.jpg', vector },
  ], IMAGE_VECTOR_DIMS, 1), IMAGE_VECTOR_DIMS, 1);
  const result = decodeVectorSnapshot(patchDecodedSnapshot(base, [
    { docId: 'current-photo-1', alertId: 'A', imageUrl: 'https://example.com/a1.jpg', vector },
    { docId: 'current-photo-2', alertId: 'A', imageUrl: 'https://example.com/a2.jpg', vector },
  ], new Set(), new Set(['A'])), IMAGE_VECTOR_DIMS, 1);
  assert.deepEqual(result.docIds, ['current-photo-1', 'current-photo-2', 'unrelated-photo']);
});

test('concurrent manifest publication uses an updateTime CAS and keeps immutable rollback manifests', async () => {
  let revision = 1;
  const expected = { revision: 1 };
  let pointer = 'base';
  let serial = Promise.resolve();
  const saved = [];
  const db = {
    collection: () => ({ doc: () => ({ id: 'vector_snapshot' }) }),
    runTransaction: callback => {
      const result = serial.then(async () => {
        let next;
        await callback({
          get: async () => ({ exists: true, updateTime: { isEqual: value => value.revision === revision } }),
          set: (_ref, manifest) => { next = manifest; },
        });
        if (next) { pointer = next.snapshotId; revision++; }
      });
      serial = result.catch(() => {});
      return result;
    },
  };
  const publish = fn('safety-gate-vector-snapshot', 'publishManifest', {
    getStorage: () => ({ bucket: () => ({ file: path => ({ save: async value => { saved.push({ path, value }); } }) }) }),
    FIRESTORE_COLLECTIONS: { meta: 'rapex_meta' }, VECTOR_SNAPSHOT_META_DOC: 'vector_snapshot', resetVectorSnapshotCacheForTests() {},
  });
  const results = await Promise.allSettled([
    publish(db, manifestFixture({ snapshotId: 'writer-1' }), expected),
    publish(db, manifestFixture({ snapshotId: 'writer-2' }), expected),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(pointer, 'writer-1');
  assert.deepEqual(saved.map(entry => entry.path).sort(), ['snapshots/writer-1/manifest.json', 'snapshots/writer-2/manifest.json']);
});

test('a new journal entry is visible immediately rather than reusing a completed five-minute overlay', async () => {
  const vector = makeDeterministicVector(TEXT_VECTOR_DIMS, 1);
  let reads = 0;
  const query = { where: () => query, orderBy: () => query, limit: () => query, get: async () => {
    reads++;
    return { readTime: Timestamp.now(), size: reads === 1 ? 0 : 1, docs: reads === 1 ? [] : [{ get: () => 'new-source' }] };
  } };
  const db = { collection: () => ({ ...query, doc: id => ({ id }) }), getAll: async () => [{ id: 'new-source', exists: true, get: () => vector }] };
  const normalize = fn('safety-gate-vector-snapshot', 'normalizeUnitVectorF64');
  const load = fn('safety-gate-vector-snapshot', 'loadDeltaOverlay', {
    pendingOverlayLoad: null, MAX_DELTA_OVERLAY_CHANGES: 250, Timestamp, GET_ALL_CHUNK: 100,
    FIRESTORE_COLLECTIONS: { alerts: 'rapex_alerts' }, TEXT_VECTOR_DIMS, extractVectorArray,
    normalizeUnitVectorF64: normalize,
  });
  const first = await load(db, manifestFixture(), false);
  const next = await load(db, manifestFixture(), false);
  assert.equal(first.textEntries.length, 0);
  assert.deepEqual(next.textEntries.map(row => row.docId), ['new-source']);
  assert.equal(reads, 2);
});

test('an image-only weekly repair journals its vector atomically even when alert facts are unchanged', async () => {
  const { database, FieldValue, collections } = await import('./helpers/isolated-source.mjs');
  const db = database();
  const fields = { caseNumber: 'fixture', pictures: ['https://example.com/new.jpg'] };
  const contentHash = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  db.rows.set('rapex_alerts/A', { fields, meta: { content_hash: contentHash, record_timestamp: 'old' }, vector_text: FieldValue.vector([.1]) });
  const commits = [];
  db.batch = () => {
    const writes = [];
    return {
      set: (ref, value) => writes.push({ ref, value }),
      commit: async () => { commits.push(writes); for (const write of writes) db.rows.set(write.ref.path, write.value); },
    };
  };
  const ingest = fn('safety-gate-weekly-loader', 'ingestWeeklyNotification', {
    db, FieldValue, Timestamp, createHash, randomUUID, FIRESTORE_COLLECTIONS: collections,
    parseReportDate: () => new Date('2026-11-20'), buildWeeklyAlertFields: () => fields,
    findExistingAlertDocId: async () => 'A', buildAlertImageDocId: () => 'photo-A',
    embedImage: async () => [.2], embedText: async () => { throw new Error('Existing text must be reused'); },
  });
  const result = await ingest({ caseNumber: 'fixture', pictures: fields.pictures });
  assert.equal(result.updated, false);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].length, 2);
  assert.equal(commits[0][0].ref.path, 'rapex_alert_images/photo-A');
  assert.ok(commits[0][1].ref.path.startsWith('rapex_changes/'));
  assert.equal(commits[0][1].value.alertId, 'A');
});

test('Stage-2 hydration batch stops early when lowerBound exceeds tightened top-K threshold', async () => {
  const unit = (vec) => {
    const n = Math.hypot(...vec);
    return vec.map(v => v / n);
  };
  const q = unit([1, 0, ...Array(TEXT_VECTOR_DIMS - 2).fill(0)]);
  const orth = unit([0, 1, ...Array(TEXT_VECTOR_DIMS - 2).fill(0)]);
  const atDist = (d) => {
    const cos = 1 - d;
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    return q.map((v, i) => cos * v + sin * orth[i]);
  };
  // 25 tight candidates around distance 0.14..0.141 + 5 looser candidates at distance 0.25.
  // With scale ~ 0.86/127 and ||q||_1 = 1, scale/2 ~ 0.0034 so 0.141 peers have lowerBound < 0.14.
  const records = [
    { docId: 'tight-target', vector: atDist(0.14) },
    ...Array.from({ length: 24 }, (_, i) => ({ docId: `tight-peer-${String(i).padStart(2, '0')}`, vector: atDist(0.141) })),
    ...Array.from({ length: 5 }, (_, i) => ({ docId: `loose-tail-${i}`, vector: atDist(0.25) })),
  ];
  const fixture = searchFixture(records);
  const hits = await fixture.search(q, 1, 0.38);
  assert.deepEqual(hits.map(h => h.id), ['tight-target']);
  assert.equal(fixture.metrics().candidateRows, 30);
  // Batch 0 reads 24 rows (finding tight-target at 0.14 -> threshold=0.14),
  // batch 1 only reads the single remaining tight peer (lowerBound < 0.14) and stops before loose-tail-*.
  assert.equal(fixture.metrics().exactDocumentReads, 25);
  assert.ok(!fixture.fetched.some(id => id.startsWith('loose-tail-')));
});

test('patchVectorSnapshotIncremental is a no-op when delta and journal have no changes or clock regresses', async () => {
  const current = manifestFixture({ coveredThrough: '2026-11-20T05:00:00.000Z' });
  let patchCalls = 0;
  let publishCalls = 0;
  const makePatch = (readTimeIso, journalDocs = []) => {
    const query = {
      where: () => query, orderBy: () => query, limit: () => query,
      get: async () => ({ empty: journalDocs.length === 0, size: journalDocs.length, docs: journalDocs }),
    };
    const db = {
      collection: name => name === 'rapex_meta'
        ? { doc: () => ({ get: async () => ({ exists: true, data: () => current, readTime: Timestamp.fromDate(new Date(readTimeIso)), updateTime: 'v1' }) }) }
        : query,
    };
    return fn('safety-gate-vector-snapshot', 'patchVectorSnapshotIncremental', {
      getFirestore: () => db,
      FIRESTORE_COLLECTIONS: { meta: 'rapex_meta', alerts: 'rapex_alerts', alertImages: 'rapex_alert_images' },
      VECTOR_SNAPSHOT_META_DOC: 'vector_snapshot', Timestamp, TEXT_VECTOR_DIMS, IMAGE_VECTOR_DIMS,
      PAGINATION_LIMIT: 1000, GET_ALL_CHUNK: 100, IN_QUERY_CHUNK: 30, MAX_PATCH_JOURNAL_CHANGES: 10000,
      parseManifestData: value => value,
      patchAndUploadSingleChannel: async () => { patchCalls++; throw new Error('must not patch'); },
      publishManifest: async () => { publishCalls++; throw new Error('must not publish'); },
      logger: { warn() {} },
    });
  };

  // Empty delta & empty journal
  const noChange = await makePatch('2026-11-20T06:00:00.000Z')({
    textUpserts: [], imageUpserts: [], deletedImageDocIds: [], coveredThrough: new Date('2026-11-20T06:00:00.000Z'),
  });
  assert.equal(noChange, current);

  // Clock regression readTime < current.coveredThrough
  const backward = await makePatch('2026-11-20T04:00:00.000Z')({
    textUpserts: [], imageUpserts: [], deletedImageDocIds: [], coveredThrough: new Date('2026-11-20T04:00:00.000Z'),
  });
  assert.equal(backward, current);
  assert.equal(patchCalls, 0);
  assert.equal(publishCalls, 0);
});
