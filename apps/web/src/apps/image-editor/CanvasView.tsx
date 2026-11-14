import { AppIcon } from '../../shell/Icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, GripVertical, MoreHorizontal, Pin, X } from 'lucide-react';
import { BrushStroke, SelectionStroke, CanvasRenderer, SceneEncoder, addLayer, allLayers, color, context2d, cropDocument, straightenDocument, feather, findLayer, fromPixels, hexColor, identity, layer, newPixelLayer, pixel, selectPolygon, selectShape, selectionBounds, around, transformSelected, createTextLayer, surface, toDocument, toLocal, transformedBounds, translateLayer, uid, updateLayer, type RenderViewport, type BrushSettings, type ImageDocument, type Layer, type Point } from '../../../../../packages/image-engine/src';
import type { ToolId, ToolOptions } from './tool-model';
import type { Workspace } from './panel-model';
import { ImageWorker } from './worker-client';
import { selectionOutline } from './selection-outline';
import { InlineType,type InlineTypeState } from './InlineType';
import type { PendingType } from './session';

type Gesture = { kind: 'brush' | 'move' | 'select' | 'crop' | 'shape' | 'gradient' | 'pan' | 'scale' | 'rotate' | 'anchor'; document: ImageDocument; start: Point; last: Point; points: Point[]; mode?: 'replace' | 'add' | 'subtract' | 'intersect'; brush?: BrushStroke|SelectionStroke; pan?: Point; anchor?: Point; bounds?: { x: number; y: number; width: number; height: number }; pathIndex?: number; pointIndex?: number };
type Props = { doc?: ImageDocument; tool: ToolId; brush: BrushSettings; options: ToolOptions; foreground: string; background: string; zoom: number; pan: Point; onView: (zoom: number, pan: Point) => void; onCommit: (name: string, doc: ImageDocument) => void; onSelect: (ids: string[], target?: 'pixels' | 'mask') => void; onColor: (color: string) => void; onText: (point: Point, layerId?: string) => void; onOperation: (name: string, action: string, payload: unknown) => void; onError: (message: string) => void; onCommand: (id: string) => void; onFit: (width: number, height: number) => void; transforming: boolean; setTransforming: (value: boolean) => void; workspace: Workspace; setWorkspace: (workspace: Workspace) => void; busy: boolean;typeStyle?:NonNullable<Layer['text']>;onPendingEdit?:(finish:(()=>void)|null)=>void;onTypeDraft?:(draft:PendingType|undefined)=>void };
export function CanvasView(props: Props) {
  const { doc, tool, zoom, pan, brush, foreground, background, options, workspace: w, setWorkspace } = props;
  const area = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null); const brushCursor=useRef<HTMLDivElement>(null); const overlay = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<CanvasRenderer | undefined>(undefined); const gesture = useRef<Gesture | null>(null); const preview = useRef<ImageDocument | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 }); const [space, setSpace] = useState(false); const [crop, setCrop] = useState<{ x: number; y: number; width: number; height: number } | null>(null); const [pen, setPen] = useState<Point[]>([]); const [revision, setRevision] = useState(0); const [taskMenu, setTaskMenu] = useState(false);
  const cloneSource = useRef<{ point: Point; layerId: string } | null>(null); const transformBase = useRef<ImageDocument | null>(null); const paintFrame = useRef(0); const documentId = useRef('');
  const renderWorker=useRef(new ImageWorker());const renderPending=useRef(false);const renderQueued=useRef<{document:ImageDocument;view:{x:number;y:number;width:number;height:number;scale:number};baseDocument?:ImageDocument;epoch:number}|null>(null);const encoder=useRef(new SceneEncoder());const mounted=useRef(true);
  const [textEdit,setTextEdit]=useState<InlineTypeState|null>(null);const inlineEdit=useRef(textEdit);inlineEdit.current=textEdit;const previewEpoch=useRef(0);const capturedPointer=useRef<number|null>(null);
  const overlayDraw=useRef<()=>void>(()=>{});
  const lastPaint=useRef<{point:Point;id:string;target:string}|null>(null);
  const latest = useRef(props); latest.current = props;
  const origin = { x: size.width / 2 + pan.x - (doc?.width || 0) * zoom / 2, y: size.height / 2 + pan.y - (doc?.height || 0) * zoom / 2 };
  const toPoint = (event: { clientX: number; clientY: number; pressure?: number; pointerType?: string }): Point => { const rect = area.current!.getBoundingClientRect(); return { x: (event.clientX - rect.left - origin.x) / zoom, y: (event.clientY - rect.top - origin.y) / zoom, pressure: event.pointerType === 'pen' ? event.pressure || .1 : 1 }; };
  const draw=useCallback((document=preview.current||latest.current.doc)=>{
    if(!document||!canvas.current||!area.current)return;
    const original=document;const editing=inlineEdit.current;if(editing?.layerId)document=updateLayer(document,editing.layerId,l=>({...l,visible:false}));
    const current=latest.current,rect=area.current.getBoundingClientRect(),zoom=current.zoom;
    const ox=rect.width/2+current.pan.x-document.width*zoom/2,oy=rect.height/2+current.pan.y-document.height*zoom/2;
    const x=Math.max(0,Math.floor((-ox-24)/zoom)),y=Math.max(0,Math.floor((-oy-24)/zoom));
    const right=Math.min(document.width,Math.ceil((rect.width-ox+24)/zoom)),bottom=Math.min(document.height,Math.ceil((rect.height-oy+24)/zoom));
    if(right<=x||bottom<=y){canvas.current.style.visibility='hidden';return;}
    const view={x,y,width:right-x,height:bottom-y,scale:Math.min(1,zoom*(window.devicePixelRatio||1))};view.scale=Math.min(view.scale,Math.sqrt(4*1024*1024/(view.width*view.height)));
    const show=(image:CanvasImageSource,view:RenderViewport,backend:string,ms:number,bytes=0,revision=document.revision)=>{
      const out=canvas.current;if(!out)return;const width=Math.max(1,Math.ceil(view.width*view.scale)),height=Math.max(1,Math.ceil(view.height*view.scale));if(out.width!==width)out.width=width;if(out.height!==height)out.height=height;
      const ctx=out.getContext('2d')!;ctx.clearRect(0,0,width,height);ctx.drawImage(image,0,0);out.style.cssText=`left:${view.x*latest.current.zoom}px;top:${view.y*latest.current.zoom}px;width:${view.width*latest.current.zoom}px;height:${view.height*latest.current.zoom}px;image-rendering:${latest.current.zoom>=4?'pixelated':'auto'};visibility:visible`;
      Object.assign(out.dataset,{documentRevision:revision,renderBackend:backend,renderMs:String(ms),transferBytes:String(bytes),docX:String(view.x),docY:String(view.y),renderScale:String(view.scale)});
    };
    if(document.width*document.height>512*512){
      renderQueued.current={document,view,baseDocument:latest.current.doc,epoch:previewEpoch.current};
      const next=async()=>{
        if(renderPending.current||!renderQueued.current||!mounted.current)return;const job=renderQueued.current;renderQueued.current=null;renderPending.current=true;
        try{const packed=encoder.current.pack(job.document,job.view);const result=await renderWorker.current.run<{bitmap:ImageBitmap;backend:string;ms:number;bytes:number;viewport:typeof view}>('render-scene',packed.packet,packed.transfer);
          if(mounted.current&&latest.current.doc?.id===job.document.id&&latest.current.doc===job.baseDocument&&job.epoch===previewEpoch.current)show(result.bitmap,result.viewport,result.backend,result.ms,result.bytes,job.document.revision);result.bitmap.close();
        }catch(error){encoder.current.reset();if(mounted.current)latest.current.onError(error instanceof Error?error.message:'Preview rendering failed.');}
        finally{renderPending.current=false;if(renderQueued.current)void next();}
      };void next();return;
    }
    renderer.current ||= new CanvasRenderer();const start=performance.now();const image=renderer.current.renderViewport(document,view);show(image,view,renderer.current.backend,performance.now()-start);
  },[]);
  function drawSoon(document: ImageDocument) { preview.current = document; if (!paintFrame.current) paintFrame.current = requestAnimationFrame(() => { paintFrame.current = 0; draw();overlayDraw.current(); }); }
  useEffect(() => {
    mounted.current=true;
    renderer.current = new CanvasRenderer();
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; setSize({ width, height }); });
    if (area.current) observer.observe(area.current);
    return () => { mounted.current=false;observer.disconnect(); renderer.current?.dispose(); renderQueued.current=null;renderWorker.current.dispose(); cancelAnimationFrame(paintFrame.current); };
  }, []);
  useEffect(() => {
    if (doc && doc.id !== documentId.current) { preview.current = null; gesture.current = null; setCrop(null); setPen([]); transformBase.current = null; renderer.current?.dispose(); documentId.current = doc.id; const rect = area.current?.getBoundingClientRect(); if (rect) props.onFit(rect.width, rect.height); }
    if (!gesture.current && !props.transforming) { preview.current = null;if(doc)drawSoon(doc); }
  }, [doc, draw]);
  useEffect(()=>{if(doc)drawSoon(preview.current||doc);},[zoom,pan.x,pan.y,size.width,size.height]);
  useEffect(() => { if (props.transforming && !transformBase.current && doc) transformBase.current = doc; if (!props.transforming) transformBase.current = null; }, [props.transforming, doc]);
  const finishTransform = useCallback((commit: boolean) => {
    const current = latest.current;
    if (commit && preview.current && transformBase.current) current.onCommit('Free Transform', preview.current);
    preview.current = null; transformBase.current = null; current.setTransforming(false); gesture.current = null; draw(current.doc); setRevision(v => v + 1);
  }, [draw]);
  const cancelGesture = useCallback(() => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    previewEpoch.current++;
    renderQueued.current = null;
    cancelAnimationFrame(paintFrame.current); paintFrame.current = 0;
    // A cancelled handle drag returns to its starting transform. Other gestures
    // return to the committed document and never create a history entry.
    preview.current = latest.current.transforming ? g.document : null;
    const pointer = capturedPointer.current; capturedPointer.current = null;
    if (pointer !== null && area.current?.hasPointerCapture(pointer)) area.current.releasePointerCapture(pointer);
    draw(preview.current || latest.current.doc);
    setRevision(v => v + 1);
  }, [draw]);
  useEffect(() => {
    const typing = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'));
    const keyDown = (event: KeyboardEvent) => {
      const frame = area.current?.closest('.os-window');
      if (typing(event.target) || frame && !frame.classList.contains('is-focused')) return;
      if (event.code === 'Space') { event.preventDefault(); setSpace(true); }
      if (event.key === 'Escape') { if (latest.current.transforming) finishTransform(false); else { gesture.current = null; preview.current = null; setCrop(null); setPen([]); draw(latest.current.doc); setRevision(v => v + 1); } }
      if (event.key === 'Enter') {
        if (latest.current.transforming) finishTransform(true);
        else if (crop && latest.current.doc) { event.preventDefault(); try { latest.current.onCommit('Crop', cropDocument(latest.current.doc, crop)); setCrop(null); } catch (error) { latest.current.onError((error as Error).message); } }
        else if (pen.length >= 2 && latest.current.doc) { event.preventDefault(); const d = latest.current.doc; if (latest.current.tool === 'polygon') latest.current.onCommit('Polygonal Selection', selectPolygon(d, pen, latest.current.options.selectionMode)); else latest.current.onCommit('New Work Path', { ...d, paths: [...d.paths, { id: uid(), name: `Work Path ${d.paths.length + 1}`, points: pen, closed: true }] }); setPen([]); }
      }
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false); };
    const blur = () => { setSpace(false); cancelGesture(); };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur); };
  }, [crop, pen, finishTransform, draw, cancelGesture]);
  const finishText=useCallback((commit:boolean)=>{
    const edit=inlineEdit.current;if(!edit)return;inlineEdit.current=null;previewEpoch.current++;setTextEdit(null);latest.current.onTypeDraft?.(undefined);latest.current.onPendingEdit?.(null);
    const document=latest.current.doc;if(!document||document.id!==edit.documentId)return;
    if(commit&&(edit.layerId||edit.text.content.length)){
      let next=document;if(edit.layerId)next=updateLayer(document,edit.layerId,l=>({...l,text:edit.text,name:edit.text.content.slice(0,24)||'Type layer'}));else{next=createTextLayer(document,edit.point,edit.text.content,edit.text.color);next=updateLayer(next,next.activeIds[0],l=>({...l,text:edit.text}));}
      latest.current.onCommit(edit.layerId?'Edit Type':'New Type Layer',next);
    }else drawSoon(document);
  },[]);
  useEffect(()=>{if(textEdit){latest.current.onPendingEdit?.(()=>finishText(true));latest.current.onTypeDraft?.({documentId:textEdit.documentId,layerId:textEdit.layerId,point:textEdit.point,text:textEdit.text});}else latest.current.onPendingEdit?.(null);},[textEdit,finishText]);
  const current = preview.current || doc; const active = current && findLayer(current); const bounds = active && current ? transformedBounds(active, current) : null;
  const showHandles = Boolean(doc && active && (props.transforming || options.showTransform && tool === 'move'));
  function drawOverlay() {
    const ctx = overlay.current?.getContext('2d'); if (!ctx || !overlay.current) return;
    const dpr = window.devicePixelRatio || 1; overlay.current.width = Math.round(size.width * dpr); overlay.current.height = Math.round(size.height * dpr); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, size.width, size.height);
    if (!doc) return;
    ctx.save(); ctx.translate(origin.x, origin.y); ctx.scale(zoom, zoom); ctx.lineWidth = 1 / zoom;
    if (w.guides) { ctx.strokeStyle = '#59dce5'; doc.guides.forEach(guide => { ctx.beginPath(); if (guide.axis === 'x') { ctx.moveTo(guide.position, -origin.y / zoom); ctx.lineTo(guide.position, (size.height - origin.y) / zoom); } else { ctx.moveTo(-origin.x / zoom, guide.position); ctx.lineTo((size.width - origin.x) / zoom, guide.position); } ctx.stroke(); }); }
    const display=preview.current||doc;
    if(display.quickMask){const width=Math.round(size.width),height=Math.round(size.height),image=new ImageData(width,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dx=Math.floor((x-origin.x)/zoom),dy=Math.floor((y-origin.y)/zoom);if(dx>=0&&dy>=0&&dx<doc.width&&dy<doc.height){const at=(y*width+x)*4;image.data[at]=255;image.data[at+3]=(255-(display.selection?.[dy*doc.width+dx]??255))*.45;}}const maskCanvas=document.createElement('canvas');maskCanvas.width=width;maskCanvas.height=height;maskCanvas.getContext('2d')!.putImageData(image,0,0);ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.drawImage(maskCanvas,0,0);ctx.restore();}
    const outline=display.quickMask?null:selectionOutline(display);if(outline){ctx.strokeStyle='#fff';ctx.stroke(outline);ctx.setLineDash([4/zoom,4/zoom]);ctx.strokeStyle='#111';ctx.stroke(outline);ctx.setLineDash([]);}
    const g = gesture.current;
    if (g && ['select', 'crop', 'shape', 'gradient'].includes(g.kind)) {
      const left = Math.min(g.start.x, g.last.x); const top = Math.min(g.start.y, g.last.y); const width = Math.abs(g.start.x - g.last.x); const height = Math.abs(g.start.y - g.last.y);
      ctx.beginPath();
      if (tool === 'lasso' || tool === 'polygon') g.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      else if (g.kind === 'gradient'||g.kind==='crop'&&options.straighten) { ctx.moveTo(g.start.x, g.start.y); ctx.lineTo(g.last.x, g.last.y); }
      else if (tool === 'ellipse-select' || tool === 'ellipse') ctx.ellipse(left + width / 2, top + height / 2, Math.max(.01, width / 2), Math.max(.01, height / 2), 0, 0, Math.PI * 2);
      else ctx.rect(left, top, width, height);
      ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([4 / zoom, 4 / zoom]); ctx.strokeStyle = '#171717'; ctx.stroke(); ctx.setLineDash([]);
    }
    if (crop) { ctx.fillStyle = '#0008'; ctx.beginPath(); ctx.rect(0, 0, doc.width, doc.height); ctx.rect(crop.x, crop.y, crop.width, crop.height); ctx.fill('evenodd'); ctx.strokeStyle = '#fff'; ctx.strokeRect(crop.x, crop.y, crop.width, crop.height); ctx.globalAlpha = .5; for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(crop.x + crop.width * i / 3, crop.y); ctx.lineTo(crop.x + crop.width * i / 3, crop.y + crop.height); ctx.moveTo(crop.x, crop.y + crop.height * i / 3); ctx.lineTo(crop.x + crop.width, crop.y + crop.height * i / 3); ctx.stroke(); } ctx.globalAlpha = 1; }
    if (tool === 'pen' || tool === 'path-select' || tool === 'polygon') {
      for (const path of [...(preview.current||doc).paths, ...(pen.length ? [{ id: 'work', points: pen, closed: false }] : [])]) { ctx.beginPath(); path.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); if (path.closed) ctx.closePath(); ctx.strokeStyle = '#58a9ff'; ctx.stroke(); for (const p of path.points) { ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 3 / zoom, p.y - 3 / zoom, 6 / zoom, 6 / zoom); ctx.strokeRect(p.x - 3 / zoom, p.y - 3 / zoom, 6 / zoom, 6 / zoom); } }
    }
    ctx.restore();
  }
  useEffect(drawOverlay, [doc, zoom, pan, size, crop, pen, revision, w.guides, tool]);
  function hitTest(point: Point, document: ImageDocument) {
    return [...allLayers(document.layers)].reverse().find(item => { if (!item.visible || item.kind === 'group' || item.kind === 'adjustment') return false; const rect = transformedBounds(item, document); if (point.x < rect.x || point.y < rect.y || point.x > rect.x + rect.width || point.y > rect.y + rect.height) return false; const source = item.kind === 'embedded' ? item.source : item.pixels; if (!source) return true; const p = toLocal(point, item.transform); return pixel(source, p.x, p.y)[3] > 0; });
  }
  overlayDraw.current=drawOverlay;
  function start(event: React.PointerEvent<HTMLDivElement>) {
    if (!doc || props.busy || event.button > 1) return; event.preventDefault(); area.current?.focus(); const point = toPoint(event); let document = doc;
    if (space || tool === 'hand' || event.button === 1) { gesture.current = { kind: 'pan', document, start: { x: event.clientX, y: event.clientY }, last: point, points: [], pan: { ...pan } }; capturedPointer.current=event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (tool === 'zoom') { zoomAt(point, event.altKey ? 1 / 1.5 : 1.5); return; }
    if (tool === 'eyedropper' || event.altKey && (tool === 'brush' || tool === 'pencil')) { if(point.x>=0&&point.y>=0&&point.x<doc.width&&point.y<doc.height){renderer.current ||= new CanvasRenderer();const sampled=renderer.current.renderViewport(doc,{x:Math.floor(point.x),y:Math.floor(point.y),width:1,height:1,scale:1});props.onColor(hexColor([...context2d(sampled).getImageData(0,0,1,1).data]));}return; }
    if(tool==='type'){const hit=hitTest(point,document);const existing=hit?.kind==='text'?hit:undefined;if(existing?.locked){props.onError('Unlock this type layer before editing it.');return;}const style=existing?.text||props.typeStyle||{content:'',font:'Arial',size:72,color:foreground,bold:false,italic:false,align:'left' as const,leading:1.2,tracking:0};const edit:InlineTypeState={documentId:document.id,layerId:existing?.id,point:existing?{x:existing.transform.x,y:existing.transform.y}:point,text:{...style,content:existing?.text?.content||''},transform:existing?.transform||{...identity(),x:point.x,y:point.y}};inlineEdit.current=edit;previewEpoch.current++;setTextEdit(edit);if(existing)props.onSelect([existing.id],'pixels');drawSoon(document);return;}
    if (tool === 'pen' || tool === 'polygon') { setPen(previous => [...previous, point]); return; }
    if (tool === 'path-select') { let found = false; document.paths.forEach((path, pathIndex) => path.points.forEach((p, pointIndex) => { if (!found && Math.hypot(p.x - point.x, p.y - point.y) * zoom < 10) { found = true; gesture.current = { kind: 'anchor', document, start: point, last: point, points: [], pathIndex, pointIndex }; } })); if (found) { capturedPointer.current=event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); } return; }
    if (tool === 'wand') { props.onOperation('Magic Wand', 'wand', { document, point, tolerance: options.tolerance, contiguous: options.contiguous, mode: selectionMode(event) }); return; }
    if (tool === 'fill') { props.onOperation('Paint Bucket', 'fill', { document, point, color: foreground, tolerance: options.tolerance }); return; }
    if (['brush', 'pencil', 'eraser', 'clone', 'heal','blur','sharpen','smudge','dodge','burn','sponge'].includes(tool)) {
      let selected = findLayer(document); if (!selected || selected.locked&&!document.quickMask) { props.onError('Select an unlocked layer before painting.'); return; }
      if ((tool === 'clone' || tool === 'heal') && event.altKey) { cloneSource.current = { point: toLocal(point, selected.transform), layerId: selected.id }; return; }
      if (!document.quickMask&&document.target !== 'mask' && selected.kind !== 'raster') {
        if (['blur','sharpen','smudge','dodge','burn','sponge'].includes(tool)) { props.onError('Select a pixel layer or use Layer → Rasterize before retouching this layer.'); return; }
        document = newPixelLayer(document); selected = findLayer(document)!;
      }
      let clone: BrushSettings['clone'];
      if (tool === 'clone' || tool === 'heal') {
        if (!cloneSource.current) { props.onError('Alt-click a pixel layer to set a source point first.'); return; }
        const sourceLayer = findLayer(doc, cloneSource.current.layerId); const source = sourceLayer?.pixels || sourceLayer?.source;
        if (!source) { props.onError('The sampled layer no longer has a pixel source.'); return; }
        const local = toLocal(point, selected.transform); clone = { source, offset: { x: cloneSource.current.point.x - local.x, y: cloneSource.current.point.y - local.y }, heal: tool === 'heal' };
      }
      try { const Stroke=document.quickMask?SelectionStroke:BrushStroke;const stroke = new Stroke(document, { ...brush, color: foreground, erase: tool === 'eraser', pencil: tool === 'pencil',retouch:['blur','sharpen','smudge','dodge','burn','sponge'].includes(tool)?tool as BrushSettings['retouch']:undefined, clone });if(event.shiftKey&&lastPaint.current?.id===selected.id&&lastPaint.current.target===document.target)stroke.add(lastPaint.current.point); stroke.add(point); gesture.current = { kind: 'brush', document, start: point, last: point, points: [], brush: stroke }; drawSoon(stroke.preview()); } catch (error) { props.onError((error as Error).message); return; }
    } else if (tool === 'move') {
      if (options.autoSelect) { const hit = hitTest(point, document); if (hit && !document.activeIds.includes(hit.id)) { document = { ...document, activeIds: [hit.id], target: 'pixels' }; props.onSelect([hit.id], 'pixels'); } }
      if (findLayer(document)?.locked) { props.onError('The selected layer is locked.'); return; }
      gesture.current = { kind: 'move', document: props.transforming ? preview.current || document : document, start: point, last: point, points: [] };
    } else {
      const kind = ['marquee', 'ellipse-select', 'lasso'].includes(tool) ? 'select' : tool === 'crop' ? 'crop' : tool === 'gradient' ? 'gradient' : 'shape';
      gesture.current = { kind, document, start: point, last: point, points: [point], mode: selectionMode(event) };
    }
    capturedPointer.current=event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); setRevision(v => v + 1);
  }
  function selectionMode(event: { shiftKey: boolean; altKey: boolean }) { return event.shiftKey && event.altKey ? 'intersect' : event.shiftKey ? 'add' : event.altKey ? 'subtract' : options.selectionMode; }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const point = toPoint(event);if(brushCursor.current){brushCursor.current.style.left=`${point.x*zoom+origin.x}px`;brushCursor.current.style.top=`${point.y*zoom+origin.y}px`;brushCursor.current.style.visibility='visible';} const g = gesture.current; if (!g) return;
    g.last = point;
    if (g.kind === 'brush') { const coalesced=event.nativeEvent.getCoalescedEvents?.();const events=coalesced?.length?coalesced:[event.nativeEvent]; for (const sample of events) g.brush!.add(toPoint(sample)); drawSoon(g.brush!.preview()); }
    else if (g.kind === 'pan') props.onView(zoom, { x: g.pan!.x + event.clientX - g.start.x, y: g.pan!.y + event.clientY - g.start.y });
    else if (g.kind === 'move') { const dx = point.x - g.start.x,dy = point.y - g.start.y;let next=transformSelected(g.document,[1,0,0,1,dx,dy]);const selected=findLayer(g.document);if(g.document.target==='mask'&&selected?.mask&&!selected.mask.linked)next=updateLayer(g.document,selected.id,item=>({...item,mask:{...item.mask!,transform:{...item.mask!.transform,x:item.mask!.transform.x+dx,y:item.mask!.transform.y+dy}}})); drawSoon(next); setRevision(v => v + 1);
    } else if (g.kind === 'scale' && g.bounds && g.anchor) {
      const dx = g.start.x - g.anchor.x; const dy = g.start.y - g.anchor.y; let sx = Math.abs(dx) > .001 ? (point.x - g.anchor.x) / dx : 1; let sy = Math.abs(dy) > .001 ? (point.y - g.anchor.y) / dy : 1;
      if (event.shiftKey) { const amount = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx) * amount; sy = Math.sign(sy) * amount; }
      sx = Math.abs(sx) < .01 ? .01 : sx; sy = Math.abs(sy) < .01 ? .01 : sy;
      const next=transformSelected(g.document,around(g.anchor,[sx,0,0,sy,0,0])); drawSoon(next); setRevision(v => v + 1);
    } else if (g.kind === 'rotate' && g.anchor) { const raw = (Math.atan2(point.y - g.anchor.y, point.x - g.anchor.x) - Math.atan2(g.start.y - g.anchor.y, g.start.x - g.anchor.x)) * 180 / Math.PI;const degrees=event.shiftKey?Math.round(raw/15)*15:raw;const angle=degrees*Math.PI/180; const next=transformSelected(g.document,around(g.anchor,[Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0])); drawSoon(next); setRevision(v => v + 1); }
    else if (g.kind === 'anchor') { const next = { ...g.document, paths: g.document.paths.map((path, i) => i === g.pathIndex ? { ...path, points: path.points.map((p, j) => j === g.pointIndex ? point : p) } : path) }; preview.current = next; setRevision(v => v + 1); }
    else { if (tool === 'lasso') g.points.push(point); setRevision(v => v + 1); }
  }
  function end(event: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current; if (!g) return;
    gesture.current = null; capturedPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    try {
      if (g.kind === 'brush') {props.onCommit(g.document.quickMask?'Paint Quick Mask':tool === 'clone' ? 'Clone Stamp' : tool === 'heal' ? 'Healing Brush (sample correction)' : doc?.target === 'mask' ? 'Brush on Layer Mask' : tool === 'eraser' ? 'Eraser' : ['blur','sharpen','smudge','dodge','burn','sponge'].includes(tool)?tool[0].toUpperCase()+tool.slice(1)+' Tool':'Brush Tool', g.brush!.finish());lastPaint.current={point:g.last,id:g.brush!.layerId,target:g.document.target};}
      else if (g.kind === 'move' && preview.current && !props.transforming) props.onCommit('Move', preview.current);
      else if (g.kind === 'select') { let next = tool === 'lasso' ? selectPolygon(g.document, g.points, g.mode) : selectShape(g.document, g.start, g.last, tool === 'ellipse-select' ? 'ellipse' : 'rectangle', g.mode); if (options.feather) next = feather(next, options.feather); props.onCommit('Selection', next); }
      else if (g.kind === 'crop') {if(options.straighten){const degrees=-Math.atan2(g.last.y-g.start.y,g.last.x-g.start.x)*180/Math.PI;props.onCommit('Straighten Image',straightenDocument(g.document,degrees));}else setCrop({ x: Math.max(0, Math.min(g.start.x, g.last.x)), y: Math.max(0, Math.min(g.start.y, g.last.y)), width: Math.abs(g.last.x - g.start.x), height: Math.abs(g.last.y - g.start.y) });}
      else if (g.kind === 'shape' && Math.abs(g.last.x - g.start.x) > 1 && Math.abs(g.last.y - g.start.y) > 1) { const type = tool === 'ellipse' ? 'ellipse' : 'rectangle'; props.onCommit('New Shape Layer', addLayer(g.document, { ...layer(type === 'ellipse' ? 'Ellipse 1' : 'Rectangle 1', 'shape'), transform: { ...identity(), x: Math.min(g.start.x, g.last.x), y: Math.min(g.start.y, g.last.y) }, shape: { type, width: Math.abs(g.last.x - g.start.x), height: Math.abs(g.last.y - g.start.y), fill: foreground, stroke: '#000000', strokeWidth: 0 } })); }
      else if (g.kind === 'gradient') props.onOperation('Gradient', 'fill', { document: g.document, point: g.start, color: foreground, gradient: { end: g.last, background } });
      else if (g.kind === 'anchor' && preview.current) props.onCommit('Move Path Anchor', preview.current);
    } catch (error) { props.onError((error as Error).message); }
    gesture.current = null; if (!props.transforming) preview.current = null; setRevision(v => v + 1);
  }
  function zoomAt(point: Point, ratio: number) { const next = Math.min(32, Math.max(.02, zoom * ratio)); props.onView(next, { x: pan.x + (point.x - (doc?.width || 0) / 2) * (zoom - next), y: pan.y + (point.y - (doc?.height || 0) / 2) * (zoom - next) }); }
  function beginHandle(event: React.PointerEvent, index: number) {
    event.stopPropagation(); event.preventDefault(); if (!doc || !bounds || active?.locked) return; if (!props.transforming) { transformBase.current = doc; props.setTransforming(true); }
    const point = toPoint(event); const base = preview.current || doc;
    const anchor = index === 4 ? { x: bounds.x+bounds.width/2, y: bounds.y+bounds.height/2 } : { x: bounds.x + (index === 0 || index === 3 ? bounds.width : 0), y: bounds.y + (index === 0 || index === 1 ? bounds.height : 0) };
    gesture.current = { kind: index === 4 ? 'rotate' : 'scale', document: base, start: point, last: point, points: [], anchor, bounds }; capturedPointer.current=event.pointerId; area.current?.setPointerCapture(event.pointerId);
  }
  const paintTool = ['brush', 'pencil', 'eraser', 'clone', 'heal','blur','sharpen','smudge','dodge','burn','sponge'].includes(tool) && !space;
  const taskBounds=useMemo(()=>doc?selectionBounds(doc):null,[doc?.selection,doc?.width,doc?.height]);
  const ruler = (vertical: boolean) => {
    const limit = vertical ? size.height : size.width; const offset = vertical ? origin.y : origin.x; const step = zoom < .2 ? 500 : zoom < .5 ? 200 : zoom < 2 ? 100 : 20;
    const marks = []; for (let p = Math.floor(-offset / zoom / step) * step; p * zoom + offset < limit; p += step) { const position = p * zoom + offset; marks.push(<g key={p}><line x1={vertical ? 11 : position} y1={vertical ? position : 11} x2={vertical ? 18 : position} y2={vertical ? position : 18}/><text x={vertical ? 2 : position + 3} y={vertical ? position + 10 : 9}>{p}</text></g>); }
    return <svg width={vertical ? 18 : size.width} height={vertical ? size.height : 18}>{marks}</svg>;
  };
  return <div className={`ie-canvas-shell ${w.rulers ? 'has-rulers' : ''}`}>
    {w.rulers && <><div className="ie-ruler-origin"/><div className="ie-ruler ie-ruler-top" title="Click to add a vertical guide" onClick={event => { if (doc) { const rect = event.currentTarget.getBoundingClientRect(); props.onCommit('New Guide', { ...doc, guides: [...doc.guides, { axis: 'x', position: (event.clientX - rect.left - origin.x) / zoom }] }); } }}>{ruler(false)}</div><div className="ie-ruler ie-ruler-left" title="Click to add a horizontal guide" onClick={event => { if (doc) { const rect = event.currentTarget.getBoundingClientRect(); props.onCommit('New Guide', { ...doc, guides: [...doc.guides, { axis: 'y', position: (event.clientY - rect.top - origin.y) / zoom }] }); } }}>{ruler(true)}</div></>}
    <div ref={area} className={`ie-canvas-area ie-cursor-${space ? 'hand' : tool}`} tabIndex={0} aria-label="Image canvas" data-testid="image-canvas-area" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture} onPointerLeave={() => {if(brushCursor.current)brushCursor.current.style.visibility='hidden';}} onWheel={event => { event.preventDefault(); if (event.ctrlKey || event.metaKey || tool === 'zoom') zoomAt(toPoint(event), Math.exp(-event.deltaY * .002)); else props.onView(zoom, { x: pan.x - (event.shiftKey ? event.deltaY : event.deltaX), y: pan.y - (event.shiftKey ? event.deltaX : event.deltaY) }); }} onDoubleClick={() => { if (tool === 'polygon' && pen.length >= 3 && doc) { props.onCommit('Polygonal Selection', selectPolygon(doc, pen, options.selectionMode)); setPen([]); } }}>
      {doc ? <><div className="ie-document-canvas ie-checkerboard" style={{ left: origin.x, top: origin.y, width: doc.width * zoom, height: doc.height * zoom }}><canvas ref={canvas} data-testid="image-composite"/></div><canvas className="ie-canvas-overlay" ref={overlay}/>{textEdit&&<InlineType edit={textEdit} zoom={zoom} origin={origin} onChange={content=>{const next={...textEdit,text:{...textEdit.text,content}};inlineEdit.current=next;setTextEdit(next);}} onFinish={finishText}/>}
        {showHandles && bounds && <div className="ie-transform-box" style={{ left: origin.x + bounds.x * zoom, top: origin.y + bounds.y * zoom, width: Math.max(1, bounds.width * zoom), height: Math.max(1, bounds.height * zoom) }}>{[0,1,2,3,4].map(i => <button key={i} className={`ie-transform-handle ie-transform-handle-${i}`} aria-label={i === 4 ? 'Rotate layer handle' : `Scale layer handle ${i + 1}`} onPointerDown={e => beginHandle(e, i)}/>)}</div>}
        {paintTool && <div ref={brushCursor} className="ie-brush-cursor" style={{visibility:'hidden',width:Math.max(2,brush.size*zoom),height:Math.max(2,brush.size*zoom)}}/>}
      </> : <div className="ie-empty-canvas"><AppIcon name="image-editor" size={64}/><h2>Prism</h2><button onClick={() => props.onCommand('image.new')}>Create new…</button><button onClick={() => props.onCommand('image.open')}>Open…</button><button className="ie-text-button" onClick={() => props.onCommand('image.sample')}>Open the layered sample</button></div>}
    </div>
    {doc && w.taskBar && <div className={`ie-contextual-bar ${w.taskPinned ? 'is-pinned' : ''}`} aria-label="Contextual Task Bar" style={w.taskPosition ? { left: w.taskPosition.x, top: w.taskPosition.y, bottom: 'auto', transform: 'none' } : undefined} onPointerDown={e => e.stopPropagation()}><span className="ie-task-grip" onPointerDown={event => { const bar = event.currentTarget.parentElement!; const rect = bar.getBoundingClientRect(); const rootRect = bar.parentElement!.getBoundingClientRect(); const offset = { x: event.clientX - rect.left, y: event.clientY - rect.top }; const grip = event.currentTarget; grip.setPointerCapture(event.pointerId); grip.onpointermove = e => { if (grip.hasPointerCapture(e.pointerId)) setWorkspace({ ...w, taskPosition: { x: Math.max(0, e.clientX - rootRect.left - offset.x), y: Math.max(0, e.clientY - rootRect.top - offset.y) }, taskPinned: true }); }; }}><GripVertical size={14}/></span>{props.transforming || crop ? <><button onClick={() => { if (props.transforming) finishTransform(true); else if (crop) { try { props.onCommit('Crop', cropDocument(doc, crop)); setCrop(null); } catch (error) { props.onError((error as Error).message); } } }}><Check size={15}/>Done</button><button onClick={() => { finishTransform(false); setCrop(null); }}><X size={14}/>Cancel</button></> : taskBounds ? <><button onClick={()=>props.onCommand('image.ai-fill')}>Generative Fill</button><button disabled={!active||active.locked||Boolean(active.mask)} onClick={() => props.onCommand('image.mask')}>Add layer mask</button><button onClick={() => props.onCommand('image.invert')}>Invert selection</button><button onClick={() => props.onCommand('image.deselect')}>Deselect</button></> : active?.text ? <><button onClick={() => props.onText({ x: active.transform.x, y: active.transform.y }, active.id)}>Edit type</button><button onClick={() => props.onCommand('image.transform')}>Transform</button></> : <><button onClick={() => props.onCommand('image.new-layer')}>New layer</button><button onClick={() => props.onCommand('image.transform')}>Transform</button><button onClick={() => props.onCommand('image.local-ai')}>Local AI</button><button onClick={() => props.onCommand('image.adjust-brightness')}>Adjust colors</button></>}<i className="ie-separator"/><button aria-label="Contextual Task Bar options" onClick={() => setTaskMenu(!taskMenu)}><MoreHorizontal size={17}/></button>{taskMenu && <div className="ie-task-menu"><button onClick={() => { setWorkspace({ ...w, taskPinned: !w.taskPinned }); setTaskMenu(false); }}><Pin size={13}/>{w.taskPinned ? 'Unpin bar position' : 'Pin bar position'}</button><button onClick={() => { setWorkspace({ ...w, taskPosition: null, taskPinned: false }); setTaskMenu(false); }}>Reset bar position</button><button onClick={() => { setWorkspace({ ...w, taskBar: false }); setTaskMenu(false); }}>Hide bar</button></div>}</div>}
  </div>;
}
