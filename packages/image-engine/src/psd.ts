import { ColorMode, initializeCanvas, readPsd, writePsdUint8Array, type Layer as PsdLayer, type Psd, type AdjustmentLayer } from 'ag-psd';
import { BLEND_MODES, allLayers, dimensions, hexColor, identity, layer, maskTransform, newDocument, surface, type Adjustment, type ImageDocument, type Layer } from './model.ts';
import { SurfaceWriter, fromPixels, surfacePixels } from './pixels.ts';
import { compositePixels } from './composite.ts';
import { fromBase64, toBase64 } from './native.ts';
import { matrixOf, transformOf, type Matrix } from './matrix.ts';

initializeCanvas((width, height) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement;
  if (typeof document === 'undefined') throw new Error('Canvas rasterization is unavailable in this environment.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }) as ImageData);

function adjustmentFromPsd(input: AdjustmentLayer): Adjustment | undefined {
  if(input.type==='exposure')return {type:'exposure',values:[input.exposure||0,input.offset||0,input.gamma??1]};
  if(input.type==='vibrance')return {type:'vibrance',values:[input.vibrance||0,input.saturation||0]};
  if(input.type==='invert')return {type:'invert',values:[]};
  if(input.type==='posterize')return {type:'posterize',values:[input.levels??4]};
  if(input.type==='threshold')return {type:'threshold',values:[input.level??128]};
  if(input.type==='black & white')return {type:'black-white',values:[input.reds??40,input.yellows??60,input.greens??40,input.cyans??60,input.blues??20,input.magentas??80]};
  if(input.type==='photo filter'&&input.color&&'r' in input.color)return {type:'photo-filter',values:[input.color.r,input.color.g,input.color.b,(input.density??.25)*100]};
  if(input.type==='channel mixer'&&!input.monochrome)return {type:'channel-mixer',values:[input.red,input.green,input.blue].flatMap((channel,index)=>[channel?.red??(index===0?100:0),channel?.green??(index===1?100:0),channel?.blue??(index===2?100:0),channel?.constant||0])};
  if(input.type==='gradient map'&&input.gradientType==='solid'&&input.colorStops?.length===2){const stops=input.colorStops.map(s=>s.color);if(stops.every(c=>'r' in c))return {type:'gradient-map',values:stops.flatMap(c=>'r' in c?[c.r,c.g,c.b]:[])};}
  if (input.type === 'brightness/contrast') return { type: 'brightness', values: [input.brightness || 0, input.contrast || 0] };
  if (input.type === 'levels') return { type: 'levels', values: [input.rgb?.shadowInput || 0, input.rgb?.midtoneInput ?? 1, input.rgb?.highlightInput ?? 255] };
  if (input.type === 'curves') { const points = input.rgb || []; const middle = points.find(point => point.input >= 100 && point.input <= 155); return { type: 'curves', values: [points[0]?.output || 0, middle?.output ?? 128, points[points.length - 1]?.output ?? 255] }; }
  if (input.type === 'hue/saturation') return { type: 'hue', values: [input.master?.hue || 0, input.master?.saturation || 0, input.master?.lightness || 0] };
  if (input.type === 'color balance') return { type: 'balance', values: [input.midtones?.cyanRed || 0, input.midtones?.magentaGreen || 0, input.midtones?.yellowBlue || 0] };
}
function adjustmentToPsd(input: Adjustment): AdjustmentLayer {
  const v = input.values;
  if(input.type==='exposure')return {type:'exposure',exposure:v[0],offset:v[1],gamma:v[2]};
  if(input.type==='vibrance')return {type:'vibrance',vibrance:v[0],saturation:v[1]};
  if(input.type==='invert')return {type:'invert'};
  if(input.type==='posterize')return {type:'posterize',levels:v[0]};
  if(input.type==='threshold')return {type:'threshold',level:v[0]};
  if(input.type==='black-white')return {type:'black & white',reds:v[0],yellows:v[1],greens:v[2],cyans:v[3],blues:v[4],magentas:v[5],useTint:false};
  if(input.type==='photo-filter')return {type:'photo filter',color:{r:v[0],g:v[1],b:v[2]},density:v[3]/100,preserveLuminosity:false};
  if(input.type==='channel-mixer'){const channel=(index:number)=>({red:v[index*4],green:v[index*4+1],blue:v[index*4+2],constant:v[index*4+3]});return {type:'channel mixer',monochrome:false,red:channel(0),green:channel(1),blue:channel(2)};}
  if(input.type==='gradient-map')return {type:'gradient map',gradientType:'solid',name:'Gradient Map',smoothness:1,colorStops:[{location:0,midpoint:.5,color:{r:v[0],g:v[1],b:v[2]}},{location:1,midpoint:.5,color:{r:v[3],g:v[4],b:v[5]}}],opacityStops:[{location:0,midpoint:.5,opacity:1},{location:1,midpoint:.5,opacity:1}]};
  if (input.type === 'brightness') return { type: 'brightness/contrast', brightness: v[0], contrast: v[1], useLegacy: false };
  if (input.type === 'levels') return { type: 'levels', rgb: { shadowInput: v[0], midtoneInput: v[1], highlightInput: v[2], shadowOutput: 0, highlightOutput: 255 } };
  if (input.type === 'curves') return { type: 'curves', rgb: [{ input: 0, output: v[0] }, { input: 128, output: v[1] }, { input: 255, output: v[2] }] };
  if (input.type === 'hue') return { type: 'hue/saturation', master: { a: 0, b: 0, c: 0, d: 0, hue: v[0], saturation: v[1], lightness: v[2] } };
  return { type: 'color balance', midtones: { cyanRed: v[0], magentaGreen: v[1], yellowBlue: v[2] }, shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 }, highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 }, preserveLuminosity: true };
}
export function importPsd(data: Uint8Array, name: string): { document: ImageDocument; warnings: string[] } {
  if (data.byteLength < 26 || String.fromCharCode(...data.slice(0, 4)) !== '8BPS') throw new Error('Invalid Photoshop document header.');
  if (data.byteLength > 256 * 1024 * 1024) throw new Error('PSD exceeds the 256 MiB input limit.');
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (header.getUint16(4) !== 1) throw new Error('PSB is not supported. Keep the original and convert a copy to RGB/8 PSD in Photoshop.');
  if (header.getUint16(22) !== 8 || header.getUint16(24) !== 3) throw new Error('Only RGB, 8-bit PSD is supported. The original has not been converted.');
  dimensions(header.getUint32(18), header.getUint32(14));
  const psd = readPsd(data, { useImageData: true, skipThumbnail: true, totalMemoryLimit: 384 * 1024 * 1024 });
  const warnings = new Set<string>();
  const walk = (source: PsdLayer[]): Layer[] => source.map((input, index) => {
    const adjustment = input.adjustment ? adjustmentFromPsd(input.adjustment) : undefined;
    const kind = input.children ? 'group' : input.text ? 'text' : adjustment ? 'adjustment' : 'raster';
    const output: Layer = { ...layer(input.name || `Layer ${index + 1}`, kind), opacity: input.opacity ?? 1, fill: input.fillOpacity ?? 1, blend: BLEND_MODES.includes(input.blendMode as Layer['blend']) || input.blendMode === 'pass through' ? input.blendMode as Layer['blend'] : 'normal', visible: !input.hidden, locked: Boolean(input.protected?.composite), clipping: Boolean(input.clipping), transform: { ...identity(), x: input.left || 0, y: input.top || 0 }, adjustment };
    if (input.blendMode && input.blendMode !== output.blend) warnings.add(`Unsupported blend mode “${input.blendMode}” uses Normal in the preview.`);
    if (input.children) { output.children = walk(input.children); output.expanded = input.opened !== false; }
    if (input.imageData) output.pixels = fromPixels(input.imageData.width, input.imageData.height, input.imageData.data);
    if (input.mask?.imageData) {
      const m = input.mask; const md = m.imageData!; const width = output.pixels?.width || psd.width; const height = output.pixels?.height || psd.height;
      const writer = new SurfaceWriter(surface(width, height, [m.defaultColor ?? 255, m.defaultColor ?? 255, m.defaultColor ?? 255, 255]));
      const offsetX = (m.left || 0) - (input.left || 0); const offsetY = (m.top || 0) - (input.top || 0);
      for (let y = 0; y < md.height; y++) for (let x = 0; x < md.width; x++) { const value = md.data[(y * md.width + x) * 4]; writer.set(x + offsetX, y + offsetY, [value, value, value, 255]); }
      output.mask = { pixels: writer.value, enabled: !m.disabled, linked: true, transform: identity() };
    }
    if (input.text) {
      const text = input.text; const style = text.style || {}; const fill = style.fillColor;
      const textColor = fill && 'r' in fill ? hexColor([fill.r, fill.g, fill.b]) : '#ffffff'; const t = text.transform || [1, 0, 0, 1, input.left || 0, input.top || 0];
      output.text = { content: text.text, font: style.font?.name || 'Arial', size: style.fontSize || 24, color: textColor, bold: Boolean(style.fauxBold), italic: Boolean(style.fauxItalic), align: text.paragraphStyle?.justification === 'center' ? 'center' : text.paragraphStyle?.justification === 'right' ? 'right' : 'left', leading: style.leading ? style.leading / (style.fontSize || 24) : 1.2, tracking: (style.tracking || 0) * (style.fontSize || 24) / 1000 };
      output.transform = transformOf(t as Matrix);
      warnings.add('Text stays editable; local font availability, typography and the PSD baseline may differ.');
    }
    if (input.adjustment && !adjustment) warnings.add(`Adjustment “${input.adjustment.type}” is preserved only in the original PSD; its stored raster preview is used.`);
    if (input.placedLayer) warnings.add('PSD Smart Objects use their stored raster preview. The complete original PSD remains embedded in the native project.');
    if (input.effects) warnings.add('Imported Photoshop layer effects use their stored preview where available; editable effects are not imported.');
    if (input.vectorMask || input.vectorFill) warnings.add('Imported Photoshop vectors use their raster preview. Original vector data remains in the source PSD.');
    if (input.text?.styleRuns?.length) warnings.add('Mixed text styles are reduced to the primary editable text style.');
    if (input.mask && !input.mask.imageData) warnings.add('An unsupported mask could not be decoded.');
    return output;
  });
  const document = newDocument(psd.width, psd.height, name);
  document.layers = walk(psd.children || []);
  if (!document.layers.length && psd.imageData) document.layers = [{ ...layer('Composite'), pixels: fromPixels(psd.width, psd.height, psd.imageData.data) }];
  document.activeIds = document.layers.length ? [document.layers[document.layers.length - 1].id] : [];
  document.resolution = psd.imageResources?.resolutionInfo?.horizontalResolution || 72;
  const profile = psd.imageResources?.iccUntaggedProfile;
  if (!profile) warnings.add('Embedded ICC bytes, when present, are retained in the original PSD. Preview uses the browser sRGB pipeline without an ICC color transform.');
  document.original = { name, data: toBase64(data), warnings: [...warnings] };
  return { document, warnings: [...warnings] };
}
export function psdCompatibility(doc: ImageDocument): string[] {
  const warnings = new Set<string>();
  for (const item of allLayers(doc.layers)) {
    if (item.kind === 'embedded') warnings.add('Embedded source objects become raster layers in PSD. The native project preserves their original pixels and transforms.');
    if (item.kind === 'shape') warnings.add('Shape and path layers become raster layers in PSD. Save a native project to keep editable vectors.');
    if (item.filters.length||item.rasterFilters?.length) warnings.add('Filter stacks are rendered into PSD layer previews; the native project keeps the editable stack.');
    if (item.effects.length) warnings.add('Layer effects are rendered into PSD previews. The native project retains editable effects.');
    if (item.text) warnings.add('Basic horizontal text is written as editable PSD text with a regenerated preview; font metrics and Photoshop validation remain unverified.');
    if (item.adjustment) warnings.add('Adjustment parameters are editable in PSD; this editor’s adjustment algorithms approximate Photoshop.');
  }
  if (doc.original?.warnings.length) warnings.add('Unsupported features in the imported source are not copied to this PSD. The native project retains the full source file.');
  if (doc.paths.length) warnings.add('Document work paths remain in the native project; they are not written to PSD.');
  if(doc.savedSelections?.length)warnings.add('Saved alpha selections remain in the native project; alpha-channel export to PSD is unavailable.');
  return [...warnings];
}
export function exportPsd(doc: ImageDocument, preview?: (layer: Layer) => Uint8ClampedArray, merged?: Uint8ClampedArray): Uint8Array {
  const walk = (source: Layer[]): PsdLayer[] => source.map(item => {
    const output: PsdLayer = { name: item.name, opacity: item.opacity, fillOpacity: item.fill, blendMode: item.blend, hidden: !item.visible, clipping: item.clipping, protected: { composite: item.locked, position: item.locked }, top: 0, left: 0, right: doc.width, bottom: doc.height };
    if (item.children) { output.children = walk(item.children); output.opened = item.expanded; }
    else if (item.adjustment) output.adjustment = adjustmentToPsd(item.adjustment);
    else {
      // Browser previews include current geometry. Basic integer translation can preserve raw pixels in Node tests.
      if (preview) output.imageData = { width: doc.width, height: doc.height, data: preview({ ...item, opacity: 1, fill: 1, blend: 'normal', mask: undefined }) };
      else if (item.pixels && !item.text && item.transform.scaleX === 1 && item.transform.scaleY === 1 && !item.transform.rotation) { output.imageData = { width: item.pixels.width, height: item.pixels.height, data: surfacePixels(item.pixels) }; output.left = item.transform.x; output.top = item.transform.y; output.right = output.left + item.pixels.width; output.bottom = output.top + item.pixels.height; }
      else output.imageData = { width: doc.width, height: doc.height, data: compositePixels({ ...doc, layers: [{ ...item, opacity: 1, fill: 1, blend: 'normal', mask: undefined }] }) };
    }
    if (item.mask) {
      const m = item.mask; const data = surfacePixels(m.pixels);const transform=maskTransform(item); const left=transform.x;const top=transform.y;
      if (preview) {
        const maskLayer: Layer = { ...layer('mask'), pixels: m.pixels, transform };
        const mask = preview(maskLayer); output.mask = { top: 0, left: 0, right: doc.width, bottom: doc.height, defaultColor: m.pixels.base[0], disabled: !m.enabled, imageData: { width: doc.width, height: doc.height, data: mask } };
      } else output.mask = { top, left, right: left + m.pixels.width, bottom: top + m.pixels.height, defaultColor: m.pixels.base[0], disabled: !m.enabled, imageData: { width: m.pixels.width, height: m.pixels.height, data } };
    }
    if (item.text) {
      const text = item.text; const t = item.transform; const a = t.rotation * Math.PI / 180; const raw = text.color.slice(1);
      output.text = { text: text.content, transform:matrixOf(t), style: { font: { name: text.font }, fontSize: text.size, fillColor: { r: parseInt(raw.slice(0, 2), 16), g: parseInt(raw.slice(2, 4), 16), b: parseInt(raw.slice(4, 6), 16) }, fauxBold: text.bold, fauxItalic: text.italic, leading: text.size * text.leading, tracking: text.tracking / text.size * 1000 }, paragraphStyle: { justification: text.align }, orientation: 'horizontal' };
    }
    return output;
  });
  const psd: Psd = { width: doc.width, height: doc.height, colorMode: ColorMode.RGB, bitsPerChannel: 8, children: walk(doc.layers), imageData: { width: doc.width, height: doc.height, data: merged || compositePixels(doc) }, imageResources: { resolutionInfo: { horizontalResolution: doc.resolution, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: doc.resolution, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' } } };
  return writePsdUint8Array(psd, { noBackground: true, invalidateTextLayers: true });
}
