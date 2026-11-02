import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnalysisMatchesSchema } from '../lib/safety-gate-checker.schemas.js';
import { buildSafetyCheckResult } from '../lib/safety-gate-checker-results.js';

const match = { alertId: 'source', overallSimilarity: 92, textSimilarity: 92, identityAssessment: 'same_model', reason: 'Same brand and model.' };
test('model output accepts bounded similarity judgements and empty lists without source records', () => {
  assert.deepEqual(AnalysisMatchesSchema.parse([]), []);
  assert.deepEqual(AnalysisMatchesSchema.parse([match]), [match]);
  assert.equal(AnalysisMatchesSchema.safeParse([{...match, reason: 'x'.repeat(1501)}]).success, false);
  assert.equal(AnalysisMatchesSchema.safeParse(Array(13).fill(match)).success, false);
  assert.equal(AnalysisMatchesSchema.safeParse([{...match, overallSimilarity: 101}]).success, false);
  const prompt=readFileSync(new URL('../prompts/productMatchAnalysis.prompt',import.meta.url),'utf8');
  assert.match(prompt,/schema: SafetyGateAnalysisMatches/);
  assert.doesNotMatch(prompt,/schema:\s*\n\s*- SafetyGateMatch/);
});

test('model-supplied source fields cannot replace actual Safety Gate evidence', () => {
  const matches=AnalysisMatchesSchema.parse([{...match,alertDetails:{fields:{name:'Invented',url:'https://invented.invalid'}}}]);
  assert.equal(matches[0].alertDetails, undefined);
  const source={id:'source',meta:{recordid:'official',alert_date:'2026-11-02',ingested_at:'2026-11-02'},fields:{name:'Actual source',brand:'Actual brand',level:'Serious',url:'https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/123'}};
  const result=buildSafetyCheckResult(matches,[source],{mode:'text-only',scoringMode:'text-only',productImagesProvided:0,productImagesUsed:0,alertImagesUsed:0,candidateAlertsConsidered:1});
  assert.equal(result.warnings[0].alertDetails.fields.name,'Actual source');
  assert.equal(result.warnings[0].alertDetails.fields.url,source.fields.url);
});
