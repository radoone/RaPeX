// Dry run by default. --apply updates only the derived GTIN field, with a read-time precondition.
import { FieldPath } from "firebase-admin/firestore";
import { db } from "../lib/firebase-admin.js";
import { extractGtins } from "../lib/gtin.js";

const apply = process.argv.includes("--apply");
const writer = apply ? db.bulkWriter({ throttling: { initialOpsPerSecond: 50, maxOpsPerSecond: 100 } }) : null;
writer?.onWriteError(error => ![5, 9].includes(error.code) && error.failedAttempts < 3);
let cursor;
let scanned = 0, changed = 0, conflicts = 0;
for (;;) {
  let query = db.collection("rapex_alerts").select("fields.barcode", "fields.product_barcode", "gtins")
    .orderBy(FieldPath.documentId()).limit(200);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;
  const writes = [];
  for (const doc of page.docs) {
    const fields = doc.get("fields") || {};
    const gtins = [...new Set([...extractGtins(fields.barcode), ...extractGtins(fields.product_barcode)])].sort();
    const current = doc.get("gtins");
    if (current === undefined && gtins.length === 0) continue;
    if (Array.isArray(current) && JSON.stringify([...current].sort()) === JSON.stringify(gtins)) continue;
    changed++;
    if (writer) {
      writes.push(writer.update(doc.ref, { gtins }, { lastUpdateTime: doc.updateTime }).catch(error => {
        if (error.code !== 9 && error.code !== 5) throw error;
        conflicts++;
      }));
    }
  }
  await Promise.all([...(writer ? [writer.flush()] : []), ...writes]);
  scanned += page.size;
  cursor = page.docs.at(-1);
}
await writer?.close();
console.log(JSON.stringify({ apply, scanned, changed, conflicts }));
if (conflicts) process.exitCode = 1;
