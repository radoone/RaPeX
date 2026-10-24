"""Union official XML with official JSON details omitted by the XML serializer.
Run after collect-official-history.py, before the final import/verification.
Raw JSON detail evidence remains beside the source manifest.
"""
import datetime
import json
import pathlib
import sys
import urllib.request
import xml.etree.ElementTree as ET

out = pathlib.Path(sys.argv[1]).resolve()
records = json.loads((out / 'official-records.json').read_text())
known = {row['reference'].rsplit('/', 1)[-1] for row in records}
extras_file = out / 'api-supplemental-records.json'
extras = json.loads(extras_file.read_text()) if extras_file.exists() else {}
identities_file = out / 'api-all-identities.json'
if identities_file.exists():
    identities = json.loads(identities_file.read_text())
    for key in identities.keys() - known - extras.keys():
        item = identities[key]
        url = 'https://ec.europa.eu/safety-gate-alerts/public/api/notification/' + key + '?language=en'
        with urllib.request.urlopen(url, timeout=45) as response:
            detail = json.load(response)
        extras[key] = {'report': item['report'], 'row': {'reference': item['caseNumber']}, 'full': detail}


def english(versions):
    return next((item for item in versions or [] if item.get('language', {}).get('key') == 'EN'), {})


def label(enum):
    if not enum:
        return ''
    return str(enum.get('name') or '').replace('_', ' ').capitalize()


for key, item in extras.items():
    if key in known:
        continue
    detail = item['full']
    product = detail['product']
    product_en = english(product.get('versions'))
    risk_en = english(detail.get('risk', {}).get('versions'))
    root = ET.fromstring((out / 'xml' / (item['report'] + '.xml')).read_bytes())
    notification_type = detail.get('notificationType', {}).get('code')
    row = {
        'caseNumber': detail['reference'],
        'reference': 'https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/' + key,
        'category': product.get('productCategory', {}).get('key', '').removeprefix('product.category.').replace('.', ' ').capitalize(),
        'product': product_en.get('name') or '', 'name': product.get('nameSpecific') or '',
        'brand': ', '.join(value['brand'] for value in product.get('brands', []) if value.get('brand')),
        'type_numberOfModel': ', '.join(value['modelType'] for value in product.get('modelTypes', []) if value.get('modelType')),
        'batchNumber': ', '.join(value['batchNumber'] for value in product.get('batchNumbers', []) if value.get('batchNumber')),
        'barcode': ', '.join(value['barcode'] for value in product.get('barcodes', []) if value.get('barcode')),
        'riskType': ', '.join(label(value) for value in detail.get('risk', {}).get('riskType', [])),
        'danger': ' '.join(value for value in [risk_en.get('riskDescription'), risk_en.get('legalProvision')] if value),
        'measures': '; '.join(label(value.get('measureCategory')) for value in detail.get('measureTaken', {}).get('measures', [])),
        'description': product_en.get('description') or '', 'notifyingCountry': detail.get('country', {}).get('name') or '',
        'countryOfOrigin': (detail.get('traceability', {}).get('countryOrigin') or {}).get('name') or '',
        'type': 'Professional' if product.get('professionalProduct') else 'Consumer',
        'level': {'A12': 'Serious risk', 'A11': 'Other risk'}.get(notification_type, ''),
        'pictures': ['https://ec.europa.eu/safety-gate-alerts/public/api/notification/image/' + str(photo['id']) for photo in sorted(product.get('photos', []), key=lambda photo: not photo.get('mainPicture'))],
        'reportDate': root.findtext('report_date'), 'reportYear': int(root.findtext('report_year')), 'reportWeek': int(root.findtext('report_week')),
        'report': item['report'], 'officialDetail': detail,
    }
    records.append(row)
extras_file.write_text(json.dumps(extras, indent=2))
(out / 'official-records.json').write_text(json.dumps(records, ensure_ascii=False))
print('Official XML/JSON union:', len(records), 'supplemental JSON details:', len(extras))
