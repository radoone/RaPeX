import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebase-admin.js';
import { parsePartnerEntitlement, refreshShopifyEntitlements } from '../lib/billing-entitlements.js';
const shop='gid://shopify/Shop/1';
const contract={shop:{id:shop},items:[{handle:'monthly',price:{active:true}}],currentBillingCycle:{endTime:'2099-01-01T00:00:00Z'}};

test('background cache requires same-shop live contract, caps verification at 24 hours and revokes cancelled contracts',()=>{
 const now=Date.now();
 const active=parsePartnerEntitlement(contract,shop,now);
 assert.equal(active.monitoringEntitled,true);assert.equal(active.subscriptionValidUntil.toMillis(),now+86400000);
 assert.equal(active.subscriptionPeriodEnd.toDate().getUTCFullYear(),2099);
 assert.equal(parsePartnerEntitlement(null,shop).monitoringEntitled,false);
 assert.throws(()=>parsePartnerEntitlement(contract,'gid://shopify/Shop/2'),/tenant/);
 for(const endTime of ['invalid','2020-01-01T00:00:00Z'])assert.equal(parsePartnerEntitlement({...contract,currentBillingCycle:{endTime}},shop).monitoringEntitled,false);
});

test('scheduled renewal works without Admin session; provider outage preserves only the finite cache and defers failure',async()=>{
 const old={collection:db.collection,transaction:db.runTransaction,fetch:global.fetch};
 const env={...process.env};
 Object.assign(process.env,{SHOPIFY_PARTNER_ORG_ID:'123',SHOPIFY_PARTNER_API_TOKEN:'unit-test-placeholder',SHOPIFY_APP_GID:'gid://shopify/App/1'});
 let state={shopifyShopId:shop,monitoringEntitled:true,subscriptionValidUntil:Timestamp.fromMillis(Date.now()-1000)};
 const ref={};const snap=()=>({id:'example.myshopify.com',ref,exists:true,get:key=>state[key]});
 const query={where(){return this;},orderBy(){return this;},limit(n){assert.equal(n,100);return this;},get:async()=>({docs:[snap()]})};
 db.collection=()=>query;db.runTransaction=async fn=>fn({get:async()=>snap(),update:(_ref,value)=>{state={...state,...value};}});
 try{
  global.fetch=async()=>({ok:true,json:async()=>({data:{activeSubscription:contract}})});
  assert.deepEqual(await refreshShopifyEntitlements(),{verified:1,failed:0});assert.ok(state.subscriptionValidUntil.toMillis()>Date.now());
  const expiry=state.subscriptionValidUntil;
  global.fetch=async()=>{throw new Error('network unavailable');};
  assert.deepEqual(await refreshShopifyEntitlements(),{verified:0,failed:1});assert.equal(state.subscriptionValidUntil,expiry);assert.equal(state.billingRefreshErrorCode,'verification_failed');
  global.fetch=async()=>({ok:true,json:async()=>({data:{activeSubscription:null}})});
  await refreshShopifyEntitlements();assert.equal(state.monitoringEntitled,false);assert.equal(state.subscriptionStatus,'inactive');
 }finally{db.collection=old.collection;db.runTransaction=old.transaction;global.fetch=old.fetch;process.env=env;}
});
