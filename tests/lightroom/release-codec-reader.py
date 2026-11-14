"""Independent Pillow reopening of worker-generated 16-bit PNG exports."""
import hashlib
import json
import struct
from pathlib import Path
import PIL
from PIL import Image

root = Path('docs/lightroom/release-audit/evidence')
worker = json.loads((root / 'data-codec-worker.json').read_text())
results = []
for result in worker['results']:
    if 'outputPath' not in result:
        continue
    path = Path(result['outputPath'])
    data = path.read_bytes()
    assert hashlib.sha256(data).hexdigest() == result['outputSha256']
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    width, height, depth, color = struct.unpack('>IIBB', data[16:26])
    assert depth == 16 and color == 6
    chunks = []
    offset = 8
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        chunks.append(data[offset + 4:offset + 8].decode('ascii'))
        offset += size + 12
    assert 'sRGB' in chunks
    with Image.open(path) as image:
        image.load()
        assert image.size == (result['width'], result['height']) == (width, height)
        rgba = list(image.convert('RGBA').getdata())
        # Pillow reduces 16-bit PNG RGB to 8-bit; permit one code value for truncation.
        expected = [result['pixels'][i:i + 4] for i in range(0, len(result['pixels']), 4)]
        assert all(abs(a - b) <= 1 for actual, wanted in zip(rgba, expected) for a, b in zip(actual, wanted))
    results.append({'file': str(path), 'sha256': result['outputSha256'], 'dimensions': [width, height],
                    'bitDepth': depth, 'colorType': color, 'sRGB': True, 'rgba8': rgba, 'passed': True})
report = {'date': '2026-11-13', 'reader': f'Pillow {PIL.__version__}', 'results': results,
          'limits': 'Pillow validates reopened pixels at 8 bits/channel; PNG IHDR independently confirms encoded 16-bit RGBA. This does not validate arbitrary color profiles.'}
(root / 'data-codec-reader.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
