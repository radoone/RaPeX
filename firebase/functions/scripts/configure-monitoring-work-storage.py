"""Enable seven-day work expiry and disable unused indexes on new private work groups.
Only these four collection groups are modified; existing indexes/TTL are preserved.
"""
import json
import os
import pathlib
import subprocess
import urllib.request

os.environ.setdefault('CLOUDSDK_PYTHON', '/opt/homebrew/bin/python3.14')
token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
base = 'https://firestore.googleapis.com/v1/projects/rapex-99a2c/databases/(default)/collectionGroups/'
operations = {}
for group in ['monitoring_work_heads', 'monitoring_work_pages', 'monitoring_work_sources', 'monitoring_work_products']:
    for field, body, mask in [('*', {'indexConfig': {'indexes': []}}, 'indexConfig'),
                              ('expireAt', {'indexConfig': {'indexes': []}, 'ttlConfig': {}}, 'indexConfig,ttlConfig')]:
        request = urllib.request.Request(base + group + '/fields/' + field + '?updateMask=' + mask,
            data=json.dumps(body).encode(), method='PATCH',
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.load(response)
        operations[group + '/' + field] = result.get('name')
        print(group + '/' + field + ': configuration requested', flush=True)
root = pathlib.Path(__file__).resolve().parents[3] / 'outputs/monitoring-performance-2026-11-03'
root.mkdir(parents=True, exist_ok=True)
root.chmod(0o700)
path = root / 'storage-operations.json'
path.write_text(json.dumps(operations, indent=2))
path.chmod(0o600)
