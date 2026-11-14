"""Independent decoding and measured implementation-only screenshot comparisons."""
from PIL import Image, ImageChops, ImageEnhance
from pathlib import Path
import hashlib, json, PIL
out=Path('docs/image-editor/release-audit/evidence')
build=json.loads((out.parent/'build-manifest.json').read_text())
records=[]
for name in ['original.png','layered.png','layered.psd']:
    p=out/'fixtures'/name
    with Image.open(p) as image:
        image.load()
        assert image.size==(96,64)
        records.append({'name':name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'format':image.format,'dimensions':image.size,'mode':image.mode,'framesRecognized':getattr(image,'n_frames',1),'layersRecognized':getattr(image,'layers',None),'pixelSha256':hashlib.sha256(image.tobytes()).hexdigest()})
png=Image.open(out/'fixtures/layered.png').convert('RGBA');psd=Image.open(out/'fixtures/layered.psd').convert('RGBA')
encoded_mismatch=0;alpha_mismatch=0;partial_alpha=0;max_visible_error=0.0
for a,b in zip(png.getdata(),psd.getdata()):
    alpha=a[3]/255
    alpha_mismatch+=a[3]!=b[3]
    if 0<a[3]<255:partial_alpha+=1
    if a[3]>0:
        expected=tuple(int(a[i]*alpha+255*(1-alpha)) for i in range(3))
        encoded_mismatch+=b[:3]!=expected
        max_visible_error=max(max_visible_error,max(abs((b[i]-255*(1-alpha))-a[i]*alpha) for i in range(3)))
assert encoded_mismatch==0 and alpha_mismatch==0
(out/'independent-decode.json').write_text(json.dumps({'reader':'Pillow raw PSD channels plus independently documented merged-preview white-matte interpretation','version':PIL.__version__,'result':'PASS_ENCODED_COMPOSITE','buildId':build['buildId'],'records':records,'compositeComparison':{'encodedMatteMismatchedPixels':encoded_mismatch,'alphaMismatches':alpha_mismatch,'partialAlphaPixels':partial_alpha,'maxCompositedChannelQuantizationError':max_visible_error,'formula':'rawPSD_C = int(PNG_C * alpha/255 + 255 * (1-alpha/255))','interpretation':'Pillow exposes stored matte RGB; raw RGBA is not straight-alpha. No pixel-identity claim; inverse at low alpha amplifies 8-bit quantization.'},'sources':['https://github.com/psd-tools/psd-tools/blob/v1.10.9/src/psd_tools/api/pil_io.py'],'limits':'Composite and supported raster layer records only. Pillow does not expose all adjustment/masked/text semantic records; frame count is not a complete layer count. Native Adobe mask/text/effect/profile/Smart Object semantics and PSB not certified.'},indent=2)+'\n')
pairs=[]
for before in sorted(out.glob('ui-*-before.png')):
    after=before.with_name(before.name.replace('-before.png','-after.png'))
    if not after.exists():continue
    a=Image.open(before).convert('RGB');b=Image.open(after).convert('RGB')
    record={'before':before.name,'after':after.name,'beforePixels':a.size,'afterPixels':b.size,'classification':'Implementation before/after regression, NOT Adobe-reference parity'}
    if a.size!=b.size:record['status']='NOT_COMPARABLE: dimensions differ; no stretching or cropping'
    else:
        name=before.stem.removesuffix('-before');overlay=name+'-overlay.png';difference=name+'-difference.png'
        Image.blend(a,b,.5).save(out/overlay);d=ImageChops.difference(a,b);ImageEnhance.Contrast(d).enhance(4).save(out/difference)
        record.update(status='GENERATED',overlay=overlay,difference=difference,overlayAlpha=.5,differenceContrast=4,dynamicExcludedRegions=[],changedPixels=sum(any(p) for p in d.getdata()))
    pairs.append(record)
(out/'visual-comparisons.json').write_text(json.dumps({'buildId':build['buildId'],'referenceComparison':'UNVERIFIED: no matched authorized Adobe captures; no Adobe overlay/diff fabricated','implementationPairs':pairs},indent=2)+'\n')
print(json.dumps({'independentDecoder':'PASS','encodedCompositeMismatch':encoded_mismatch,'implementationScreenshotPairs':len(pairs)}))
