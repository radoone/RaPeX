"""Release the tested matcher budget/evidence policy to its seven direct consumers.

Preserve each function's deployed source, lockfile, runtime configuration and
triggers. Private artifacts include rollback sources and must stay untracked.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zipfile

repo = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release', repo / 'scripts/scoped-hardening-release.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.root = Path(os.environ.get('ZERO_RECALL_RELEASE_DIR', repo.parents[1] / 'outputs/matcher-production-2026-11-09/backend'))
r.root.mkdir(parents=True, exist_ok=True)
r.root.chmod(0o700)
r.names = ['checkProductSafetyAPI', 'shopifyProductChangeTask', 'merchantMonitoringTask',
           'runMerchantDeltaMonitoringAPI', 'merchantCatalogAuditTask',
           'scanPublicShopifyStoreAPI', 'freeScanCatalogTask']
r.modules = ['candidate-selection', 'safety-gate-checker', 'safety-gate-checker-results',
             'safety-gate-checker-retrieval', 'safety-gate-checker.schemas',
             'safety-gate-checker.types', 'safety-gate-config', 'product-model-identity',
             'product-pair-cache', 'product-safety-coverage', 'public-scan-coverage']
r.intended_limits = {}
prompt = Path('prompts/productMatchAnalysis.prompt')
cached_token = None
original_token = r.token


def token():
    global cached_token
    if cached_token is None:
        cached_token = original_token()
    return cached_token


r.token = token


def hashes(dest):
    return {str(p.relative_to(dest)): r.digest(p.read_bytes())
            for folder in ['src', 'prompts'] for p in (dest / folder).rglob('*') if p.is_file()}


def declaration(source, name):
    script = """const ts=require('typescript'),fs=require('fs');
