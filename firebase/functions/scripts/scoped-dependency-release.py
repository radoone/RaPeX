"""Upgrade dependencies while preserving each deployed function's own application source.

Run prepare, validate, deploy [function names...], check. Snapshots contain private
configuration and live only in the owner-readable ZERO_RECALL_RELEASE_DIR.
"""
import importlib.util
import json
import os
from pathlib import Path
import sys
import zipfile

os.environ.setdefault('ZERO_RECALL_RELEASE_DIR', '/tmp/zerorecall-dependency-release')
helper = Path(__file__).with_name('scoped-hardening-release.py')
spec = importlib.util.spec_from_file_location('scoped_release', helper)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
# Dependency updates do not intentionally alter any instance limits or source modules.
release.modules = []
release.intended_limits = {}
canonical = helper.parent.parent
original_token = release.token
cached_token = original_token()
release.token = lambda: cached_token


def prepare():
    functions = release.call(release.base + '/functions').get('functions', [])
    release.names = [f['name'].split('/')[-1] for f in functions]
    assert release.names, 'No functions found'
    assert not (release.root / 'manifest.json').exists(), 'Use a fresh release directory'
    release.prepare()
    manifest = json.loads((release.root / 'manifest.json').read_text())
    package = json.loads((canonical / 'package.json').read_text())
    for name, record in manifest.items():
        dest = release.root / name
        # Reverse the legacy helper's billing overlay: every application source is preserved.
        with zipfile.ZipFile(release.root / (name + '-before.zip')) as archive:
            for entry in archive.namelist():
                if entry.startswith('.env') or entry.endswith('/'):
                    continue
                target = dest / entry
                assert target.resolve().is_relative_to(dest.resolve()), 'Invalid archive path'
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
        before = json.loads((dest / 'package.json').read_text())
        assert before.get('main') == package.get('main'), name + ': incompatible entry point'
        for filename in ['package.json', 'package-lock.json']:
            (dest / filename).write_bytes((canonical / filename).read_bytes())
        record['modules'] = {}
        record['validated'] = False
        record['lockSha256'] = release.digest((dest / 'package-lock.json').read_bytes())
        record['packageSha256'] = release.digest((dest / 'package.json').read_bytes())
        record['sourceHashes'] = {
            str(p.relative_to(dest)): release.digest(p.read_bytes())
            for p in (dest / 'src').rglob('*') if p.is_file()
        }
    release.private_json(release.root / 'manifest.json', manifest)


def verify_inputs(manifest):
    for name, record in manifest.items():
        dest = release.root / name
        for filename, key in [('package.json', 'packageSha256'), ('package-lock.json', 'lockSha256')]:
            assert release.digest((dest / filename).read_bytes()) == record[key], name + ': changed ' + filename
        current = {str(p.relative_to(dest)): release.digest(p.read_bytes())
                   for p in (dest / 'src').rglob('*') if p.is_file()}
        assert current == record['sourceHashes'], name + ': deployed application source changed'


def deploy():
    manifest = json.loads((release.root / 'manifest.json').read_text())
    verify_inputs(manifest)
    operations_path = release.root / 'operations.json'
    operations = json.loads(operations_path.read_text()) if operations_path.exists() else {}
    selected = sys.argv[2:] or list(manifest)
    for name in selected:
        assert name in manifest, 'Unknown function ' + name
        if name in operations:
            continue
        before = json.loads((release.root / (name + '-before.json')).read_text())
        current = release.call(release.base + '/functions/' + name)
        assert current['updateTime'] == before['updateTime'], name + ': deployment changed since snapshot; resnapshot first'
    release.names = list(manifest)
    release.deploy()


if __name__ == '__main__':
    command = sys.argv[1]
    if command == 'prepare':
        prepare()
    elif command == 'validate':
        verify_inputs(json.loads((release.root / 'manifest.json').read_text()))
        release.validate()
    elif command == 'deploy':
        deploy()
    elif command == 'check':
        release.check()
    else:
        raise SystemExit('Use prepare, validate, deploy [function names...], or check')
