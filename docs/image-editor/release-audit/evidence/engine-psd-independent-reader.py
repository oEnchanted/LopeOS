"""Read the candidate PSD with independently installed psd-tools 1.10.9."""
import sys
sys.path.insert(0, '/private/tmp/lope-audit-psdtools')
from pathlib import Path
from PIL import Image
from psd_tools import PSDImage
import psd_tools
import json

out = Path(__file__).resolve().parent
record = json.loads((out / 'independent-psd-alpha.json').read_text())
psd = PSDImage.open(out / 'fixtures/layered.psd')
preview = psd.topil(apply_icc=False).convert('RGBA')
png = Image.open(out / 'fixtures/layered.png').convert('RGBA')
assert preview.size == png.size
alpha_mismatches = 0
maximum_straight_error = maximum_visible_error = 0.0
for expected, actual in zip(png.getdata(), preview.getdata()):
    alpha_mismatches += expected[3] != actual[3]
    if expected[3]:
        error = max(abs(c - d) for c, d in zip(expected[:3], actual[:3]))
        maximum_straight_error = max(maximum_straight_error, error)
        maximum_visible_error = max(maximum_visible_error, error * expected[3] / 255)
assert alpha_mismatches == 0
# Writer truncation contributes <1 final output step; the independent reader's
# integer rounding adds at most one more. Record the actual error, not equality.
assert maximum_visible_error < 2
preview.save(out / 'fixtures/psd-tools-merged-composite.png')
layers = []
for layer in psd.descendants():
    item = {'name': layer.name, 'kind': layer.kind, 'hasMask': layer.has_mask(), 'blendMode': str(layer.blend_mode), 'opacity': layer.opacity}
    if layer.kind == 'type':
        item['text'] = layer.text
    layers.append(item)
record['independentReaderExecution'] = {
    'status': 'PASS', 'reader': 'psd-tools', 'version': psd_tools.__version__,
    'method': 'PSDImage.open(...).topil(apply_icc=False)',
    'alphaMismatches': alpha_mismatches,
    'maximumStraightChannelError': maximum_straight_error,
    'maximumVisibleChannelError': maximum_visible_error,
    'example': {'coordinate': [38, 20], 'png': png.getpixel((38, 20)), 'psdTools': preview.getpixel((38, 20))},
    'layers': layers,
    'limits': 'Merged preview decode plus layer/mask/text metadata inspection; this does not certify Photoshop rendering or every semantic field.'
}
(out / 'independent-psd-alpha.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record['independentReaderExecution'], indent=2))
