"""Audit PSD merged RGB/alpha interpretation without changing either fixture."""
from pathlib import Path
from PIL import Image, PsdImagePlugin
import PIL
import hashlib
import inspect
import json
import struct

out = Path(__file__).resolve().parent
fixtures = out / 'fixtures'
png_path, psd_path = fixtures / 'layered.png', fixtures / 'layered.psd'
raw = psd_path.read_bytes()
assert raw[:4] == b'8BPS'
assert struct.unpack_from('>H', raw, 4)[0] == 1
assert struct.unpack_from('>HH', raw, 22) == (8, 3)
offset = 26
for _ in range(2):
    offset += 4 + struct.unpack_from('>I', raw, offset)[0]
layer_count = struct.unpack_from('>h', raw, offset + 8)[0]
assert layer_count < 0, 'Merged transparency must be identified, not guessed from four channels.'

png = Image.open(png_path).convert('RGBA')
psd = Image.open(psd_path).convert('RGBA')
assert png.size == psd.size
alpha_mismatches = encoded_mismatches = raw_visible_mismatches = partial_pixels = 0
maximum_straight_error = maximum_visible_error = 0.0
normalized = []
for source, stored in zip(png.getdata(), psd.getdata()):
    alpha_mismatches += source[3] != stored[3]
    raw_visible_mismatches += bool(source[3] and source[:3] != stored[:3])
    if 0 < source[3] < 255:
        partial_pixels += 1
        a = source[3] / 255
        # PSD merged preview convention, confirmed in two separate libraries.
        encoded = tuple(int(c * a + 255 * (1 - a)) for c in source[:3])
        encoded_mismatches += encoded != stored[:3]
        decoded = tuple(max(0, min(255, (c + stored[3] - 255) * 255 / stored[3])) for c in stored[:3])
        error = max(abs(c - d) for c, d in zip(source[:3], decoded))
        maximum_straight_error = max(maximum_straight_error, error)
        maximum_visible_error = max(maximum_visible_error, error * a)
        normalized.append(tuple(round(c) for c in decoded) + (stored[3],))
    else:
        encoded_mismatches += bool(source[3] and source[:3] != stored[:3])
        normalized.append(stored)
assert alpha_mismatches == 0
assert encoded_mismatches == 0
assert maximum_visible_error < 1, '8-bit matte quantization can contribute less than one output channel step.'
image = Image.new('RGBA', psd.size)
image.putdata(normalized)
image.save(fixtures / 'independent-psd-normalized-composite.png')
record = {
    'result': 'PASS: expected PSD merged white-matte encoding; direct Pillow straight-RGBA comparison was invalid',
    'productSourceChanged': False,
    'reader': {'name': 'Pillow', 'version': PIL.__version__, 'pluginSha256': hashlib.sha256(inspect.getsource(PsdImagePlugin).encode()).hexdigest()},
    'buildId': json.loads((out.parent / 'build-manifest.json').read_text())['buildId'],
    'fixtures': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [png_path, psd_path]},
    'negativeLayerCount': layer_count,
    'partialAlphaPixels': partial_pixels,
    'rawVisibleMismatchesBeforeNormalization': raw_visible_mismatches,
    'alphaMismatches': alpha_mismatches,
    'exactEncodedWhiteMatteMismatches': encoded_mismatches,
    'maximumInverseStraightChannelQuantizationError': maximum_straight_error,
    'maximumVisibleChannelQuantizationError': maximum_visible_error,
    'forward': 'For 0<A<255: stored C = trunc(straight C * A/255 + 255*(1-A/255)). Opaque channels remain unchanged.',
    'inverse': 'For A>0: straight C = clamp((stored C + A - 255)*255/A). Alpha is unchanged; alpha-zero RGB is invisible.',
    'example': {'coordinate': [38, 20], 'png': png.getpixel((38, 20)), 'pillowRawPsd': psd.getpixel((38, 20))},
    'sources': [
        {'url': 'https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/', 'scope': 'Layer info: negative layer count identifies merged transparency. The specification does not itself state the white-matte interpretation.'},
        {'url': 'https://github.com/psd-tools/psd-tools/blob/v1.10.9/src/psd_tools/api/pil_io.py', 'scope': 'Independent reader calls _remove_white_background for merged image data, not layer image data.'},
        {'url': 'https://github.com/python-pillow/Pillow/blob/main/src/PIL/PsdImagePlugin.py', 'scope': 'Pillow directly maps four PSD RGB channels to RGBA; no merged white-matte removal.'},
        {'path': 'packages/image-engine/node_modules/ag-psd/src/psdWriter.ts:322', 'scope': 'Installed ag-psd 31.0.3 adds white matte to merged RGB.'},
        {'path': 'packages/image-engine/node_modules/ag-psd/src/psdReader.ts:1010', 'scope': 'Installed ag-psd 31.0.3 removes merged white matte.'},
    ],
    'limits': 'This checks merged channel encoding and a documented independent-reader transformation. It does not establish exact Adobe rendering, lossless merged RGB recovery, or complete layer/text/mask/effect interoperability. Eight-bit white matting quantizes partially transparent RGB; retain native originals.',
}
(out / 'engine-psd-alpha-investigation.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({k: record[k] for k in ['result', 'buildId', 'partialAlphaPixels', 'exactEncodedWhiteMatteMismatches', 'maximumVisibleChannelQuantizationError']}))
