import test from 'node:test';
import assert from 'node:assert/strict';
import { emailAttemptPolicy, emailIdempotencyKey, EMAIL_AMBIGUITY_WINDOW_MS } from '../lib/email-delivery.js';
import { db } from '../lib/firebase-admin.js';
import { emailNotificationTestUtils as email } from '../lib/email-notifications.js';
import { Timestamp } from 'firebase-admin/firestore';

test('submission policy preserves terminal states, locks and ambiguous acceptance window', () => {
  const now = 100_000_000;
  for (const status of ['accepted','delivered','bounced','blocked']) assert.equal(emailAttemptPolicy({status},now),'skip');
  assert.equal(emailAttemptPolicy({status:'failed', attempts:1},now),'send');
  assert.equal(emailAttemptPolicy({status:'pending',leaseUntil:now+1000},now),'busy');
  assert.equal(emailAttemptPolicy({status:'failed',attempts:8},now),'exhausted');
  assert.equal(emailAttemptPolicy({ambiguousSince:now-EMAIL_AMBIGUITY_WINDOW_MS},now),'uncertain');
  assert.match(emailIdempotencyKey('a','id'), /^[a-f\d]{8}-[a-f\d]{4}-5[a-f\d]{3}-a[a-f\d]{3}-[a-f\d]{12}$/);
  assert.notEqual(emailIdempotencyKey('a','weekly'),emailIdempotencyKey('b','weekly'));
});

test('failed merchant send resumes, freezes recipient, handles provider duplicates and never downgrades delivery', async () => {
  const original = { transaction: db.runTransaction, collection: db.collection, fetch:global.fetch };
  process.env.BREVO_API_KEY='unit-test-placeholder';process.env.BREVO_SENDER_EMAIL='info@example.com';
  const docs = new Map();
  const ref = path => ({ path, collection: name => ref(path+'/'+name), doc: id=>ref(path+'/'+id), set:async value=>docs.set(path,value) });
  const snapshot = r => ({ exists: docs.has(r.path), data:()=>docs.get(r.path), get:key=>docs.get(r.path)?.[key] });
  db.collection=name=>ref(name);
  db.runTransaction=async fn=>fn({get:async r=>snapshot(r),set:(r,value)=>docs.set(r.path,{...docs.get(r.path),...value})});
  const params={shop:'example.myshopify.com',notificationId:'immediate_alert__one',type:'immediate_alert',recipient:'owner@example.com',content:{subject:'Subject',htmlContent:'<p>Facts</p>',textContent:'Facts'}};
  let calls=0;
  try {
    global.fetch=async(_url,options)=>{
      calls++;
      const body=JSON.parse(options.body);
      assert.equal(body.headers.idempotencyKey,emailIdempotencyKey(params.shop,params.notificationId));
      assert.equal(body.to[0].email,'owner@example.com');
      assert.ok(options.signal);
      if(calls===1) return {ok:false,status:503,json:async()=>({message:'unavailable'})};
      // Simulate authenticated delivery arriving before the API acceptance is saved.
      const row=docs.get('merchants/example.myshopify.com/email_notifications/immediate_alert__one');
      row.status='delivered';
      return {ok:true,status:201,json:async()=>({messageId:'<provider-one>'})};
    };
    await assert.rejects(email.createAndSendNotification(params), /rejected/);
    const path='merchants/example.myshopify.com/email_notifications/immediate_alert__one';
    assert.equal(docs.get(path).status,'failed');
    // Simulate FieldValue.delete after failed attempt in the in-memory store.
    delete docs.get(path).leaseUntil;delete docs.get(path).ambiguousSince;
    assert.equal(await email.createAndSendNotification({...params,recipient:'changed@example.com'}),true);
    assert.equal(docs.get(path).status,'delivered');
    assert.equal(docs.get(path).attempts,2);
    assert.equal(await email.createAndSendNotification(params),false);
    assert.equal(calls,2);
    global.fetch=async()=>({ok:false,status:400,json:async()=>({code:'duplicate_parameter',message:'idempotency key already used'})});
    assert.equal(await email.sendBrevoEmail({shop:'example.myshopify.com',notificationId:'other',to:'owner@example.com',content:params.content}),null);
    global.fetch=async()=>({ok:false,status:400,json:async()=>({code:'duplicate_parameter',message:'recipient invalid'})});
    await assert.rejects(email.sendBrevoEmail({shop:'example.myshopify.com',notificationId:'other',to:'owner@example.com',content:params.content}),/rejected/);
    assert.ok(docs.get(path).acceptedAt);
    assert.ok(docs.get(path).createdAt);
    assert.equal(Timestamp.fromMillis(1).toMillis(),1);
  } finally {db.runTransaction=original.transaction;db.collection=original.collection;global.fetch=original.fetch;}
});

test('a duplicate worker cannot acquire a live lease or bypass the expired ambiguity window', async()=>{
 const original={transaction:db.runTransaction,collection:db.collection,fetch:global.fetch};
 let state={status:'pending',attempts:1,leaseUntil:Timestamp.fromMillis(Date.now()+90000)};
 let sends=0;
 const ref={collection:()=>ref,doc:()=>ref};
 db.collection=()=>ref;
 db.runTransaction=async fn=>fn({get:async()=>({data:()=>state,get:k=>state[k]}),set:(_r,value)=>{state={...state,...value};}});
 global.fetch=async()=>{sends++;throw new Error('must not send');};
 const params={shop:'example.myshopify.com',notificationId:'same',type:'immediate_alert',recipient:'owner@example.com',content:{subject:'x',htmlContent:'x',textContent:'x'}};
 try{
  await assert.rejects(email.createAndSendNotification(params),/in progress/);assert.equal(sends,0);
  state={status:'failed',attempts:1,ambiguousSince:Timestamp.fromMillis(Date.now()-EMAIL_AMBIGUITY_WINDOW_MS-1000)};
  assert.equal(await email.createAndSendNotification(params),false);assert.equal(sends,0);
  assert.equal(state.failureCode,'uncertain');assert.equal(state.retryable,false);
 }finally{db.runTransaction=original.transaction;db.collection=original.collection;global.fetch=original.fetch;}
});
