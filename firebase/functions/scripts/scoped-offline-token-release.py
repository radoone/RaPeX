"""Patch only Shopify session readers in three deployed worker bundles."""
import importlib.util, json, os, sys, zipfile, io, urllib.request
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('release',repo/'scripts/scoped-hardening-release.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
r.root=repo.parents[1]/'outputs/shopify-offline-tokens-2026-11-11/backend';r.root.mkdir(parents=True,exist_ok=True);r.root.chmod(0o700)
r.names=['shopifyProductChangeTask','merchantCatalogAuditTask','merchantCatalogReconciliationTask'];r.modules=['shopify-offline-session'];r.intended_limits={}
command=sys.argv[1]
if command=='prepare':
 assert not (r.root/'manifest.json').exists(), 'Use a fresh release directory to preserve rollback evidence'
 r.prepare()
 for name in r.names:
  dest=r.root/name
  p=dest/'src/merchant-catalog-audit.ts';s=p.read_text();start=s.index('async function loadOfflineAccessToken(shop: string)');stop=s.index('\nasync function loadShopifyProductPage',start)
  s='import { loadOfflineAccessToken as loadCurrentOfflineAccessToken } from "./shopify-offline-session.js";\n'+s[:start]+'async function loadOfflineAccessToken(shop: string): Promise<string> {\n  return loadCurrentOfflineAccessToken(db, shop);\n}\n'+s[stop:];p.write_text(s)
  p=dest/'src/merchant-catalog-reconciliation.ts'
  if p.exists():
   s=p.read_text().replace('import { decryptStoredShopifyToken } from "./merchant-catalog-audit.js";','import { loadOfflineAccessToken } from "./shopify-offline-session.js";')
   old='  const sessions = await db.collection("shopify_sessions").where("shop", "==", shop).where("isOnline", "==", false).limit(1).get();\n  const accessToken = decryptStoredShopifyToken(sessions.docs[0]?.get("accessToken"));'
   assert old in s;s=s.replace(old,'  const accessToken = await loadOfflineAccessToken(db, shop);');p.write_text(s)
  # Keep source declarations aligned with the intentional runtime secret binding.
  p=dest/'src/index.ts';s=p.read_text();start=s.index('export const '+name);stop=s.find('\nexport const ',start+1);stop=len(s) if stop<0 else stop
  part=s[start:stop].replace('"SAFETY_GATE_API_KEY"]','"SAFETY_GATE_API_KEY", "SHOPIFY_API_SECRET"]');s=s[:start]+part+s[stop:];p.write_text(s)
 m=json.loads((r.root/'manifest.json').read_text())
 for name,entry in m.items():entry['sourceHashes']={str(p.relative_to(r.root/name)):r.digest(p.read_bytes()) for p in (r.root/name/'src').rglob('*') if p.is_file()}
 r.private_json(r.root/'manifest.json',m)
elif command=='validate':r.validate()
elif command=='deploy':
 m=json.loads((r.root/'manifest.json').read_text());assert all(e.get('validated') for e in m.values())
 ops={}
 for name,entry in m.items():
  dest=r.root/name;before=json.loads((r.root/(name+'-before.json')).read_text());current=r.call(r.base+'/functions/'+name)
  assert current['updateTime']==before['updateTime'],'Concurrent deployment'
  assert all(r.digest((dest/p).read_bytes())==sha for p,sha in entry['sourceHashes'].items()),'Staged source drift'
  out=io.BytesIO()
  with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
   for p in dest.rglob('*'):
    if p.is_file() and not any(x in ['node_modules','.git','test'] for x in p.relative_to(dest).parts) and not p.name.startswith('.env'):z.write(p,str(p.relative_to(dest)))
  raw=out.getvalue();(r.root/(name+'-release.zip')).write_bytes(raw)
  upload=r.call(r.base+'/functions:generateUploadUrl',{})
  with urllib.request.urlopen(urllib.request.Request(upload['uploadUrl'],data=raw,method='PUT',headers={'Content-Type':'application/zip'}),timeout=180) as response:assert response.status==200
  config=before['serviceConfig'];env=dict(config.get('environmentVariables',{}));env['SHOPIFY_API_KEY']='0f8c446d88af9f13ac49947a87c47207'
  secrets=list(config.get('secretEnvironmentVariables',[]))
  if not any(s['key']=='SHOPIFY_API_SECRET' for s in secrets):secrets.append({'key':'SHOPIFY_API_SECRET','projectId':'rapex-99a2c','secret':'SHOPIFY_API_SECRET','version':'latest'})
  patch={'buildConfig':{'source':{'storageSource':upload['storageSource']}},'serviceConfig':{'environmentVariables':env,'secretEnvironmentVariables':secrets}}
  op=r.call(r.base+'/functions/'+name+'?updateMask=buildConfig.source,serviceConfig.environmentVariables,serviceConfig.secretEnvironmentVariables',patch,'PATCH');ops[name]=op['name'];r.private_json(r.root/'operations.json',ops);print(name+': build started',flush=True)
elif command=='check':
 result={}
 for name,op in json.loads((r.root/'operations.json').read_text()).items():
  status=r.call('https://cloudfunctions.googleapis.com/v2/'+op)
  if status.get('error'):raise RuntimeError(str(status['error']))
  if not status.get('done'):result[name]={'state':'BUILDING'};continue
  before=json.loads((r.root/(name+'-before.json')).read_text());after=r.call(r.base+'/functions/'+name);assert after['state']=='ACTIVE'
  a=dict(after['serviceConfig']);b=dict(before['serviceConfig']);a['environmentVariables']=dict(a.get('environmentVariables',{}));a['environmentVariables'].pop('SHOPIFY_API_KEY',None)
  b['environmentVariables']=dict(b.get('environmentVariables',{}));b['environmentVariables'].pop('SHOPIFY_API_KEY',None)
  a['secretEnvironmentVariables']=[s for s in a['secretEnvironmentVariables'] if s['key']!='SHOPIFY_API_SECRET'];b['secretEnvironmentVariables']=[s for s in b['secretEnvironmentVariables'] if s['key']!='SHOPIFY_API_SECRET']
  for key in ['environmentVariables','secretEnvironmentVariables','serviceAccountEmail','ingressSettings','timeoutSeconds','availableMemory','maxInstanceCount']:assert a.get(key)==b.get(key),(name,key)
  assert after.get('eventTrigger')==before.get('eventTrigger')
  r.private_json(r.root/(name+'-after.json'),after);result[name]={'state':'ACTIVE','revision':after['serviceConfig'].get('revision'),'configurationPreservedExceptOAuthCredentials':True}
 r.private_json(r.root/'verification.json',result);print(json.dumps(result,indent=2))
