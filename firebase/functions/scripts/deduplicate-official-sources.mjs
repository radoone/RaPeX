/** Owner-authorized source deduplication. Preserve journal IDs; back up before deletion.
 * node scripts/deduplicate-official-sources.mjs <absolute evidence directory>
 * The app's decision events are never rewritten. Refuse if one references a duplicate.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Firestore } from 'firebase-admin/firestore';
import { buildAlertImageDocId } from '../lib/safety-gate-weekly-loader.js';
const db = new Firestore({ projectId: 'rapex-99a2c', preferRest: true, ignoreUndefinedProperties: true });

const out = resolve(process.argv[2]);
const backup = resolve(out, 'dedup-backup', String(Date.now()));
mkdirSync(backup, { recursive: true });
const initial = JSON.parse(readFileSync(resolve(out, 'firestore-before.json')));
const protectedSources = JSON.parse(readFileSync(resolve(out, 'protected-sources.json')));
const journal = new Set(protectedSources.journal);
const merchant = new Set(protectedSources.merchant);
const groups = new Map();
for (const row of initial) {
  const url = row.fields?.url || row.fields?.rapex_url;
  if (!/^https:\/\/ec\.europa\.eu\/safety-gate-alerts\/screen\/webReport\/alertDetail\/-?\d+\/?$/.test(url || '')) continue;
  const key = url.replace(/\/$/, '');
  const group = groups.get(key) || [];
  group.push(row); groups.set(key, group);
}
const replacements = new Map();
for (const rows of groups.values()) {
  if (rows.length < 2) continue;
  if (rows.filter(row => journal.has(row.id)).length > 1) throw Error('Multiple journalled sources require explicit reconciliation');
  rows.sort((a, b) => Number(journal.has(b.id)) - Number(journal.has(a.id)) || Number(Boolean(b.meta?.content_hash)) - Number(Boolean(a.meta?.content_hash)) || Number(merchant.has(b.id)) - Number(merchant.has(a.id)) || a.id.localeCompare(b.id));
  for (const row of rows.slice(1)) replacements.set(row.id, rows[0].id);
}
writeFileSync(resolve(out, 'dedup-map.json'), JSON.stringify(Object.fromEntries(replacements), null, 2));
const proto = doc => ({ name: doc.ref.formattedName, fields: doc._fieldsProto, updateTime: doc.updateTime.toDate().toISOString() });
// Repoint technical source IDs in mutable test findings/check snapshots, retaining facts and finding IDs.
function rewrite(value) {
  if (typeof value === 'string') {
    if (replacements.has(value)) return replacements.get(value);
    if (value.startsWith('{') || value.startsWith('[')) {
      try { const parsed = JSON.parse(value); const revised = rewrite(parsed); return JSON.stringify(parsed) === JSON.stringify(revised) ? value : JSON.stringify(revised); } catch { return value; }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
  return value;
}
let repointed = 0;
for (const collection of ['decision_events', 'alerts', 'checks', 'merchant_match_cache']) {
  const snap = collection === 'merchant_match_cache' ? await db.collection(collection).get() : await db.collectionGroup(collection).get();
  for (const doc of snap.docs) {
    const before = doc.data(), after = rewrite(before);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (collection === 'decision_events') throw Error('Immutable decision evidence references a duplicate; refusing deletion');
    writeFileSync(resolve(backup, `reference-${repointed}.json.gz`), gzipSync(JSON.stringify(proto(doc))));
    await doc.ref.update(after, { lastUpdateTime: doc.updateTime });
    repointed++;
  }
}
const imageIndex = await db.collection('rapex_alert_images').select('alertId', 'imageUrl', 'imageIndex').get();
const movingImages = imageIndex.docs.filter(doc => replacements.has(doc.get('alertId')));
let imagesMoved = 0;
for (let offset = 0; offset < movingImages.length; offset += 50) {
  const docs = await db.getAll(...movingImages.slice(offset, offset + 50).map(doc => doc.ref));
  writeFileSync(resolve(backup, `images-${offset}.json.gz`), gzipSync(JSON.stringify(docs.map(proto))));
  const targetRefs = docs.map(doc => db.collection('rapex_alert_images').doc(buildAlertImageDocId(replacements.get(doc.get('alertId')), doc.get('imageUrl'))));
  const targets = await db.getAll(...targetRefs);
  const batch = db.batch();
  const written = new Set();
  for (let index = 0; index < docs.length; index++) {
    const doc = docs[index];
    const data = doc.data(), target = replacements.get(data.alertId);
    const targetRef = targetRefs[index];
    if (!targets[index].exists && !written.has(targetRef.path)) {
      if (data.vector_image?.toArray?.().length !== 1408) throw Error('Invalid duplicate image vector; refusing to copy');
      // Concurrent image repair can write this same URL/model/dimension; either vector is valid.
      batch.set(targetRef, { ...data, alertId: target, meta: { ...data.meta, recordid: target } });
      written.add(targetRef.path);
    }
    batch.delete(doc.ref, { lastUpdateTime: doc.updateTime });
    imagesMoved++;
  }
  await batch.commit();
  if (imagesMoved % 500 === 0) console.log(JSON.stringify({ imagesMoved, remainingAtStart: movingImages.length }));
}
let deleted = 0;
const ids = [...replacements.keys()];
for (let offset = 0; offset < ids.length; offset += 100) {
  const docs = (await db.getAll(...ids.slice(offset, offset + 100).map(id => db.collection('rapex_alerts').doc(id)))).filter(doc => doc.exists);
  if (!docs.length) continue;
  if (docs.some(doc => !doc._fieldsProto)) throw Error('Backup serialization unavailable');
  writeFileSync(resolve(backup, `sources-${offset}.json.gz`), gzipSync(JSON.stringify(docs.map(proto))));
  const batch = db.batch();
  for (const doc of docs) batch.delete(doc.ref, { lastUpdateTime: doc.updateTime });
  await batch.commit(); deleted += docs.length;
  if (deleted % 500 === 0) console.log(JSON.stringify({ deleted, planned: ids.length, imagesMoved, repointed }));
}
const result = { completedAt: new Date().toISOString(), planned: ids.length, deleted, imagesMoved, repointed, backupDirectory: backup };
writeFileSync(resolve(out, 'dedup-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
