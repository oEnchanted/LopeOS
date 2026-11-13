"""Independent Pillow / LittleCMS verification; does not import the Lope engine."""
import io
import json
from pathlib import Path
from PIL import Image, ImageCms

results = []
for path in sorted(Path('docs/lightroom/fixtures').glob('*-export.*')):
    image = Image.open(path)
    image.load()
    expected = (384, 288) if path.name == 'ai-denoise-export.tif' else (128, 96) if 'production-' in path.name else (64, 48)
    assert image.size == expected, (path, image.size)
    record = {'file': path.name, 'format': image.format, 'width': image.width, 'height': image.height, 'mode': image.mode}
    if image.format == 'TIFF':
        assert image.tag_v2[258] == (16, 16, 16)
        assert image.tag_v2[339] == (1, 1, 1)
        record.update(bitsPerSample=list(image.tag_v2[258]), sampleFormat=list(image.tag_v2[339]))
    if image.format in ('JPEG', 'TIFF'):
        profile = ImageCms.ImageCmsProfile(io.BytesIO(image.info['icc_profile']))
        assert ImageCms.getProfileDescription(profile).strip() == 'LopeOS sRGB'
        ImageCms.profileToProfile(image, profile, ImageCms.createProfile('sRGB'))
        record.update(profile='LopeOS sRGB', iccTransform='passed')
    record['result'] = 'passed'
    results.append(record)
assert results, 'Run node tests/lightroom/codecs.mjs first'
report = {'reader': 'Pillow ' + Image.__version__, 'profileReader': 'Pillow ImageCms / LittleCMS', 'date': '2026-11-13', 'results': results}
Path('docs/lightroom/independent-reader-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
