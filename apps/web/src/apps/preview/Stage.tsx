import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { box, drawShapes, fonts, handles, hitTest, measureText, moveShape, resizeShape, shapeBounds, type Handle, type Shape, type Style } from './markup';
import { floodMask, maskOverlay, regionPath, type Rect, type Region } from './raster';

export type Tool = 'select' | 'ellipse' | 'lasso' | 'alpha' | 'pen';
export interface AlphaPreview { x: number; y: number; tolerance: number; overlay: HTMLCanvasElement }
export interface StageProps {
  docId: string; raster: HTMLCanvasElement; display: HTMLCanvasElement | null; live: string | null;
  shapes: Shape[]; zoom: number; tool: Tool; style: Style; checkerboard: boolean;
  selection: Region | null; selectedShape: string | null; editingText: string | null; alpha: AlphaPreview | null;
  onZoom(zoom: number, anchor?: { clientX: number; clientY: number }): void;
  onViewport(size: { width: number; height: number }): void;
  onSelection(region: Region | null): void; onSelectShape(id: string | null): void;
  onShapes(shapes: Shape[]): void; onEditText(id: string | null): void; onAlpha(alpha: AlphaPreview | null): void;
  /** Lets the app place new annotations in view and center on a point after zooming. */
  api: { current: StageApi | null };
  center: { x: number; y: number; key: number } | null;
}
export interface StageApi { visibleRect(): Rect }
type Drag =
  | { mode: 'pen'; shape: Shape }
  | { mode: 'move'; id: string; start: { x: number; y: number }; origin: Shape[]; moved: boolean }
  | { mode: 'resize'; id: string; handle: Handle; origin: Shape[] }
  | { mode: 'region'; kind: Region['kind']; start: { x: number; y: number }; points: number[] }
  | { mode: 'region-move'; start: { x: number; y: number }; origin: Region }
  | { mode: 'region-resize'; handle: Handle; origin: Region }
  | { mode: 'alpha'; clientX: number; clientY: number; seed: { x: number; y: number } };
const corner = (r: Rect): { id: Handle; x: number; y: number }[] => [{ id: 'nw', x: r.x, y: r.y }, { id: 'ne', x: r.x + r.w, y: r.y }, { id: 'sw', x: r.x, y: r.y + r.h }, { id: 'se', x: r.x + r.w, y: r.y + r.h }];
const cursorFor = (handle: Handle) => handle === 'nw' || handle === 'se' ? 'nwse-resize' : handle === 'ne' || handle === 'sw' ? 'nesw-resize' : 'move';
const normal = (x1: number, y1: number, x2: number, y2: number): Rect => ({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });

