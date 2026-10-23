import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { reportAccessAllowed, reportTokenParts, readFreeScanReport } from '../lib/free-scan-report.js';
import { compactScanMatch } from '../lib/free-scan-catalog.js';
import { downloadReportPages } from '../../../marketing-site/free-scan-report.js';

test('report access requires the completed request, separate recipient secret and unexpired retention', async()=>{
 const secret='A'.repeat(43),now=Date.now();
 const data={status:'completed',expireAt:Timestamp.fromMillis(now+1000),reportAccessHash:createHash('sha256').update(secret).digest('hex')};
 assert.equal(reportAccessAllowed(data,secret,now),true);
 assert.equal(reportAccessAllowed(data,'B'.repeat(43),now),false);
 assert.equal(reportAccessAllowed({...data,status:'running'},secret,now),false);
 assert.equal(reportAccessAllowed(data,secret,now+1001),false);
 assert.equal(reportTokenParts('id.short'),null);
 assert.equal((await readFreeScanReport('invalid')).status,400);
 assert.equal((await readFreeScanReport('A'.repeat(20)+'.'+secret,'../other')).status,400);
});
test('full export traverses every page and every warning; neutralizes formulas and rejects external source links',async()=>{
 const match=n=>compactScanMatch({productId:String(n),productTitle:'=HYPERLINK("bad")',productUrl:'https://evil.test/a',result:{warnings:[{reason:'first',alertDetails:{fields:{caseNumber:'SR/12345/26',url:'https://evil.test'}}},{reason:'second'}]}});
 let calls=0;
 const result=await downloadReportPages('private-token',async payload=>{
  calls++;assert.equal(payload.reportToken,'private-token');
  if(calls===1) assert.equal(payload.cursor,undefined);else assert.equal(payload.cursor,'200');
  return {domain:'example.myshopify.com',checkedProducts:297,possibleMatches:7,matches:(calls===1?[1,2,3,4,5]:[6,7]).map(match),nextCursor:calls===1?'200':null};
 });
 assert.equal(calls,2);assert.equal(result.csv.split('\r\n').length,16);
 assert.match(result.csv,/'=HYPERLINK/);assert.doesNotMatch(result.csv,/evil\.test/);assert.match(result.csv,/"7"/);
 await assert.rejects(downloadReportPages('x',async()=>({domain:'a',matches:[],nextCursor:'200'})),/Repeated/);
});

test('authorized receipt API uses bounded pages and reveals nothing for a different secret',async()=>{
 const {db}=await import('../lib/firebase-admin.js');
 const original=db.collection;
 const secret='A'.repeat(43),token='A'.repeat(20)+'.'+secret;
 let reads=0,cursor=null,limit;
 const receipts=Array.from({length:201},(_,n)=>({id:String(n+1000),get:()=>({productId:String(n+1000)})}));
 const query={orderBy(){return this;},limit(n){limit=n;return this;},startAfter(value){cursor=value;return this;},async get(){reads++;const rows=cursor?receipts.slice(200):receipts.slice(0,200);return {size:rows.length,docs:rows};}};
 db.collection=()=>({doc:()=>({get:async()=>({data:()=>({domain:'example.myshopify.com',status:'completed',checkedProducts:201,possibleMatches:201,expireAt:Timestamp.fromMillis(Date.now()+10000),reportAccessHash:createHash('sha256').update(secret).digest('hex')})}),collection:()=>query})});
 try{
  assert.equal((await readFreeScanReport('A'.repeat(20)+'.'+'B'.repeat(43))).status,403);assert.equal(reads,0);
  const first=await readFreeScanReport(token);assert.equal(first.body.matches.length,200);assert.equal(limit,200);
  const second=await readFreeScanReport(token,first.body.nextCursor);assert.equal(second.body.matches.length,1);assert.equal(second.body.nextCursor,null);
 }finally{db.collection=original;}
});
