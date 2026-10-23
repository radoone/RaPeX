"""Repair only missing required embeddings, from existing official facts; no merchant changes."""
import os,subprocess,json,urllib.request,urllib.error,pathlib,datetime,copy
os.environ['CLOUDSDK_PYTHON']='/opt/homebrew/bin/python3.14';token=subprocess.check_output(['gcloud','auth','print-access-token'],text=True).strip()
base='https://firestore.googleapis.com/v1/projects/rapex-99a2c/databases/(default)/documents'
def call(url,data):
 req=urllib.request.Request(url,data=json.dumps(data).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=90)as response:return json.load(response)
def names(where=None):
 query={'from':[{'collectionId':'rapex_alerts'}],'select':{'fields':[{'fieldPath':'__name__'}]}}
 if where:query['where']=where
 return {row['document']['name']for row in call(base+':runQuery',{'structuredQuery':query})if'document'in row}
allIds=names();ready=names({'unaryFilter':{'op':'IS_NOT_NULL','field':{'fieldPath':'vector_text'}}});missing=sorted(allIds-ready)
assert len(missing)<=10, 'Unexpected repair size; do not bulk-modify the dataset'
print('Missing required text embeddings:',len(missing),flush=True)
def decode(v):
 if 'stringValue'in v:return v['stringValue']
 if 'mapValue'in v:return{k:decode(x)for k,x in v['mapValue'].get('fields',{}).items()}
 return None
# Read one actual SDK-encoded vector as the REST serialization template; do not print it.
sample=next(iter(ready));req=urllib.request.Request('https://firestore.googleapis.com/v1/'+sample,headers={'Authorization':'Bearer '+token})
with urllib.request.urlopen(req)as response:template=json.load(response)['fields']['vector_text']
assert template['mapValue']['fields']['__type__']['stringValue']=='__vector__'
result={'before':{'total':len(allIds),'withTextVector':len(ready)},'repaired':[]}
for name in missing:
 req=urllib.request.Request('https://firestore.googleapis.com/v1/'+name,headers={'Authorization':'Bearer '+token})
 with urllib.request.urlopen(req)as response:document=json.load(response)
 if 'vector_text'in document['fields']:continue
 f=decode(document['fields']['fields'])
 parts=[('Brand',f.get('brand')or f.get('product_brand')),('Model',f.get('type_numberOfModel')or f.get('product_model')or f.get('product')),('Category',f.get('category')or f.get('product_category')),('Title',f.get('name')or f.get('product_name')or f.get('product')),('Description',f.get('description')or f.get('product_description')or f.get('danger'))]
 text=[]
 for label,value in parts:
  value=str(value or '').strip()
  if label=='Description'and len(value)>350:value=value[:350]+'...'
  if value:text.append(label+': '+value)
 assert text,'Missing source facts; do not invent embedding content'
 prediction=call('https://us-central1-aiplatform.googleapis.com/v1/projects/rapex-99a2c/locations/us-central1/publishers/google/models/gemini-embedding-001:predict',{'instances':[{'content':'\n'.join(text)}],'parameters':{'outputDimensionality':1536}})
 values=prediction['predictions'][0]['embeddings']['values'];assert len(values)==1536
 vector=copy.deepcopy(template);vector['mapValue']['fields']['value']['arrayValue']['values']=[{'doubleValue':value}for value in values]
 now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z');docId=name.split('/')[-1]
 journal='projects/rapex-99a2c/databases/(default)/documents/rapex_changes/'+now+'_'+docId+'_embedding_repair'
 call(base+':commit',{'writes':[{'update':{'name':name,'fields':{'vector_text':vector,'meta':{'mapValue':{'fields':{'record_timestamp':{'stringValue':now}}}}}},'updateMask':{'fieldPaths':['vector_text','meta.record_timestamp']},'currentDocument':{'updateTime':document['updateTime']}},{'update':{'name':journal,'fields':{'alertId':{'stringValue':docId},'reason':{'stringValue':'repair_missing_text_vector'}}},'updateTransforms':[{'fieldPath':'changedAt','setToServerValue':'REQUEST_TIME'}],'currentDocument':{'exists':False}}]})
 result['repaired'].append({'sourceId':docId,'caseNumber':f.get('caseNumber')or f.get('alert_number'),'dimensions':1536})
 print('Official source repaired:',docId,flush=True)
result['after']={'total':len(allIds),'withTextVector':len(names({'unaryFilter':{'op':'IS_NOT_NULL','field':{'fieldPath':'vector_text'}}}))}
pathlib.Path('outputs/firebase-hardening-2026-10-23/vector-repair.json').write_text(json.dumps(result,indent=2));assert result['after']['total']==result['after']['withTextVector']
print('Required text vectors now cover every existing source document',flush=True)
