import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMonitoringShortlist, processMonitoringProducts } from '../lib/monitoring-work.js';
import { sourceFunction, database, FieldValue, Timestamp } from './helpers/isolated-source.mjs';
import { installationKey } from '../lib/product-lifecycle.js';

const path = 'merchants/test.myshopify.com';
function fixture() {
  const db = database(); db.rows.set(path, {createdAt: Timestamp.fromMillis(1)});
  const merchant = db.doc(path), run = db.doc(path + '/monitoring_runs/run');
  const create = sourceFunction('monitoring-work', 'createMonitoringWorkStore', {FieldValue, Timestamp, installationKey, randomUUID: () => 'page', Buffer});
  return {db, run, store: create(db, run, merchant, installationKey(db.rows.get(path)))};
}
const source = {id:'A', meta:{recordid:'A'}, fields:{pictures:['https://example.com/source.jpg'], brand:'Actual brand'}};
const seed = {shop:'test.myshopify.com', mode:'delta', window:{strategy:'since-last-check',days:null,checkpointDate:'2026-10-01'}, hasMore:false,rapexAlertsScanned:1, checkpoint:{lastRapexAlertDate:'2026-10-02',lastRapexRecordTimestamp:'1',lastRapexAlertDocId:'A'}, changeCursor:null};
const item = {product:{id:'1',data:{productId:'1',name:'Actual product',sourceUpdatedAt:'1',vector_text:[1,2],vector_image:[3,4],accessToken:'never snapshot this'}},alerts:new Map([['A',{...source,fields:{...source.fields,pictures:['https://example.com/best.jpg',...source.fields.pictures],product_image:'https://example.com/best.jpg'}}]])};

test('vector retrieval overlaps at most four sources, retaining source merge order', async () => {
  let active = 0, peak = 0; const merged = [];
  await prepareMonitoringShortlist([0,1,2,3,4,5,6], async source => {
    peak = Math.max(peak, ++active); await new Promise(resolve=>setTimeout(resolve, (4-source%4)*2)); active--;return [source];
  }, (source, products) => merged.push([source,...products]));
  assert.equal(peak,4); assert.deepEqual(merged.map(x=>x[0]),[0,1,2,3,4,5,6]);
});

test('a failed window drains siblings and never starts later product work', async () => {
  const events = [];
  await assert.rejects(processMonitoringProducts([1,2,3], async id => {
    events.push(id); if(id===1)throw Error('provider unavailable');
    await new Promise(resolve=>setTimeout(resolve,10)); events.push('sibling committed');
  }), /provider unavailable/);
  assert.deepEqual(events,[1,2,'sibling committed']);
});

test('prepared facts, cursor and matched image order survive a restart without vector/token copies', async () => {
  const {db,store} = fixture();
  await store.save(seed,[source],[item]);
  const saved=await store.load();
  assert.deepEqual(saved.seed,seed);
  assert.deepEqual(saved.items[0].alerts.get('A').fields.pictures,item.alerts.get('A').fields.pictures);
  const json=[...db.rows.values()].map(x=>JSON.stringify(x)).join('');
  assert.ok(!json.includes('vector_text') && !json.includes('vector_image') && !json.includes('accessToken'));
  await store.complete(saved.items[0],{productsScanned:1,matchesFound:1,alertsCreated:1});
  assert.deepEqual((await store.load()).items[0].completed,{productsScanned:1,matchesFound:1,alertsCreated:1});
});

test('incomplete preparation is invisible and missing prepared inputs fail closed', async () => {
  const {db,store}=fixture(), transact=db.runTransaction;let writes=0;
  db.runTransaction=async callback=>{if(++writes===2)throw Error('interrupted');return transact(callback);};
  await assert.rejects(store.save(seed,[source],[item]),/interrupted/);
  assert.equal(await store.load(),null);
  db.runTransaction=transact;await store.save(seed,[source],[item]);
  const sourcePath=[...db.rows.keys()].find(key=>key.includes('/monitoring_work_sources/'));
  db.rows.delete(sourcePath);
  await assert.rejects(store.load(),/incomplete/);
});

test('purged and reinstalled merchants cannot receive stale checkpoint writes', async () => {
  const {db,store}=fixture();
  const page=await store.save(seed,[source],[item]);
  db.rows.clear();
  await assert.rejects(store.complete(page.items[0],{productsScanned:1,matchesFound:0,alertsCreated:0}),/installation changed/);
  assert.equal(db.rows.size,0);
  db.rows.set(path,{createdAt:Timestamp.fromMillis(2)});
  await assert.rejects(store.save(seed,[source],[item]),/installation changed/);
  assert.equal(db.rows.size,1);
});
