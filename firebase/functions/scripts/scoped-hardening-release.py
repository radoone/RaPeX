"""Overlay reviewed backend modules onto each deployed function's own source/lockfile.
Private snapshots preserve rollback inputs. Never print credentials or runtime environment.
Run prepare, validate, deploy, check in sequence; source and configuration hashes are recorded.
"""
import os, json, subprocess, urllib.request, urllib.parse, zipfile, io, pathlib, hashlib, sys, re
os.environ.setdefault('CLOUDSDK_PYTHON', '/opt/homebrew/bin/python3.14')
repo = pathlib.Path(__file__).resolve().parents[1]
root = pathlib.Path(os.environ.get('ZERO_RECALL_RELEASE_DIR', '/tmp/zerorecall-backend-hardening'))
root.mkdir(exist_ok=True, parents=True); os.chmod(root, 0o700)
project = 'rapex-99a2c'
base = f'https://cloudfunctions.googleapis.com/v2/projects/{project}/locations/europe-west1'
names = ['checkProductSafetyAPI', 'upsertMerchantProductAPI', 'startShopifyProductChangeAPI', 'shopifyProductChangeTask', 'merchantMonitoringTask', 'runMerchantDeltaMonitoringAPI', 'dailyMerchantDeltaMonitoring', 'merchantCatalogAuditTask', 'startMerchantCatalogAuditAPI', 'dailyRapexDeltaLoader', 'manualSafetyGateWeeklyLoader', 'scanPublicShopifyStoreAPI', 'freeScanCatalogTask', 'processFreeScanRequestJob', 'sendImmediateSafetyGateAlertEmail', 'weeklyClearSafetyGateSummary', 'brevoEmailWebhook', 'notifyFreeScanOwner', 'backfillRecentRapexEmbeddings', 'manualRapexLoader', 'backfillHistoricalRapexAlerts', 'refreshShopifyBillingEntitlements']
modules = ['safety-gate-checker', 'safety-gate-checker-results', 'safety-gate-checker-retrieval', 'safety-gate-checker-media', 'safety-gate-embeddings', 'safety-gate-weekly-loader', 'safety-gate-types', 'merchant-monitoring', 'merchant-catalog-audit', 'product-lifecycle', 'vector-recall', 'public-image', 'email-notifications', 'free-scan-owner-notification', 'billing-entitlements', 'safety-gate-checker.types', 'safety-gate-checker.schemas', 'scripts/test-product-matching', 'monitoring-task-id']

if os.environ.get('ZERO_RECALL_RELEASE_FUNCTIONS'):
    names = os.environ['ZERO_RECALL_RELEASE_FUNCTIONS'].split(',')
if os.environ.get('ZERO_RECALL_RELEASE_MODULES'):
    modules = os.environ['ZERO_RECALL_RELEASE_MODULES'].split(',')

intended_limits = {'manualSafetyGateWeeklyLoader': 1, 'refreshShopifyBillingEntitlements': 1}