const s=fs.readFileSync(0,'utf8'),t=ts.createSourceFile('x.ts',s,ts.ScriptTarget.Latest,true);
const n=t.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===process.argv[1]);
if(!n)process.exit(2);process.stdout.write(n.getText(t));"""
    return subprocess.check_output(['node', '-e', script, name], input=source, text=True, cwd=repo)


def scoped_parts(dest, archive):
    # Onboarding and pair-cache adoption were previously deployed to different
    # consumer subsets. Preserve each consumer's flow instead of expanding it.
    relative = 'src/safety-gate-checker.ts'
    original = archive.read(relative).decode()
    canonical = (repo / relative).read_text()
    original = original.replace('import { AI_CONFIG, FIRESTORE_COLLECTIONS }',
                                'import { AI_CONFIG, FIRESTORE_COLLECTIONS, MATCHER_POLICY_VERSION }', 1)
    original, count = re.subn(r'reliabilityVersion: \d+', 'reliabilityVersion: MATCHER_POLICY_VERSION', original)
    assert count == 1, 'Unexpected matcher cache declaration'
    if '  createCandidateAnalysisSchema,' not in original:
        assert '  AnalysisMatchesSchema,' in original
        original = original.replace('  AnalysisMatchesSchema,', '  AnalysisMatchesSchema,\n  createCandidateAnalysisSchema,', 1)
    original = original.replace(declaration(original, 'analyzeProductMatches'),
                                declaration(canonical, 'analyzeProductMatches'), 1)
    assert 'if (candidateAlerts.length > 4)' in original, 'Expected previously deployed four-candidate batches'
    (dest / relative).write_text(original)

    relative = 'src/product-safety-coverage.ts'
    original = archive.read(relative).decode()
    original = 'import { MATCHER_POLICY_VERSION } from "./safety-gate-config.js";\n' + original
    needle = 'if (stored.get("installation") === installation &&'
    assert original.count(needle) == 1, 'Unexpected full coverage cache guard'
    original = original.replace(needle, 'if (stored.get("matcherPolicy") === MATCHER_POLICY_VERSION && stored.get("installation") === installation &&', 1)
    needle = 'transaction.set(ref, { ...coverage,'
    assert 1 <= original.count(needle) <= 2, 'Unexpected completed coverage writes'
    original = original.replace(needle, 'transaction.set(ref, { ...coverage, matcherPolicy: MATCHER_POLICY_VERSION,')
    (dest / relative).write_text(original)

    # Keep each runtime's existing product-version normalization.
    relative = 'src/safety-gate-checker-retrieval.ts'
    original = archive.read(relative).decode()
    patched = (dest / relative).read_text()
    patched = patched.replace(declaration(patched, 'getCachedMerchantProductVectors'),
                              declaration(original, 'getCachedMerchantProductVectors'), 1)
    if patched.count('sameProductVersion') == 1:
        patched = patched.replace('import { sameProductVersion } from "./product-lifecycle.js";\n', '', 1)
    (dest / relative).write_text(patched)


def verify(manifest):
    for name, entry in manifest.items():
        dest = r.root / name
        assert hashes(dest) == entry['sourceHashes'], name + ': staged source drift'
        assert r.digest((dest / 'package-lock.json').read_bytes()) == entry['lockSha256'], name + ': lock drift'
        assert r.digest((dest / 'package.json').read_bytes()) == entry['packageSha256'], name + ': package drift'
        assert r.digest((dest / prompt).read_bytes()) == r.digest((repo / prompt).read_bytes()), name + ': prompt drift'


command = sys.argv[1]
if command in ['prepare', 'refine']:
    if command == 'prepare':
        assert not (r.root / 'manifest.json').exists(), 'Use a fresh release directory'
        r.prepare()
    else:
        assert not (r.root / 'operations.json').exists(), 'Cannot refine a submitted release'
    manifest = json.loads((r.root / 'manifest.json').read_text())
    allowed = {'src/' + module + '.ts' for module in r.modules} | {str(prompt)}
    for name, entry in manifest.items():
        dest = r.root / name
        (dest / prompt).parent.mkdir(exist_ok=True)
        (dest / prompt).write_bytes((repo / prompt).read_bytes())
        with zipfile.ZipFile(r.root / (name + '-before.zip')) as archive:
            scoped_parts(dest, archive)
            current = hashes(dest)
            original = {path: r.digest(archive.read(path)) for path in archive.namelist()
                        if path.startswith(('src/', 'prompts/')) and not path.endswith('/')}
        changes = sorted(path for path in set(original) | set(current) if original.get(path) != current.get(path))
        assert set(changes) <= allowed, name + ': unrelated source changes'
        entry.pop('compiledHashes', None)
        entry.update(sourceHashes=current, changedPaths=changes,
                     packageSha256=r.digest((dest / 'package.json').read_bytes()), validated=False)
        # Reuse only an installed runtime with an identical complete lockfile.
        candidates = [repo] + list((repo.parents[1] / 'outputs').glob('*/backend/' + name))
        for prior in candidates:
            lock = prior / 'package-lock.json'
            runtime = prior / 'node_modules'
            if runtime.exists() and lock.exists() and r.digest(lock.read_bytes()) == entry['lockSha256']:
                if not (dest / 'node_modules').exists():
                    (dest / 'node_modules').symlink_to(runtime.resolve(), target_is_directory=True)
                break
    r.private_json(r.root / 'manifest.json', manifest)
elif command == 'validate':
    manifest = json.loads((r.root / 'manifest.json').read_text())
    verify(manifest)
    r.validate()
    manifest = json.loads((r.root / 'manifest.json').read_text())
    for name, entry in manifest.items():
        entry['compiledHashes'] = {str(p.relative_to(r.root / name)): r.digest(p.read_bytes())
                                  for p in (r.root / name / 'lib').rglob('*') if p.is_file()}
    r.private_json(r.root / 'manifest.json', manifest)
elif command == 'deploy':
    manifest = json.loads((r.root / 'manifest.json').read_text())
    verify(manifest)
    operations = json.loads((r.root / 'operations.json').read_text()) if (r.root / 'operations.json').exists() else {}
    for name in sys.argv[2:] or r.names:
        entry = manifest[name]
        assert entry.get('validated'), name + ': not validated'
        current = {str(p.relative_to(r.root / name)): r.digest(p.read_bytes())
                   for p in (r.root / name / 'lib').rglob('*') if p.is_file()}
        assert current == entry['compiledHashes'], name + ': compiled output drift'
        if name not in operations:
            before = json.loads((r.root / (name + '-before.json')).read_text())
            assert r.call(r.base + '/functions/' + name)['updateTime'] == before['updateTime'], name + ': concurrent deployment'
    r.deploy()
elif command == 'check':
    r.check()
else:
    raise SystemExit('Use prepare, validate, deploy [names...], or check')
