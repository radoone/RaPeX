/** Read native image vectors, not inequality-index presence estimates. */
import { Firestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const out = resolve(process.argv[2]);
const db = new Firestore({ projectId: 'rapex-99a2c' });
const plan = JSON.parse(readFileSync(resolve(out, 'import-plan.json')));
const expected = new Map(plan.flatMap(item => item.source.pictures.map(url => [item.id + '__' + createHash('sha1').update(url).digest('hex').slice(0, 24), { alertId: item.id, url }])));
const resume = process.argv.includes('--resume') ? JSON.parse(readFileSync(resolve(out, 'image-vector-validation.json'))) : null;
const oldMissing = new Set(resume?.missing || []);
const checked = new Set(resume ? [...expected.keys()].filter(id => !oldMissing.has(id)) : []), invalid = [...(resume?.invalid || [])], dimensions = { ...(resume?.dimensions || {}) };
let extras = resume?.extras || 0;
function inspect(doc) {
  if (!doc.exists) return;
  if (!expected.has(doc.id)) { extras++; return; }
  if (checked.has(doc.id)) return;
  const field = doc.get('vector_image');
  const vector = field?.constructor?.name === 'VectorValue' ? field.toArray() : null;
  const item = expected.get(doc.id);
  dimensions[String(vector?.length)] = (dimensions[String(vector?.length)] || 0) + 1;
  if (vector?.length !== 1408 || vector.some(value => !Number.isFinite(value)) || !vector.some(value => value !== 0) || doc.get('alertId') !== item.alertId || doc.get('imageUrl') !== item.url) invalid.push(doc.id);
  checked.add(doc.id);
  if (checked.size % 10000 === 0) console.log(JSON.stringify({ checked: checked.size, expected: expected.size, invalid: invalid.length, dimensions }));
}
if (resume) {
  const pending = [...oldMissing];
  for (let offset = 0; offset < pending.length; offset += 50) {
    const docs = await db.getAll(...pending.slice(offset, offset + 50).map(id => db.collection('rapex_alert_images').doc(id)));
    docs.forEach(inspect);
  }
} else for await (const doc of db.collection('rapex_alert_images').select('vector_image', 'alertId', 'imageUrl').stream()) inspect(doc);
const missing = [...expected.keys()].filter(id => !checked.has(id));
const result = { checkedAt: new Date().toISOString(), expected: expected.size, checked: checked.size, extras, dimensions, invalid, missing, validExisting: invalid.length === 0, complete: invalid.length === 0 && missing.length === 0 };
writeFileSync(resolve(out, 'image-vector-validation.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, missing: missing.length, invalid: invalid.length }));
if (!result.validExisting) process.exitCode = 1;