def token(): return subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
def call(url, body=None, method=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers={'Authorization': 'Bearer '+token(), 'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=180) as response: return json.load(response)
def private_json(path, value):
    path.write_text(json.dumps(value, indent=2)); os.chmod(path, 0o600)
def digest(data): return hashlib.sha256(data).hexdigest()

def prepare():
    manifest = {}
    for name in names:
        function = call(base+'/functions/'+name)
        assert function.get('state') == 'ACTIVE', name+' must finish its previous operation before snapshotting'
        private_json(root/(name+'-before.json'), function)
        source = function['buildConfig']['source']['storageSource']; q = urllib.parse.quote
        url = 'https://storage.googleapis.com/storage/v1/b/'+q(source['bucket'], safe='')+'/o/'+q(source['object'], safe='')+'?alt=media&generation='+source['generation']
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization':'Bearer '+token()}), timeout=120) as response: raw = response.read()
        (root/(name+'-before.zip')).write_bytes(raw)
        dest = root/name; dest.mkdir(exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            for filename in archive.namelist():
                if filename.startswith('.env') or filename.endswith('/'): continue
                target = dest/filename
                if not target.resolve().is_relative_to(dest.resolve()): raise ValueError('Invalid archive path')
                target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(archive.read(filename))
        # The isolated billing scheduler deliberately has only its own dependencies.
        selected = ['billing-entitlements'] if name == 'refreshShopifyBillingEntitlements' else modules
        for module in selected:
            target = dest/'src'/f'{module}.ts'; target.parent.mkdir(exist_ok=True)
            target.write_bytes((repo/'src'/f'{module}.ts').read_bytes())
        manifest[name] = {'previousSourceSha256':digest(raw), 'lockSha256':digest((dest/'package-lock.json').read_bytes()), 'modules':{m:digest((repo/'src'/f'{m}.ts').read_bytes()) for m in selected}}
        print(name+': scoped source prepared', flush=True)
    private_json(root/'manifest.json', manifest)

def refresh():
    manifest = json.loads((root/'manifest.json').read_text())
    for name, record in manifest.items():
        dest = root/name
        selected = ['billing-entitlements'] if name == 'refreshShopifyBillingEntitlements' else list(modules)
        pending = list(selected)
        while pending:
            module = pending.pop()
            source = repo/'src'/f'{module}.ts'
            target = dest/'src'/f'{module}.ts'; target.parent.mkdir(exist_ok=True)
            target.write_bytes(source.read_bytes())
            for dependency in re.findall(r'from ["\']\./([^"\']+)\.js["\']', source.read_text()):
                if not (dest/'src'/f'{dependency}.ts').exists() and dependency not in selected and (repo/'src'/f'{dependency}.ts').exists():
                    selected.append(dependency); pending.append(dependency)
        record['modules'] = {module:digest((repo/'src'/f'{module}.ts').read_bytes()) for module in selected}
        record['validated'] = False
    private_json(root/'manifest.json', manifest)
    print('Reviewed overlay and missing direct dependencies refreshed', flush=True)

def validate():
    manifest = json.loads((root/'manifest.json').read_text()); runtimes = {}
    for name, record in manifest.items():
        dest = root/name; lock = record['lockSha256']
        modules_path = dest/'node_modules'
        if modules_path.exists(): runtimes.setdefault(lock, modules_path.resolve())
        if not modules_path.exists():
            if lock in runtimes: modules_path.symlink_to(runtimes[lock], target_is_directory=True)
            else:
                result = subprocess.run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'], cwd=dest, capture_output=True, text=True)
                (root/(name+'-install.log')).write_text(result.stdout+result.stderr)
                if result.returncode: raise RuntimeError(name+' install failed; inspect private log')
                runtimes[lock] = modules_path
        result = subprocess.run(['npm','run','build'], cwd=dest, capture_output=True, text=True)
        (root/(name+'-build.log')).write_text(result.stdout+result.stderr)
        if result.returncode: print((result.stdout+result.stderr)[-4000:]); raise RuntimeError(name+' build failed')
        record['validated'] = True
        print(name+': built against preserved production lockfile', flush=True)
    private_json(root/'manifest.json', manifest)

def deploy():
    manifest = json.loads((root/'manifest.json').read_text())
    assert all(v.get('validated') for v in manifest.values()), 'Validate every production bundle first'
    operations = json.loads((root/'operations.json').read_text()) if (root/'operations.json').exists() else {}
    # Optional release batches avoid exhausting regional Cloud Build concurrency.
    selected = sys.argv[2:] or names
    for name in selected:
        if name in operations: continue
        assert all(digest((repo/'src'/f'{m}.ts').read_bytes()) == sha for m,sha in manifest[name]['modules'].items()), 'Source changed after validation'
        dest = root/name; output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in dest.rglob('*'):
                if not path.is_file() or any(part in ['node_modules','.git','test'] for part in path.relative_to(dest).parts) or path.name.startswith('.env'): continue
                archive.write(path, str(path.relative_to(dest)))
        payload = output.getvalue(); (root/(name+'-release.zip')).write_bytes(payload)
        upload = call(base+'/functions:generateUploadUrl', {})
        with urllib.request.urlopen(urllib.request.Request(upload['uploadUrl'], data=payload, method='PUT', headers={'Content-Type':'application/zip'}), timeout=180) as response: assert response.status == 200
        before = json.loads((root/(name+'-before.json')).read_text())
        operation = call(base+'/functions/'+name+'?updateMask=buildConfig.source,serviceConfig.maxInstanceCount', {'buildConfig':{'source':{'storageSource':upload['storageSource']}},'serviceConfig':{'maxInstanceCount':intended_limits.get(name,before['serviceConfig'].get('maxInstanceCount',0))}}, 'PATCH')
        operations[name] = operation['name']; private_json(root/'operations.json',operations)
        print(name+': build started',flush=True)

def check():
    result = {}; operations = json.loads((root/'operations.json').read_text())
    for name, operation in operations.items():
        status = call('https://cloudfunctions.googleapis.com/v2/'+operation)
        if status.get('error'): raise RuntimeError(name+': '+json.dumps(status['error']))
        if not status.get('done'): result[name] = {'state':'BUILDING'}; continue
        before = json.loads((root/(name+'-before.json')).read_text()); after = call(base+'/functions/'+name)
        assert after['state'] == 'ACTIVE', name
        for field in ['environmentVariables','secretEnvironmentVariables','serviceAccountEmail','ingressSettings','timeoutSeconds','availableMemory','maxInstanceCount']:
            old, new = before['serviceConfig'].get(field), after['serviceConfig'].get(field)
            if field == 'maxInstanceCount': old, new = intended_limits.get(name,old or 0), new or 0
            assert old == new, name+' configuration changed: '+field
        def trigger(value):
            data = dict(value or {})
            if 'eventFilters' in data: data['eventFilters'] = sorted(data['eventFilters'],key=lambda item: json.dumps(item,sort_keys=True))
            return data
        assert trigger(before.get('eventTrigger')) == trigger(after.get('eventTrigger')), name+' trigger changed'
        private_json(root/(name+'-after.json'), after)
        result[name] = {'state':'ACTIVE','revision':after['serviceConfig'].get('revision'), 'configurationPreserved':True, 'intentionalInstanceLimit':intended_limits.get(name)}
    private_json(root/'verification.json',result)
    print(json.dumps(result,indent=2))

if __name__ == '__main__':
    {'prepare':prepare,'refresh':refresh,'validate':validate,'deploy':deploy,'check':check}[sys.argv[1]]()
