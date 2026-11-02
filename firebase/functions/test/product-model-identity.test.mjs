import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareExplicitModels, explicitProductModel } from '../lib/product-model-identity.js';
import { buildComparisonPrompt, buildSafetyCheckResult, parseAnalysisMatches } from '../lib/safety-gate-checker-results.js';

const product = { name: 'Akyga power supply', category: 'electrical', description: 'Model: AK-ND-07. Power adaptor.', brand: 'Akyga' };
const source = model => ({ id: 'official', meta: { recordid: 'official', alert_date: '', ingested_at: '' }, fields: { brand: 'Akyga', type_numberOfModel: model } });
const visual = { mode: 'with-image', scoringMode: 'image-first', productImagesProvided: 1, productImagesUsed: 1, alertImagesUsed: 1, candidateAlertsConsidered: 1, comparedImageAlertIds: ['official'] };
const match = { alertId: 'official', overallSimilarity: 99, textSimilarity: 99, imageSimilarity: 99, identityAssessment: 'same_model', reason: 'Similar appearance.' };

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

test('a visual identity needs images of this specific alert, not just some other candidate', () => {
  const result = buildSafetyCheckResult([{ ...match, identityAssessment: 'distinctive_visual' }], [source('Unknown')], { ...visual, comparedImageAlertIds: ['other'] }, { ...product, description: '' });
  assert.equal(result.warnings[0].identityAssessment, 'uncertain');
  assert.equal(result.warnings[0].imageSimilarity, undefined);
});

test('identifiers recognized only in photos are visual evidence, without inventing structured merchant identifiers', () => {
  const warning = buildSafetyCheckResult([match], [source('AK-ND-07')], visual, { ...product, description: '' }).warnings[0];
  assert.equal(warning.identityAssessment, 'distinctive_visual');
  assert.equal(warning.imageSimilarity, 99);
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
