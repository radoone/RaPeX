import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidateAnalysisSchema } from '../lib/safety-gate-checker.schemas.js';
import { sourceFunction } from './helpers/isolated-source.mjs';

const realId = '70963128ec44510d9bc5b0b3e49d2b2d20abfdad';
const mistypedId = '70963128ec45510d9bc5b0b3e49d2b2d20abfdad';
const match = id => ({ alertId: id, overallSimilarity: 85, textSimilarity: 90, identityAssessment: 'uncertain', identityConflict: false, visualEvidence: [], reason: 'Compare exact model and batch.' });

test('request schema permits only actual candidates, including empty no-match results', () => {
  const schema = createCandidateAnalysisSchema([realId, 'second', realId]);
  assert.equal(schema.safeParse([match(realId)]).success, true);
  assert.equal(schema.safeParse([match('second')]).success, true);
  assert.equal(schema.safeParse([]).success, true);
  assert.equal(schema.safeParse([match(mistypedId)]).success, false);
  assert.equal(schema.safeParse([match('unrelated')]).success, false);
  assert.equal(schema.safeParse([{ ...match(realId), overallSimilarity: 101 }]).success, false);
  assert.equal(schema.safeParse([match(realId), match('second'), match(realId)]).success, false);
  assert.throws(() => createCandidateAnalysisSchema([]), /Missing analysis candidates/);
});

test('matcher sends candidate-restricted output schema to the provider instead of the generic prompt schema', async () => {
  let calls = 0;
  const analyze = sourceFunction('safety-gate-checker', 'analyzeProductMatches', {
    createCandidateAnalysisSchema,
    AI_CONFIG: { primaryModel: 'flash', fallbackModel: 'lite' },
    buildPromptParts: async () => ({ productImages: [], alertImages: [], analysis: { productImagesProvided: 0, productImagesUsed: 0, alertImagesUsed: 0 } }),
    runAnalysisAttempts: async (attempts, work) => work(attempts[0], new AbortController().signal),
    productMatchAnalysisPrompt: { render: async () => ({ messages: [], output: { format: 'json', schema: 'generic-prompt-schema' } }) },
    vertexAI: { model: name => name },
    appendMediaMessages: messages => messages,
    functionsAi: { generate: async options => {
      calls++;
      assert.equal(options.output.format, 'json');
      assert.equal(options.config.location, 'global');
      assert.equal(options.output.schema.safeParse([match(realId)]).success, true);
      assert.equal(options.output.schema.safeParse([match(mistypedId)]).success, false);
      return { text: '[]' };
    } },
  });
  await analyze({ name: 'Alpaca' }, [{ id: realId }], 'comparison', async () => null);
  assert.equal(calls, 1);
});
