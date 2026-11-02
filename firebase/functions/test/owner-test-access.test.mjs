import test from 'node:test';import assert from 'node:assert/strict';
import { ownerTestAccessGranted } from '../lib/owner-test-access.js';
import { sourceFunction } from './helpers/isolated-source.mjs';
const shop='example.myshopify.com';
const data=()=>({shop,createdAt:{toMillis:()=>123},ownerTestAccess:{shop,enabled:true,installation:'123',expiresAt:null}});
test('explicit owner access is tenant and installation bound, revocable and separate from payment',()=>{
 assert.equal(ownerTestAccessGranted(data(),shop),true);
 for(const value of [{...data(),installationRetiredAt:true},{...data(),createdAt:{toMillis:()=>124}},{...data(),ownerTestAccess:{...data().ownerTestAccess,enabled:false}},{...data(),ownerTestAccess:{...data().ownerTestAccess,expiresAt:undefined}}])assert.equal(ownerTestAccessGranted(value,shop),false);
 assert.equal(ownerTestAccessGranted(data(),'another.myshopify.com'),false);
 assert.equal(ownerTestAccessGranted({...data(),ownerTestAccess:{...data().ownerTestAccess,expiresAt:new Date(10)}},shop,11),false);
});
test('monitoring and email gates honor the same grant, then deny on revocation',()=>{
 for(const [module,name]of [['merchant-monitoring','currentEntitlement'],['email-notifications','hasCurrentMonitoringEntitlement']]){
 const gate=sourceFunction(module,name,{ownerTestAccessGranted});
 assert.equal(gate(data()),true);assert.equal(gate({...data(),ownerTestAccess:{...data().ownerTestAccess,enabled:false}}),false);
 }
});
