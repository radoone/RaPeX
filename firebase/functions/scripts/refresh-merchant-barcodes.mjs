// Index maintenance only. Dry run by default; no matching, embeddings or notifications.
import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../lib/firebase-admin.js';
import { loadShopifyProductBarcodes } from '../lib/merchant-catalog-audit.js';
import { normalizeProductBarcodes, productGtins } from '../lib/product-barcodes.js';
import { installationKey } from '../lib/product-lifecycle.js';

const shop = process.argv.find(arg => arg.startsWith('--shop='))?.slice(7);
if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Error('Provide --shop=example.myshopify.com');
const apply = process.argv.includes('--apply');
const merchant = db.collection('merchants').doc(encodeURIComponent(shop));
const initial = await merchant.get();
if (!initial.exists || initial.get('installationRetiredAt')) throw new Error('Merchant installation is missing or retired');
let cursor, scanned = 0, changed = 0, skippedDeleted = 0, conflicts = 0;
for (;;) {
  let query = merchant.collection('products').orderBy(FieldPath.documentId()).limit(100);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;
  for (const doc of page.docs) {
    scanned++;
    if (doc.get('deletedAt')) { skippedDeleted++; continue; }
    const version = doc.get('sourceUpdatedAt');
    if (typeof version !== 'string' || !Number.isFinite(Date.parse(version))) { conflicts++; continue; }
    const live = await loadShopifyProductBarcodes(shop, String(doc.get('productId') || decodeURIComponent(doc.id)));
    if (Date.parse(live.sourceUpdatedAt) !== Date.parse(version)) { conflicts++; continue; }
    const barcodes = normalizeProductBarcodes(live.barcodes), gtins = productGtins(barcodes);
    if (doc.get('barcodeVersion') === 1 && JSON.stringify(doc.get('barcodes')) === JSON.stringify(barcodes) && JSON.stringify(doc.get('gtins')) === JSON.stringify(gtins)) continue;
    changed++;
    if (apply) await db.runTransaction(async transaction => {
      const [currentMerchant, current] = await Promise.all([transaction.get(merchant), transaction.get(doc.ref)]);
      if (!currentMerchant.exists || currentMerchant.get('installationRetiredAt') || installationKey(currentMerchant.data()) !== installationKey(initial.data())) throw new Error('Merchant installation changed; stop maintenance');
      if (!current.exists || current.get('deletedAt') || !current.updateTime.isEqual(doc.updateTime)) { conflicts++; return; }
      transaction.update(doc.ref, { barcodes, gtins, barcodeVersion: 1 });
    });
  }
  cursor = page.docs.at(-1);
}
console.log(JSON.stringify({ apply, scanned, changed, skippedDeleted, conflicts }));
if (conflicts) process.exitCode = 1;
