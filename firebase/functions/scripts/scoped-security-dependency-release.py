"""Patch only affected dependency locks, preserving each live function's sources/manifest.
Run prepare, validate, deploy [names...], check. Never overlay canonical application code.
"""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.parse
import urllib.request
import zipfile

os.environ.setdefault('ZERO_RECALL_RELEASE_DIR', str(Path(__file__).resolve().parents[3] / 'outputs/dependency-security-2026-11-03/backend'))
helper = Path(__file__).with_name('scoped-hardening-release.py')
spec = importlib.util.spec_from_file_location('release', helper)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.modules = []
r.intended_limits = {}
credential = r.token()
r.token = lambda: credential


def affected(lock):
    result = {}
    for path, value in lock.get('packages', {}).items():
        version = tuple(int(x) for x in value.get('version', '0.0.0').split('-')[0].split('.') if x.isdigit())
        if path.endswith('node_modules/follow-redirects') and (1, 16, 0) <= version <= (1, 16, 1):
            result['follow-redirects'] = '1.16.2'
        if path.endswith('node_modules/glob') and version <= (14, 0, 1):
            result['glob'] = '14.0.2'
        if path.endswith('node_modules/minimatch') and (9, 0, 0) <= version < (11, 0, 1):
            result['minimatch@>=9.0.0'] = '11.0.1'
    return result


def source_hashes(dest):
    return {str(p.relative_to(dest)): r.digest(p.read_bytes()) for p in dest.rglob('*') if p.is_file()
            and 'node_modules' not in p.relative_to(dest).parts and p.name not in ['package.json', 'package-lock.json']
            and 'lib' not in p.relative_to(dest).parts}


def prepare():
    assert not (r.root / 'manifest.json').exists(), 'Use a fresh directory'
    functions = r.call(r.base + '/functions').get('functions', [])
    manifest, inventory, locks = {}, {}, {}
    for function in functions:
        name = function['name'].split('/')[-1]
        assert function.get('state') == 'ACTIVE', name + ': deployment in progress'
        source = function['buildConfig']['source']['storageSource']
        url = 'https://storage.googleapis.com/storage/v1/b/' + urllib.parse.quote(source['bucket'], safe='') + '/o/' + urllib.parse.quote(source['object'], safe='') + '?alt=media&generation=' + source['generation']
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + r.token()}), timeout=120) as response:
            raw = response.read()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            lock = json.loads(archive.read('package-lock.json'))
            changes = affected(lock)
            inventory[name] = {'affected': changes, 'sourceSha256': r.digest(raw)}
            if not changes:
                print(name + ': no affected dependency versions', flush=True)
                continue
            r.private_json(r.root / (name + '-before.json'), function)
            (r.root / (name + '-before.zip')).write_bytes(raw)
            dest = r.root / name
            dest.mkdir()
            for entry in archive.namelist():
                if entry.startswith('.env') or entry.endswith('/'):
                    continue
                target = dest / entry
                assert target.resolve().is_relative_to(dest.resolve()), 'Invalid archive path'
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
        before_sources = source_hashes(dest)
        package = json.loads((dest / 'package.json').read_text())
        original_dependencies = {key: package.get(key) for key in ['dependencies', 'devDependencies', 'engines', 'scripts', 'main']}
        package.setdefault('overrides', {}).update(changes)
        (dest / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
        identity = r.digest((dest / 'package.json').read_bytes() + json.dumps(lock, sort_keys=True).encode())
        if identity in locks:
            (dest / 'package-lock.json').write_bytes(locks[identity])
        else:
            process = subprocess.run(['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=dest, capture_output=True, text=True)
            (r.root / (name + '-lock.log')).write_text(process.stdout + process.stderr)
            assert process.returncode == 0, name + ': lock update failed; inspect private log'
            locks[identity] = (dest / 'package-lock.json').read_bytes()
        assert source_hashes(dest) == before_sources, name + ': application source drift'
        assert {key: package.get(key) for key in original_dependencies} == original_dependencies
        assert not affected(json.loads((dest / 'package-lock.json').read_text())), name + ': vulnerable targeted package remains'
        manifest[name] = {'modules': {}, 'validated': False, 'previousSourceSha256': r.digest(raw),
                          'lockSha256': r.digest((dest / 'package-lock.json').read_bytes()),
                          'packageSha256': r.digest((dest / 'package.json').read_bytes()),
                          'sourceHashes': before_sources, 'overrides': changes}
        print(name + ': dependency-only security patch prepared', flush=True)
    assert manifest, 'No affected functions found'
    r.private_json(r.root / 'inventory.json', inventory)
    r.private_json(r.root / 'manifest.json', manifest)


def verify_inputs(manifest):
    for name, record in manifest.items():
        dest = r.root / name
        assert source_hashes(dest) == record['sourceHashes'], name + ': application source changed'
        for filename, key in [('package.json', 'packageSha256'), ('package-lock.json', 'lockSha256')]:
            assert r.digest((dest / filename).read_bytes()) == record[key], name + ': dependency input changed'


command = sys.argv[1]
if command == 'prepare':
    prepare()
elif command == 'validate':
    verify_inputs(json.loads((r.root / 'manifest.json').read_text()))
    r.validate()
elif command == 'deploy':
    manifest = json.loads((r.root / 'manifest.json').read_text())
    verify_inputs(manifest)
    r.names = list(manifest)
    selected = sys.argv[2:] or r.names
    operations = json.loads((r.root / 'operations.json').read_text()) if (r.root / 'operations.json').exists() else {}
    for name in selected:
        if name in operations:
            continue
        before = json.loads((r.root / (name + '-before.json')).read_text())
        current = r.call(r.base + '/functions/' + name)
        assert before['updateTime'] == current['updateTime'], name + ': concurrent deployment; take fresh snapshot'
    r.deploy()
elif command == 'check':
    r.check()
else:
    raise SystemExit('Use prepare, validate, deploy [names...], or check')
