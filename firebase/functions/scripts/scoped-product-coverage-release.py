"""Scoped current-state coverage release; never changes paused queues or schedulers."""
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
import zipfile

repo = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release', repo / 'scripts/scoped-hardening-release.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.root = pathlib.Path(os.environ.get('ZERO_RECALL_RELEASE_DIR', repo.parents[1] / 'outputs/product-baseline-2026-11-03/backend'))
r.root.mkdir(parents=True, exist_ok=True)
r.root.chmod(0o700)
r.names = ['checkProductSafetyAPI', 'shopifyProductChangeTask', 'merchantCatalogAuditTask', 'merchantMonitoringTask', 'runMerchantDeltaMonitoringAPI', 'dailyMerchantDeltaMonitoring', 'dailyRapexDeltaLoader']
if os.environ.get('ZERO_RECALL_RELEASE_FUNCTIONS'):
    r.names = os.environ['ZERO_RECALL_RELEASE_FUNCTIONS'].split(',')
r.modules = []
r.intended_limits = {}

def function(source, name):
    start = re.search(r'(?m)^(?:export )?(?:async )?function ' + name + r'\(', source)
    assert start, 'Missing function: ' + name
    end = re.search(r'\n(?:export )?(?:async )?function ', source[start.start() + 1:])
    assert end, 'Missing following function: ' + name
    return source[start.start():start.start() + 1 + end.start()]

command = sys.argv[1]
if command == 'snapshot':
    assert not (r.root / 'manifest.json').exists(), 'Use a new release directory'
    r.prepare()
