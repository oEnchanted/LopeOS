"""Reopen the production handoff derivative independently of LopeOS engines."""
import hashlib
import json
import os
from pathlib import Path
import PIL
from PIL import Image

phase = os.environ.get('LOPE_AUDIT_PHASE', 'production')
root = Path(f'docs/lightroom/release-audit/evidence/handoff-{phase}')
report = json.loads((root / 'results.json').read_text())
path = root / 'returned-derivative.png'
data = path.read_bytes()
assert hashlib.sha256(data).hexdigest() == report['exported']['sha256']
assert data[:8] == b'\x89PNG\r\n\x1a\n' and data[24] == 16 and data[25] == 6
with Image.open(path) as image:
    image.load()
    assert image.size == (report['initial']['metadata']['width'], report['initial']['metadata']['height'])
    assert set(image.convert('RGBA').getdata()) == {(0, 0, 0, 255)}
    assert image.info.get('srgb') == 0
    result = {'reader': f'Pillow {PIL.__version__}', 'file': str(path), 'format': image.format,
              'dimensions': list(image.size), 'bitDepth': data[24], 'colorType': data[25],
              'sRGB': image.info['srgb'], 'uniqueRgba8': [[0, 0, 0, 255]],
              'sha256': hashlib.sha256(data).hexdigest(), 'result': 'PASSED',
              'limit': 'The native handoff is RGB/8. PNG16 cannot recreate precision discarded during that interchange.'}
(root / 'independent-reader.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
