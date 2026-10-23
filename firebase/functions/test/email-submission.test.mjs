import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebase-admin.js';
import { submitScanReportOnce } from '../lib/email-submission.js';
import { EmailProviderRejection, EMAIL_AMBIGUITY_WINDOW_MS } from '../lib/email-delivery.js';

test('a report resumes a rejected submission, deduplicates acceptance and stops uncertain late retries',async()=>{
 const original=db.runTransaction;
 let state;
 const ref={};
 db.runTransaction=async fn=>fn({get:async()=>({exists:true,get:key=>key.split('.').slice(1).reduce((v,k)=>v?.[k],state)}),update:(_ref,value)=>{state=value.reportSubmission;}});
 let sends=0;
 try{
  await assert.rejects(submitScanReportOnce(ref,async()=>{sends++;throw new EmailProviderRejection('503');}),/503/);
  assert.equal(state.status,'failed');assert.equal(state.ambiguousSince,undefined);
  await submitScanReportOnce(ref,async()=>{sends++;});
  assert.equal(state.status,'accepted');
  await submitScanReportOnce(ref,async()=>{sends++;});assert.equal(sends,2);
  state={status:'failed',attempts:1,ambiguousSince:Timestamp.fromMillis(Date.now()-EMAIL_AMBIGUITY_WINDOW_MS-1)};
  await assert.rejects(submitScanReportOnce(ref,async()=>{sends++;}),/uncertain/);assert.equal(sends,2);
 }finally{db.runTransaction=original;}
});