elif command == 'prepare':
    manifest = json.loads((r.root / 'manifest.json').read_text())
    for name, entry in manifest.items():
        dest = r.root / name
        with zipfile.ZipFile(r.root / (name + '-before.zip')) as archive:
            original = archive.read('src/merchant-monitoring.ts').decode()
            original_audit = archive.read('src/merchant-catalog-audit.ts').decode()
        canonical = (repo / 'src/merchant-monitoring.ts').read_text()
        patched = original
        for target in ['loadRapexAlertCandidatesSince', 'loadMonitoringImages', 'findCandidateProductsForAlert', 'upsertAlertForProduct', 'runMerchantDeltaMonitoringForShop', 'runDailyMerchantDeltaMonitoring']:
            patched = patched.replace(function(original, target), function(canonical, target), 1)
        for target in ['loadPublicMonitoringDocuments', 'createMonitoringProductLoader']:
            if re.search(r'(?m)^(?:export )?(?:async )?function ' + target + r'\(', original):
                patched = patched.replace(function(original, target), function(canonical, target), 1)
            else:
                anchor = 'loadRapexAlertCandidatesSince' if target == 'loadPublicMonitoringDocuments' else 'findCandidateProductsForAlert'
                patched = patched.replace(function(canonical, anchor), function(canonical, target) + '\n' + function(canonical, anchor), 1)
        if 'export async function runMerchantCatalogProductPage(' not in patched:
            patched = patched.replace(function(canonical, 'runMerchantDeltaMonitoringForShop'), function(canonical, 'runMerchantCatalogProductPage') + '\n' + function(canonical, 'runMerchantDeltaMonitoringForShop'), 1)
        for old, new in [
            ('if (status === "completed" || status === "skipped_unentitled")', 'if (status === "completed" || status === "skipped_unentitled" || status === "cancelled")'),
            ('if (jobSnapshot.get("status") === "completed") return;', 'if (["completed", "cancelled"].includes(String(jobSnapshot.get("status")))) return;'),
        ]:
            if old in patched:
                assert 1 <= patched.count(old) <= 2, 'Unexpected worker guard: ' + name
                patched = patched.replace(old, new)
            else:
                assert new in patched, 'Missing cancelled guard: ' + name
        for module in ['monitoring-work', 'monitoring-public-cache', 'monitoring-small-catalog', 'monitoring-product-cache', 'product-safety-coverage', 'product-lifecycle']:
            line = next(line for line in canonical.splitlines() if 'from "./' + module + '.js"' in line)
            existing = next((line for line in patched.splitlines() if 'from "./' + module + '.js"' in line), None)
            patched = patched.replace(existing, line, 1) if existing else line + '\n' + patched
        if 'type DocumentSnapshot' not in patched:
            patched = patched.replace('type DocumentReference', 'type DocumentSnapshot, type DocumentReference', 1)
        if patched.count('mapBounded') == 1:
            patched = patched.replace('import { mapBounded } from "./matching-work.js";\n', '')
        (dest / 'src/merchant-monitoring.ts').write_text(patched)
        changed = ['safety-gate-checker', 'safety-gate-checker-results', 'safety-gate-checker-retrieval', 'safety-gate-checker.types', 'safety-gate-checker.schemas', 'merchant-catalog-audit', 'monitoring-product-cache', 'monitoring-work', 'safety-gate-types', 'product-safety-coverage', 'product-pair-cache', 'product-lifecycle']
        for module in changed:
            (dest / 'src' / (module + '.ts')).write_bytes((repo / 'src' / (module + '.ts')).read_bytes())
        prompt = repo / 'prompts/productMatchAnalysis.prompt'
        (dest / 'prompts').mkdir(exist_ok=True)
        (dest / 'prompts/productMatchAnalysis.prompt').write_bytes(prompt.read_bytes())
        entry['promptSha256'] = r.digest(prompt.read_bytes())
        audit = (dest / 'src/merchant-catalog-audit.ts').read_text()
        audit = audit.replace(function(audit, 'loadShopifyProductBarcodes'), function(original_audit, 'loadShopifyProductBarcodes'), 1)
        (dest / 'src/merchant-catalog-audit.ts').write_text(audit)
        entry['auditPatchSha256'] = r.digest(audit.encode())
        # Current-state consumers also need previously scoped retrieval dependencies.
        for source in list((dest / 'src').rglob('*.ts')):
            for dependency in re.findall(r'from ["\']\./([^"\']+)\.js["\']', source.read_text()):
                target = source.parent / (dependency + '.ts')
                if not target.exists():
                    candidate = repo / target.relative_to(dest)
                    assert candidate.exists(), 'Missing dependency: ' + str(candidate)
                    target.write_bytes(candidate.read_bytes())
                    module = str(target.relative_to(dest / 'src'))[:-3]
                    if module not in changed: changed.append(module)
        entry['modules'] = {m: r.digest((repo / 'src' / (m + '.ts')).read_bytes()) for m in changed}
        entry['monitoringPatch'] = {'beforeSha256': r.digest(original.encode()), 'afterSha256': r.digest(patched.encode())}
        entry['validated'] = False
        # Reuse only an exactly matching installed dependency lock.
        for prior in [repo.parents[1] / 'outputs/product-baseline-2026-11-03/backend' / name,
                      repo.parents[1] / 'outputs/catalog-reconciliation-2026-11-03/backend' / name,
                      repo.parents[1] / 'outputs/monitoring-catalog-strategies-2026-11-03/backend' / name,
                      repo.parents[1] / 'outputs/monitoring-incident-2026-11-03/backend' / name]:
            if (prior / 'node_modules').exists() and r.digest((prior / 'package-lock.json').read_bytes()) == entry['lockSha256']:
                if not (dest / 'node_modules').exists(): (dest / 'node_modules').symlink_to((prior / 'node_modules').resolve(), target_is_directory=True)
                break
    r.private_json(r.root / 'manifest.json', manifest)
elif command == 'deploy':
    manifest = json.loads((r.root / 'manifest.json').read_text())
    for name, entry in manifest.items():
        assert entry['monitoringPatch']['afterSha256'] == r.digest((r.root / name / 'src/merchant-monitoring.ts').read_bytes()), 'Scoped source drift'
        assert entry['auditPatchSha256'] == r.digest((r.root / name / 'src/merchant-catalog-audit.ts').read_bytes()), 'Scoped audit drift'
        assert entry['promptSha256'] == r.digest((r.root / name / 'prompts/productMatchAnalysis.prompt').read_bytes()), 'Scoped prompt drift'
        before = json.loads((r.root / (name + '-before.json')).read_text())
        current = r.call(r.base + '/functions/' + name)
        assert current['updateTime'] == before['updateTime'], 'Concurrent deployment: ' + name
    r.deploy()
else:
    {'validate': r.validate, 'check': r.check}[command]()
