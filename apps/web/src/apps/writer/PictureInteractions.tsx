import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type RefObject, type CSSProperties } from 'react';
import { Check, Crop, LayoutPanelTop, X } from 'lucide-react';
import { assertReceipt, type SelectionCapture, type WriterEngine, type WriterSnapshot } from '../../../../../packages/document-engine/src';
import { insertPicture, pictureWrap, setPictureWrap, type PictureWrap, type WriterPicture } from './pictures';
import '../../../../../packages/ui/src/glass.css';
import './pictures.css';

export type PictureActions = { layout: () => void; crop: () => void; resetCrop: () => void };
type Props = {
  engine: WriterEngine | null; snapshot: WriterSnapshot; root: RefObject<HTMLDivElement | null>;
  selectedId: string | null; select: (id: string | null) => void; format: () => void;
  blocked: boolean; defaultWrap: 'inline' | 'square' | 'topAndBottom'; unit: 'in' | 'cm';
  systemTheme: 'light' | 'dark';
  textScale: number; increaseContrast: boolean;
  perform: (action: () => unknown | Promise<unknown>) => Promise<void>;
};
type Box = { left: number; top: number; width: number; height: number };
type CropValues = { left: number; right: number; top: number; bottom: number };
type Gesture = {
  kind: 'move' | 'crop'; pointer: number; x: number; y: number; dx: number; dy: number; active: boolean;
  frame: HTMLElement; box: DOMRect; page: HTMLElement; revision: number; picture: Promise<WriterPicture | null>;
  dropPage?: HTMLElement; turn?: number;
  handedOff?: boolean;
  edge?: string; crop?: CropValues; target?: SelectionCapture['selectionTarget'];
};
const cropValues = (image: WriterPicture): CropValues => ({ left: image.properties.crop?.left || 0, right: image.properties.crop?.right || 0, top: image.properties.crop?.top || 0, bottom: image.properties.crop?.bottom || 0 });
const isFloating = (image: WriterPicture) => image.properties.placement === 'floating';
const frames = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.writer-engine-mount [data-sd-image-id]')].filter(node => node.matches('img') || node.querySelector('img'));
const imageSource = (frame: HTMLElement) => (frame.matches('img') ? frame as HTMLImageElement : frame.querySelector('img'))?.src;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function PositionControls({ horizontal, top, unit, disabled, apply }: { horizontal:number;top:number;unit:'in'|'cm';disabled:boolean;apply:(position:{horizontal:number;top:number})=>Promise<boolean> }) {
  const divisor=unit==='cm'?96/2.54:96,format=(value:number)=>String(Number((value/divisor).toFixed(3)));
  const [x,setX]=useState(()=>format(horizontal)),[y,setY]=useState(()=>format(top)),[dirty,setDirty]=useState(false);
  useEffect(()=>{if(!dirty){setX(format(horizontal));setY(format(top));}},[horizontal,top,unit,dirty]);
  return <form className="wr-picture-position" onSubmit={event=>{event.preventDefault();void apply({horizontal:Number(x)*divisor,top:Number(y)*divisor}).then(ok=>{if(ok)setDirty(false);});}}>
    <strong>Position on page</strong><div>
      <label>Horizontal ({unit})<input aria-label={`Picture horizontal position (${unit})`} type="number" min={0} step="any" required disabled={disabled} value={x} onChange={event=>{setDirty(true);setX(event.target.value);}}/></label>
      <label>Vertical ({unit})<input aria-label={`Picture vertical position (${unit})`} type="number" min={0} step="any" required disabled={disabled} value={y} onChange={event=>{setDirty(true);setY(event.target.value);}}/></label>
    </div><button disabled={disabled||!dirty} type="submit">Apply position</button>
  </form>;
}

