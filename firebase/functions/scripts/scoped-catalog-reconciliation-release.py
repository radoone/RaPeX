"""Preserve deployed sources/locks while adding daily catalog reconciliation.

prepare/validate/deploy/check patch only the existing product worker. The separately
validated new-functions directory exports only the two new Firebase functions.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

repo = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release', repo / 'scripts/scoped-hardening-release.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.root = Path(os.environ.get('ZERO_RECALL_RELEASE_DIR', repo.parents[1] / 'outputs/catalog-reconciliation-2026-11-03/backend'))
r.root.mkdir(parents=True, exist_ok=True)
r.root.chmod(0o700)
r.names = ['shopifyProductChangeTask']
r.modules = ['catalog-reconciliation', 'merchant-catalog-reconciliation', 'product-deletion']
r.intended_limits = {}
baseline_revision = '5efc940'


def function(source, name):
    match = re.search(r'(?m)^(?:export )?(?:async )?function ' + name + r'\(', source)
    assert match, 'Missing function ' + name
    end = re.search(r'\n(?:export )?(?:async )?function ', source[match.start() + 1:])
    assert end, 'Missing boundary for ' + name
    return source[match.start():match.start() + 1 + end.start()]


def hashes(directory):
    return {str(p.relative_to(directory)): r.digest(p.read_bytes()) for p in directory.rglob('*')
            if p.is_file() and not any(part in ['node_modules', 'lib'] for part in p.relative_to(directory).parts)}


command = sys.argv[1]
if command == 'prepare':
    assert not (r.root / 'manifest.json').exists(), 'Preserve existing release evidence; use a fresh directory'
    r.prepare()
    manifest = json.loads((r.root / 'manifest.json').read_text())
    baseline = subprocess.check_output(['git', 'show', baseline_revision + ':firebase/functions/src/merchant-monitoring.ts'], cwd=repo, text=True)
    canonical = (repo / 'src/merchant-monitoring.ts').read_text()
    dest = r.root / 'shopifyProductChangeTask'
    with zipfile.ZipFile(r.root / 'shopifyProductChangeTask-before.zip') as archive:
        original = archive.read('src/merchant-monitoring.ts').decode()
    patched = original
    for target in ['currentEntitlement', 'productChangeJobId', 'handleShopifyProductChangeTask']:
        old = function(original, target)
        assert old == function(baseline, target), 'Unexpected live product lifecycle drift: ' + target
        patched = patched.replace(old, function(canonical, target), 1)
    pattern = r'export type ShopifyProductChangeTaskPayload = \{.*?\n\};'
    old = re.search(pattern, original, re.S).group()
    assert old == re.search(pattern, baseline, re.S).group(), 'Unexpected live task payload drift'
    patched = patched.replace(old, re.search(pattern, canonical, re.S).group(), 1)
    assert 'from "./product-deletion.js"' not in original
    patched = 'import { markMerchantProductDeleted } from "./product-deletion.js";\n' + patched
    (dest / 'src/merchant-monitoring.ts').write_text(patched)
    previous = repo.parents[1] / 'outputs/dependency-security-2026-11-03/backend/shopifyProductChangeTask'
    if (previous / 'node_modules').exists() and r.digest((previous / 'package-lock.json').read_bytes()) == manifest['shopifyProductChangeTask']['lockSha256']:
        (dest / 'node_modules').symlink_to((previous / 'node_modules').resolve(), target_is_directory=True)
    new = r.root / 'new-functions'
    shutil.copytree(dest, new, ignore=shutil.ignore_patterns('node_modules', 'lib'))
    index = (repo / 'src/index.ts').read_text()
    start = index.index('export const dailyMerchantCatalogReconciliation =')
    end = index.index('// --- Scheduled Function ---', start)
    imports = '''import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { handleCatalogReconciliationTask, reconcileMerchantCatalogs } from "./merchant-catalog-reconciliation.js";
'''
    (new / 'src/index.ts').write_text(imports + '\n' + index[start:end])
    (new / 'node_modules').symlink_to((dest / 'node_modules').resolve(), target_is_directory=True)
    r.private_json(r.root / 'firebase.json', {'functions': [{'source': 'new-functions', 'codebase': 'default', 'ignore': ['node_modules', '.git', 'test', '*.log']}]})
    manifest['shopifyProductChangeTask']['scopedSourceHashes'] = hashes(dest)
    r.private_json(r.root / 'manifest.json', manifest)
    r.private_json(r.root / 'new-functions-inputs.json', hashes(new))
elif command == 'validate':
    r.validate()
    result = subprocess.run(['npm', 'run', 'build'], cwd=r.root / 'new-functions', capture_output=True, text=True)
    (r.root / 'new-functions-build.log').write_text(result.stdout + result.stderr)
    assert result.returncode == 0, 'New functions compilation failed; inspect private log'
    assert hashes(r.root / 'new-functions') == json.loads((r.root / 'new-functions-inputs.json').read_text()), 'New function source drift'
    print('Two isolated new function exports compiled against the preserved production lock', flush=True)
elif command == 'deploy':
    manifest = json.loads((r.root / 'manifest.json').read_text())
    for name, record in manifest.items():
        assert hashes(r.root / name) == record['scopedSourceHashes'], 'Scoped deployment source drift'
        current = r.call(r.base + '/functions/' + name)
        before = json.loads((r.root / (name + '-before.json')).read_text())
        assert current['updateTime'] == before['updateTime'], 'Concurrent product worker deployment'
    r.deploy()
elif command == 'check':
    r.check()
else:
    raise SystemExit('Use prepare, validate, deploy, or check')
