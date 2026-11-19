import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareExplicitModels, explicitProductModel } from '../lib/product-model-identity.js';
import { buildComparisonPrompt, buildSafetyCheckResult, parseAnalysisMatches } from '../lib/safety-gate-checker-results.js';

const product = { name: 'Akyga power supply', category: 'electrical', description: 'Model: AK-ND-07. Power adaptor.', brand: 'Akyga' };
const source = model => ({ id: 'official', meta: { recordid: 'official', alert_date: '', ingested_at: '' }, fields: { brand: 'Akyga', type_numberOfModel: model } });
const visual = { mode: 'with-image', scoringMode: 'image-first', productImagesProvided: 1, productImagesUsed: 1, alertImagesUsed: 1, candidateAlertsConsidered: 1, comparedImageAlertIds: ['official'] };
const match = { alertId: 'official', overallSimilarity: 99, textSimilarity: 99, imageSimilarity: 99, identityAssessment: 'same_model', identityConflict: false, visualEvidence: [], reason: 'Similar appearance.' };

test('explicit model comparison ignores formatting, supports model lists, and never infers a model from category/title', () => {
  assert.equal(explicitProductModel(product), 'AK-ND-07');
  assert.equal(compareExplicitModels(product, source('ak nd 07')), 'equal');
  assert.equal(compareExplicitModels({ ...product, model: 'AK-ND-07; AK-ND-08' }, source('AK-ND-08')), 'equal');
  assert.equal(compareExplicitModels({ ...product, description: '', name: 'AK-ND-07' }, source('AK-ND-07')), 'unknown');
  assert.equal(compareExplicitModels(product, source('Unknown')), 'unknown');
  assert.equal(compareExplicitModels(product, source('AK-ND-44')), 'different');
});

test('a 99-percent model/visual claim cannot override an explicit conflicting model', () => {
  const result = buildSafetyCheckResult([match], [source('AK-ND-44')], visual, product);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.isSafe, true);
  assert.equal(buildSafetyCheckResult([match], [source('AK-ND-07')], visual, product).warnings[0].identityAssessment, 'same_model');
});

test('a model prefix remains an uncertain warning rather than becoming safe or a confirmed identity', () => {
  const p = { ...product, model: 'LK-003' };
  assert.equal(compareExplicitModels(p, source('LK-003-A004')), 'variant');
  const warning = buildSafetyCheckResult([match], [source('LK-003-A004')], visual, p).warnings[0];
  assert.equal(warning.identityAssessment, 'uncertain');
  assert.match(warning.reason, /Identity not confirmed/);
});

test('an omitted same-brand model family still requires review, without inventing visual or text measurements', () => {
  const p = { ...product, model: 'LK-003' };
  const warning = buildSafetyCheckResult([], [source('LK-003-A004')], visual, p).warnings[0];
  assert.equal(warning.identityAssessment, 'uncertain');
  assert.equal(warning.matchBasis, 'model_family');
  assert.equal(warning.imageSimilarity, undefined);
  assert.equal(warning.textSimilarity, undefined);
  assert.equal(warning.scoreBreakdown, undefined);
  assert.match(warning.reason, /not a measured visual similarity/);
  const unrelated = { ...source('LK-003-A004'), fields: { ...source('LK-003-A004').fields, brand: 'Another maker' } };
  assert.deepEqual(buildSafetyCheckResult([], [unrelated], visual, p).warnings, []);
});

test('a visual identity needs images of this specific alert, not just some other candidate', () => {
  const result = buildSafetyCheckResult([{ ...match, identityAssessment: 'distinctive_visual' }], [source('Unknown')], { ...visual, comparedImageAlertIds: ['other'] }, { ...product, description: '' });
  assert.deepEqual(result.warnings, []);
});

test('beta false positives cannot turn a category, barcode fragment or different model into identity', () => {
  const cases = [
    [{ name: 'TEST Toy train model ZR-0030', category: 'toy train', description: 'Fictional toy train. Model ZR-0030.', brand: 'ZeroRecall Test' }, { brand: 'OFKPO', product: 'Electric toy train', barcode: '6959102100030' }, 85],
    [{ name: 'TEST Kitchen bowl model ZR-0438', category: 'kitchen bowl', description: 'Fictional kitchen bowl. Model ZR-0438.', brand: 'ZeroRecall Test' }, { brand: 'Not specified', product: 'Kitchen timer', type_numberOfModel: 'not specified' }, 50],
    [{ name: 'TEST Building blocks model ZR-0414', category: 'building blocks', description: 'Fictional building blocks. Model ZR-0414.', brand: 'ZeroRecall Test' }, { brand: 'TOINSA', product: 'Building blocks', type_numberOfModel: 'Ref. 03-1414' }, 70],
  ];
  for (const [p, fields, score] of cases) {
    const a = { ...source('Unknown'), fields };
    const result = buildSafetyCheckResult([{ ...match, identityAssessment: 'uncertain', overallSimilarity: score, textSimilarity: score }], [a], { ...visual, scoringMode: 'text-only', productImagesUsed: 0 }, p);
    assert.deepEqual(result.warnings, [], p.name);
  }
  assert.equal(explicitProductModel(cases[2][0]), 'ZR-0414');
  assert.equal(compareExplicitModels(cases[2][0], { ...source('Unknown'), fields: cases[2][1] }), 'different');
  assert.equal(explicitProductModel({ ...product, description: 'A model train for children.' }), '');
});

