import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFunction as fn, database, collections, FieldValue, Timestamp } from './helpers/isolated-source.mjs';
import { installationKey, isProductChangeSupersededByDeletion, sameProductVersion } from '../lib/product-lifecycle.js';

const shop = 'test.myshopify.com', sourceUpdatedAt = '2026-11-02T21:20:00Z';
const payload = { shop, productId: '1', operation: 'upsert', sourceUpdatedAt, installation: '100', product: { name: 'Current Shopify title', barcodesComplete: false } };
test('REST offsets and UTC encode the same version, while invalid and genuinely changed versions do not', () => {
  assert.equal(sameProductVersion('2026-11-02T16:20:00-05:00', sourceUpdatedAt), true);
  assert.equal(sameProductVersion('2026-11-02T21:20:00.000Z', sourceUpdatedAt), true);
  assert.equal(sameProductVersion('2026-11-02T21:20:01Z', sourceUpdatedAt), false);
  assert.equal(sameProductVersion('invalid', 'invalid'), false);
});
function setup() {
  const db = database(), merchantPath = `merchants/${shop}`, queued = [];
  db.rows.set(merchantPath, { createdAt: new Timestamp(100), entitled: true });
  const productChangeJobId = p => `${p.productId}-${p.sourceUpdatedAt}`;
  const productChangeJobRef = (_shop, id) => db.doc(`${merchantPath}/product_change_jobs/${id}`);
  const queue = { enqueue: async (...args) => { queued.push(args); } };
  const enqueue = fn('merchant-monitoring', 'enqueueRefreshedProductChange', {
    db, FIRESTORE_COLLECTIONS: collections, productChangeJobId, productChangeJobRef,
    currentEntitlement: data => data.entitled === true, installationKey,
    isProductChangeSupersededByDeletion, FieldValue, PRODUCT_CHANGE_TASK_QUEUE: queue,
  });
  return { db, merchantPath, queued, queue, enqueue, jobPath: `${merchantPath}/product_change_jobs/${productChangeJobId(payload)}` };
}

test('a current Shopify snapshot is durably queued with a stable identity and is revalidated by its worker', async () => {
  const s = setup();
  await s.enqueue(payload);
  assert.equal(s.queued.length, 1);
  assert.equal(s.queued[0][0].product.name, 'Current Shopify title');
  assert.equal(s.queued[0][0].product.barcodesComplete, false);
  assert.equal(s.db.rows.get(s.jobPath).status, 'queued');
  s.queue.enqueue = async () => { throw Object.assign(Error('duplicate'), { code: 'functions/task-already-exists' }); };
  await s.enqueue(payload);
  assert.equal([...s.db.rows.keys()].filter(k => k.includes('/product_change_jobs/')).length, 1);
  s.db.rows.set(s.jobPath, { status: 'completed' });
  s.queue.enqueue = async () => { throw Error('must not dispatch completed work'); };
  await s.enqueue(payload);
});

test('recovery cannot cross uninstall, installation, entitlement, deletion or newer-product fences', async () => {
  for (const change of ['retired', 'installation', 'unentitled', 'deleted', 'newer']) {
    const s = setup();
    if (change === 'retired') s.db.rows.get(s.merchantPath).installationRetiredAt = new Timestamp(200);
    if (change === 'installation') s.db.rows.get(s.merchantPath).createdAt = new Timestamp(101);
    if (change === 'unentitled') s.db.rows.get(s.merchantPath).entitled = false;
    if (change === 'deleted') s.db.rows.set(`${s.merchantPath}/products/1`, { deletedAt: new Timestamp(200), deletedSourceUpdatedAt: '2026-11-02T21:21:00Z' });
    if (change === 'newer') s.db.rows.set(`${s.merchantPath}/products/1`, { sourceUpdatedAt: '2026-11-02T21:21:00Z' });
    await s.enqueue(payload);
    assert.equal(s.queued.length, 0, change);
    assert.equal(s.db.rows.has(s.jobPath), false, change);
  }
});

test('queue outages propagate so the old task retries instead of consuming the newer product check', async () => {
  const s = setup();
  await assert.rejects(s.enqueue({ ...payload, sourceUpdatedAt: undefined }), /version is missing/);
  await assert.rejects(s.enqueue({ ...payload, sourceUpdatedAt: 'invalid' }), /version is missing/);
  s.queue.enqueue = async () => { throw Error('Cloud Tasks unavailable'); };
  await assert.rejects(s.enqueue(payload), /Cloud Tasks unavailable/);
  assert.equal(s.db.rows.get(s.jobPath).status, 'enqueue_failed');
  s.queue.enqueue = async (...args) => { s.queued.push(args); };
  await s.enqueue(payload);
  assert.equal(s.queued.length, 1);
});

test('variant hydration also returns authoritative title, images and description for a newer version', async () => {
  const node = { id: 'gid://shopify/Product/1', title: 'Updated title', description: 'Updated description', updatedAt: sourceUpdatedAt, variants: { nodes: [] } };
  let query;
  const load = fn('merchant-catalog-audit', 'loadShopifyProductBarcodes', {
    loadOfflineAccessToken: async () => 'test-token', requestShopifyBarcodes: async (_shop, _token, q) => { query = q; return { data: { product: node } }; },
    completeShopifyBarcodes: async p => { assert.equal(p, node); return [{ barcode: '4006381333931' }]; },
    toProductInput: (p, tenant) => ({ shop: tenant, productId: '1', productTitle: p.title, product: { name: p.title, description: p.description, barcodes: p.barcodes } }),
  });
  const result = await load(shop, '1');
  assert.equal(result.product.name, 'Updated title');
  assert.equal(result.product.description, 'Updated description');
  assert.equal(result.sourceUpdatedAt, sourceUpdatedAt);
  assert.ok(query.includes('images(first: 4)'));
  assert.deepEqual(result.product.barcodes, [{ barcode: '4006381333931' }]);
});
