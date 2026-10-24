"""Idempotent production safeguards. Run from the repository root with an authorized gcloud account.
Maintains deletion protection and operations notifications. Paid recovery is disabled
by owner request (24 October 2026); --enable-paid-recovery explicitly opts back in.
Credentials are read only by subprocess and never logged or saved.
"""
import os,json,urllib.request,urllib.error,subprocess,pathlib,time,sys
os.environ['CLOUDSDK_PYTHON']='/opt/homebrew/bin/python3.14'
project='rapex-99a2c'; db='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)'
token=subprocess.check_output(['gcloud','auth','print-access-token'],text=True).strip()
def call(url,data=None,method=None):
 req=urllib.request.Request(url,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method)
 try:
  with urllib.request.urlopen(req,timeout=90) as r:return json.load(r)
 except urllib.error.HTTPError as e:raise RuntimeError(str(e.code)+' '+e.read().decode()[:1000])
result={}
paid_recovery='--enable-paid-recovery' in sys.argv[1:]
updated=call(db+'?updateMask=pointInTimeRecoveryEnablement,deleteProtectionState',{'pointInTimeRecoveryEnablement':'POINT_IN_TIME_RECOVERY_ENABLED' if paid_recovery else 'POINT_IN_TIME_RECOVERY_DISABLED','deleteProtectionState':'DELETE_PROTECTION_ENABLED'},'PATCH')
result['database']={k:updated.get(k)for k in ['name','pointInTimeRecoveryEnablement','deleteProtectionState','versionRetentionPeriod','earliestVersionTime']}
print('Database deletion protection enabled; paid recovery '+('enabled' if paid_recovery else 'disabled'),flush=True)
existing=call(db+'/backupSchedules').get('backupSchedules',[])
if paid_recovery:
 for kind,config in [('dailyRecurrence',{'retention':'604800s','dailyRecurrence':{}}),('weeklyRecurrence',{'retention':'2419200s','weeklyRecurrence':{'day':'SUNDAY'}})]:
  if not any(kind in s for s in existing):call(db+'/backupSchedules',config,'POST')
else:
 for schedule in existing:call('https://firestore.googleapis.com/v1/'+schedule['name'],method='DELETE')
result['backupSchedules']=call(db+'/backupSchedules').get('backupSchedules',[])
print('Backup schedules verified; paid recovery '+('enabled' if paid_recovery else 'disabled'),flush=True)
monitor='https://monitoring.googleapis.com/v3/projects/'+project
channels=call(monitor+'/notificationChannels').get('notificationChannels',[])
channel=next((c for c in channels if c.get('type')=='email'and c.get('labels',{}).get('email_address')=='info@zerorecall.online'),None)
if not channel:channel=call(monitor+'/notificationChannels',{'type':'email','displayName':'ZeroRecall operations','labels':{'email_address':'info@zerorecall.online'},'enabled':True},'POST')
result['notificationChannel']={k:channel.get(k)for k in ['name','enabled','verificationStatus']}
policies=call(monitor+'/alertPolicies').get('alertPolicies',[])
name='ZeroRecall backend errors'
if True:
 policy={'displayName':name,'combiner':'OR','enabled':True,'notificationChannels':[channel['name']],
 'conditions':[{'displayName':'Backend or health check reported an error','conditionMatchedLog':{'filter':'severity>=ERROR AND ((resource.type="cloud_run_revision" AND resource.labels.service_name=~"^(merchant|shopifyproduct|free|processfree|daily|check|send|weekly|notify|refresh|brevo|scanpublic|upsert|startmerchant|startshopify|runmerchant|manual|backfill|safety-gate-shopify).*") OR (resource.type="cloud_scheduler_job" AND resource.labels.job_id=~"^firebase-schedule-.*"))'}}],
 'alertStrategy':{'notificationRateLimit':{'period':'900s'},'autoClose':'1800s'},
 'documentation':{'mimeType':'text/markdown','content':'ZeroRecall backend error. Inspect Cloud Logging, task attempts, loader freshness and email acceptance. A failed or saturated check must remain incomplete. Runbook: docs/firebase-operations.md. Never grant billing access or mark mail delivered manually.'}}
 existingPolicy=next((p for p in policies if p.get('displayName')==name),None)
 if existingPolicy:
  policy['name']=existingPolicy['name'];call('https://monitoring.googleapis.com/v3/'+existingPolicy['name'],policy,'PATCH')
 else: policies.append(call(monitor+'/alertPolicies',policy,'POST'))
# A log alert cannot detect its own probe silently stopping. Seed this metric after setup.
metric_name='zerorecall_backend_health_runs'
logging_base='https://logging.googleapis.com/v2/projects/'+project+'/metrics'
metrics=call(logging_base).get('metrics',[])
metric={'name':metric_name,'description':'Count of completed ZeroRecall backend health probes, including probes reporting problems.','filter':'resource.type="cloud_run_revision" AND resource.labels.service_name="checkbackendhealth" AND jsonPayload.code="backend_health"','metricDescriptor':{'metricKind':'DELTA','valueType':'INT64','unit':'1'}}
if not any(m.get('name')==metric_name for m in metrics):call(logging_base,metric,'POST')
health_run='https://cloudscheduler.googleapis.com/v1/projects/'+project+'/locations/europe-west1/jobs/firebase-schedule-checkBackendHealth-europe-west1:run'
call(health_run,{},'POST')
def heartbeat_policy_call(url,body,method):
 for attempt in range(20):
  try:return call(url,body,method)
  except RuntimeError as error:
   if 'Cannot find metric(s)' not in str(error) or attempt==19:raise
   print('Waiting for the new heartbeat metric descriptor to propagate',flush=True)
   time.sleep(30)
heartbeat={'displayName':'ZeroRecall health heartbeat missing','combiner':'OR','enabled':True,'notificationChannels':[channel['name']],
 'conditions':[{'displayName':'No health probe data for three hours','conditionAbsent':{'filter':'metric.type="logging.googleapis.com/user/zerorecall_backend_health_runs" AND resource.type="cloud_run_revision" AND resource.labels.service_name="checkbackendhealth"','duration':'10800s','aggregations':[{'alignmentPeriod':'600s','perSeriesAligner':'ALIGN_SUM','crossSeriesReducer':'REDUCE_SUM'}],'trigger':{'count':1}}}],
 'documentation':{'mimeType':'text/markdown','content':'The hourly ZeroRecall health probe stopped reporting. Check that the Cloud Scheduler job is enabled, its service account can invoke the private health service, and the backend health function is available. Runbook: docs/firebase-operations.md.'}}
existing_heartbeat=next((p for p in policies if p.get('displayName')==heartbeat['displayName']),None)
if existing_heartbeat:
 heartbeat['name']=existing_heartbeat['name'];heartbeat_policy_call('https://monitoring.googleapis.com/v3/'+existing_heartbeat['name'],heartbeat,'PATCH')
else:heartbeat_policy_call(monitor+'/alertPolicies',heartbeat,'POST')
# Absence policies require at least one fresh observation after policy creation.
call(health_run,{},'POST')
policies=call(monitor+'/alertPolicies').get('alertPolicies',[])
result['healthHeartbeatMetric']='logging.googleapis.com/user/'+metric_name
result['alertPolicies']=[{k:p.get(k)for k in ['name','displayName','enabled','notificationChannels']}for p in policies if p.get('displayName','').startswith('ZeroRecall')]
pathlib.Path('outputs/firebase-hardening-2026-10-23/protection.json').write_text(json.dumps(result,indent=2))
print('Operational errors, scheduler failures and missing-heartbeat alert policies configured',flush=True)
