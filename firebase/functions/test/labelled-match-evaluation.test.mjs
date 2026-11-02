import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../scripts/evaluate-labelled-matches.mjs";

test("reports confusion matrices and does not count unavailable predictions as negatives", () => {
  const result = evaluate([
    { id: "a", label: true, predictions: { text: true, image: null } },
    { id: "b", label: true, predictions: { text: false, image: true } },
    { id: "c", label: false, predictions: { text: true, image: false } },
    { id: "d", label: false, predictions: { text: false } },
  ]);
  assert.deepEqual(result.modes.text, { total: 4, evaluated: 4, unavailable: 0, tp: 1, fp: 1, tn: 1, fn: 1, precision: 0.5, recall: 0.5, falsePositiveRate: 0.5 });
  assert.equal(result.modes.image.unavailable, 2);
  assert.equal(result.modes.image.recall, 1);
});

test("rejects ambiguous labels and duplicate pairs", () => {
  assert.throws(() => evaluate([{ id: "x", label: "true", predictions: { text: true } }]));
  assert.throws(() => evaluate([{ id: "x", label: true, predictions: { text: true } }, { id: "x", label: false, predictions: { text: false } }]));
  assert.throws(() => evaluate([]));
});


test("compares modes on a shared eligible cohort and reports zero coverage honestly", () => {
  const report = evaluate([
    { id: "one", label: true, predictions: { text: true, image: null } },
    { id: "two", label: false, predictions: { text: true, image: false } },
  ]);
  assert.equal(report.commonCohort.pairs, 1);
  assert.equal(report.commonCohort.modes.text.falsePositiveRate, 1);
  assert.equal(report.commonCohort.modes.image.falsePositiveRate, 0);
  assert.equal(report.commonCohort.modes.image.recall, null);
  const empty = evaluate([{ id: "unavailable", label: true, predictions: { text: null } }]);
  assert.equal(empty.commonCohort.pairs, 0);
  assert.equal(empty.modes.text.precision, null);
});

test("rejects padded duplicate ids and unsafe mode names", () => {
  assert.throws(() => evaluate([{ id: "a", label: true, predictions: { text: true } }, { id: " a ", label: false, predictions: { text: false } }]));
  assert.throws(() => evaluate(JSON.parse('[{"id":"a","label":true,"predictions":{"__proto__":true}}]')));
});
