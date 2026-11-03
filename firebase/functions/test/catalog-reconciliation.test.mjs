import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../lib/catalog-reconciliation.js';
import * as lifecycle from '../lib/product-lifecycle.js';
import { merchantCatalogAuditTaskId, monitoringTaskId } from '../lib/monitoring-task-id.js';
import { sourceFunction as fn, database, Timestamp, FieldValue, logger } from './helpers/isolated-source.mjs';

const shop = 'test.myshopify.com', root = `merchants/${shop}`, version = '2026-11-02T10:00:00.000Z', now = '2026-11-03T10:00:00.000Z';
const node = (id, updatedAt = version) => ({ id: `gid://shopify/Product/${id}`, updatedAt });
const fieldPath = { documentId: () => '__name__' };
function paged(query, options = {}) {
  return {
    ...query,
    where: (...args) => paged(query.where(...args), options),
    orderBy: () => paged(query, options),
    startAfter: cursor => paged(query, { ...options, cursor }),
    select: () => paged(query, options),
    limit: cap => paged(query, { ...options, cap }),
    doc: id => document(query.doc(id)),
    get: async () => {
      const all = await query.get();
      const docs = all.docs.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .filter(d => !options.cursor || d.id > options.cursor).slice(0, options.cap ?? Infinity);
      return { docs, size: docs.length, empty: !docs.length };
    },
  };
}
function document(ref) { return { ...ref, collection: name => paged(ref.collection(name)) }; }
function fixture() {
  const db = database();db.rows.set(root, { shop, createdAt: Timestamp.fromMillis(1), entitled: true, initialScanStatus:'completed' });
  const merchantRef = () => document(db.doc(root));
  const queue = { entries: [], async enqueue(body, options) { this.entries.push({ body: structuredClone(body), options }); } };
  const deps = { db, FieldValue, Timestamp, FieldPath: fieldPath, logger, ...lifecycle, ...core, merchantCatalogAuditTaskId, monitoringTaskId,
    RUNS: 'catalog_reconciliation_runs', MAX_RUN_AGE: 20*60*60_000, merchantRef,
    currentEntitlement: data => data.entitled === true, validShop: value => typeof value === 'string' && /^[a-z0-9-]+\.myshopify\.com$/.test(value),
    PRODUCT_QUEUE: queue, randomUUID: () => 'lease-token',
  };
  deps.taskFor = fn('merchant-catalog-reconciliation', 'taskFor');
  deps.ownsRun = fn('merchant-catalog-reconciliation', 'ownsRun', deps);
  deps.productChangeJobId = fn('merchant-monitoring', 'productChangeJobId', deps);
  const reserve = fn('merchant-catalog-reconciliation', 'reserveCatalogReconciliation', deps);
  return { db, merchantRef, deps, queue, reserve };
}
function deleteProduct(s) { return fn('product-deletion', 'markMerchantProductDeleted', s.deps)(s.db, s.merchantRef(), shop, '1', now, '1'); }

test('only complete ordered Shopify responses can establish explicit missing products', () => {
  assert.equal(core.parseCatalogNodes({ data: { nodes: [node('1'), null] } }, ['1','2']).get('2'), null);
  for (const payload of [{}, {data:{}}, {data:{nodes:[]}}, {data:{nodes:[undefined]}}, {data:{nodes:[{}]}}, {data:{nodes:[node('2')]}}, {data:{nodes:[null]}, errors:[{message:'Access denied'}]}]) {
    assert.throws(() => core.parseCatalogNodes(payload,['1']));
  }
  const page = { data: { products: { nodes: [node('1'),node('2')], pageInfo: { hasNextPage: true, endCursor: 'next' } } } };
  assert.equal(core.parseCatalogPage(page,null,null).lastProductId,'2');
  assert.throws(() => core.parseCatalogPage(page,'next',null),/cursor/);
  assert.throws(() => core.parseCatalogPage(page,null,'2'),/advance/);
  assert.throws(() => core.parseCatalogPage({data:{products:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'x'}}}},null,null));
  assert.deepEqual(core.parseCatalogPage({data:{products:{nodes:[],pageInfo:{hasNextPage:false}}}},null,null).products,[]);
});