export function Stage(props: StageProps) {
  const { raster, zoom, shapes } = props, width = raster.width, height = raster.height;
  const scroller = useRef<HTMLDivElement>(null), imageBox = useRef<HTMLDivElement>(null), holder = useRef<HTMLDivElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<Shape[] | null>(null);
  const [cursor, setCursor] = useState('default');
  const [text, setText] = useState('');
  const drag = useRef<Drag | null>(null), anchor = useRef<{ x: number; y: number } | null>(null);
  const metrics = useRef({ doc: '', zoom, left: 0, top: 0, scrollLeft: 0, scrollTop: 0 });
  const alphaSource = useRef<{ raster: HTMLCanvasElement; image: ImageData; scale: number } | null>(null);
  const frame = useRef(0), latest = useRef(props); latest.current = props;
  const visible = draft ?? shapes;
  const editing = props.editingText ? visible.find(shape => shape.id === props.editingText) : undefined;

  function paint() {
    const canvas = overlay.current, view = scroller.current, target = imageBox.current; if (!canvas || !view || !target) return;
    const p = latest.current, dpr = window.devicePixelRatio || 1, w = view.clientWidth, h = view.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
    const context = canvas.getContext('2d')!; context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
    const z = p.zoom, ox = target.offsetLeft - view.scrollLeft, oy = target.offsetTop - view.scrollTop;
    context.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    context.save(); context.beginPath(); context.rect(0, 0, p.raster.width, p.raster.height); context.clip();
    drawShapes(context, (drag.current?.mode === 'pen' ? [...(latestDraft.current ?? p.shapes), drag.current.shape] : latestDraft.current ?? p.shapes).filter(shape => shape.id !== p.editingText));
    if (p.alpha) { context.imageSmoothingEnabled = false; context.drawImage(p.alpha.overlay, 0, 0, p.raster.width, p.raster.height); }
    context.restore();
    const unit = 1 / z;
    if (p.selection) {
      const path = regionPath(p.selection); context.lineWidth = unit;
      context.setLineDash([5 * unit, 4 * unit]); context.strokeStyle = '#000'; context.stroke(path);
      context.lineDashOffset = 5 * unit; context.strokeStyle = '#fff'; context.stroke(path); context.setLineDash([]); context.lineDashOffset = 0;
      if (p.selection.kind !== 'lasso') for (const handle of corner(p.selection.rect)) { context.fillStyle = '#fff'; context.strokeStyle = '#555'; context.beginPath(); context.arc(handle.x, handle.y, 4 * unit, 0, Math.PI * 2); context.fill(); context.stroke(); }
    }
    const selected = (latestDraft.current ?? p.shapes).find(shape => shape.id === p.selectedShape);
    if (selected && selected.id !== p.editingText) {
      const b = shapeBounds(selected), accent = getComputedStyle(view).getPropertyValue('--accent').trim() || '#167bac', pad = 3 * unit;
      context.lineWidth = unit; context.strokeStyle = accent; context.setLineDash([3 * unit, 3 * unit]); context.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2); context.setLineDash([]);
      for (const handle of handles(selected)) { context.fillStyle = '#fff'; context.strokeStyle = accent; context.lineWidth = 1.5 * unit; context.beginPath(); context.arc(handle.x, handle.y, 4.5 * unit, 0, Math.PI * 2); context.fill(); context.stroke(); }
    }
  }
  const latestDraft = useRef<Shape[] | null>(null); latestDraft.current = draft;
  const schedule = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(paint); };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(schedule);

  // The raster canvas itself is mounted, so large images are never copied for display.
  useLayoutEffect(() => {
    const node = props.display ?? raster, element = holder.current; if (!element) return;
    node.className = 'preview-raster'; element.replaceChildren(node);
  }, [props.display, raster]);
  useLayoutEffect(() => {
    const view = scroller.current, target = imageBox.current; if (!view || !target) return;
    const m = metrics.current;
    if (m.doc !== props.docId) { view.scrollLeft = (view.scrollWidth - view.clientWidth) / 2; view.scrollTop = (view.scrollHeight - view.clientHeight) / 2; }
    else if (m.zoom !== zoom) {
      const point = anchor.current ?? { x: view.clientWidth / 2, y: view.clientHeight / 2 };
      const ix = (m.scrollLeft + point.x - m.left) / m.zoom, iy = (m.scrollTop + point.y - m.top) / m.zoom;
      view.scrollLeft = target.offsetLeft + ix * zoom - point.x; view.scrollTop = target.offsetTop + iy * zoom - point.y;
    }
    anchor.current = null;
    metrics.current = { doc: props.docId, zoom, left: target.offsetLeft, top: target.offsetTop, scrollLeft: view.scrollLeft, scrollTop: view.scrollTop };
    paint();
  }, [zoom, width, height, props.docId]);
  useLayoutEffect(() => {
    const view = scroller.current, target = imageBox.current, center = props.center; if (!view || !target || !center) return;
    view.scrollLeft = target.offsetLeft + center.x * zoom - view.clientWidth / 2; view.scrollTop = target.offsetTop + center.y * zoom - view.clientHeight / 2;
    metrics.current.scrollLeft = view.scrollLeft; metrics.current.scrollTop = view.scrollTop; schedule();
  }, [props.center?.key]);
  props.api.current = {
    visibleRect() {
      const view = scroller.current, target = imageBox.current, z = latest.current.zoom;
      if (!view || !target) return { x: 0, y: 0, w: width, h: height };
      const x = Math.max(0, (view.scrollLeft - target.offsetLeft) / z), y = Math.max(0, (view.scrollTop - target.offsetTop) / z);
      return { x, y, w: Math.min(width, (view.scrollLeft - target.offsetLeft + view.clientWidth) / z) - x, h: Math.min(height, (view.scrollTop - target.offsetTop + view.clientHeight) / z) - y };
    },
  };
  useEffect(() => {
    const view = scroller.current; if (!view) return;
    const observer = new ResizeObserver(() => { latest.current.onViewport({ width: view.clientWidth, height: view.clientHeight }); schedule(); });
    observer.observe(view);
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = view.getBoundingClientRect(), scale = view.offsetWidth / rect.width;
      anchor.current = { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      latest.current.onZoom(latest.current.zoom * Math.exp(-delta * (event.ctrlKey && !event.metaKey ? 0.01 : 0.0025)));
    };
    view.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); view.removeEventListener('wheel', wheel); };
  }, []);
  const finished = useRef<string | null>(null);
  useEffect(() => { if (editing) { setText(editing.text ?? ''); finished.current = null; } }, [props.editingText]);

  const toImage = (event: { clientX: number; clientY: number }) => {
    const rect = imageBox.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height, scale: rect.width / width };
  };
  function computeAlpha(seed: { x: number; y: number }, tolerance: number) {
    if (alphaSource.current?.raster !== raster) {
      const scale = Math.min(1, Math.sqrt(1_500_000 / (width * height))), w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      const small = document.createElement('canvas'); small.width = w; small.height = h; const context = small.getContext('2d', { willReadFrequently: true })!; context.drawImage(raster, 0, 0, w, h);
      alphaSource.current = { raster, image: context.getImageData(0, 0, w, h), scale };
    }
    const source = alphaSource.current, sx = Math.min(source.image.width - 1, Math.max(0, Math.floor(seed.x * source.scale))), sy = Math.min(source.image.height - 1, Math.max(0, Math.floor(seed.y * source.scale)));
    const mask = floodMask(source.image, sx, sy, tolerance), p = (sy * source.image.width + sx) * 4, d = source.image.data;
    props.onAlpha({ x: seed.x, y: seed.y, tolerance, overlay: maskOverlay(mask, source.image.width, source.image.height, [d[p], d[p + 1], d[p + 2]]) });
  }
  function regionHandle(point: { x: number; y: number }, slack: number) {
    const region = props.selection; if (!region || region.kind === 'lasso') return undefined;
    return corner(region.rect).find(handle => Math.hypot(handle.x - point.x, handle.y - point.y) <= slack)?.id;
  }
  const insideRegion = (point: { x: number; y: number }) => { const r = props.selection?.rect; return !!r && point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h; };
  function shapeHandle(point: { x: number; y: number }, slack: number) {
    const selected = visible.find(shape => shape.id === props.selectedShape); if (!selected) return undefined;
    return handles(selected).find(handle => Math.hypot(handle.x - point.x, handle.y - point.y) <= slack)?.id;
  }

  function pointerDown(event: React.PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.preview-text-editor')) return;
    if (props.editingText) { finishText(); return; }
    const p = toImage(event), slack = 7 / p.scale, view = scroller.current!;
    if (event.target === view && (event.nativeEvent.offsetX > view.clientWidth || event.nativeEvent.offsetY > view.clientHeight)) return; // Scroll bars.
    view.setPointerCapture(event.pointerId); view.focus({ preventScroll: true });
    if (props.tool === 'pen') {
      props.onSelectShape(null);
      drag.current = { mode: 'pen', shape: { id: crypto.randomUUID(), kind: 'pen', x1: p.x, y1: p.y, x2: p.x, y2: p.y, points: [p.x, p.y], stroke: props.style.stroke, fill: null, width: props.style.width } };
      schedule(); return;
    }
    if (props.tool === 'alpha') { drag.current = { mode: 'alpha', clientX: event.clientX, clientY: event.clientY, seed: p }; computeAlpha(p, 18); return; }
    const handle = shapeHandle(p, slack);
    if (handle && props.selectedShape) { drag.current = { mode: 'resize', id: props.selectedShape, handle, origin: shapes }; return; }
    const hit = hitTest(shapes, p.x, p.y, slack);
    if (hit) {
      props.onSelectShape(hit.id);
      if (event.detail >= 2 && hit.kind === 'text') { props.onEditText(hit.id); return; }
      drag.current = { mode: 'move', id: hit.id, start: p, origin: shapes, moved: false }; return;
    }
    props.onSelectShape(null);
    const regionCorner = regionHandle(p, slack);
    if (regionCorner && props.selection) { drag.current = { mode: 'region-resize', handle: regionCorner, origin: props.selection }; return; }
    if (props.selection && insideRegion(p)) { drag.current = { mode: 'region-move', start: p, origin: props.selection }; return; }
    props.onSelection(null);
    drag.current = { mode: 'region', kind: props.tool === 'ellipse' ? 'ellipse' : props.tool === 'lasso' ? 'lasso' : 'rect', start: p, points: [p.x, p.y] };
  }
  function pointerMove(event: React.PointerEvent) {
    const current = drag.current, p = toImage(event), slack = 7 / p.scale;
    if (!current) {
      if (props.tool === 'pen' || props.tool === 'alpha') { setCursor('crosshair'); return; }
      const handle = shapeHandle(p, slack) ?? regionHandle(p, slack);
      setCursor(handle ? cursorFor(handle) : hitTest(shapes, p.x, p.y, slack) ? 'move' : insideRegion(p) ? 'move' : 'crosshair'); return;
    }
    if (current.mode === 'pen') {
      const points = current.shape.points!, lx = points[points.length - 2], ly = points[points.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) * p.scale >= 1.5) { points.push(p.x, p.y); schedule(); }
    } else if (current.mode === 'move') {
      const dx = p.x - current.start.x, dy = p.y - current.start.y; current.moved ||= Math.hypot(dx, dy) * p.scale > 1;
      if (current.moved) setDraft(current.origin.map(shape => shape.id === current.id ? moveShape(shape, dx, dy) : shape));
    } else if (current.mode === 'resize') {
      setDraft(current.origin.map(shape => shape.id === current.id ? resizeShape(shape, current.handle, p.x, p.y, event.shiftKey) : shape));
    } else if (current.mode === 'region') {
      if (current.kind === 'lasso') {
        current.points.push(p.x, p.y); const xs = current.points.filter((_, i) => i % 2 === 0), ys = current.points.filter((_, i) => i % 2);
        props.onSelection({ kind: 'lasso', points: [...current.points], rect: normal(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)) });
      } else {
        let x2 = p.x, y2 = p.y;
        if (event.shiftKey) { const size = Math.max(Math.abs(x2 - current.start.x), Math.abs(y2 - current.start.y)); x2 = current.start.x + Math.sign(x2 - current.start.x || 1) * size; y2 = current.start.y + Math.sign(y2 - current.start.y || 1) * size; }
        const rect = normal(Math.max(0, Math.min(width, current.start.x)), Math.max(0, Math.min(height, current.start.y)), Math.max(0, Math.min(width, x2)), Math.max(0, Math.min(height, y2)));
        props.onSelection({ kind: current.kind, rect });
      }
    } else if (current.mode === 'region-move') {
      const r = current.origin.rect, dx = Math.max(-r.x, Math.min(width - r.x - r.w, p.x - current.start.x)), dy = Math.max(-r.y, Math.min(height - r.y - r.h, p.y - current.start.y));
      props.onSelection(current.origin.kind === 'lasso' ? { kind: 'lasso', rect: { ...r, x: r.x + dx, y: r.y + dy }, points: current.origin.points.map((v, i) => v + (i % 2 ? dy : dx)) } : { kind: current.origin.kind, rect: { ...r, x: r.x + dx, y: r.y + dy } });
    } else if (current.mode === 'region-resize' && current.origin.kind !== 'lasso') {
      const r = current.origin.rect, fx = current.handle.includes('w') ? r.x + r.w : r.x, fy = current.handle.startsWith('n') ? r.y + r.h : r.y;
      props.onSelection({ kind: current.origin.kind, rect: normal(fx, fy, Math.max(0, Math.min(width, p.x)), Math.max(0, Math.min(height, p.y))) });
    } else if (current.mode === 'alpha') {
      const distance = Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY), tolerance = Math.min(255, 18 + distance * 0.75);
      cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => computeAlpha(current.seed, tolerance));
    }
  }
  function pointerUp(event: React.PointerEvent) {
    const current = drag.current; drag.current = null;
    if (scroller.current?.hasPointerCapture(event.pointerId)) scroller.current.releasePointerCapture(event.pointerId);
    if (!current) return;
    if (current.mode === 'pen') { const shape = current.shape, b = shapeBounds(shape); props.onShapes([...shapes, { ...shape, x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h }]); props.onSelectShape(null); }
    else if ((current.mode === 'move' && current.moved || current.mode === 'resize') && draft) props.onShapes(draft);
    else if (current.mode === 'region') {
      const region = props.selection, scale = toImage(event).scale;
      if (!region || region.rect.w * scale < 3 || region.rect.h * scale < 3 || region.kind === 'lasso' && region.points.length < 6) props.onSelection(null);
    }
    setDraft(null);
  }
  function finishText() {
    const id = props.editingText; if (!id || finished.current === id) return;
    finished.current = id;
    const shape = shapes.find(item => item.id === id);
    props.onEditText(null);
    if (!shape) return;
    if (!text.trim()) props.onShapes(shapes.filter(item => item.id !== id));
    else if (text !== shape.text) props.onShapes(shapes.map(item => item.id === id ? measureText({ ...item, text }) : item));
  }
  const editBox = editing ? box(measureText({ ...editing, text: text || ' ' })) : null;
  const textStyle: CSSProperties | undefined = editing && editBox ? {
    left: editBox.x * zoom, top: editBox.y * zoom, width: (editBox.w + (editing.size ?? 28)) * zoom, height: editBox.h * zoom,
    font: `${editing.bold ? 'bold ' : ''}${(editing.size ?? 28) * zoom}px ${fonts[editing.font ?? 'system'].family}`, color: editing.stroke,
    padding: `${(editing.size ?? 28) * 0.2 * zoom}px ${(editing.size ?? 28) * 0.25 * zoom}px`, lineHeight: 1.25, textAlign: editing.align ?? 'left',
    background: editing.fill ?? 'transparent',
  } : undefined;
  return <div className="preview-stage">
    <div ref={scroller} className="preview-scroller" tabIndex={-1} style={{ cursor }} aria-label="Image" role="img"
      onScroll={() => { const view = scroller.current!; metrics.current.scrollLeft = view.scrollLeft; metrics.current.scrollTop = view.scrollTop; schedule(); }}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <div className="preview-content">
        <div ref={imageBox} className={`preview-image ${props.checkerboard ? 'checkerboard' : ''} ${zoom >= 3 ? 'pixelated' : ''}`} style={{ width: width * zoom, height: height * zoom }}>
          {props.live && !props.display && <img className="preview-raster" src={props.live} alt="" draggable={false}/>}
          <div ref={holder} className="preview-holder" hidden={!!props.live && !props.display}/>
          {editing && textStyle && <textarea className="preview-text-editor" autoFocus spellCheck={false} value={text} style={textStyle} aria-label="Text annotation"
            onChange={event => setText(event.target.value)} onFocus={event => event.currentTarget.select()}
            onBlur={finishText}
            onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' || event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finishText(); } }}/>}
        </div>
      </div>
    </div>
    <canvas ref={overlay} className="preview-overlay" aria-hidden="true"/>
  </div>;
}
