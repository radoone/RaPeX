"""Release identity rules to matcher consumers, preserving each deployed source/lock/runtime.
Run prepare, validate, deploy [function names...], check. Private artifacts stay in outputs.
"""
import importlib.util
import json
import os
import pathlib
import shutil
import sys

repo = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release', repo / 'scripts/scoped-hardening-release.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.repo = repo
artifacts = repo.parents[1] / 'outputs'
r.root = pathlib.Path(os.environ.get('ZERO_RECALL_RELEASE_DIR', artifacts / 'identity-matcher-2026-11-02/backend'))
r.root.mkdir(parents=True, exist_ok=True)
r.root.chmod(0o700)
r.names = ['checkProductSafetyAPI', 'shopifyProductChangeTask', 'merchantMonitoringTask', 'runMerchantDeltaMonitoringAPI', 'merchantCatalogAuditTask', 'scanPublicShopifyStoreAPI', 'freeScanCatalogTask']
r.modules = ['safety-gate-checker', 'safety-gate-checker-results', 'safety-gate-checker.schemas', 'safety-gate-checker.types', 'product-model-identity']
r.intended_limits = {}
prompt = repo / 'prompts/productMatchAnalysis.prompt'
command = sys.argv[1]
if command in ['prepare', 'refresh']:
    if command == 'prepare' and (r.root / 'manifest.json').exists():
        raise RuntimeError('Use a fresh release directory; do not overwrite rollback snapshots')
    if command == 'prepare':
        r.prepare()
    r.refresh()
    manifest = json.loads((r.root / 'manifest.json').read_text())
    for name in r.names:
        dest = r.root / name
        (dest / 'prompts').mkdir(exist_ok=True)
        shutil.copyfile(prompt, dest / 'prompts/productMatchAnalysis.prompt')
        manifest[name]['promptSha256'] = r.digest(prompt.read_bytes())
        # Reuse installed dependencies only when the complete production lock hash matches.
        for candidate in (artifacts / 'gtin-release-2026-11-02').glob('*backend/*/package-lock.json'):
            runtime = candidate.parent / 'node_modules'
            if not (dest / 'node_modules').exists() and runtime.exists() and r.digest(candidate.read_bytes()) == manifest[name]['lockSha256']:
                (dest / 'node_modules').symlink_to(runtime.resolve(), target_is_directory=True)
                break
    r.private_json(r.root / 'manifest.json', manifest)
elif command == 'deploy':
    manifest = json.loads((r.root / 'manifest.json').read_text())
    for name in r.names:
        assert manifest[name]['promptSha256'] == r.digest(prompt.read_bytes()) == r.digest((r.root / name / 'prompts/productMatchAnalysis.prompt').read_bytes()), 'Prompt drift'
    r.deploy()
else:
    {'validate': r.validate, 'check': r.check}[command]()