test('unchanged versions and newer local/deletion versions do not trigger AI work', () => {
  assert.equal(core.catalogNeedsRepair(undefined,{id:'1',updatedAt:version}),true);
  assert.equal(core.catalogNeedsRepair({id:'1',sourceUpdatedAt:'2026-11-02T05:00:00-05:00'},{id:'1',updatedAt:version}),false);
  assert.equal(core.catalogNeedsRepair({id:'1',sourceUpdatedAt:now},{id:'1',updatedAt:version}),false);
  assert.equal(core.catalogNeedsRepair({id:'1',deletedAt:true,deletedSourceUpdatedAt:now},{id:'1',updatedAt:version}),false);
  assert.equal(core.catalogNeedsRepair({id:'1',sourceUpdatedAt:version},{id:'1',updatedAt:now}),true);
});

test('absence requires direct Shopify confirmation and deletion cleanup works without a plan', () => {
  const stored = [{id:'1',sourceUpdatedAt:version},{id:'2',sourceUpdatedAt:version}];
  const current = new Map([['1',null],['2',{id:'2',updatedAt:now}]]);
  assert.deepEqual(core.prepareCatalogVerification(stored,current,now,false),[{id:'1',operation:'delete',sourceUpdatedAt:now}]);
  assert.equal(core.prepareCatalogVerification(stored,current,now,true).length,2);
  assert.throws(() => core.prepareCatalogVerification(stored,new Map(),now,true),/incomplete/);
  assert.deepEqual(core.prepareCatalogVerification([{id:'1',sourceUpdatedAt:'2026-11-04T00:00:00Z'}],new Map([['1',null]]),now,true),[]);
  assert.deepEqual(core.prepareCatalogVerification([{id:'1',deletedAt:true,deletedSourceUpdatedAt:version}],new Map([['1',null]]),now,false),[{id:'1',operation:'delete',sourceUpdatedAt:version}]);
});

test('deletion paginates 501 findings, keeps decisions/checks/history and isolates the shop', async () => {
  const s=fixture();s.db.rows.set(root+'/products/1',{sourceUpdatedAt:version,vector_text:'large',vector_image:'large',gtins:['123']});
  for(let i=0;i<501;i++)s.db.rows.set(root+'/alerts/'+String(i).padStart(4,'0'),{productId:'1',status:'resolved',reviewState:'resolved',notes:'Keep original decision'});
  s.db.rows.set(root+'/alerts/0000/decision_events/decision',{outcome:'supplier-confirmed'});
  s.db.rows.set(root+'/checks/check',{isSafe:false});s.db.rows.set('merchants/other.myshopify.com/alerts/finding',{productId:'1'});
  assert.equal(await deleteProduct(s),true);
  const product=s.db.rows.get(root+'/products/1');assert.ok(product.deletedAt);assert.ok(product.deletionCleanupCompletedAt);assert.equal(product.vector_text,undefined);assert.deepEqual(product.gtins,[]);
  const alerts=[...s.db.rows.entries()].filter(([p])=>p.startsWith(root+'/alerts/')&&!p.includes('/decision_events/'));
  assert.equal(alerts.length,501);assert.ok(alerts.every(([,v])=>v.productDeleted&&v.status==='resolved'&&v.notes==='Keep original decision'));
  assert.deepEqual(s.db.rows.get(root+'/alerts/0000/decision_events/decision'),{outcome:'supplier-confirmed'});
  assert.deepEqual(s.db.rows.get(root+'/checks/check'),{isSafe:false});assert.equal(s.db.rows.get('merchants/other.myshopify.com/alerts/finding').productDeleted,undefined);
});

