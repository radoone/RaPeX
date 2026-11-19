"""Release shared public/onboarding coverage after the authorized scans finish.

Snapshot each function's own source and lockfile. Overlay only the reviewed
functions/modules; preserve unrelated runtime code, configuration and secrets.
"""
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import zipfile

repo = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release', repo / 'scripts/scoped-hardening-release.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.root = pathlib.Path(os.environ.get('ZERO_RECALL_RELEASE_DIR', repo.parents[1] / 'outputs/onboarding-cache-2026-11-03/backend'))
r.root.mkdir(parents=True, exist_ok=True)
r.root.chmod(0o700)
r.names = ['merchantCatalogAuditTask', 'scanPublicShopifyStoreAPI', 'freeScanCatalogTask']
r.modules = []
r.intended_limits = {}


def declaration(source, name):
    # Use the TypeScript parser rather than a regex to find nested function ends.
    script = """const ts=require('typescript'),fs=require('fs');
const s=fs.readFileSync(0,'utf8'),t=ts.createSourceFile('x.ts',s,ts.ScriptTarget.Latest,true);
const n=t.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===process.argv[1] ||
ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(t)===process.argv[1]));
if(!n)process.exit(2);process.stdout.write(n.getText(t));"""
    return subprocess.check_output(['node', '-e', script, name], input=source, text=True, cwd=repo)


def replace_declaration(original, canonical, name):
    return original.replace(declaration(original, name), declaration(canonical, name), 1)


def add_import(source, canonical, module):
    line = next(line for line in canonical.splitlines() if f'from "./{module}.js"' in line)
    old = next((line for line in source.splitlines() if f'from "./{module}.js"' in line), None)
    return source.replace(old, line, 1) if old else line + '\n' + source


def scans_finished():
    root = repo.parents[1]
    batch = json.loads((root / 'outputs/public-store-refresh-2026-11-03/batch.json').read_text())
    stores = [s for s in batch['stores'] if s['domain'] != 'babyboutiqueshop.nl']
    assert all(s['status'] == 'completed' for s in stores), 'Public store refresh is not successfully finished'
    progress = root / 'outputs/4kidspoint-current-scan-2026-11-03/http2-paged'
    assert (progress / 'result.json').exists(), '4kidspoint scan is still running'
    run = json.loads((progress / 'run.json').read_text())
    # result.json precedes the worker's final transaction: require server state.
    script = """const {initializeApp,applicationDefault}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
initializeApp({projectId:'rapex-99a2c',credential:applicationDefault()});
(async()=>{const db=getFirestore();
const run=await db.doc('rapex_leads/4kidspoint.sk/owner_scan_runs/'+process.argv[1]).get();
const batch=await db.doc('rapex_meta/'+process.argv[2]).get();
if(run.get('status')!=='completed'||!['completed','completed_with_failures'].includes(batch.get('status')))process.exit(3);
const stores=batch.get('stores').filter(s=>s.domain!=='babyboutiqueshop.nl');
if(!stores.every(s=>s.status==='completed'))process.exit(4);})();"""
    subprocess.run(['node', '-e', script, run['runId'], batch['batchId']], cwd=repo, check=True)


command = sys.argv[1]
if command == 'snapshot':
    assert not (r.root / 'manifest.json').exists(), 'Use a new release directory'
    r.prepare()
