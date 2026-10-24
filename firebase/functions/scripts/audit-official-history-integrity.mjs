/** Source identity/reference audit. --repair-references only repoints deleted duplicates.
 * Reads explicit result fields; never reads/backs up OAuth sessions or report secrets.
 */
import { Firestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
const out = resolve(process.argv[2]);
const repair = process.argv.includes('--repair-references');
const db = new Firestore({ projectId: 'rapex-99a2c', preferRest: true });
const redirect = JSON.parse(readFileSync(resolve(out, 'dedup-map.json')));
const sources = await db.collection('rapex_alerts').select('fields.url', 'fields.rapex_url').get();
const ids = new Set(sources.docs.map(doc => doc.id)), groups = new Map();
for (const doc of sources.docs) {
  const url = doc.get('fields.url') || doc.get('fields.rapex_url');
  const group = groups.get(url) || []; group.push(doc.id); groups.set(url, group);
}
const duplicateGroups = [...groups.entries()].filter(([, group]) => group.length > 1).map(([url, group]) => ({ url, ids: group }));
const journal = await db.collection('rapex_changes').select('alertId').get();
const missingJournalSources = journal.docs.filter(doc => !ids.has(doc.get('alertId'))).map(doc => doc.ref.path);
const queries = [
  ['merchantAlerts', db.collectionGroup('alerts').select('sourceAlertId', 'checkResult')],
  ['checks', db.collectionGroup('checks').select('checkResult', 'result', 'warnings', 'resultJson')],
  ['decisions', db.collectionGroup('decision_events').select('sourceAlertId', 'checkResult', 'sourceSnapshot', 'result')],
  ['productJobs', db.collectionGroup('product_change_jobs').select('resultJson')],
  ['products', db.collectionGroup('products').select('match', 'result', 'warnings', 'checkResult')],
  ['publicRequests', db.collection('free_scan_requests').select('previewMatches')],
  ['publicLeads', db.collection('rapex_leads').select('matches')],
  ['cache', db.collection('merchant_match_cache').select('result')],
];
const backup = resolve(out, 'reference-repair-' + Date.now());
const staleReferences = [], missingReferences = [], counts = {};
let repaired = 0;
function rewrite(value, found, absent, key = '') {
  if (typeof value === 'string') {
    if (redirect[value]) { found.add(value); return redirect[value]; }
    if (['alertId', 'sourceAlertId'].includes(key) && /^[a-f0-9]{40}$/.test(value) && !ids.has(value)) absent.add(value);
    if (value.startsWith('{') || value.startsWith('[')) {
      try { const parsed = JSON.parse(value), after = rewrite(parsed, found, absent); return JSON.stringify(parsed) === JSON.stringify(after) ? value : JSON.stringify(after); } catch { return value; }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => rewrite(item, found, absent, key));
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, rewrite(item, found, absent, name)]));
  return value;
}
for (const [label, query] of queries) {
  const snapshot = await query.get(); counts[label] = snapshot.size;
  for (const doc of snapshot.docs) {
    const before = doc.data(), found = new Set(), absent = new Set(), after = rewrite(before, found, absent);
    if (absent.size) missingReferences.push({ path: doc.ref.path, sourceIds: [...absent] });
    if (!found.size) continue;
    staleReferences.push({ path: doc.ref.path, sourceIds: [...found] });
    if (!repair) continue;
    if (label === 'decisions') throw Error('Immutable decision references a deleted source');
    const fields = Object.keys(before).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    mkdirSync(backup, { recursive: true });
    writeFileSync(resolve(backup, String(repaired) + '.json.gz'), gzipSync(JSON.stringify({ path: doc.ref.path, fields: Object.fromEntries(fields.map(key => [key, before[key]])) })));
    await doc.ref.update(Object.fromEntries(fields.map(key => [key, after[key]])), { lastUpdateTime: doc.updateTime });
    repaired++;
  }
}
const result = { checkedAt: new Date().toISOString(), sources: sources.size, duplicateGroups, journalEntries: journal.size, missingJournalSources, counts, staleReferences, missingReferences, repaired };
writeFileSync(resolve(out, repair ? 'reference-repair-result.json' : 'referential-integrity.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, staleReferences: staleReferences.length, missingReferences: missingReferences.length }));
if (duplicateGroups.length || missingJournalSources.length || missingReferences.length || (!repair && staleReferences.length)) process.exitCode = 1;