test('interrupted finding cleanup resumes the same tombstone and a newer update stops stale cleanup', async () => {
  const s=fixture();s.db.rows.set(root+'/products/1',{sourceUpdatedAt:version});
  for(let i=0;i<401;i++)s.db.rows.set(root+'/alerts/'+String(i).padStart(4,'0'),{productId:'1'});
  const transact=s.db.runTransaction;let writes=0;
  s.db.runTransaction=async callback=>{if(++writes===3)throw Error('interrupted');return transact(callback);};
  await assert.rejects(deleteProduct(s),/interrupted/);assert.ok(s.db.rows.get(root+'/products/1').deletedAt);
  assert.equal(s.db.rows.get(root+'/products/1').deletionCleanupCompletedAt,undefined);
  s.db.runTransaction=transact;await deleteProduct(s);assert.ok(s.db.rows.get(root+'/products/1').deletionCleanupCompletedAt);
  s.db.rows.set(root+'/products/1',{sourceUpdatedAt:'2026-11-04T00:00:00Z'});
  assert.equal(await deleteProduct(s),false);assert.equal(s.db.rows.get(root+'/products/1').deletedAt,undefined);
});

test('uninstall or reinstall cannot receive old deletion writes or resurrect purged documents', async () => {
  for(const kind of ['retired','reinstalled','purged']) {
    const s=fixture();s.db.rows.set(root+'/products/1',{sourceUpdatedAt:version});
    if(kind==='retired')s.db.rows.get(root).installationRetiredAt=true;
    if(kind==='reinstalled')s.db.rows.get(root).createdAt=Timestamp.fromMillis(2);
    if(kind==='purged')s.db.rows.clear();
    assert.equal(await deleteProduct(s),false,kind);
    if(kind==='purged')assert.equal(s.db.rows.size,0);
    else assert.equal(s.db.rows.get(root+'/products/1').deletedAt,undefined);
  }
});

test('daily reservations reuse unfinished work, skip completed days and replace abandoned work', async () => {
  const s=fixture(), day=new Date();const first=await s.reserve(shop,day);assert.equal(first.phase,'discover');
  assert.deepEqual(await s.reserve(shop,new Date(day.getTime()+3600000)),first);
  const run=root+'/catalog_reconciliation_runs/'+first.runId;
  s.db.rows.get(run).status='completed';assert.equal(await s.reserve(shop,day),null);
  s.db.rows.get(run).status='retrying';s.db.rows.get(run).createdAt=Timestamp.fromMillis(Date.now()-21*3600000);
  const next=await s.reserve(shop,new Date(day.getTime()+86400000));assert.notEqual(next.runId,first.runId);assert.equal(s.db.rows.get(run).status,'abandoned');
  s.db.rows.get(root).entitled=false;s.db.rows.get(root+'/catalog_reconciliation_runs/'+next.runId).status='completed';
  assert.equal((await s.reserve(shop,new Date(day.getTime()+2*86400000))).phase,'verify');
});

test('a persisted repair page survives queue failure without advancing or re-reading Shopify', async () => {
  const s=fixture(), payload=await s.reserve(shop,new Date()), run=root+'/catalog_reconciliation_runs/'+payload.runId;
  let preparations=0,continuations=0,fail=true;
  const prepare=async()=>{preparations++;return {phase:'discover',nextCursor:'next',lastProductId:'2',done:false,visited:2,repairs:[{id:'1',operation:'upsert',sourceUpdatedAt:version},{id:'2',operation:'delete',sourceUpdatedAt:now}]};};
  const original=s.queue.enqueue.bind(s.queue);s.queue.enqueue=async(body,options)=>{if(fail&&body.operation==='delete')throw Error('queue unavailable');return original(body,options);};
  const worker=fn('merchant-catalog-reconciliation','handleCatalogReconciliationTask',{...s.deps,prepareReconciliationPage:prepare,enqueue:async()=>{continuations++;}});
  await assert.rejects(worker(payload),/queue unavailable/);assert.equal(s.db.rows.get(run).pageIndex,0);assert.ok(s.db.rows.get(run).prepared);assert.equal(s.db.rows.get(run).status,'retrying');
  fail=false;await worker(payload,1);assert.equal(preparations,1);assert.equal(s.db.rows.get(run).pageIndex,1);assert.equal(s.db.rows.get(run).cursor,'next');assert.equal(s.db.rows.get(run).prepared,undefined);assert.equal(continuations,1);
  const upserts=s.queue.entries.filter(e=>e.body.operation==='upsert');assert.equal(upserts.length,2);assert.equal(upserts[0].options.id,upserts[1].options.id);
  assert.equal(upserts[0].body.refreshFromShopify,true);assert.equal(upserts[0].body.product,undefined);
  assert.ok(!JSON.stringify(s.db.rows.get(run)).includes('accessToken'));
});