test('uncertain text-only branded product names and related models stay reviewable', () => {
  const p = { name: 'Acme Star Cruiser deluxe', category: 'toy', brand: 'Acme', description: '' };
  const a = { ...source('Unknown'), fields: { brand: 'Acme', name: 'Star Cruiser', product: 'Toy' } };
  const input = { ...visual, scoringMode: 'text-only', productImagesUsed: 0 };
  assert.equal(buildSafetyCheckResult([{ ...match, identityAssessment: 'uncertain' }], [a], input, p).warnings.length, 1);
  assert.equal(buildSafetyCheckResult([{ ...match, identityAssessment: 'uncertain' }], [{ ...a, fields: { ...a.fields, brand: 'Other' } }], input, p).warnings.length, 0);
});

test('identifiers recognized only in photos are visual evidence, without inventing structured merchant identifiers', () => {
  const warning = buildSafetyCheckResult([{ ...match, visualEvidence: ['Same complete printed AK-ND-07 label layout', 'Same distinctive plug/cable outlet and casing mould'] }], [source('AK-ND-07')], visual, { ...product, description: '' }).warnings[0];
  assert.equal(warning.identityAssessment, 'distinctive_visual');
  assert.equal(warning.imageSimilarity, 99);
});

test('a renamed/rebranded listing can match through distinctive photos despite different local model codes', () => {
  const p = { ...product, brand: 'Local Retail Brand', model: 'LOCAL-123' };
  const supported = { ...match, identityAssessment: 'distinctive_visual', visualEvidence: ['Identical asymmetric connector bracket and screw layout', 'Identical three-part casing seam and cable outlet'] };
  assert.equal(buildSafetyCheckResult([supported], [source('AK-ND-07')], visual, p).warnings[0].identityAssessment, 'distinctive_visual');
  for (const rejected of [
    { ...supported, identityConflict: true },
    { ...supported, imageSimilarity: 70 },
    { ...supported, visualEvidence: [] },
    { ...supported, visualEvidence: ['detail', ' DETAIL '] },
  ]) assert.deepEqual(buildSafetyCheckResult([rejected], [source('AK-ND-07')], visual, p).warnings, []);
  assert.deepEqual(buildSafetyCheckResult([supported], [source('AK-ND-07')], { ...visual, comparedImageAlertIds: ['other'] }, p).warnings, []);
});

test('generic visual uncertainty cannot turn the CP laser into a ZK identity', () => {
  const p = { name: 'ZK Laser', category: 'Laser pointers', brand: 'ZK', model: 'ZK-9110', description: 'Length 6.72 cm.' };
  const a = { ...source(''), fields: { brand: 'CP', description: 'Length 7.45 cm; transparent cap and different switches.' } };
  assert.deepEqual(buildSafetyCheckResult([{ ...match, identityAssessment: 'uncertain', textSimilarity: 50, imageSimilarity: 70 }], [a], visual, p).warnings, []);
  assert.deepEqual(buildSafetyCheckResult([{ ...match, identityConflict: true, visualEvidence: ['claimed detail one', 'claimed detail two'] }], [a], visual, p).warnings, []);
});

test('the model sees actual source construction, dimensions and batch facts, not only hypothetical danger', () => {
  const alert = source('CP');
  alert.fields.description = 'Length 7.45 cm; transparent front cap.';
  alert.fields.batchNumber = 'batch-A';
  alert.fields.barcode = '5901720130549';
  const prompt = buildComparisonPrompt(product, [alert]);
  assert.match(prompt, /Length 7.45 cm; transparent front cap/);
  assert.match(prompt, /Batch \/ production codes: batch-A/);
  assert.match(prompt, /not a validated merchant identifier match/);
});

test('missing or invalid identity assessments fail closed instead of being silently certain', () => {
  for (const value of [undefined, 'confirmed_safe', false]) assert.throws(() => parseAnalysisMatches({ output: [{ ...match, identityAssessment: value }], text: '' }), /Invalid/);
  assert.equal(parseAnalysisMatches({ output: [match], text: '' })[0].identityAssessment, 'same_model');
});

test('the fifteen fixed regression pairs contain positives, hard negatives and an uncertain batch with public provenance', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/matcher-identity-15.json', import.meta.url)));
  assert.equal(fixture.pairs.length, 15);
  assert.equal(new Set(fixture.pairs.map(p => p.id)).size, 15);
  assert.equal(fixture.pairs.filter(p => p.expected === 'no_match').length, 8);
  assert.equal(fixture.pairs.filter(p => p.expected === 'uncertain').length, 1);
  for (const p of fixture.pairs) {
    assert.match(p.alert.fields.url, /^https:\/\/ec\.europa\.eu\//);
    assert.ok(p.labelReason);
    assert.equal(p.product.shop, undefined);
  }
});
