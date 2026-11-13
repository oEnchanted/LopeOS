/// <reference lib="webworker" />
import { deserializeDocument, serializeDocument } from './native.ts';
import { exportPsd, importPsd } from './psd.ts';
import { CanvasRenderer, context2d } from './render.ts';
import { feather, growSelection, selectTolerance,selectColorRange,borderSelection,smoothSelection } from './selection.ts';
import { paintFill } from './pixels.ts';
import { dimensions, findLayer, identity, layer, maskTransform, type ImageDocument } from './model.ts';
import { SceneDecoder } from './preview.ts';
import { clearPixels, copyRendered, pastePixels } from './clipboard.ts';
import { applyFilter } from './filters.ts';
import { transformedBounds,trimDocument } from './operations.ts';

const worker = self as unknown as DedicatedWorkerGlobalScope;
let previewRenderer:CanvasRenderer|undefined;
const scene=new SceneDecoder();let sceneRenderer:CanvasRenderer|undefined;
worker.onmessage = async ({ data }) => {
  const { id, action, payload } = data; let renderer: CanvasRenderer | undefined;
  try {
    let result: unknown;
    if (action === 'serialize') result = serializeDocument(payload);
    else if (action === 'deserialize') result = deserializeDocument(payload);
    else if (action === 'psd-import') result = importPsd(payload.data, payload.name);
    else if (action === 'render') { renderer=previewRenderer ||= new CanvasRenderer({gpu:true});const start=performance.now();const canvas=renderer.render(payload) as OffscreenCanvas;const bitmap=canvas.transferToImageBitmap();worker.postMessage({id,result:{bitmap,backend:renderer.backend,ms:performance.now()-start}},[bitmap]);return; }
    else if(action==='render-scene'){const start=performance.now();const doc=scene.apply(payload);renderer=sceneRenderer ||= new CanvasRenderer();const canvas=renderer.renderViewport(doc,payload.viewport) as OffscreenCanvas;const bitmap=canvas.transferToImageBitmap();worker.postMessage({id,result:{bitmap,backend:renderer.backend,ms:performance.now()-start,bytes:payload.bytes,viewport:payload.viewport}},[bitmap]);return;}
    else if(action==='filter')result=applyFilter(payload.document,payload.filter,payload.smart);
    else if(action==='clear')result=clearPixels(payload);
    else if(action==='clipboard-copy'||action==='layer-via-copy'){
      const doc=payload.document as ImageDocument;const active=findLayer(doc);if(!active)throw new Error('Select a layer to copy.');renderer=new CanvasRenderer();
      const mask=doc.target==='mask'&&active.mask;const single=mask?{...layer('Mask'),pixels:mask.pixels,transform:maskTransform(active)}:{...active,visible:true,opacity:1,blend:'normal' as const,clipping:false};
      const selected=payload.merged?doc:{...doc,layers:[single]};const canvas=renderer.render(selected);const pixels=context2d(canvas).getImageData(0,0,doc.width,doc.height).data;const clipboard=copyRendered(doc,pixels,payload.merged?undefined:transformedBounds(single,doc));
      result=action==='layer-via-copy'?pastePixels(payload.cut?clearPixels(doc):doc,clipboard,true):clipboard;
    }
    else if (action === 'psd-export') {
      const document = payload as ImageDocument; renderer = new CanvasRenderer(); const raster = renderer;
      const merged = context2d(raster.render(document)).getImageData(0, 0, document.width, document.height).data;
      result = exportPsd(document, layer => context2d(raster.content(layer, document)).getImageData(0, 0, document.width, document.height).data, merged);
    } else if (action === 'raster-export') {
      const document = payload.document as ImageDocument; renderer = new CanvasRenderer(); const rendered = renderer.render(document) as OffscreenCanvas;
      if (payload.type === 'image/jpeg') { const ctx = context2d(rendered); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = payload.matte || '#ffffff'; ctx.fillRect(0, 0, document.width, document.height); ctx.globalCompositeOperation = 'source-over'; }
      const blob = await rendered.convertToBlob({ type: payload.type, quality: payload.quality });
      if (blob.type !== payload.type) throw new Error(`${payload.type} export is not available in this browser.`);
      result = new Uint8Array(await blob.arrayBuffer());
    } else if (action === 'raster-import') {
      const bitmap = await createImageBitmap(new Blob([payload.data])); dimensions(bitmap.width, bitmap.height);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); const ctx = context2d(canvas); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      result = { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
    } else if (action === 'feather') result = feather(payload.document, payload.amount);
    else if (action === 'grow') result = growSelection(payload.document, payload.amount);
    else if(action==='border')result=borderSelection(payload.document,payload.amount);
    else if(action==='smooth')result=smoothSelection(payload.document,payload.amount);
    else if(action==='color-range'||action==='trim'){renderer=new CanvasRenderer();const doc=payload.document,pixels=context2d(renderer.render(doc)).getImageData(0,0,doc.width,doc.height).data;result=action==='trim'?trimDocument(doc,pixels):selectColorRange(doc,pixels,payload.color,payload.amount,payload.mode);}
    else if (action === 'fill') result = paintFill(payload.document, payload.color, payload.point, payload.tolerance, payload.gradient);
    else if (action === 'wand') { renderer = new CanvasRenderer(); const doc = payload.document; const pixels = context2d(renderer.render(doc)).getImageData(0, 0, doc.width, doc.height).data; result = selectTolerance(doc, pixels, payload.point, payload.tolerance, payload.mode, payload.contiguous); }
    else throw new Error(`Unknown image operation: ${action}`);
    worker.postMessage({ id, result });
  } catch (error) { worker.postMessage({ id, error: error instanceof Error ? error.message : 'Image operation failed.' }); }
  finally { if(renderer!==previewRenderer&&renderer!==sceneRenderer)renderer?.dispose(); }
};