test('continuation enqueue failure repairs dispatch on replay and never rolls progress back', async () => {
  const s=fixture(), payload=await s.reserve(shop,new Date()), run=root+'/catalog_reconciliation_runs/'+payload.runId;let fail=true,dispatched;
  const worker=fn('merchant-catalog-reconciliation','handleCatalogReconciliationTask',{...s.deps,
    prepareReconciliationPage:async()=>({phase:'discover',nextCursor:null,lastProductId:null,done:true,visited:0,repairs:[]}),
    enqueue:async p=>{if(fail)throw Error('continuation unavailable');dispatched=p;},
  });
  await assert.rejects(worker(payload),/continuation unavailable/);assert.equal(s.db.rows.get(run).phase,'verify');assert.equal(s.db.rows.get(run).status,'queued');
  fail=false;await worker(payload,1);assert.equal(dispatched.phase,'verify');assert.equal(s.db.rows.get(run).shopifyProductsSeen,0);
});

test('an API outage never queues deletions, and a purged tenant cannot receive late page writes', async () => {
  for(const kind of ['api','purge','reinstall']) {
    const s=fixture(), payload=await s.reserve(shop,new Date());
    const worker=fn('merchant-catalog-reconciliation','handleCatalogReconciliationTask',{...s.deps,
      prepareReconciliationPage:async()=>{
        if(kind==='api')throw Error('Shopify unavailable');
        if(kind==='purge')s.db.rows.clear();else s.db.rows.get(root).createdAt=Timestamp.fromMillis(2);
        return {phase:'discover',nextCursor:null,lastProductId:null,done:true,visited:0,repairs:[{id:'1',operation:'delete',sourceUpdatedAt:now}]};
      },enqueue:async()=>{},
    });
    if(kind==='api')await assert.rejects(worker(payload),/unavailable/);else await worker(payload);
    assert.equal(s.queue.entries.length,0);if(kind==='purge')assert.equal(s.db.rows.size,0);
  }
});

test('a failed dispatch window drains siblings and does not start later repairs', async () => {
  const events=[];await assert.rejects(core.dispatchCatalogRepairs([0,1,2,3,4],async id=>{
    events.push(id);if(id===0)throw Error('unavailable');await new Promise(r=>setTimeout(r,5));events.push('done'+id);
  }),/unavailable/);
  assert.ok(!events.includes(4));assert.ok(events.includes('done3'));
});

test('repair identities are stable within a run but can recover an exhausted prior webhook job', () => {
  const s=fixture(), payload={shop,productId:'1',sourceUpdatedAt:version,installation:'1'};
  const original=s.deps.productChangeJobId(payload), repaired=s.deps.productChangeJobId({...payload,recoveryRunId:'daily-a'});
  assert.notEqual(original,repaired);assert.equal(repaired,s.deps.productChangeJobId({...payload,recoveryRunId:'daily-a'}));
  assert.notEqual(repaired,s.deps.productChangeJobId({...payload,recoveryRunId:'daily-b'}));
});

