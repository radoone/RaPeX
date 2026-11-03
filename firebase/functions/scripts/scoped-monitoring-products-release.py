"""Release projected searches and page-local product facts onto each deployed consumer."""
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
r.root = pathlib.Path(os.environ.get('ZERO_RECALL_RELEASE_DIR', repo.parents[1] / 'outputs/monitoring-product-cache-2026-11-03/backend'))
r.root.mkdir(parents=True, exist_ok=True)
r.root.chmod(0o700)
r.names = ['merchantMonitoringTask', 'merchantCatalogAuditTask', 'runMerchantDeltaMonitoringAPI']
r.modules = ['monitoring-product-cache']
r.intended_limits = {}


def function(source, name):
    match = re.search(r'(?m)^(?:export )?(?:async )?function ' + name + r'\(', source)
    assert match, 'Missing function: ' + name
    following = re.search(r'\n(?:export )?(?:async )?function ', source[match.start() + 1:])
    assert following, 'Missing function boundary: ' + name
    return source[match.start():match.start() + 1 + following.start()]


canonical = (repo / 'src/merchant-monitoring.ts').read_text()
command = sys.argv[1]
if command == 'prepare':
    assert not (r.root / 'manifest.json').exists(), 'Use a fresh directory to preserve rollback snapshots'
    r.prepare()
    baseline = subprocess.check_output(['git', 'show', '0152558:firebase/functions/src/merchant-monitoring.ts'], cwd=repo, text=True)
    manifest = json.loads((r.root / 'manifest.json').read_text())
    for name in r.names:
        dest = r.root / name
        with zipfile.ZipFile(r.root / (name + '-before.zip')) as archive:
            original = archive.read('src/merchant-monitoring.ts').decode()
        patched = original
        for target in ['findCandidateProductsForAlert', 'runMerchantDeltaMonitoringForShop']:
            previous = function(original, target)
            assert previous == function(baseline, target), 'Unexpected deployed monitoring changes: ' + name + '/' + target
            patched = patched.replace(previous, function(canonical, target), 1)
        assert 'function createMonitoringProductLoader(' not in original
        patched = patched.replace(function(canonical, 'findCandidateProductsForAlert'), function(canonical, 'createMonitoringProductLoader') + '\n' + function(canonical, 'findCandidateProductsForAlert'), 1)
        imports = next(line for line in canonical.splitlines() if 'from "./monitoring-product-cache.js"' in line)
        patched = imports + '\n' + patched
        (dest / 'src/merchant-monitoring.ts').write_text(patched)
        manifest[name]['monitoringPatch'] = {'beforeSha256': r.digest(original.encode()), 'afterSha256': r.digest(patched.encode()), 'canonicalSha256': r.digest(canonical.encode())}
        previous_runtime = repo.parents[1] / 'outputs/monitoring-performance-2026-11-03/backend' / name
        if (previous_runtime / 'node_modules').exists() and r.digest((previous_runtime / 'package-lock.json').read_bytes()) == manifest[name]['lockSha256']:
            (dest / 'node_modules').symlink_to((previous_runtime / 'node_modules').resolve(), target_is_directory=True)
    r.private_json(r.root / 'manifest.json', manifest)
elif command == 'deploy':
    manifest = json.loads((r.root / 'manifest.json').read_text())
    for name, record in manifest.items():
        assert record['monitoringPatch']['canonicalSha256'] == r.digest(canonical.encode()), 'Canonical source drift'
        assert record['monitoringPatch']['afterSha256'] == r.digest((r.root / name / 'src/merchant-monitoring.ts').read_bytes()), 'Scoped patch drift'
    r.deploy()
else:
    {'validate': r.validate, 'check': r.check}[command]()
