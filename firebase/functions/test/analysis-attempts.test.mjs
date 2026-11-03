import test from 'node:test';
import assert from 'node:assert/strict';
import { isPermanentProviderFailure, runAnalysisAttempts } from '../lib/analysis-attempts.js';

test('billing/auth failures stop retries that use the same provider account', async () => {
  for (const error of [Object.assign(new Error('payment'), {status: 402}), new Error('[402 Payment Required] Your prepayment credits are depleted.'), {cause: {code: 403}}, {status: 'PERMISSION_DENIED'}]) {
    let calls = 0;
    assert.equal(isPermanentProviderFailure(error), true);
    assert.equal(await runAnalysisAttempts([1,2,3,4], async () => { calls++; throw error; }, () => {}), null);
    assert.equal(calls, 1);
  }
});

test('transient/media failures retain model and text fallback opportunities', async () => {
  const calls = [];
  const result = await runAnalysisAttempts(['image', 'text'], async (attempt, signal) => {
    calls.push(attempt); assert.equal(signal.aborted, false);
    if (attempt === 'image') throw new Error('unsupported mime');
    return {matches: []};
  }, () => {});
  assert.deepEqual(calls, ['image', 'text']);
  assert.deepEqual(result, {matches: []});
  assert.equal(isPermanentProviderFailure({status: 429}), false);
});

test('hung model calls are aborted and cannot exhaust an entire task deadline', async () => {
  const signals = [];
  const result = await runAnalysisAttempts([1,2,3,4], async (_, signal) => {
    signals.push(signal);
    return new Promise(() => {});
  }, () => {}, {attemptMs: 15, totalMs: 25});
  assert.equal(result, null);
  assert.ok(signals.length <= 2);
  assert.ok(signals.every(signal => signal.aborted));
});

test('all failed attempts remain unavailable rather than a safe result', async () => {
  let failures = 0;
  assert.equal(await runAnalysisAttempts([1,2], async () => {throw new Error('unavailable');}, () => {failures++;}), null);
  assert.equal(failures, 2);
});