test('discovery queues only new/updated products; verification never interprets an API failure as deletion', async () => {
  const s=fixture();s.db.rows.set(root+'/products/1',{sourceUpdatedAt:version});s.db.rows.set(root+'/products/3',{sourceUpdatedAt:version});
  const prepare=fn('merchant-catalog-reconciliation','prepareReconciliationPage',{...s.deps,
    requestCatalogGraphQL:async()=>({data:{products:{nodes:[node('1'),node('2'),node('3',now)],pageInfo:{hasNextPage:false}}}}),
    productExistence:async()=>{throw Error('Shopify unavailable');},
  });
  const result=await prepare(shop,{phase:'discover'},true);assert.deepEqual(result.repairs.map(p=>p.id),['2','3']);
  assert.equal((await prepare(shop,{phase:'discover'},false)).repairs.length,0);
  await assert.rejects(prepare(shop,{phase:'verify'},true),/unavailable/);
});

test('initial catalog imports keep ownership of bulk embeddings and are not duplicated by reconciliation', async () => {
  const s=fixture();s.db.rows.get(root).initialScanStatus='scanning';const payload=await s.reserve(shop,new Date());
  assert.equal(payload.phase,'verify');let entitled;
  const worker=fn('merchant-catalog-reconciliation','handleCatalogReconciliationTask',{...s.deps,
    prepareReconciliationPage:async(_shop,_data,enabled)=>{entitled=enabled;return {phase:'verify',nextCursor:null,lastProductId:null,done:true,visited:0,repairs:[]};},
    enqueue:async()=>{},
  });
  await worker(payload);assert.equal(entitled,false);assert.equal(s.queue.entries.length,0);
});

test('product recovery hydrates authoritative Shopify facts before vector/model work and follows a newer version', async () => {
  for(const newer of [false,true]) {
    const s=fixture(), queued=[],writes=[],analyses=[];
    const current={shop,productId:'1',productTitle:'Actual Shopify title',sourceUpdatedAt:newer?now:version,product:{name:'Actual Shopify title',category:'toys',description:'Actual description',imageUrls:['https://example.com/actual.jpg'],barcodes:[{barcode:'4006381333931'}]}};
    const worker=fn('merchant-monitoring','handleShopifyProductChangeTask',{...s.deps,
      FIRESTORE_COLLECTIONS:{merchants:'merchants',subProducts:'products',subChecks:'checks'},AI_CONFIG:{checkHistoryTtlDays:90},
      productChangeJobRef:(_shop,id)=>s.db.doc(root+'/product_change_jobs/'+id),
      require:()=>({loadShopifyProductBarcodes:async()=>current}),
      enqueueRefreshedProductChange:async body=>queued.push(body),
      upsertMerchantProduct:async body=>{writes.push(body);s.db.rows.set(root+'/products/1',{sourceUpdatedAt:body.sourceUpdatedAt});},
      checkProductSafety:async product=>{analyses.push(product);return {isSafe:true,warnings:[],checkedAt:now};},
    });
    await worker({shop,productId:'1',sourceUpdatedAt:version,installation:'1',recoveryRunId:'daily-repair',refreshFromShopify:true});
    if(newer){assert.equal(writes.length,0);assert.equal(analyses.length,0);assert.equal(queued[0].sourceUpdatedAt,now);}
    else {assert.equal(queued.length,0);assert.equal(writes[0].product.name,current.product.name);assert.deepEqual(analyses[0].imageUrls,current.product.imageUrls);}
  }
});

test('an unentitled installation still queues cleanup but never a product analysis', async () => {
  const s=fixture();s.db.rows.get(root).entitled=false;const payload=await s.reserve(shop,new Date());
  const worker=fn('merchant-catalog-reconciliation','handleCatalogReconciliationTask',{...s.deps,
    prepareReconciliationPage:async()=>({phase:'verify',nextCursor:null,lastProductId:null,done:true,visited:2,repairs:[{id:'1',operation:'upsert',sourceUpdatedAt:version},{id:'2',operation:'delete',sourceUpdatedAt:now}]}),
    enqueue:async()=>{},
  });
  await worker(payload);assert.deepEqual(s.queue.entries.map(e=>e.body.operation),['delete']);
  assert.equal(s.db.rows.get(root+'/catalog_reconciliation_runs/'+payload.runId).status,'completed');
  assert.equal([...s.db.rows.keys()].some(k=>k.includes('/checks/')),false);
});
