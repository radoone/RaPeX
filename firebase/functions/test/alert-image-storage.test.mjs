import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sourceFunction as fn, database, FieldValue, Timestamp, collections } from './helpers/isolated-source.mjs';

test('legacy/historical source-document builder never writes an inline image vector', () => {
  const build = fn('safety-gate-loader', 'buildAlertDocument', { FieldValue, Timestamp });
  const record = { recordid: 'A', datasetid: 'official', record_timestamp: 'revision', fields: { caseNumber: 'SR/00001/26' } };
  const source = build(record, new Date('2026-10-24'), [.1], [1, 2]);
  assert.ok(source.vector_text);
  assert.equal(Object.hasOwn(source, 'vector_image'), false);
  assert.equal(source.fields, record.fields);
});

test('weekly ingestion removes an old inline copy and preserves all shared picture vectors', async () => {
  const db = database(), pictures = ['one', 'two'];
  const fields = { caseNumber: 'SR/00001/26', pictures };
  const contentHash = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  db.rows.set('rapex_alerts/A', { fields, meta: { content_hash: contentHash, record_timestamp: 'old' }, vector_text: FieldValue.vector([.1]), vector_image: FieldValue.vector([.2]) });
  for (const url of pictures) db.rows.set(`rapex_alert_images/A-${url}`, { vector_image: FieldValue.vector([url.length]) });
  const ingest = fn('safety-gate-weekly-loader', 'ingestWeeklyNotification', {
    db, FieldValue, Timestamp, createHash, FIRESTORE_COLLECTIONS: collections,
    parseReportDate: () => new Date('2026-10-24'), buildWeeklyAlertFields: () => fields,
    findExistingAlertDocId: async () => 'A', buildAlertImageDocId: (id, url) => `${id}-${url}`,
    embedText: async () => { throw Error('Unnecessary text embedding'); },
    embedImage: async () => { throw Error('Shared images must be reused'); },
  });
  const result = await ingest({ caseNumber: fields.caseNumber, pictures, reportDate: '24/10/2026' });
  assert.equal(result.imagesEmbedded, 0);
  assert.equal(Object.hasOwn(db.rows.get('rapex_alerts/A'), 'vector_image'), false);
  assert.deepEqual(db.rows.get('rapex_alert_images/A-one').vector_image.toArray(), [3]);
  assert.deepEqual(db.rows.get('rapex_alert_images/A-two').vector_image.toArray(), [3]);
});