/** Painted geometry supplies pointer feedback; public image operations own every document change. */
export const PictureInteractions = forwardRef<PictureActions, Props>(function PictureInteractions(props, ref) {
  const latest = useRef(props); latest.current = props;
  const [image, setImage] = useState<WriterPicture | null>(null), model = useRef<WriterPicture | null>(null); model.current = image;
  const frame = useRef<HTMLElement | null>(null), frameKey = useRef({ raw: '', page: '' });
  const frameId = useRef<string | null>(null);
  const [box, setBox] = useState<Box | null>(null), [layoutOpen, setLayoutOpen] = useState(false);
  const [behindText, setBehindText] = useState(false);
  const [crop, setCrop] = useState<CropValues | null>(null), cropDraft = useRef(crop); cropDraft.current = crop;
  const cropRevision = useRef(0);
  const [preview, setPreview] = useState<{ box: Box; source?: string; floating: boolean; crop:CropValues; guideX?: number; guideY?: number } | null>(null);
  const [caret, setCaret] = useState<Box | null>(null), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const pending = useRef(false), gesture = useRef<Gesture | null>(null), sequence = useRef(0), geometryFrame = useRef(0);
  const layoutButton = useRef<HTMLButtonElement>(null), popover = useRef<HTMLElement>(null);
  const editable = props.snapshot.ready && !props.blocked && props.snapshot.state?.documentMode !== 'viewing';

  function local(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): Box {
    const root = latest.current.root.current!, parent = root.getBoundingClientRect();
    const sx = parent.width / root.offsetWidth || 1, sy = parent.height / root.offsetHeight || 1;
    return { left: (rect.left - parent.left) / sx, top: (rect.top - parent.top) / sy, width: rect.width / sx, height: rect.height / sy };
  }
  function liveFrame() {
    const root = latest.current.root.current; if (!root) return null;
    if (frame.current?.isConnected) return frame.current;
    const matches = frames(root).filter(node => node.dataset.sdImageId === frameKey.current.raw);
    frame.current = matches.find(node => node.closest('[data-page-number]')?.getAttribute('data-page-number') === frameKey.current.page) || (matches.length === 1 ? matches[0] : null);
    return frame.current;
  }
  function remember(element: HTMLElement, id?: string) {
    frame.current = element; frameKey.current = { raw: element.dataset.sdImageId || '', page: element.closest('[data-page-number]')?.getAttribute('data-page-number') || '' };
    if (id) frameId.current = id;
  }
  function geometry() {
    if (geometryFrame.current) return;
    geometryFrame.current = requestAnimationFrame(() => {
      geometryFrame.current = 0;
      const element = liveFrame(), root = latest.current.root.current, workspace = root?.querySelector('.writer-workspace');
      if (!element || !workspace) { setBox(null); return; }
      const rect = element.getBoundingClientRect(), visible = workspace.getBoundingClientRect();
      setBehindText(element.classList.contains('ts-float-back') || element.dataset.behindDoc === 'true' || element.dataset.behindDoc === '1');
      if (rect.bottom <= visible.top || rect.top >= visible.bottom || rect.right <= visible.left || rect.left >= visible.right) { setBox(null); return; }
      const next = local(rect); setBox(previous => previous && Object.keys(next).every(key => Math.abs(previous[key as keyof Box] - next[key as keyof Box]) < .25) ? previous : next);
    });
  }
  async function refresh() {
    const { engine, selectedId } = latest.current;
    if (!engine || !selectedId) return;
    const next = await engine.api.images.get({ imageId: selectedId });
    if (latest.current.engine !== engine || latest.current.selectedId !== selectedId) return;
    setImage(next); geometry();
  }
  async function change(action: (engine: WriterEngine, image: WriterPicture) => Promise<unknown>) {
    const current = latest.current, id = current.selectedId, engine = current.engine;
    if (pending.current || !engine || !id || current.blocked || engine.ui?.state.documentMode === 'viewing') return false;
    pending.current = true; setBusy(true);
    let success=false;
    try { await current.perform(async () => { const fresh = await engine.api.images.get({ imageId: id }); await action(engine, fresh); await refresh();success=true;requestAnimationFrame(()=>liveFrame()?.scrollIntoView({block:'nearest',inline:'nearest'})); }); }
    finally { pending.current = false; setBusy(false); }
    return success;
  }
  function startCrop() { if (model.current && editable) { cropRevision.current=latest.current.snapshot.revision;setLayoutOpen(false); setCrop(cropValues(model.current)); setStatus('Drag a black crop handle. Enter applies the crop; Escape cancels.'); } }
  async function applyCrop() {
    const next = cropDraft.current; if (!next) return;
    await change(async (engine, picture) => { assertReceipt(await engine.api.images.crop({ imageId: picture.sdImageId, crop: next })); setCrop(null); setStatus('Picture cropped.'); });
  }
  useImperativeHandle(ref, () => ({ layout: () => { if (latest.current.selectedId) setLayoutOpen(true); }, crop: startCrop,resetCrop:()=>void change(async(owner,picture)=>{assertReceipt(await owner.api.images.resetCrop({imageId:picture.sdImageId}));setCrop(null);setStatus('Picture crop reset.');}) }));

  useEffect(() => {
    const { engine, selectedId } = props; let active = true;
    if (!engine || !selectedId || !props.snapshot.ready) { setImage(null); setBox(null); setCrop(null); setLayoutOpen(false); return; }
    void (async () => {
      const next = await engine.api.images.get({ imageId: selectedId });
      if (!active) return;
      setImage(next);
      if (frameId.current !== selectedId) { frame.current = null; frameKey.current = { raw:'',page:'' }; }
      if (!liveFrame()) for (const element of frames(props.root.current!)) {
        const candidate = await engine.resolveImageAt(element);
        if (!active) return;
        if (candidate?.sdImageId === selectedId) { remember(element,selectedId); break; }
      }
      geometry();
    })().catch(() => { if (active) props.select(null); });
    return () => { active = false; };
  }, [props.engine, props.selectedId, props.snapshot.revision, props.snapshot.ready]);
  useEffect(() => { setCrop(null); setLayoutOpen(false); }, [props.selectedId]);
  useEffect(()=>{
    const element=liveFrame();if(!element||!image)return;
    const label=image.properties.description||image.properties.alt||image.properties.name||'Document picture';
    element.setAttribute('aria-label',`Picture: ${label}`);
    const original=element.matches('img')?element as HTMLImageElement:element.querySelector<HTMLImageElement>('img:not([data-writer-image-presentation])');
    if(original&&original.alt!==label)original.alt=label;
  },[image,box]);
  useEffect(() => { if(cropDraft.current&&!pending.current&&cropRevision.current!==props.snapshot.revision){setCrop(null);setStatus('The document changed. Crop editing was cancelled.');} }, [props.snapshot.revision]);
  useEffect(() => { if (props.blocked) { sequence.current++; gesture.current = null; setPreview(null); setCaret(null); setCrop(null); setLayoutOpen(false); } }, [props.blocked]);
  useEffect(() => {
    if (!layoutOpen) return;
    const token = requestAnimationFrame(() => popover.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
    return () => cancelAnimationFrame(token);
  }, [layoutOpen]);
  useEffect(() => {
    if (!layoutOpen) return;
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest('.wr-picture-layout-popover,.wr-picture-layout-button')) setLayoutOpen(false); };
    document.addEventListener('pointerdown',outside,true);return () => document.removeEventListener('pointerdown',outside,true);
  }, [layoutOpen]);

  useEffect(() => {
    const root = props.root.current, engine = props.engine;
    if (!root || !engine || !props.snapshot.ready) return;
    const observer = new MutationObserver(geometry); observer.observe(root.querySelector('.writer-engine-mount')!, { childList: true, subtree: true });
    const resize = new ResizeObserver(geometry); resize.observe(root);
    const release = engine.ui?.viewport.observe(geometry);
    root.addEventListener('scroll', geometry, true); window.addEventListener('resize', geometry);

    let scrollFrame = 0, handingOff = false, lastPointer: { x:number; y:number; pointer:number; shift:boolean; alt:boolean } | null = null;
    function takeGesture(g:Gesture) {
      if(g.handedOff || g.kind!=='move')return;
      // Native selection/resize remains intact. Once this is a body drag,
      // cancel its pending native drag so a second drop cannot reanchor it.
      g.handedOff=true;handingOff=true;
      try { g.frame.dispatchEvent(new PointerEvent('pointercancel',{pointerId:g.pointer,pointerType:'mouse',bubbles:true})); }
      finally { handingOff=false; }
    }
    function cancel() { gesture.current = null; setPreview(null); setCaret(null); cancelAnimationFrame(scrollFrame); scrollFrame = 0; }
    function autoScroll() {
      scrollFrame = 0;
      const g = gesture.current, pointer = lastPointer, workspace = root!.querySelector<HTMLElement>('.writer-workspace');
      if (!g?.active || g.kind !== 'move' || !pointer || !workspace) return;
      const rect = workspace.getBoundingClientRect(), before = workspace.scrollTop;
      const speed = pointer.y < rect.top + 30 ? -Math.min(18,(rect.top+30-pointer.y)/2) : pointer.y > rect.bottom-30 ? Math.min(18,(pointer.y-rect.bottom+30)/2) : 0;
      if (!speed) return;
      workspace.scrollTop += speed; if (workspace.scrollTop === before) return;
      void move(new PointerEvent('pointermove',{pointerId:pointer.pointer,clientX:pointer.x,clientY:pointer.y,shiftKey:pointer.shift,altKey:pointer.alt,cancelable:true}));
      if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
    }
    function selectFrame(element: HTMLElement) {
      const request = ++sequence.current; remember(element);
      const result = engine!.resolveImageAt(element);
      void result.then(picture => {
        if (request !== sequence.current || !picture || latest.current.engine !== engine) return;
        frameId.current = picture.sdImageId; setImage(picture); latest.current.select(picture.sdImageId); geometry();
      }).catch(() => {});
      return result;
    }
    function down(event: PointerEvent) {
      const target = event.target as Element;
      if (target.closest('.writer-picture-layer,.v2-image-resize-overlay')) return;
      const element = target.closest<HTMLElement>('.writer-engine-mount [data-sd-image-id]');
      if (!element || (!element.matches('img') && !element.querySelector('img'))) {
        if (target.closest('.writer-workspace')) { sequence.current++; latest.current.select(null); setLayoutOpen(false); setCrop(null); }
        return;
      }
      const picture = selectFrame(element), page = element.closest<HTMLElement>('.superdoc-page');
      if (!page || event.button !== 0 || latest.current.blocked || pending.current || engine!.ui?.state.documentMode === 'viewing') return;
      gesture.current = { kind: 'move', pointer: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, active: false, frame: element, box: element.getBoundingClientRect(), page, revision: engine!.snapshot.revision, picture };
    }
    async function move(event: PointerEvent) {
      const g = gesture.current; if (!g || g.pointer !== event.pointerId) return;
      const turn = g.turn = (g.turn || 0) + 1;
      lastPointer = { x:event.clientX,y:event.clientY,pointer:event.pointerId,shift:event.shiftKey,alt:event.altKey };
      g.dx = event.clientX - g.x; g.dy = event.clientY - g.y;
      if (!g.active && Math.hypot(g.dx, g.dy) < 4) return;
      g.active = true; event.preventDefault(); event.stopImmediatePropagation();
      if (g.kind === 'move' && !scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
      const picture = await g.picture; if (!picture || gesture.current !== g || g.turn !== turn) return;
      takeGesture(g);
      if (g.kind === 'crop') {
        const current = g.crop!, remainingX = 100 - current.left - current.right, remainingY = 100 - current.top - current.bottom;
        const next = { ...current };
        if (g.edge!.includes('w')) next.left = clamp(current.left + g.dx / g.box.width * remainingX, 0, 95 - current.right);
        if (g.edge!.includes('e')) next.right = clamp(current.right - g.dx / g.box.width * remainingX, 0, 95 - current.left);
        if (g.edge!.includes('n')) next.top = clamp(current.top + g.dy / g.box.height * remainingY, 0, 95 - current.bottom);
        if (g.edge!.includes('s')) next.bottom = clamp(current.bottom - g.dy / g.box.height * remainingY, 0, 95 - current.top);
        setCrop(next); return;
      }
      if (event.shiftKey) { if (Math.abs(g.dx) >= Math.abs(g.dy)) g.dy = 0; else g.dx = 0; }
      const destination = [...root!.querySelectorAll<HTMLElement>('.writer-engine-mount .superdoc-page')].find(page => { const r=page.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom; }) || g.page;
      g.dropPage = destination;
      const area = destination.getBoundingClientRect(); let left = g.box.left + g.dx, top = g.box.top + g.dy;
      const floating = isFloating(picture); let guideX: number | undefined, guideY: number | undefined;
      if (floating) {
        left = clamp(left, area.left, Math.max(area.left, area.right - g.box.width)); top = clamp(top, area.top, Math.max(area.top, area.bottom - g.box.height));
        if (!event.altKey && Math.abs(left + g.box.width / 2 - (area.left + area.width / 2)) < 5) { left = area.left + (area.width - g.box.width) / 2; guideX = local(area).left + local(area).width / 2; }
        if (!event.altKey && Math.abs(top + g.box.height / 2 - (area.top + area.height / 2)) < 5) { top = area.top + (area.height - g.box.height) / 2; guideY = local(area).top + local(area).height / 2; }
        g.dx = left - g.box.left; g.dy = top - g.box.top;
      } else {
        const hit = await engine!.ui!.viewport.positionAt({ x: event.clientX, y: event.clientY });
        if (gesture.current !== g || g.turn !== turn) return;
        g.target = hit.status === 'resolved' ? hit.target : undefined;
        const rect = g.target ? engine!.ui!.viewport.getRect({ target: g.target }).rect : undefined;
        setCaret(rect ? local({ ...rect, width: 2 }) : null);
      }
      setPreview({ box: local({ left, top, width: g.box.width, height: g.box.height }), source: imageSource(g.frame), floating, crop:cropValues(picture), guideX, guideY });
    }
    async function up(event: PointerEvent) {
      const g = gesture.current; if (!g || g.pointer !== event.pointerId) return;
      gesture.current = null; setPreview(null); setCaret(null);
      cancelAnimationFrame(scrollFrame);scrollFrame=0;
      if (!g.active || g.kind === 'crop') return;
      event.preventDefault(); event.stopImmediatePropagation();
      const viewport=root!.querySelector('.writer-workspace')!.getBoundingClientRect();
      if(event.clientX<viewport.left||event.clientX>viewport.right||event.clientY<viewport.top||event.clientY>viewport.bottom){setStatus('Drag cancelled.');return;}
      await latest.current.perform(async () => {
        const picture = await g.picture; if (!picture || latest.current.engine !== engine) return;
        if (engine!.snapshot.revision !== g.revision) throw new Error('The document changed while dragging. Try the picture again.');
        if (isFloating(picture)) {
          const zoom = engine!.ui!.state.zoom.value / 100, rootScale = root!.getBoundingClientRect().width / root!.offsetWidth || 1, scale = zoom * rootScale;
          const destination = g.dropPage || g.page, area = destination.getBoundingClientRect(), native = picture.properties;
          // Page-based offsets preserve the native unrotated origin after rotation.
          const horizontal = native.anchorData?.hRelativeFrom === 'page' ? native.marginOffset?.horizontal ?? (g.box.left - area.left) / scale : (g.box.left - area.left) / scale;
          const top = native.anchorData?.vRelativeFrom === 'page' ? native.marginOffset?.top ?? (g.box.top - area.top) / scale : (g.box.top - area.top) / scale;
          if (destination !== g.page) {
            const hit = await engine!.ui!.viewport.positionAt({ x:event.clientX,y:event.clientY });
            if(hit.status !== 'resolved')throw new Error('Drop the picture on a document page.');
            const position={ horizontal:Math.max(0,(g.box.left+g.dx-area.left)/scale),top:Math.max(0,(g.box.top+g.dy-area.top)/scale) };
            await engine!.moveImageToSelection(picture.sdImageId,hit.target);
            await engine!.positionImage(picture.sdImageId,position);
          } else await engine!.positionImage(picture.sdImageId, { horizontal: Math.max(0, horizontal + g.dx / scale), top: Math.max(0, top + g.dy / scale) });
        } else {
          const hit = await engine!.ui!.viewport.positionAt({ x: event.clientX, y: event.clientY });
          if (hit.status !== 'resolved') throw new Error('Drop an inline picture in the text. Choose Square in Layout Options to move it freely.');
          await engine!.moveImageToSelection(picture.sdImageId, hit.target);
        }
        await refresh(); setStatus('Picture moved.');
      });
    }
    function doubleClick(event: MouseEvent) { if ((event.target as Element).closest('.writer-engine-mount [data-sd-image-id]')) { event.preventDefault(); latest.current.format(); } }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopImmediatePropagation(); if(gesture.current.kind==='crop')setCrop(null);cancel(); setStatus('Drag cancelled.'); return; }
      if (!(event.target as Element).closest('.writer-engine-mount')) return;
      if (cropDraft.current && ['Escape','Enter'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); if (event.key === 'Enter') void applyCrop(); else setCrop(null); return; }
      if (event.key === 'Escape' && latest.current.selectedId) { setCrop(null); setLayoutOpen(false); latest.current.select(null); return; }
      if (event.key === 'Enter' && (event.target as Element).matches('[data-sd-image-id]')) { event.preventDefault(); (event.target as HTMLElement).click(); void selectFrame(event.target as HTMLElement); return; }
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) && model.current && isFloating(model.current) && !event.altKey && !event.ctrlKey && !event.metaKey && !latest.current.blocked && engine!.ui?.state.documentMode !== 'viewing') {
        event.preventDefault(); event.stopImmediatePropagation();
        const amount = event.shiftKey ? 10 : 1, element = liveFrame(), page = element?.closest('.superdoc-page'); if (!element || !page) return;
        const rect = element.getBoundingClientRect(), bounds = page.getBoundingClientRect(), scale = (engine!.ui!.state.zoom.value / 100) * (root!.getBoundingClientRect().width / root!.offsetWidth || 1);
        void change(async (owner, picture) => { await owner.positionImage(picture.sdImageId, { horizontal: Math.max(0, (rect.left - bounds.left) / scale + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0)), top: Math.max(0, (rect.top - bounds.top) / scale + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0)) }); setStatus('Picture position adjusted.'); });
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && latest.current.selectedId) latest.current.select(null);
    }
    function dragOver(event: DragEvent) { if (event.dataTransfer?.types.includes('Files') && (event.target as Element).closest('.writer-workspace')) { event.preventDefault(); event.dataTransfer.dropEffect = latest.current.blocked || engine!.ui?.state.documentMode === 'viewing' ? 'none' : 'copy'; } }
    function cancelled() { if(!handingOff)cancel(); }
    function drop(event: DragEvent) {
      const files = [...event.dataTransfer?.files || []].filter(file => file.type.startsWith('image/'));
      if (!files.length || !(event.target as Element).closest('.writer-workspace')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void latest.current.perform(async () => {
        if (latest.current.blocked || engine!.ui?.state.documentMode === 'viewing') throw new Error('Switch to Editing to insert a picture.');
        if (files.length>10)throw new Error('Drop up to 10 pictures at a time.');
        const hit = await engine!.ui!.viewport.positionAt({ x: event.clientX, y: event.clientY });
        if (hit.status !== 'resolved') throw new Error('Drop the picture in the document text.');
        assertReceipt(await engine!.ui!.selection.applyAndWait(hit.target));
        for (const file of files) latest.current.select(await insertPicture(engine!, file, { wrap: latest.current.defaultWrap }));
        setStatus(files.length > 1 ? 'Pictures inserted.' : 'Picture inserted.');
      });
    }
    root.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
    root.addEventListener('dblclick', doubleClick, true); root.addEventListener('keydown', key, true); root.addEventListener('dragover', dragOver, true); root.addEventListener('drop', drop, true);
    window.addEventListener('blur', cancel); document.addEventListener('pointercancel', cancelled, true);
    const annotate = () => frames(root!).forEach(element => { element.tabIndex = 0; element.setAttribute('role','img'); element.setAttribute('aria-label', `Picture: ${(element.matches('img') ? element as HTMLImageElement : element.querySelector('img'))?.alt || 'Document picture'}`); });
    annotate(); const a11y = new MutationObserver(annotate); a11y.observe(root.querySelector('.writer-engine-mount')!, { childList: true, subtree: true });
    return () => {
      cancel(); observer.disconnect(); a11y.disconnect(); resize.disconnect(); release?.(); cancelAnimationFrame(geometryFrame.current); geometryFrame.current = 0;
      root.removeEventListener('scroll', geometry, true); window.removeEventListener('resize', geometry); root.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); root.removeEventListener('dblclick', doubleClick, true); root.removeEventListener('keydown', key, true);
      root.removeEventListener('dragover', dragOver, true); root.removeEventListener('drop', drop, true); window.removeEventListener('blur', cancel); document.removeEventListener('pointercancel', cancelled, true);
    };
  }, [props.engine, props.snapshot.ready]);

  function cropDown(event: React.PointerEvent, edge: string) {
    const element = liveFrame(), page = element?.closest<HTMLElement>('.superdoc-page'); if (!element || !page || !image || !crop) return;
    event.preventDefault(); event.stopPropagation();
    gesture.current = { kind: 'crop', pointer: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, active: true, frame: element, page, box: element.getBoundingClientRect(), revision: props.snapshot.revision, picture: Promise.resolve(image), edge, crop: { ...crop } };
  }
  const visible = !props.blocked && props.selectedId && image && box;
  const workspace = props.root.current?.querySelector('.writer-workspace')?.getBoundingClientRect(), visibleArea = workspace && local(workspace);
  const buttonLeft = box && visibleArea ? clamp(box.left + box.width + 9, visibleArea.left + 4, visibleArea.left + visibleArea.width - 34) : 0;
  const buttonTop = box && visibleArea ? clamp(box.top, visibleArea.top + 4, visibleArea.top + visibleArea.height - 34) : 0;
  const popoverHeight = visibleArea ? Math.min(440,visibleArea.height-16) : 440;
  const popoverLeft = visibleArea ? clamp(buttonLeft + 35, visibleArea.left + 8, Math.max(visibleArea.left + 8, visibleArea.left + visibleArea.width - 272)) : 0;
  const popoverTop = visibleArea ? clamp(buttonTop, visibleArea.top + 8, Math.max(visibleArea.top + 8, visibleArea.top + visibleArea.height - popoverHeight - 8)) : 0;
  const choices: Array<[PictureWrap,string]> = [['inline','In Line with Text'],['square','Square'],['topAndBottom','Top and Bottom'],['behind','Behind Text'],['front','In Front of Text']];
  const currentWrap = image && pictureWrap(image) === 'front' && behindText ? 'behind' : image ? pictureWrap(image) : 'inline';
  const baselineCrop = image ? cropValues(image) : { left: 0, top: 0, right: 0, bottom: 0 };
  const inset = crop && image ? { left: (crop.left - baselineCrop.left) / (100 - baselineCrop.left - baselineCrop.right) * 100, right: (crop.right - baselineCrop.right) / (100 - baselineCrop.left - baselineCrop.right) * 100, top: (crop.top - baselineCrop.top) / (100 - baselineCrop.top - baselineCrop.bottom) * 100, bottom: (crop.bottom - baselineCrop.bottom) / (100 - baselineCrop.top - baselineCrop.bottom) * 100 } : null;
  const cropInset = inset ? `${Math.max(0,inset.top)}% ${Math.max(0,inset.right)}% ${Math.max(0,inset.bottom)}% ${Math.max(0,inset.left)}%` : undefined;
  const clip = visibleArea && props.root.current ? `inset(${visibleArea.top}px ${Math.max(0,props.root.current.offsetWidth-visibleArea.left-visibleArea.width)}px ${Math.max(0,props.root.current.offsetHeight-visibleArea.top-visibleArea.height)}px ${visibleArea.left}px)` : undefined;
  const element=liveFrame(),page=element?.closest('.superdoc-page')?.getBoundingClientRect(),painted=element?.getBoundingClientRect();
  const scale=(props.snapshot.state?.zoom.value||100)/100*(props.root.current?props.root.current.getBoundingClientRect().width/props.root.current.offsetWidth:1);
  const position=page&&painted&&image?{horizontal:image.properties.anchorData?.hRelativeFrom==='page'?image.properties.marginOffset?.horizontal??(painted.left-page.left)/scale:(painted.left-page.left)/scale,top:image.properties.anchorData?.vRelativeFrom==='page'?image.properties.marginOffset?.top??(painted.top-page.top)/scale:(painted.top-page.top)/scale}:null;
  return <div className="writer-picture-layer" data-glass-tone={props.systemTheme} data-increase-contrast={props.increaseContrast} data-crop={Boolean(crop)} style={{'--wr-picture-text-scale':props.textScale} as CSSProperties} onKeyDown={event=>{if(event.key==='Escape'&&crop){event.preventDefault();event.stopPropagation();setCrop(null);}}}>
    <span className="wr-picture-status" role="status" aria-live="polite">{status}</span>
    {visible && !preview && <>
      <button ref={layoutButton} className="wr-picture-layout-button glass" aria-label="Layout Options" aria-expanded={layoutOpen} aria-haspopup="dialog" style={{ left: buttonLeft, top: buttonTop }} onClick={() => { setCrop(null); setLayoutOpen(value => !value); }}><LayoutPanelTop size={19}/></button>
      {layoutOpen && <section ref={popover} role="dialog" aria-label="Layout Options" className="wr-picture-layout-popover glass" style={{ left: popoverLeft, top: popoverTop,maxHeight:popoverHeight }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLayoutOpen(false); layoutButton.current?.focus(); } }}>
        <header><strong>Layout Options</strong><button aria-label="Close Layout Options" onClick={() => { setLayoutOpen(false); layoutButton.current?.focus(); }}><X size={14}/></button></header>
        <div className="wr-picture-wrap-choices">{choices.map(([value,label]) => <button key={value} disabled={!editable || busy} aria-pressed={currentWrap === value} onClick={() => void change(async (owner,picture) => { await setPictureWrap(owner,picture.sdImageId,value); setStatus(`${label} applied.`); })}><span className={`wr-picture-wrap-symbol wr-wrap-${value}`} aria-hidden><i/><i/><i/><b/></span><span>{label}</span>{currentWrap === value && <Check size={13}/>}</button>)}</div>
        <p>{isFloating(image) ? 'Drag the picture to position it. Arrow keys nudge; Shift moves farther.' : 'Inline pictures move with the text. Drag to a text position, or choose Square to place freely.'}</p>
        {isFloating(image)&&position&&<PositionControls key={image.sdImageId} {...position} unit={props.unit} disabled={!editable||busy} apply={position=>change((owner,picture)=>owner.positionImage(picture.sdImageId,position))}/>}
        <div className="wr-picture-tools"><button disabled={!editable || busy} onClick={startCrop}><Crop size={15}/>Crop picture</button><button onClick={() => { setLayoutOpen(false); props.format(); }}>Picture Properties…</button></div>
      </section>}
      {crop && inset && <>
        <div className="wr-picture-document-clip" style={{clipPath:clip}}><div className="wr-picture-crop-box" style={{ ...box }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void applyCrop(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setCrop(null); } }}>
          <div className="wr-picture-crop-mask"><div style={{inset:cropInset}}/></div>
          <div className="wr-picture-crop-window" style={{ inset:cropInset }}>{['nw','n','ne','e','se','s','sw','w'].map(edge => <button key={edge} className={`wr-picture-crop-handle wr-crop-${edge}`} aria-label={`Crop picture ${edge}`} onPointerDown={event => cropDown(event,edge)} onKeyDown={event => {
            if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
            event.preventDefault();const next={...crop},amount=event.shiftKey?5:1;
            if(edge.includes('w')&&['ArrowLeft','ArrowRight'].includes(event.key))next.left=clamp(next.left+(event.key==='ArrowRight'?amount:-amount),0,95-next.right);
            if(edge.includes('e')&&['ArrowLeft','ArrowRight'].includes(event.key))next.right=clamp(next.right+(event.key==='ArrowLeft'?amount:-amount),0,95-next.left);
            if(edge.includes('n')&&['ArrowUp','ArrowDown'].includes(event.key))next.top=clamp(next.top+(event.key==='ArrowDown'?amount:-amount),0,95-next.bottom);
            if(edge.includes('s')&&['ArrowUp','ArrowDown'].includes(event.key))next.bottom=clamp(next.bottom+(event.key==='ArrowUp'?amount:-amount),0,95-next.top);
            setCrop(next);
          }}/>)}</div>
        </div></div>
        <div className="wr-picture-crop-toolbar glass" role="toolbar" aria-label="Crop picture" style={{ left:Math.max((visibleArea?.left||0)+8,Math.min(box.left,(visibleArea?.left||0)+(visibleArea?.width||800)-300*props.textScale)),maxWidth:Math.max(160,(visibleArea?.width||800)-16),top: Math.max(visibleArea?.top || 0, box.top - 40*props.textScale) }}><strong>Crop</strong><button disabled={busy} onClick={() => void applyCrop()}><Check size={14}/>Done</button><button onClick={() => setCrop(null)}>Cancel</button><button disabled={busy} onClick={() => setCrop({ left:0,right:0,top:0,bottom:0 })}>Reset</button></div>
      </>}
    </>}
    {preview && <div className="wr-picture-document-clip" style={{clipPath:clip}}>
      <div className="wr-picture-drag-preview" style={preview.box}>{preview.source && <div className="wr-picture-drag-content"><img src={preview.source} alt="" style={{ position:'absolute',maxWidth:'none',width:`${10000/(100-preview.crop.left-preview.crop.right)}%`,height:`${10000/(100-preview.crop.top-preview.crop.bottom)}%`,left:`${-preview.crop.left*100/(100-preview.crop.left-preview.crop.right)}%`,top:`${-preview.crop.top*100/(100-preview.crop.top-preview.crop.bottom)}%` }}/></div>}<span>{preview.floating ? 'Move picture · Esc to cancel' : 'Drop in text · Esc to cancel'}</span></div>
      {preview.guideX !== undefined && visibleArea && <i className="wr-picture-guide vertical" style={{ left: preview.guideX, top: visibleArea.top, height: visibleArea.height }}/>} 
      {preview.guideY !== undefined && visibleArea && <i className="wr-picture-guide horizontal" style={{ top: preview.guideY, left: visibleArea.left, width: visibleArea.width }}/>} 
    </div>}
    {caret && <div className="wr-picture-document-clip" style={{clipPath:clip}}><i className="wr-picture-drop-caret" style={caret}/></div>}
  </div>;
});
