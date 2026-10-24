/** Read every canonical native text vector, including dimension/numeric validation. */
import { Firestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.argv[2]);
const db = new Firestore({ projectId: 'rapex-99a2c' });
const plan = JSON.parse(readFileSync(resolve(out, 'import-plan.json')));
const redirect = JSON.parse(readFileSync(resolve(out, 'dedup-map.json')));
const expected = new Set(plan.map(item => redirect[item.id] || item.id));
const checked = new Set(), invalid = [], dimensions = {};
for await (const doc of db.collection('rapex_alerts').select('vector_text').stream()) {
  if (!expected.has(doc.id)) continue;
  const field = doc.get('vector_text');
  const values = field?.constructor?.name === 'VectorValue' && typeof field.toArray === 'function' ? field.toArray() : null;
  dimensions[String(values?.length)] = (dimensions[String(values?.length)] || 0) + 1;
  if (values?.length !== 1536 || values.some(value => !Number.isFinite(value)) || !values.some(value => value !== 0)) invalid.push(doc.id);
  checked.add(doc.id);
  if (checked.size % 5000 === 0) console.log(JSON.stringify({ checked: checked.size, expected: expected.size, dimensions, invalid: invalid.length }));
}
const missing = [...expected].filter(id => !checked.has(id));
const result = { checkedAt: new Date().toISOString(), expected: expected.size, checked: checked.size, dimensions, invalid, missing, complete: invalid.length === 0 && missing.length === 0 };
writeFileSync(resolve(out, 'text-vector-validation.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!result.complete) process.exitCode = 1;
