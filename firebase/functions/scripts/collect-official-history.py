"""Save all official weekly XML reports and reconcile their independent public API counts.

Usage: python3 scripts/collect-official-history.py <evidence-directory> [--api-check]
Cached XML is an immutable snapshot; use a new directory for a later audit.
Records use the official numeric reference, because historical case numbers collide.
"""
import collections
import concurrent.futures
import hashlib
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

out = pathlib.Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
(out / 'xml').mkdir(exist_ok=True)
base = 'https://ec.europa.eu/safety-gate-alerts/'


def fetch(url):
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


list_file = out / 'weekly-list.xml'
if not list_file.exists():
    list_file.write_bytes(fetch(base + 'api/download/weeklyReport/list/xml/en'))
reports = [{child.tag: child.text for child in report} for report in ET.fromstring(list_file.read_bytes()).iter('weeklyReport')]
assert reports and all(int(report['year']) >= 2005 for report in reports)
(out / 'reports.json').write_text(json.dumps(reports, indent=2))


def download(report):
    target = out / 'xml' / (report['reference'] + '.xml')
    if not target.exists():
        data = fetch(report['URL'])
        root = ET.fromstring(data)
        assert root.tag == 'Safety-Gate' and root.findall('notifications'), report['reference']
        target.write_bytes(data)
    return report['reference']


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    for index, reference in enumerate(executor.map(download, reports), 1):
        if index % 100 == 0:
            print('Downloaded', index, '/', len(reports), flush=True)

records = {}
inventory = []
for report in sorted(reports, key=lambda item: (int(item['year']), int(item['week']))):
    raw = (out / 'xml' / (report['reference'] + '.xml')).read_bytes()
    root = ET.fromstring(raw)
    items = root.findall('notifications')
    inventory.append({'report': report['reference'], 'year': report['year'], 'count': len(items), 'sha256': hashlib.sha256(raw).hexdigest(), 'url': report['URL']})
    for element in items:
        record = {child.tag: (child.text or '').strip() for child in element if child.tag != 'pictures'}
        record['pictures'] = [(image.text or '').strip() for image in element.findall('pictures/picture') if (image.text or '').strip()]
        record.update(reportDate=root.findtext('report_date'), reportYear=int(root.findtext('report_year') or report['year']), reportWeek=int(root.findtext('report_week') or report['week']), report=report['reference'])
        record['urlRecall'] = record.pop('URLrecall', '')
        assert record['caseNumber'] and re.fullmatch(r'https://ec\.europa\.eu/safety-gate-alerts/screen/webReport/alertDetail/-?\d+', record['reference']), record
        records[record['reference']] = record
(out / 'official-records.json').write_text(json.dumps(list(records.values()), ensure_ascii=False))
(out / 'report-inventory.json').write_text(json.dumps(inventory, indent=2))
print('Official reports:', len(reports), 'unique records:', len(records), 'images:', sum(len(item['pictures']) for item in records.values()), flush=True)

if '--api-check' in sys.argv or '--api-identities' in sys.argv:
    (out / 'api-report-counts').mkdir(exist_ok=True)
    xml_counts = {item['report']: item['count'] for item in inventory}

    def cross_check(report):
        report_id = re.search(r'/xml/(\d+)', report['URL']).group(1)
        target = out / 'api-report-counts' / (report['reference'] + '.json')
        if not target.exists():
            query = urllib.parse.urlencode({'language': 'en', 'page': 0, 'search': 'WEB_REPORT|:|' + report_id + ','})
            data = json.loads(fetch(base + 'public/api/webreport/notifications?' + query))
            assert 'totalElements' in data
            target.write_text(json.dumps({'reportId': report_id, 'totalElements': data['totalElements'], 'sampleIds': [item['id'] for item in data['content']]}))
        data = json.loads(target.read_text())
        return {'report': report['reference'], 'xmlCount': xml_counts[report['reference']], 'apiCount': data['totalElements'], 'match': xml_counts[report['reference']] == data['totalElements']}

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        for index, result in enumerate(executor.map(cross_check, reports), 1):
            results.append(result)
            if index % 100 == 0:
                print('Independent counts checked:', index, flush=True)
    mismatches = [item for item in results if not item['match']]
    (out / 'independent-api-count-check.json').write_text(json.dumps({'reports': len(results), 'mismatches': mismatches, 'results': results}, indent=2))
    print('Independent count mismatches:', len(mismatches), flush=True)

if '--api-identities' in sys.argv:
    (out / 'api-pages').mkdir(exist_ok=True)
    tasks = []
    for report in reports:
        header = json.loads((out / 'api-report-counts' / (report['reference'] + '.json')).read_text())
        for page in range((header['totalElements'] + 8) // 9):
            tasks.append((report, header['reportId'], page))

    def collect_page(task):
        report, report_id, page = task
        target = out / 'api-pages' / (report['reference'] + '-' + str(page) + '.json')
        if not target.exists():
            query = urllib.parse.urlencode({'language': 'en', 'page': page, 'search': 'WEB_REPORT|:|' + report_id + ','})
            data = json.loads(fetch(base + 'public/api/webreport/notifications?' + query))
            assert data['number'] == page
            target.write_text(json.dumps({'totalElements': data['totalElements'], 'items': [{'id': row['id'], 'caseNumber': row['reference']} for row in data['content']]}))
        return report['reference'], json.loads(target.read_text())['items']

    api_records = {}
    per_report_ids = collections.defaultdict(set)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        for index, (report_reference, items) in enumerate(executor.map(collect_page, tasks), 1):
            for item in items:
                item['report'] = report_reference
                api_records[str(item['id'])] = item
                per_report_ids[report_reference].add(item['id'])
            if index % 250 == 0:
                print('Independent identity pages:', index, '/', len(tasks), flush=True)
    for report in reports:
        expected = json.loads((out / 'api-report-counts' / (report['reference'] + '.json')).read_text())['totalElements']
        assert len(per_report_ids[report['reference']]) == expected, report['reference']
    xml_ids = {reference.rsplit('/', 1)[-1] for reference in records}
    comparison = {'apiRecords': len(api_records), 'xmlRecords': len(xml_ids), 'pages': len(tasks), 'apiOnly': [api_records[key] for key in sorted(api_records.keys() - xml_ids)], 'xmlOnly': sorted(xml_ids - api_records.keys())}
    (out / 'api-all-identities.json').write_text(json.dumps(api_records, indent=2))
    (out / 'api-identity-comparison.json').write_text(json.dumps(comparison, indent=2))
    print('Identity comparison:', json.dumps({key: value if not isinstance(value, list) else len(value) for key, value in comparison.items()}), flush=True)
