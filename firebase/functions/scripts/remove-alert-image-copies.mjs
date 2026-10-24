/** Owner-authorized cleanup after readers/writers have been deployed without inline vectors.
 * node scripts/remove-alert-image-copies.mjs <evidence-directory> apply
 * Deletes only rapex_alerts.vector_image; shared image/product vectors are untouched.
 */
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.argv[2]);
if (process.argv[3] !== 'apply') throw Error('Explicit apply required');
const release = JSON.parse(readFileSync(resolve(out, 'release/verification.json')));
if (Object.keys(release).length !== 8 || Object.values(release).some(row => row.state !== 'ACTIVE' || !row.configurationPreserved)) throw Error('All eight reader/writer deployments must be verified first');
const alignment = JSON.parse(readFileSync(resolve(out, 'photo-alignment-result.json')));
if (alignment.remainingMismatches !== 0) throw Error('Align authoritative shared picture references first');
const db = new Firestore({ projectId: 'rapex-99a2c' });
const count = async query => (await query.count().get()).data().count;
const sources = db.collection('rapex_alerts'), images = db.collection('rapex_alert_images');
const [sourceCount, imageCount, textVectors] = await Promise.all([count(sources), count(images), count(sources.where('vector_text', '!=', null))]);
const copies = await sources.where('vector_image', '!=', null).select().get();
writeFileSync(resolve(out, 'removed-copy-ids.json'), JSON.stringify(copies.docs.map(doc => doc.id)));
const writer = db.bulkWriter({ throttling: { initialOpsPerSecond: 500, maxOpsPerSecond: 1000 } });
writer.onWriteError(error => [4, 8, 10, 13, 14].includes(error.code) && error.failedAttempts < 5);
let removed = 0;
const failures = [];
const pending = copies.docs.map(doc => writer.update(doc.ref, { vector_image: FieldValue.delete() }).then(() => {
  removed++;
  if (removed % 5000 === 0) console.log(JSON.stringify({ removed, planned: copies.size }));
}).catch(error => failures.push({ id: doc.id, error: error.message })));
await writer.close(); await Promise.all(pending);
const after = { sources: await count(sources), imageDocuments: await count(images), textVectors: await count(sources.where('vector_text', '!=', null)), remainingCopies: await count(sources.where('vector_image', '!=', null)) };
const result = { completedAt: new Date().toISOString(), before: { sources: sourceCount, imageDocuments: imageCount, textVectors, copies: copies.size }, removed, rawVectorBytesRemoved: removed * 1408 * 8, after, failures };
writeFileSync(resolve(out, 'cleanup-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (failures.length || after.remainingCopies || after.sources !== sourceCount || after.imageDocuments !== imageCount || after.textVectors !== textVectors) throw Error('Cleanup invariants failed; inspect saved evidence');
