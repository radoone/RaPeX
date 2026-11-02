#!/usr/bin/env node
// Evaluate independently labelled product/alert pairs against recorded predictions.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function evaluate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Expected a non-empty array of labelled pairs");
  const ids = new Set();
  const modes = new Set();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim() || ids.has(row.id.trim())) throw new Error("Each pair needs a unique non-empty id");
    ids.add(row.id.trim());
    if (typeof row.label !== "boolean" || !row.predictions || typeof row.predictions !== "object" || Array.isArray(row.predictions)) throw new Error(`Invalid label or predictions for ${row.id}`);
    for (const [mode, prediction] of Object.entries(row.predictions)) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(mode)) throw new Error("Invalid prediction mode");
      if (typeof prediction !== "boolean" && prediction !== null) throw new Error(`Invalid prediction for ${row.id}/${mode}`);
      modes.add(mode);
    }
  }
  if (!modes.size) throw new Error("No prediction modes found");
  const metrics = Object.create(null);
  for (const mode of [...modes].sort()) {
    let tp = 0, fp = 0, tn = 0, fn = 0, unavailable = 0;
    for (const row of rows) {
      const prediction = Object.hasOwn(row.predictions, mode) ? row.predictions[mode] : null;
      if (prediction === null || prediction === undefined) { unavailable++; continue; }
      if (row.label && prediction) tp++;
      else if (!row.label && prediction) fp++;
      else if (row.label) fn++;
      else tn++;
    }
    const ratio = (n, d) => d ? n / d : null;
    metrics[mode] = { total: rows.length, evaluated: tp + fp + tn + fn, unavailable, tp, fp, tn, fn,
      precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), falsePositiveRate: ratio(fp, fp + tn) };
  }
  const common = rows.filter(row => [...modes].every(mode => Object.hasOwn(row.predictions, mode) && typeof row.predictions[mode] === "boolean"));
  return { labelledPairs: rows.length, positivePairs: rows.filter(row => row.label).length, modes: metrics,
    commonCohort: { pairs: common.length, modes: common.length && common.length < rows.length ? evaluate(common).modes : common.length ? metrics : {} } };

}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: node scripts/evaluate-labelled-matches.mjs <labelled-pairs.json> <report.json>");
  const result = evaluate(JSON.parse(await readFile(input, "utf8")));
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
