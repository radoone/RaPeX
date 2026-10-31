/* global process, console, setTimeout */
/** Explicit translation maintenance tool. Never runs during app build/start or email delivery.
 * Input: a snapshot of localizedResources produced with tsx. Only static public UI copy is sent.
 * Uses this project's existing Vertex AI ADC authentication; never logs credentials.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Provide a static localizedResources JSON snapshot. This is an explicit network translation operation.');
const resources = JSON.parse(await readFile(resolve(sourcePath), 'utf8'));
const req = createRequire(resolve(root, 'firebase/functions/package.json'));
const { GoogleAuth } = req('google-auth-library');
const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
const output = resolve(root, 'shopify-client/app/locales/complete');
const cacheDir = resolve(root, 'outputs/merchant-locales/translation-cache');
await mkdir(output, { recursive: true }); await mkdir(cacheDir, { recursive: true });
const flatten = (o, prefix = '') => Object.fromEntries(Object.entries(o).flatMap(([key, value]) => typeof value === 'object' && value !== null ? Object.entries(flatten(value, `${prefix}${key}.`)) : [[prefix + key, value]]));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sorted = o => Object.fromEntries(Object.entries(o).sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0));
const english = sorted(flatten(resources.en.translation));
const names = {bg:'Bulgarian',cs:'Czech',da:'Danish',de:'German',el:'Greek',es:'Spanish',et:'Estonian',fi:'Finnish',fr:'French',ga:'Irish',hr:'Croatian',hu:'Hungarian',it:'Italian',lt:'Lithuanian',lv:'Latvian',mt:'Maltese',nl:'Dutch',pl:'Polish',pt:'European Portuguese',ro:'Romanian',sk:'Slovak',sl:'Slovenian',sv:'Swedish'};
const fixed = value => ['Shopify','Shopify Admin','Safety Gate','ZeroRecall','RAPEX','SKU','GTIN','EAN','GTIN/EAN','GPSR','CSV','PDF','ID','URL','API','AI','UTC'].includes(value) || /^[\d\s%.,–—−/+():…→✓⚠!?€-]+$/.test(value);
const tokens = value => (value.match(/{{[^}]+}}/g)||[]).sort();
const urls = value => (value.match(/https?:\/\/[^\s"<>]+/g)||[]).sort();
function validate(source, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Empty translation');
  if (JSON.stringify(tokens(source)) !== JSON.stringify(tokens(value))) throw new Error('Interpolation mismatch');
  if (JSON.stringify(urls(source)) !== JSON.stringify(urls(value))) throw new Error('URL mismatch');
}
function unflatten(flat) { const result = {}; for (const [key,value] of Object.entries(flat)) {const parts=key.split('.'); let node=result; for(const part of parts.slice(0,-1)) node=node[part]??={}; node[parts.at(-1)]=value;} return result; }
async function atomic(path, value) { const tmp=`${path}.tmp`; await writeFile(tmp,JSON.stringify(value,null,2)+'\n'); await rename(tmp,path); }
let active=0; const queue=[];
async function limited(task) { if(active>=6) await new Promise(resolve=>queue.push(resolve)); active++; try{return await task();} finally {active--;queue.shift()?.();} }
const manifest={createdOn:new Date().toISOString(),model:'gemini-2.5-flash',sourceSha256:hash(english),sourceOrdering:'Unicode code point',sourceKeys:Object.keys(english).length,scope:'Complete Shopify merchant UI, excluding stored product facts, identifiers and original Safety Gate records',nativeSpeakerReview:'Not performed for every language',locales:{}};
async function translate(language, items, batchIndex) {
  const cachePath=resolve(cacheDir,`${language}-${hash(items).slice(0,20)}.json`);
  try { const cached=JSON.parse(await readFile(cachePath,'utf8')); for(const item of items) validate(item.text,cached.translations[item.id]); return cached; } catch { /* A missing or stale cache is regenerated. */ }
  const input=Object.fromEntries(items.map(item=>[item.id,{key:item.key,text:item.text}]));
  const prompt=`You are translating a Shopify Admin app for product safety review. Translate every input text into natural ${names[language]} (${language}), in a consistent professional merchant UI style. Distinguish a possible product match from an official Safety Gate alert; similarity never certifies product danger or safety. Review means a merchant examines evidence; check means software compares a product. Keep the brands Shopify, ZeroRecall, Safety Gate and identifiers unchanged. Translate UI words including statuses, errors, table headers, navigation, helper text and accessibility labels. Do not add legal or regulatory facts. Preserve all {{interpolation}} tokens, numbers, URLs and markup exactly. Keys ending in _one, _two, _few, _many, _zero or _other are grammatical plural forms: use the correct ${names[language]} form for that category. Do not merely copy English for explanatory text. Return ONLY a JSON object mapping every input ID to its translated string, with no extra keys or commentary. Input:\n${JSON.stringify(input)}`;
  for(let attempt=0;attempt<4;attempt++) {
    try {
      const {data}=await limited(()=>client.request({url:'https://us-central1-aiplatform.googleapis.com/v1/projects/rapex-99a2c/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent',method:'POST',timeout:180000,data:{contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:Object.fromEntries(items.map(item=>[item.id,{type:'STRING'}])),required:items.map(item=>item.id)},temperature:0,maxOutputTokens:16000,thinkingConfig:{thinkingBudget:0}}}}));
      const text=(data.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
      const translations=JSON.parse(text);
      if(Object.keys(translations).length!==items.length) throw new Error('Key count mismatch');
      for(const item of items) { try { validate(item.text,translations[item.id]); } catch(error) { await atomic(resolve(cacheDir,`${language}-invalid-${batchIndex}.json`),{source:items,translations}); throw new Error(`${error.message} (${item.key})`, {cause:error}); } }
      const result={translations,usage:data.usageMetadata,sourceSha256:hash(items)};
      await atomic(cachePath,result); return result;
    } catch(error) { console.log(JSON.stringify({retry:language,batch:batchIndex,attempt:attempt+1,reason:error.response?.status || (/mismatch|Empty|Unexpected/.test(error.message) ? error.message : error.name)})); if(attempt===3) throw new Error(`Translation failed: ${language} batch ${batchIndex}; ${error.response?.status || error.name}`, {cause:error}); await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**attempt,10000))); }
  }
}
async function complete(language) {
  const source={...english};
  for(const key of Object.keys(english)) if(key.endsWith('_other')) {
    const stem=key.slice(0,-6);
    for(const category of new Intl.PluralRules(language).resolvedOptions().pluralCategories) source[`${stem}_${category}`]??=english[key];
  }
  const existing=flatten(resources[language].translation);
  const flat={}; const groups=new Map();
  for(const [key,text] of Object.entries(source)) {
    if(language==='sk' && typeof existing[key]==='string' && (existing[key]!==text || fixed(text))) continue;
    if(fixed(text)) {flat[key]=text;continue;}
    const category=key.match(/_(zero|one|two|few|many|other)$/)?.[1]||'';
    const dedup=`${text}\u0000${category}`;
    const group=groups.get(dedup)||{id:String(groups.size),key,text,keys:[]};group.keys.push(key);groups.set(dedup,group);
  }
  const items=[...groups.values()]; const chunks=[];
  for(let offset=0;offset<items.length;offset+=85) chunks.push(items.slice(offset,offset+85));
  const results=await Promise.all(chunks.map((chunk,index)=>translate(language,chunk,index)));
  let promptTokens=0,outputTokens=0;
  results.forEach((result,index)=>{promptTokens+=result.usage?.promptTokenCount||0;outputTokens+=result.usage?.candidatesTokenCount||0;for(const item of chunks[index]) for(const key of item.keys) flat[key]=result.translations[item.id];});
  for(const [key,text] of Object.entries(source)) validate(text,flat[key]??existing[key]);
  await atomic(resolve(output,`${language}.json`),unflatten(sorted(flat)));
  manifest.locales[language]={keys:Object.keys(flat).length,promptTokens,outputTokens,batches:chunks.length,extraPluralKeys:Object.keys(source).filter(key=>!(key in english))};
  console.log(JSON.stringify({language,keys:Object.keys(flat).length,batches:chunks.length,outputTokens}));
}
const languages=process.argv[3] ? process.argv[3].split(',') : Object.keys(names);
const results=await Promise.allSettled(languages.map(language=>complete(language)));
const failed=results.flatMap((result,index)=>result.status==='rejected'?[{language:languages[index],error:result.reason.message}]:[]);
await atomic(resolve(output,'manifest.json'),manifest);
if(failed.length) { console.error(JSON.stringify({failed})); process.exitCode=1; }
else console.log(JSON.stringify({complete:true,languages:languages.length,keys:Object.keys(english).length}));
