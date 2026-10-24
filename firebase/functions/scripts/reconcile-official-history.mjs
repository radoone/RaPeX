/** Resumable, explicitly invoked maintenance against a saved official XML inventory.
 * No merchant writes, model matching, email sends or loader-checkpoint changes.
 * Usage: node scripts/reconcile-official-history.mjs <inventory|text|images|verify>
 *        <absolute evidence directory>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, Firestore } from 'firebase-admin/firestore';
import { buildWeeklyAlertFields, parseReportDate, buildAlertImageDocId } from '../lib/safety-gate-weekly-loader.js';
import { buildEmbeddingText, embedTexts, embedImage } from '../lib/safety-gate-embeddings.js';
import { embedOfficialImage } from './official-history-image-embedder.mjs';
// HTTP transport avoids long-lived gRPC connections during a multi-hour local audit.
const db = new Firestore({ projectId: 'rapex-99a2c', preferRest: true, ignoreUndefinedProperties: true });

const [mode, directory] = process.argv.slice(2);
if (!directory || !['inventory', 'text', 'images', 'verify'].includes(mode)) throw Error('Expected mode and evidence directory');
const out = resolve(directory);
mkdirSync(out, { recursive: true });
const official = JSON.parse(readFileSync(resolve(out, 'official-records.json'), 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const refKey = (value) => {
  const match = String(value || '').match(/^https:\/\/ec\.europa\.eu\/safety-gate-alerts\/screen\/webReport\/alertDetail\/(-?\d+)\/?$/);
  if (!match) throw Error(`Invalid official reference: ${value}`);
  return match[1];
};
if (new Set(official.map(x => refKey(x.reference))).size !== official.length) throw Error('Duplicate official identity');
const save = (name, value) => writeFileSync(resolve(out, name), JSON.stringify(value, null, 2));
const log = (data) => { const row = { at: new Date().toISOString(), ...data }; console.log(JSON.stringify(row)); appendFileSync(resolve(out, `${mode}-progress.jsonl`), JSON.stringify(row) + '\n'); };
const vectorIds = async (collection, field) => {
  // Enumerate image documents rather than infer presence from a vector inequality.
  // Writes include a validated vector; an independent native-field audit checks
  // that invariant and excludes any invalid documents from the ready set.
  const query = collection === 'rapex_alert_images' ? db.collection(collection) : db.collection(collection).where(field, '!=', null);
  const ids = new Set((await query.select().get()).docs.map(doc => doc.id));
  const auditFile = resolve(out, 'image-vector-validation.json');
  if (collection === 'rapex_alert_images' && existsSync(auditFile)) for (const id of JSON.parse(readFileSync(auditFile)).invalid) ids.delete(id);
  return ids;
};
async function inventory() {
  const snap = await db.collection('rapex_alerts').select('fields.caseNumber', 'fields.alert_number', 'fields.url', 'fields.rapex_url', 'meta.alert_date', 'meta.content_hash').get();
  const ready = await vectorIds('rapex_alerts', 'vector_text');
  const groups = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    const url = data.fields?.url || data.fields?.rapex_url;
    let key;
    try { key = refKey(url); } catch { continue; }
    const list = groups.get(key) || [];
    list.push({ id: doc.id, textVector: ready.has(doc.id), ...data });
    groups.set(key, list);
  }
  const plan = official.map(source => {
    const group = groups.get(refKey(source.reference)) || [];
    // Prefer an already journalled/current source, then a vector-bearing source.
    group.sort((a, b) => Number(Boolean(b.meta?.content_hash)) - Number(Boolean(a.meta?.content_hash)) || Number(b.textVector) - Number(a.textVector) || a.id.localeCompare(b.id));
    return { source, id: group[0]?.id || createHash('sha1').update(`ec-safety-gate-official-${refKey(source.reference)}`).digest('hex'), exists: group.length > 0, textVector: group[0]?.textVector || false, duplicates: group.slice(1).map(d => d.id) };
  });
  save('import-plan.json', plan);
  log({ totalDocuments: snap.size, officialRecords: official.length, missingRecords: plan.filter(x => !x.exists).length, missingText: plan.filter(x => !x.textVector).length, duplicateDocuments: [...groups.values()].reduce((n, x) => n + x.length - 1, 0) });
  return plan;
}

if (mode === 'inventory') await inventory();
if (mode === 'text') {
  const plan = await inventory();
  const pending = plan.filter(x => !x.textVector);
  mkdirSync(resolve(out, 'text-cache'), { recursive: true });
  let nextPage = 0, completed = 0;
  await Promise.all(Array.from({ length: Number(process.env.TEXT_WORKERS || 4) }, async () => {
  while (nextPage < pending.length) {
    const start = nextPage;
    nextPage += 50;
    const page = pending.slice(start, start + 50);
    const contents = page.map(({ source: s }) => buildEmbeddingText({ brand: s.brand, model: s.type_numberOfModel || s.product, category: s.category, title: s.name || s.product, description: s.description || s.danger }));
    if (contents.some(x => !x.trim())) throw Error('Official source lacks embedding content');
    const cache = resolve(out, 'text-cache', hash(JSON.stringify(page.map((x, i) => [x.id, contents[i]]))) + '.json');
    const vectors = existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : await embedTexts(contents);
    if (vectors.length !== page.length || vectors.some(v => v?.length !== 1536 || v.some(n => !Number.isFinite(n)))) throw Error('Incomplete text embedding batch; no writes');
    if (!existsSync(cache)) writeFileSync(cache, JSON.stringify(vectors));
    const revision = new Date().toISOString();
    await db.runTransaction(async batch => {
    const current = await batch.getAll(...page.map(item => db.collection('rapex_alerts').doc(item.id)));
    for (let i = 0; i < page.length; i++) {
      const { source, id } = page[i];
      const exists = current[i].exists;
      if (current[i].get('vector_text')) continue;
      const alertRef = db.collection('rapex_alerts').doc(id);
      const fields = buildWeeklyAlertFields(source, parseReportDate(source.reportDate));
      if (source.officialDetail) fields.official_detail = source.officialDetail;
      const contentHash = hash(JSON.stringify(fields));
      if (!exists) batch.create(alertRef, {
        fields, vector_text: FieldValue.vector(vectors[i]),
        meta: { datasetid: 'ec.europa.eu-safety-gate', recordid: id, record_timestamp: revision, content_hash: contentHash, alert_date: Timestamp.fromDate(parseReportDate(source.reportDate)), ingested_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(), history_reconciliation: '2026-10-23' },
      });
      else batch.update(alertRef, { vector_text: FieldValue.vector(vectors[i]), 'meta.record_timestamp': revision });
      batch.create(db.collection('rapex_changes').doc(`${revision}_${id}_official_history`), { alertId: id, contentHash, reason: exists ? 'repair_missing_text_vector' : 'official_history_backfill', changedAt: FieldValue.serverTimestamp() });
    }
    });
    completed += page.length;
    log({ completed, pendingAtStart: pending.length, lastYear: page.at(-1).source.reportYear });
  }
  }));
  await inventory();
}
if (mode === 'images') {
  const plan = JSON.parse(readFileSync(resolve(out, 'import-plan.json'), 'utf8'));
  const dedupFile = resolve(out, 'dedup-map.json');
  const redirects = existsSync(dedupFile) ? JSON.parse(readFileSync(dedupFile, 'utf8')) : {};
  for (const item of plan) item.id = redirects[item.id] || item.id;
  const retryIds = process.env.IMAGE_FAILURES_ONLY ? new Set(JSON.parse(readFileSync(resolve(out, 'image-failures.json'))).map(item => item.id)) : null;
  const ready = retryIds ? new Set() : await vectorIds('rapex_alert_images', 'vector_image');
  const tasks = plan.filter(item => !process.env.IMAGE_EXISTING_ONLY || item.exists).flatMap(({ source, id }) => [...new Set(source.pictures)].map((url, index) => ({ alertId: id, url, index, date: source.reportDate, id: buildAlertImageDocId(id, url) }))).filter(x => !ready.has(x.id) && (!retryIds || retryIds.has(x.id)));
  const regions = (process.env.IMAGE_REGIONS || '').split(',').filter(Boolean);
  log({ missingImages: tasks.length });
  let cursor = 0, done = 0, failed = 0;
  const failures = [];
  await Promise.all(Array.from({ length: Number(process.env.IMAGE_CONCURRENCY || 8) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      try {
        const embedding = regions.length ? await embedOfficialImage(task.url, regions) : { vector: await embedImage(task.url), sourceUrl: task.url };
        const { vector, sourceUrl } = embedding;
        if (vector?.length !== 1408 || vector.some(n => !Number.isFinite(n))) throw Error('Image download or embedding unavailable');
        const batch = db.batch();
        batch.set(db.collection('rapex_alert_images').doc(task.id), { alertId: task.alertId, imageUrl: task.url, embeddingSourceUrl: sourceUrl, imageIndex: task.index, vector_image: FieldValue.vector(vector), meta: { datasetid: 'ec.europa.eu-safety-gate', recordid: task.alertId, alert_date: Timestamp.fromDate(parseReportDate(task.date)), ingested_at: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() });
        await batch.commit();
      } catch (error) { failed++; failures.push({ ...task, error: String(error) }); }
      done++;
      if (done % 100 === 0) { save('image-failures.json', failures); log({ completed: done, pendingAtStart: tasks.length, failed }); }
    }
  }));
  save('image-failures.json', failures);
  log({ completed: done, pendingAtStart: tasks.length, failed, finished: true });
}
if (mode === 'verify') {
  const plan = await inventory();
  const textReady = await vectorIds('rapex_alerts', 'vector_text');
  const imagesReady = await vectorIds('rapex_alert_images', 'vector_image');
  const years = {};
  const missing = [];
  const missingImages = [];
  for (const item of plan) {
    const year = String(item.source.reportYear);
    const row = years[year] ||= { official: 0, present: 0, textVector: 0, expectedImages: 0, imageVectors: 0 };
    row.official++;
    if (item.exists) row.present++;
    if (item.exists && textReady.has(item.id)) row.textVector++;
    else missing.push({ reference: item.source.reference, caseNumber: item.source.caseNumber, id: item.id });
    for (const url of new Set(item.source.pictures)) {
      row.expectedImages++;
      if (imagesReady.has(buildAlertImageDocId(item.id, url))) row.imageVectors++;
      else missingImages.push({ id: item.id, reference: item.source.reference, url });
    }
  }
  const apiFile = resolve(out, 'api-all-identities.json');
  const apiIds = existsSync(apiFile) ? new Set(Object.keys(JSON.parse(readFileSync(apiFile, 'utf8')))) : null;
  const officialIds = new Set(official.map(item => refKey(item.reference)));
  const identityDifference = apiIds ? { apiOnly: [...apiIds].filter(id => !officialIds.has(id)), manifestOnly: [...officialIds].filter(id => !apiIds.has(id)) } : null;
  const vectorValidationFile = resolve(out, 'text-vector-validation.json');
  const nativeVectorValidation = existsSync(vectorValidationFile) ? JSON.parse(readFileSync(vectorValidationFile)) : null;
  const identityMatch = identityDifference && identityDifference.apiOnly.length === 0 && identityDifference.manifestOnly.length === 0;
  const result = { checkedAt: new Date().toISOString(), source: 'European Commission official weekly XML archive plus public JSON details', reportCount: JSON.parse(readFileSync(resolve(out, 'reports.json'))).length, officialRecords: official.length, independentlyEnumeratedApiRecords: apiIds?.size, identityDifference, nativeVectorValidation: nativeVectorValidation ? { checked: nativeVectorValidation.checked, complete: nativeVectorValidation.complete } : null, completeRecordsAndTextVectors: Boolean(missing.length === 0 && identityMatch && nativeVectorValidation?.complete && nativeVectorValidation.checked === official.length), completeAllImageVectors: missingImages.length === 0, missingRecordsOrTextVectors: missing.length, missingImageVectors: missingImages.length, years };
  save('coverage-verification.json', result); save('missing-after.json', missing); save('missing-images-after.json', missingImages); log(result);
}
