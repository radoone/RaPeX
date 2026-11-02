// Fixed public regression cases, not a catalog scan or a held-out accuracy benchmark.
// Run from firebase/functions after npm run build; output files must be new.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { db } from '../lib/firebase-admin.js';
import { embedTexts, embedImage, buildEmbeddingText } from '../lib/safety-gate-embeddings.js';
import { retrieveAlertsForVector, retrieveAlertsByGtins } from '../lib/safety-gate-checker-retrieval.js';
import { checkProductAgainstAlerts } from '../lib/safety-gate-checker.js';
import { mapBounded } from '../lib/matching-work.js';
import { MATCHING_THRESHOLDS, AI_CONFIG } from '../lib/safety-gate-config.js';

const [mode, input, output] = process.argv.slice(2);
if (!['prepare', 'predict', 'api'].includes(mode) || !input || !output) throw Error('Usage: node scripts/verify-identity-pairs.mjs prepare fixture.json NEW.json | predict retrieval.json NEW.json | api retrieval.json NEW.json');
if (existsSync(output)) throw Error('Refusing to overwrite evidence: ' + output);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const save = value => writeFileSync(output, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const fingerprint = product => createHash('sha256').update(JSON.stringify(product)).digest('hex');

if (mode === 'prepare') {
  const fixture = read(input);
  const groups = [...new Map(fixture.pairs.map(pair => [fingerprint(pair.product), { key: fingerprint(pair.product), product: pair.product }])).values()];
  // Exact identifiers are looked up before any embeddings or vector queries.
  for (const group of groups) group.exact = await retrieveAlertsByGtins(group.product);
  const needsVectors = groups.filter(group => !group.exact.length);
  const texts = needsVectors.map(group => buildEmbeddingText({ ...group.product, title: group.product.name }));
  const vectors = await embedTexts(texts);
  if (vectors.length !== texts.length || vectors.some(v => !v?.length)) throw Error('Incomplete batch embeddings; no predictions produced');
  const urls = [...new Set(needsVectors.flatMap(group => group.product.imageUrls || []))];
  const embedded = await mapBounded(urls, 4, async url => {
    const vector = await embedImage(url);
    if (!vector?.length) throw Error('Image embedding unavailable: ' + url);
    const snap = await db.collection('rapex_alert_images').findNearest({ vectorField: 'vector_image', queryVector: vector, limit: 6, distanceMeasure: 'COSINE', distanceResultField: 'distance' }).get();
    return [url, snap.docs.filter(d => d.get('distance') <= MATCHING_THRESHOLDS.imageDistance).map(d => ({ id: d.get('alertId'), distance: d.get('distance'), imageUrl: d.get('imageUrl') }))];
  });
  const imageHits = new Map(embedded);
  await mapBounded(needsVectors, 4, async group => {
    const index = needsVectors.indexOf(group);
    group.candidates = await retrieveAlertsForVector(vectors[index], 12, MATCHING_THRESHOLDS.textDistance);
    const allHits = (group.product.imageUrls || []).flatMap(url => imageHits.get(url) || []);
    const imageIds = [...new Set(allHits.map(hit => hit.id))];
    if (imageIds.some(id => typeof id !== 'string' || !id)) throw Error('Invalid source image index');
    if (imageIds.length) {
      const docs = await db.getAll(...imageIds.map(id => db.collection('rapex_alerts').doc(id)));
      for (const doc of docs) {
        if (!doc.exists) throw Error('Source missing for image vector');
        const hits = allHits.filter(hit => hit.id === doc.id).sort((a, b) => a.distance - b.distance);
        const data = doc.data(), at = group.candidates.findIndex(a => a.id === doc.id);
        const old = group.candidates[at];
        const pictures = data.fields.pictures || [];
        const matched = [...new Set(hits.map(hit => hit.imageUrl).filter(url => pictures.includes(url)))];
        const candidate = { id: doc.id, meta: data.meta, fields: { ...data.fields, pictures: [...matched, ...pictures.filter(url => !matched.includes(url))] }, source: 'retriever', distance: Math.min(old?.distance ?? Infinity, hits[0].distance), matchedImageUrls: matched };
        if (at < 0) group.candidates.push(candidate); else group.candidates[at] = candidate;
      }
    }
    group.candidates.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  });
  for (const group of groups) if (group.exact.length) group.candidates = group.exact;
  save({ at: new Date().toISOString(), fixture, groups, config: { textLimit: 12, imageLimitPerPhoto: 6, ...MATCHING_THRESHOLDS }, evidence: { eanFirst: true, textEmbeddingBatchSize: texts.length, distinctImageEmbeddings: urls.length, source: 'live Firestore KNN; no forced candidate injection' } });
  console.log(JSON.stringify({ groups: groups.length, batchEmbeddings: texts.length, pairs: fixture.pairs.length, retrievedPairs: fixture.pairs.filter(pair => groups.find(g => g.key === fingerprint(pair.product)).candidates.some(a => a.id === pair.alert.id)).length }));
} else {
  const prepared = read(input), calls = [];
  const results = await mapBounded(prepared.groups, 2, async group => {
    const start = Date.now();
    try {
      let result;
      if (mode === 'api') {
        if (!process.env.SAFETY_GATE_API_KEY) throw Error('Runtime API key is required');
        const response = await fetch('https://europe-west1-rapex-99a2c.cloudfunctions.net/checkProductSafetyAPI', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.SAFETY_GATE_API_KEY }, body: JSON.stringify(group.product), signal: AbortSignal.timeout(250000) });
        if (!response.ok) throw Error('Live checker HTTP ' + response.status);
        result = await response.json();
      } else {
        result = await checkProductAgainstAlerts(group.product, group.candidates);
      }
      const call = { key: group.key, milliseconds: Date.now() - start, result };
      calls.push(call); console.log(JSON.stringify({ group: group.key.slice(0, 8), milliseconds: call.milliseconds, warnings: result.warnings.length, mode }));
      return call;
    } catch (error) {
      const call = { key: group.key, milliseconds: Date.now() - start, error: String(error) };
      calls.push(call); console.log(JSON.stringify({ group: group.key.slice(0, 8), error: call.error, mode }));
      return call;
    }
  });
  const pairs = prepared.fixture.pairs.map(pair => {
    const key = fingerprint(pair.product), group = prepared.groups.find(g => g.key === key), call = results.find(c => c.key === key);
    const retrieved = group.candidates.some(a => a.id === pair.alert.id);
    const warning = call.result?.warnings.find(w => w.alertId === pair.alert.id);
    const actual = call.error ? 'unavailable' : warning ? warning.identityAssessment || 'unclassified' : 'no_match';
    const expected = pair.expected;
    const identifierEvidenceValid = expected !== 'identifier' ||
      (warning?.identifierMatches?.length === pair.product.barcodes.length && call.result?.warnings[0]?.matchBasis === 'gtin' && warning.imageSimilarity === undefined && warning.textSimilarity === undefined);
    const passed = actual === expected && (expected === 'no_match' || retrieved) && identifierEvidenceValid;
    return { id: pair.id, expected, actual, passed, preparedTargetRetrieved: retrieved, modelEligibleInPreparedRun: retrieved && !group.exact.length, identifierEvidenceValid, warning, error: call.error };
  });
  const summary = { pairs: pairs.length, passed: pairs.filter(p => p.passed).length, unavailable: pairs.filter(p => p.actual === 'unavailable').length, ean: pairs.filter(p => p.expected === 'identifier').length, aiPositive: pairs.filter(p => ['same_model', 'distinctive_visual'].includes(p.expected)).length, negatives: pairs.filter(p => p.expected === 'no_match').length, uncertain: pairs.filter(p => p.expected === 'uncertain').length };
  save({ at: new Date().toISOString(), mode, fixtureVersion: prepared.fixture.version, modelConfig: AI_CONFIG, summary, pairs, calls, provenance: prepared.fixture.provenance, note: mode === 'api' ? 'Actual deployed endpoint performs its own GTIN and text/image retrieval; preparedTargetRetrieved is separate preparatory evidence, not a claim about its exact live shortlist.' : 'Predictions run only on the real prepared vector/GTIN shortlist. Not retrieved is recorded; no source is injected to force a model test.' });
  console.log(JSON.stringify(summary));
  if (summary.passed !== summary.pairs) process.exitCode = 1;
}
