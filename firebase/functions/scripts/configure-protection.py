"""Idempotent production safeguards. Run from the repository root with an authorized gcloud account.
Enables PITR/deletion protection, daily/weekly backups and operations error notifications.
Credentials are read only by subprocess and never logged or saved.
"""
import os,json,urllib.request,urllib.error,subprocess,pathlib
os.environ['CLOUDSDK_PYTHON']='/opt/homebrew/bin/python3.14'
project='rapex-99a2c'; db='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)'
token=subprocess.check_output(['gcloud','auth','print-access-token'],text=True).strip()
def call(url,data=None,method=None):
 req=urllib.request.Request(url,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method)
 try:
  with urllib.request.urlopen(req,timeout=90) as r:return json.load(r)
 except urllib.error.HTTPError as e:raise RuntimeError(str(e.code)+' '+e.read().decode()[:1000])
result={}
updated=call(db+'?updateMask=pointInTimeRecoveryEnablement,deleteProtectionState',{'pointInTimeRecoveryEnablement':'POINT_IN_TIME_RECOVERY_ENABLED','deleteProtectionState':'DELETE_PROTECTION_ENABLED'},'PATCH')
result['database']={k:updated.get(k)for k in ['name','pointInTimeRecoveryEnablement','deleteProtectionState','versionRetentionPeriod','earliestVersionTime']}
print('PITR and database deletion protection enabled',flush=True)
existing=call(db+'/backupSchedules').get('backupSchedules',[])
for kind,config in [('dailyRecurrence',{'retention':'604800s','dailyRecurrence':{}}),('weeklyRecurrence',{'retention':'2419200s','weeklyRecurrence':{'day':'SUNDAY'}})]:
 if not any(kind in s for s in existing):call(db+'/backupSchedules',config,'POST')
result['backupSchedules']=call(db+'/backupSchedules').get('backupSchedules',[])
print('Daily 7-day and weekly 28-day backup schedules verified',flush=True)
monitor='https://monitoring.googleapis.com/v3/projects/'+project
channels=call(monitor+'/notificationChannels').get('notificationChannels',[])
channel=next((c for c in channels if c.get('type')=='email'and c.get('labels',{}).get('email_address')=='info@zerorecall.online'),None)
if not channel:channel=call(monitor+'/notificationChannels',{'type':'email','displayName':'ZeroRecall operations','labels':{'email_address':'info@zerorecall.online'},'enabled':True},'POST')
result['notificationChannel']={k:channel.get(k)for k in ['name','enabled','verificationStatus']}
policies=call(monitor+'/alertPolicies').get('alertPolicies',[])
name='ZeroRecall backend errors'
if True:
 policy={'displayName':name,'combiner':'OR','enabled':True,'notificationChannels':[channel['name']],
 'conditions':[{'displayName':'Backend or health check reported an error','conditionMatchedLog':{'filter':'resource.type="cloud_run_revision" AND severity>=ERROR AND (resource.labels.service_name=~"^(merchant|shopifyproduct|free|processfree|daily|check|send|weekly|notify|refresh|brevo|scanpublic|upsert|startmerchant|startshopify|runmerchant|manual|backfill|safety-gate-shopify).*")'}}],
 'alertStrategy':{'notificationRateLimit':{'period':'900s'},'autoClose':'1800s'},
 'documentation':{'mimeType':'text/markdown','content':'ZeroRecall backend error. Inspect Cloud Logging, task attempts, loader freshness and email acceptance. A failed or saturated check must remain incomplete. Runbook: docs/firebase-operations.md. Never grant billing access or mark mail delivered manually.'}}
 existingPolicy=next((p for p in policies if p.get('displayName')==name),None)
 if existingPolicy:
  policy['name']=existingPolicy['name'];call('https://monitoring.googleapis.com/v3/'+existingPolicy['name'],policy,'PATCH')
 else: policies.append(call(monitor+'/alertPolicies',policy,'POST'))
result['alertPolicies']=[{k:p.get(k)for k in ['name','displayName','enabled','notificationChannels']}for p in policies if p.get('displayName','').startswith('ZeroRecall')]
pathlib.Path('outputs/firebase-hardening-2026-10-23/protection.json').write_text(json.dumps(result,indent=2))
print('Operational error alert configured; receipt of a real incident alert is not claimed',flush=True)