elif command == 'prepare':
    manifest = json.loads((r.root / 'manifest.json').read_text())
    for name, entry in manifest.items():
        dest = r.root / name
        with zipfile.ZipFile(r.root / (name + '-before.zip')) as archive:
            for path in archive.namelist():
                if path.startswith('src/') and path.endswith('.ts'):
                    (dest / path).write_bytes(archive.read(path))
        copied = ['public-scan-onboarding-cache', 'public-scan-coverage', 'product-safety-coverage', 'product-pair-cache']
        if name == 'merchantCatalogAuditTask':
            for module, functions in [('merchant-monitoring', ['upsertMerchantProductsBatch']),
                                      ('merchant-catalog-audit', ['toProductInput', 'loadShopifyProductPage'])]:
                path = dest / 'src' / (module + '.ts')
                original = path.read_text()
                canonical = (repo / 'src' / (module + '.ts')).read_text()
                for function in functions:
                    original = replace_declaration(original, canonical, function)
                original = add_import(original, canonical, 'public-scan-onboarding-cache')
                if module == 'merchant-catalog-audit':
                    old = 'await upsertMerchantProductsBatch(page.products);'
                    assert original.count(old) == 1, 'Audit call-site drift'
                    original = original.replace(old, 'await upsertMerchantProductsBatch(page.products, page.publicScanDomains);')
                path.write_text(original)
        else:
            copied.append('public-store-scanner')
        # Preserve deployed checker behavior except the shared coverage callback
        # and the candidate-ID enum fix exercised by the current local workers.
        module = 'safety-gate-checker'
        path = dest / 'src' / (module + '.ts')
        canonical = (repo / 'src' / (module + '.ts')).read_text()
        original = path.read_text()
        if not re.search(r'import\s*\{[^}]*\bmergeSafetyResults\b[^}]*\}\s*from', original):
            original = 'import { mergeSafetyResults } from "./product-pair-cache.js";\n' + original
        for function in ['analyzeProductMatches', 'checkProductSafety']:
            original = replace_declaration(original, canonical, function)
        if '  createCandidateAnalysisSchema,' not in original:
            original = original.replace('  AnalysisMatchesSchema,', '  AnalysisMatchesSchema,\n  createCandidateAnalysisSchema,', 1)
        if '  retrieveAlertsByGtins,' not in original:
            original = original.replace('  retrieveAlertsWithRag,', '  retrieveAlertsWithRag,\n  retrieveAlertsByGtins,', 1)
        if 'withProductSafetyCoverage' not in original.split('export const checkProductSafety')[0]:
            original = 'import { withProductSafetyCoverage } from "./product-safety-coverage.js";\n' + original
        path.write_text(original)
        module = 'safety-gate-checker-retrieval'
        path = dest / 'src' / (module + '.ts')
        original = path.read_text()
        canonical = (repo / 'src' / (module + '.ts')).read_text()
        for function in ['retrieveAlertsFromCachedVectors', 'retrieveAlertsWithRag']:
            original = replace_declaration(original, canonical, function)
        if 'function mergeImageRecall(' not in original:
            original += '\n' + declaration(canonical, 'mergeImageRecall') + '\n'
        path.write_text(original)
        path = dest / 'src/product-lifecycle.ts'
        original = path.read_text()
        if 'export function sameProductVersion(' not in original:
            original += '\n' + declaration((repo / 'src/product-lifecycle.ts').read_text(), 'sameProductVersion') + '\n'
        path.write_text(original)
        module = 'safety-gate-checker.schemas'
        path = dest / 'src' / (module + '.ts')
        original = path.read_text()
        if 'export function createCandidateAnalysisSchema(' not in original:
            original += '\n' + declaration((repo / 'src' / (module + '.ts')).read_text(), 'createCandidateAnalysisSchema') + '\n'
        path.write_text(original)
        for module in copied:
            (dest / 'src' / (module + '.ts')).write_bytes((repo / 'src' / (module + '.ts')).read_bytes())
        # Cover the final patched bundle and all source modules with drift guards.
        entry['modules'] = {module: r.digest((repo / 'src' / (module + '.ts')).read_bytes()) for module in copied}
        entry['preparedSourceHashes'] = {str(path.relative_to(dest)): r.digest(path.read_bytes()) for path in (dest / 'src').rglob('*.ts')}
        entry['validated'] = False
        for prior in repo.parents[1].glob('outputs/*/backend/' + name):
            lock = prior / 'package-lock.json'
            if (prior / 'node_modules').exists() and lock.exists() and r.digest(lock.read_bytes()) == entry['lockSha256']:
                if not (dest / 'node_modules').exists():
                    (dest / 'node_modules').symlink_to((prior / 'node_modules').resolve(), target_is_directory=True)
                break
    r.private_json(r.root / 'manifest.json', manifest)
elif command == 'deploy':
    scans_finished()
    manifest = json.loads((r.root / 'manifest.json').read_text())
    for name, entry in manifest.items():
        for path, digest in entry['preparedSourceHashes'].items():
            assert r.digest((r.root / name / path).read_bytes()) == digest, 'Prepared source changed after review'
        before = json.loads((r.root / (name + '-before.json')).read_text())
        assert r.call(r.base + '/functions/' + name)['updateTime'] == before['updateTime'], 'Concurrent deployment: ' + name
    r.deploy()
elif command == 'watch':
    status_path = r.root.parent / 'watch-status.json'
    def state(status, **details):
        r.private_json(status_path, {'status': status, 'updatedAt': time.time(), **details})
        print(status, flush=True)
    manifest = json.loads((r.root / 'manifest.json').read_text())
    assert all(entry.get('validated') for entry in manifest.values()), 'Validate all bundles before arming the watcher'
    state('waiting_for_scans')
    try:
        while True:
            project = repo.parents[1]
            batch = json.loads((project / 'outputs/public-store-refresh-2026-11-03/batch.json').read_text())
            stores = [s for s in batch['stores'] if s['domain'] != 'babyboutiqueshop.nl']
            terminal = all(s['status'] in ['completed', 'failed'] for s in stores)
            four_done = (project / 'outputs/4kidspoint-current-scan-2026-11-03/http2-paged/result.json').exists()
            if terminal and four_done:
                assert all(s['status'] == 'completed' for s in stores), 'A public refresh failed; inspect before deploying'
                break
            time.sleep(30)
        # The deploy subcommand independently verifies server-side run states,
        # source hashes and absence of concurrent function deployments.
        state('verifying_scan_completion')
        subprocess.run([sys.executable, __file__, 'deploy'], check=True)
        state('deploying')
        for _ in range(60):
            subprocess.run([sys.executable, __file__, 'check'], check=True)
            verification = json.loads((r.root / 'verification.json').read_text())
            if len(verification) == len(r.names) and all(item['state'] == 'ACTIVE' for item in verification.values()):
                state('deployed', functions=verification)
                break
            time.sleep(30)
        else:
            raise RuntimeError('Deployment did not finish within the verification window')
    except Exception as error:
        state('stopped', reason=str(error))
        raise
else:
    {'validate': r.validate, 'check': r.check, 'gate': scans_finished}[command]()
