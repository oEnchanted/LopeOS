import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, FolderOpen, ImageIcon, Info, PanelLeft, Pause, PenTool, Play, RotateCcw, Share, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { AppContext } from '../../../../../packages/contracts/src';
import { Button, Dialog } from '../../../../../packages/ui/src';
import { photoExtensions } from '../../../../../packages/photo-engine/src/formats';
import { imageEditorManifest } from '../image-editor/manifest';
import { baseName, errorCode, errorMessage, formatBytes, parentPath, useAppCommands, usePreference } from '../hooks';
import { defaultExtension, extensionOf, formatById, previewExtensions, readableFormats, type ImageFormat } from './formats';
import { encode } from './encoders';
import { defaultStyle, drawShapes, measureText, moveShape, shapeLabels, type Shape, type ShapeKind, type Style } from './markup';
import { openImage } from './open';
import { adjustCanvas, adjustPixels, canvas, clearRegion, context2d, crop, flatten, flip, floodMask, fromSource, hasTransparency, isNeutral, neutralAdjust, pixelsOf, removeMasked, resample, resize, rotate, type ColorAdjust, type Edit, type Region } from './raster';
import { Stage, type AlphaPreview, type StageApi, type Tool } from './Stage';
import { AdjustColorPanel, AdjustSizeDialog, ExportDialog, Inspector, MarkupBar, type ExportChoice } from './panels';
import '../application.css';
import './preview.css';

interface PreviewDoc {
  id: string; name: string; path?: string; version?: string; size?: number; modified?: string;
  format: ImageFormat; live?: string; original: HTMLCanvasElement; animated: boolean;
  current: Edit; saved: Edit; past: Edit[]; future: Edit[];
  details: [string, string][]; exif: [string, string][]; dpi: number;
}
const HISTORY = 40, MIN_ZOOM = 0.02, MAX_ZOOM = 32, FILE_DRAG_TYPE = 'application/x-lope-files';
const UNSAVED: Edit = { raster: document.createElement('canvas'), shapes: [] };
const dirtyOf = (doc: PreviewDoc) => doc.current.raster !== doc.saved.raster || doc.current.shapes !== doc.saved.shapes;
const pristine = (doc: PreviewDoc) => doc.current.raster === doc.original && !doc.current.shapes.length;
const stem = (name: string) => name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
const isConflict = (cause: unknown) => errorCode(cause) === 'CONFLICT' || /already exists|conflict|changed/i.test(errorMessage(cause));
const toBlob = (source: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => source.toBlob(blob => blob ? resolve(blob) : reject(new Error('The image couldn’t be copied.')), 'image/png'));
const canOpenIn = (extensions: string[] | undefined, doc?: PreviewDoc) => !!doc?.path && !!extensions?.includes('.' + extensionOf(doc.path));

export default function Preview({ context }: { context: AppContext }) {
  const fs = context.services.files;
  const [docs, setDocs] = useState<PreviewDoc[]>([]);
  const docsRef = useRef(docs);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const [loading, setLoading] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [zoom, setZoomState] = useState(1);
  const [fit, setFit] = useState<'none' | 'shrink' | 'fit'>('shrink');
  const [viewport, setViewport] = useState({ width: 800, height: 600 });
  const [center, setCenter] = useState<{ x: number; y: number; key: number } | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [style, setStyle] = usePreference<Style>(context, 'preview.markupStyle', defaultStyle);
  const [sidebar, setSidebar] = usePreference(context, 'preview.sidebar', true);
  const [markup, setMarkup] = usePreference(context, 'preview.markup', false);
  const [checkerboard, setCheckerboard] = usePreference(context, 'preview.checkerboard', true);
  const [inspector, setInspector] = useState(false);
  const [selection, setSelection] = useState<Region | null>(null);
  const [inverted, setInverted] = useState(false);
  const [selectedShape, setSelectedShape] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [alpha, setAlpha] = useState<AlphaPreview | null>(null);
  const [adjust, setAdjust] = useState<{ value: ColorAdjust; source: ImageData; preview: HTMLCanvasElement; previewData: ImageData } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [sizing, setSizing] = useState(false);
  const [exporting, setExporting] = useState<{ id: string; title: string; initial: ImageFormat; resolve(saved: boolean): void } | null>(null);
  const [guard, setGuard] = useState<{ ids: string[]; resolve(proceed: boolean): void } | null>(null);
  const [overwrite, setOverwrite] = useState<{ path: string; resolve(ok: boolean): void } | null>(null);
  const [slideshow, setSlideshow] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const root = useRef<HTMLDivElement>(null), stageApi = useRef<StageApi | null>(null), shapeClipboard = useRef<Shape | null>(null), adjustFrame = useRef(0), alive = useRef(true), working = useRef(false);
  const doc = docs.find(item => item.id === activeId);
  const dirty = doc ? dirtyOf(doc) : false;
  const shapes = doc?.current.shapes ?? [];
  const selected = shapes.find(shape => shape.id === selectedShape);
  const scale = Math.max(1, 1 / zoom); // New markup keeps a consistent on-screen size on large photos.

  function mutate(change: (list: PreviewDoc[]) => PreviewDoc[]) { docsRef.current = change(docsRef.current); setDocs(docsRef.current); }
  const find = (id: string) => docsRef.current.find(item => item.id === id);
  function commit(next: Edit, id = activeRef.current) {
    if (!id) return;
    mutate(list => list.map(item => item.id === id ? { ...item, past: [...item.past.slice(-(HISTORY - 1)), item.current], future: [], current: next } : item));
  }
  function setShapes(next: Shape[]) { const current = doc && find(doc.id); if (current) commit({ raster: current.current.raster, shapes: next }); }
  function step(direction: 'undo' | 'redo') {
    const id = activeRef.current, item = id && find(id); if (!item) return;
    const from = direction === 'undo' ? item.past : item.future; if (!from.length) return;
    const target = from[from.length - 1];
    mutate(list => list.map(d => d.id !== id ? d : direction === 'undo' ? { ...d, current: target, past: d.past.slice(0, -1), future: [...d.future, d.current] } : { ...d, current: target, future: d.future.slice(0, -1), past: [...d.past, d.current] }));
    if (target.raster.width !== item.current.raster.width || target.raster.height !== item.current.raster.height) { setSelection(null); setFit('shrink'); }
    setSelectedShape(null); setEditingText(null);
  }
  function resetInteraction() { setSelection(null); setInverted(false); setSelectedShape(null); setEditingText(null); setAlpha(null); setAdjust(null); }
  function activate(id: string | null) { if (id === activeRef.current) return; resetInteraction(); setActiveId(id); activeRef.current = id; setFit('shrink'); }

  // ---------- Opening ----------
  async function addDoc(bytes: Uint8Array, name: string, meta: Partial<PreviewDoc>, select: boolean, unsaved = false) {
    const opened = await openImage(bytes, name);
    if (!alive.current) return;
    const snapshot: Edit = { raster: opened.raster, shapes: [] };
    const item: PreviewDoc = { id: crypto.randomUUID(), name, format: opened.format, live: opened.live ? URL.createObjectURL(opened.live) : undefined, original: opened.raster, animated: opened.animated,
      current: snapshot, saved: unsaved ? UNSAVED : snapshot, past: [], future: [], details: opened.details, exif: opened.exif, dpi: opened.dpi ?? 72, size: bytes.byteLength, ...meta };
    mutate(list => [...list, item]);
    if (select || !activeRef.current) activate(item.id);
  }
  async function openPath(path: string, select = true) {
    const existing = docsRef.current.find(item => item.path === path);
    if (existing) { if (select) activate(existing.id); return; }
    setLoading(n => n + 1); setError('');
    try {
      if (!fs.readBinary) throw new Error('Reading images is unavailable in this workspace.');
      const [file, entry] = await Promise.all([fs.readBinary(path), fs.stat(path).catch(() => null)]);
      await addDoc(file.data, baseName(path), { path, version: file.version, size: entry?.size ?? file.data.byteLength, modified: entry?.modified }, select);
    } catch (cause) { if (alive.current) setError(`“${baseName(path)}” couldn’t be opened. ${errorMessage(cause)}`); }
    finally { if (alive.current) setLoading(n => n - 1); }
  }
  async function openDialog() {
    try { const path = await context.services.dialogs.openFile({ extensions: previewExtensions }); if (path) await openPath(path); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  async function openFiles(files: File[]) {
    for (const file of files) {
      setLoading(n => n + 1);
      try { await addDoc(new Uint8Array(await file.arrayBuffer()), file.name, { modified: new Date(file.lastModified).toISOString() }, true); }
      catch (cause) { setError(`“${file.name}” couldn’t be opened. ${errorMessage(cause)}`); }
      finally { setLoading(n => n - 1); }
    }
  }
  async function clipboardImage(): Promise<Blob> {
    if (!navigator.clipboard?.read) throw new Error('This browser doesn’t allow reading images from the clipboard.');
    const items = await navigator.clipboard.read();
    for (const item of items) { const type = item.types.find(t => t.startsWith('image/')); if (type) return item.getType(type); }
    throw new Error('The clipboard doesn’t contain an image.');
  }
  async function newFromClipboard() {
    try { const blob = await clipboardImage(); await addDoc(new Uint8Array(await blob.arrayBuffer()), `Untitled ${docsRef.current.filter(d => !d.path).length + 1}.png`, {}, true, true); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  // Restore the images this window had open; otherwise open what the window was launched with.
  const requested = typeof context.launchArgs.path === 'string' ? context.launchArgs.path : '';
  const requestedPaths = Array.isArray(context.launchArgs.paths) ? context.launchArgs.paths.filter((p): p is string => typeof p === 'string') : [];
  const sessionKey = `preview.window.${context.windowId}`;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; started.current = true;
    const record = context.services.settings.get<{ launch: string; paths: string[]; active?: string } | null>(sessionKey, null);
    const paths = record && record.launch === requested && Array.isArray(record.paths) && record.paths.length ? record.paths : [...new Set([requested, ...requestedPaths].filter(Boolean))];
    void (async () => { for (const path of paths) await openPath(path, path === (record?.active ?? paths[0])); })();
  }, []);
  useEffect(() => { if (started.current && requested && docsRef.current.length) void openPath(requested); }, [requested]);
  useEffect(() => {
    if (!started.current || loading) return;
    try { context.services.settings.set(sessionKey, { launch: requested, paths: docs.map(d => d.path).filter(Boolean), active: doc?.path }); } catch { /* Session restoration is best-effort. */ }
  }, [docs.map(d => d.path).join('|'), doc?.path, loading]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; docsRef.current.forEach(d => d.live && URL.revokeObjectURL(d.live)); }; }, []);

  // ---------- Title, thumbnails, zoom ----------
  useEffect(() => { context.lifecycle.setTitle(doc ? `${doc.name}${dirty ? ' — Edited' : ''}` : 'Preview'); }, [doc?.name, dirty, context.lifecycle]);
  const thumbSource = useRef(new Map<string, Edit>());
  useEffect(() => {
    const timer = setTimeout(() => {
      const next: Record<string, string> = {}; let changed = false;
      for (const item of docsRef.current) {
        if (thumbSource.current.get(item.id) === item.current && thumbs[item.id]) { next[item.id] = thumbs[item.id]; continue; }
        next[item.id] = thumbnail(item.current); thumbSource.current.set(item.id, item.current); changed = true;
      }
      if (changed || Object.keys(thumbs).length !== Object.keys(next).length) setThumbs(next);
    }, 120);
    return () => clearTimeout(timer);
  }, [docs]);
  const fitZoom = (item: PreviewDoc, enlarge: boolean) => {
    const { width, height } = item.current.raster, z = Math.min((viewport.width - 48) / width, (viewport.height - 48) / height);
    return clampZoom(enlarge ? z : Math.min(1, z));
  };
  useEffect(() => { if (doc && fit !== 'none') setZoomState(fitZoom(doc, fit === 'fit')); }, [fit, doc?.id, doc?.current.raster, viewport.width, viewport.height]);
  const setZoom = (value: number) => { setFit('none'); setZoomState(clampZoom(value)); };
  function zoomToSelection() {
    if (!doc) return;
    const r = selection?.rect ?? (selected ? { x: Math.min(selected.x1, selected.x2), y: Math.min(selected.y1, selected.y2), w: Math.abs(selected.x2 - selected.x1), h: Math.abs(selected.y2 - selected.y1) } : null);
    if (!r || r.w < 1 || r.h < 1) return;
    const z = clampZoom(Math.min((viewport.width - 48) / r.w, (viewport.height - 48) / r.h));
    setFit('none'); setZoomState(z); setCenter({ x: r.x + r.w / 2, y: r.y + r.h / 2, key: Date.now() });
  }

  // ---------- Saving and exporting ----------
  function confirmOverwrite(path: string) { return new Promise<boolean>(resolve => setOverwrite({ path, resolve })); }
  async function write(path: string, data: Uint8Array, version?: string): Promise<{ version: string } | null> {
    if (!fs.writeBinary) throw new Error('Saving files is unavailable in this workspace.');
    if (version !== undefined) return fs.writeBinary(path, data, { version });
    try { return await fs.writeBinary(path, data, { createOnly: true }); }
    catch (cause) {
      if (!isConflict(cause)) throw cause;
      if (!(await confirmOverwrite(path))) return null;
      const existing = fs.readBinary ? await fs.readBinary(path) : null;
      return fs.writeBinary(path, data, existing ? { version: existing.version } : {});
    }
  }
  const needsExport = (item: PreviewDoc) => !item.path || !item.format.writable || item.animated || !item.format.alpha && hasTransparency(item.current.raster) && !pristine(item);
  async function save(id = activeRef.current): Promise<boolean> {
    const item = id && find(id); if (!item) return false;
    if (!dirtyOf(item) && item.path) return true;
    if (needsExport(item)) {
      const transparentInOpaque = item.path && item.format.writable && !item.format.alpha;
      return exportDoc(item.id, 'Save', transparentInOpaque ? formatById('png') : item.format.writable ? item.format : formatById('png'));
    }
    if (working.current) return false;
    working.current = true; setStatus('Saving…'); setError('');
    try {
      const snapshot = item.current, data = await encode(flatten(snapshot.raster, snapshot.shapes), item.format.id, { quality: 0.92, alpha: true, dpi: item.dpi });
      const result = await write(item.path!, data, item.version);
      if (!result) return false;
      mutate(list => list.map(d => d.id === item.id ? { ...d, saved: snapshot, version: result.version, size: data.byteLength, modified: new Date().toISOString() } : d));
      setStatus(`Saved ${item.name}`); return true;
    } catch (cause) {
      setError(isConflict(cause) ? `“${item.name}” changed elsewhere since it was opened. Use Export to save a separate copy.` : `“${item.name}” couldn’t be saved. ${errorMessage(cause)}`);
      setStatus(''); return false;
    } finally { working.current = false; }
  }
  function exportDoc(id: string, title = 'Export', initial?: ImageFormat) {
    const item = find(id); if (!item) return Promise.resolve(false);
    return new Promise<boolean>(resolve => setExporting({ id, title, initial: initial ?? (item.format.writable ? item.format : formatById('png')), resolve }));
  }
  const exportSource = useRef<{ edit: Edit; canvas: HTMLCanvasElement } | null>(null);
  function flattened(item: PreviewDoc) {
    if (exportSource.current?.edit !== item.current) exportSource.current = { edit: item.current, canvas: flatten(item.current.raster, item.current.shapes) };
    return exportSource.current.canvas;
  }
  async function finishExport(choice: ExportChoice) {
    const request = exporting; if (!request) return;
    setExporting(null);
    const item = find(request.id); if (!item) { request.resolve(false); return; }
    const extension = defaultExtension(choice.format);
    const suggested = `${stem(item.name)}.${extension}`;
    try {
      const chosen = await context.services.dialogs.saveFile({ defaultName: item.path ? `${parentPath(item.path)}/${suggested}`.replace(/^\/\//, '/') : suggested });
      if (!chosen) { request.resolve(false); return; }
      const path = extensionOf(chosen) ? chosen : `${chosen}.${extension}`;
      setStatus('Exporting…');
      const snapshot = item.current, data = await encode(flattened(item), choice.format.id, { quality: choice.quality, alpha: choice.alpha, dpi: item.dpi });
      const result = await write(path, data, path === item.path ? item.version : undefined);
      if (!result) { setStatus(''); request.resolve(false); return; }
      // Like Preview on the Mac, the window now shows the exported file.
      const format = readableFormats.find(f => f.id === choice.format.id) ?? choice.format;
      mutate(list => list.map(d => d.id === item.id ? { ...d, path, name: baseName(path), format, version: result.version, size: data.byteLength, modified: new Date().toISOString(), saved: snapshot, animated: false, live: undefined } : d));
      if (item.live) URL.revokeObjectURL(item.live);
      setStatus(`Saved ${baseName(path)}`); request.resolve(true);
    } catch (cause) { setError(`The image couldn’t be exported. ${errorMessage(cause)}`); setStatus(''); request.resolve(false); }
  }
  async function measureExport(choice: ExportChoice) { const item = exporting && find(exporting.id); if (!item) return 0; return (await encode(flattened(item), choice.format.id, { quality: choice.quality, alpha: choice.alpha, dpi: item.dpi })).byteLength; }
  function revert() { const item = doc && find(doc.id); if (!item || !dirtyOf(item) || item.saved === UNSAVED) return; commit(item.saved); resetInteraction(); setFit('shrink'); setStatus('Reverted to the last saved version'); }
  function duplicate() {
    const item = doc && find(doc.id); if (!item) return;
    const copy: PreviewDoc = { ...item, id: crypto.randomUUID(), name: `${stem(item.name)} copy.${extensionOf(item.name) || defaultExtension(item.format)}`, path: undefined, version: undefined, live: undefined, original: item.current.raster, saved: UNSAVED, past: [], future: [], animated: false };
    mutate(list => [...list, copy]); activate(copy.id);
  }
  function askDiscard(ids: string[]) { return ids.length ? new Promise<boolean>(resolve => setGuard({ ids, resolve })) : Promise.resolve(true); }
  async function closeImage(id = activeRef.current) {
    const item = id && find(id); if (!item) return;
    if (dirtyOf(item) && !(await askDiscard([item.id]))) return;
    const index = docsRef.current.findIndex(d => d.id === item.id);
    if (item.live) URL.revokeObjectURL(item.live);
    mutate(list => list.filter(d => d.id !== item.id));
    if (!docsRef.current.length) { activate(null); context.lifecycle.close(); return; }
    if (activeRef.current === item.id) activate(docsRef.current[Math.min(index, docsRef.current.length - 1)].id);
  }
  useEffect(() => context.lifecycle.onBeforeClose(() => askDiscard(docsRef.current.filter(dirtyOf).map(d => d.id))), [context.lifecycle]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (docsRef.current.some(dirtyOf)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
  }, []);
  async function resolveGuard(action: 'cancel' | 'discard' | 'save') {
    const request = guard; if (!request) return;
    if (action === 'save') { for (const id of request.ids) { activate(id); if (!(await save(id))) return; } }
    setGuard(null); request.resolve(action !== 'cancel');
  }

  // ---------- Editing ----------
  const editable = !!doc && !adjust && !editingText;
  function geometry(change: (edit: Edit) => Edit, label: string) {
    const item = doc && find(doc.id); if (!item) return;
    commit(change(item.current)); resetInteraction(); setFit('shrink'); setStatus(label);
  }
  function cropToSelection() {
    const item = doc && find(doc.id); if (!item || !selection) return;
    if (selection.kind !== 'rect' && !item.format.alpha) setStatus('The area outside the selection is transparent. Saving will offer PNG.');
    geometry(edit => crop(edit, selection), 'Cropped');
  }
  function deleteSelection() {
    const item = doc && find(doc.id); if (!item) return false;
    if (alpha) { applyAlpha(); return true; }
    if (selectedShape) { setShapes(item.current.shapes.filter(s => s.id !== selectedShape)); setSelectedShape(null); return true; }
    if (selection) { commit({ raster: clearRegion(item.current.raster, selection, !item.format.alpha, inverted), shapes: item.current.shapes }); return true; }
    return false;
  }
  function applyAlpha() {
    const item = doc && find(doc.id); if (!item || !alpha) return;
    setStatus('Removing background…');
    setTimeout(() => {
      const mask = floodMask(pixelsOf(item.current.raster), alpha.x, alpha.y, alpha.tolerance);
      commit({ raster: removeMasked(item.current.raster, mask), shapes: item.current.shapes }); setAlpha(null);
      setStatus(item.format.alpha ? 'Removed the highlighted area' : `${item.format.label}s can’t store transparency. Saving will offer PNG.`);
    }, 20);
  }
  function insertShape(kind: ShapeKind) {
    const item = doc && find(doc.id); if (!item) return;
    const view = stageApi.current?.visibleRect() ?? { x: 0, y: 0, w: item.current.raster.width, h: item.current.raster.height };
    const size = Math.max(16, Math.min(view.w, view.h) * 0.28), cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    const tall = kind === 'line' || kind === 'arrow' ? size * 0.6 : kind === 'highlight' ? size * 0.25 : kind === 'bubble' ? size * 0.75 : size;
    const shape: Shape = { id: crypto.randomUUID(), kind, x1: cx - size / 2, y1: cy - tall / 2, x2: cx + size / 2, y2: cy + tall / 2, stroke: style.stroke, fill: kind === 'highlight' ? style.fill ?? '#ffe066' : kind === 'bubble' ? style.fill ?? '#ffffff' : style.fill, width: style.width * scale };
    if (kind === 'line' || kind === 'arrow') { shape.y1 = cy + tall / 2; shape.y2 = cy - tall / 2; }
    setShapes([...item.current.shapes, shape]); setSelectedShape(shape.id); setTool('select'); setMarkup(true);
  }
  function insertText() {
    const item = doc && find(doc.id); if (!item) return;
    const view = stageApi.current?.visibleRect() ?? { x: 0, y: 0, w: item.current.raster.width, h: item.current.raster.height };
    const shape = measureText({ id: crypto.randomUUID(), kind: 'text', x1: 0, y1: 0, x2: 0, y2: 0, text: 'Text', stroke: style.stroke, fill: style.fill, width: 0, font: style.font, size: style.size * scale, bold: style.bold, align: style.align });
    const placed = moveShape(shape, view.x + view.w / 2 - (shape.x2 - shape.x1) / 2, view.y + view.h / 2 - (shape.y2 - shape.y1) / 2);
    setShapes([...item.current.shapes, placed]); setSelectedShape(placed.id); setEditingText(placed.id); setTool('select'); setMarkup(true);
  }
  function changeStyle(change: Partial<Style>) {
    setStyle({ ...style, ...change });
    if (!selected || !doc) return;
    const next: Shape = { ...selected, ...('stroke' in change ? { stroke: change.stroke! } : {}), ...('fill' in change ? { fill: change.fill ?? null } : {}), ...('width' in change ? { width: change.width! * scale } : {}),
      ...('font' in change ? { font: change.font } : {}), ...('size' in change ? { size: change.size! * scale } : {}), ...('bold' in change ? { bold: change.bold } : {}), ...('align' in change ? { align: change.align } : {}) };
    setShapes(shapes.map(s => s.id === selected.id ? (s.kind === 'text' ? measureText(next) : next) : s));
  }
  function nudge(dx: number, dy: number) {
    if (selected) { setShapes(shapes.map(s => s.id === selected.id ? moveShape(s, dx, dy) : s)); return true; }
    if (selection && doc) { const r = selection.rect; setSelection(selection.kind === 'lasso' ? { ...selection, rect: { ...r, x: r.x + dx, y: r.y + dy }, points: selection.points.map((v, i) => v + (i % 2 ? dy : dx)) } : { ...selection, rect: { ...r, x: r.x + dx, y: r.y + dy } }); return true; }
    return false;
  }
  // Adjust Color previews a reduced copy live and applies to full resolution on Done.
  function openAdjust() {
    const item = doc && find(doc.id); if (!item) return;
    if (adjust) { setAdjust(null); return; }
    const { raster } = item.current, s = Math.min(1, Math.sqrt(1_600_000 / (raster.width * raster.height)));
    const base = s < 1 ? resample(raster, Math.max(1, Math.round(raster.width * s)), Math.max(1, Math.round(raster.height * s))) : fromSource(raster, raster.width, raster.height);
    const source = pixelsOf(base), preview = fromSource(base, base.width, base.height);
    setAlpha(null); setEditingText(null); setAdjust({ value: neutralAdjust, source, preview, previewData: source });
  }
  function changeAdjust(value: ColorAdjust) {
    setAdjust(current => current && { ...current, value });
    cancelAnimationFrame(adjustFrame.current);
    adjustFrame.current = requestAnimationFrame(() => setAdjust(current => {
      if (!current) return current;
      const data = adjustPixels(current.source, current.value); context2d(current.preview).putImageData(data, 0, 0);
      return { ...current, previewData: data };
    }));
  }
  function finishAdjust() {
    const item = doc && find(doc.id), current = adjust; if (!item || !current) return;
    if (isNeutral(current.value)) { setAdjust(null); return; }
    setAdjusting(true); setStatus('Applying color adjustments…');
    setTimeout(() => {
      try { commit({ raster: adjustCanvas(item.current.raster, current.value), shapes: item.current.shapes }); setStatus('Adjusted color'); }
      catch (cause) { setError(errorMessage(cause)); }
      finally { setAdjusting(false); setAdjust(null); }
    }, 30);
  }
  async function copy(cut = false) {
    const item = doc && find(doc.id); if (!item) return;
    if (selected) { shapeClipboard.current = selected; if (cut) deleteSelection(); setStatus(`Copied ${shapeLabels[selected.kind]?.toLowerCase() ?? 'annotation'}`); return; }
    try {
      let source = flatten(item.current.raster, item.current.shapes);
      if (selection && !inverted) source = crop({ raster: source, shapes: [] }, selection).raster;
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('This browser doesn’t allow copying images.');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(source) })]);
      shapeClipboard.current = null;
      if (cut && selection) deleteSelection();
      setStatus(selection ? 'Copied the selection' : 'Copied the image');
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function paste() {
    const item = doc && find(doc.id);
    if (!item) { await newFromClipboard(); return; }
    if (shapeClipboard.current) { const offset = 16 * scale, shape = { ...moveShape(shapeClipboard.current, offset, offset), id: crypto.randomUUID() }; shapeClipboard.current = shape; setShapes([...item.current.shapes, shape]); setSelectedShape(shape.id); return; }
    try {
      const bitmap = await createImageBitmap(await clipboardImage()), image = fromSource(bitmap, bitmap.width, bitmap.height); bitmap.close();
      const view = stageApi.current?.visibleRect() ?? { x: 0, y: 0, w: item.current.raster.width, h: item.current.raster.height };
      const s = Math.min(1, view.w * 0.8 / image.width, view.h * 0.8 / image.height), w = image.width * s, h = image.height * s, cx = view.x + view.w / 2, cy = view.y + view.h / 2;
      const shape: Shape = { id: crypto.randomUUID(), kind: 'image', x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, stroke: 'transparent', fill: null, width: 0, image };
      setShapes([...item.current.shapes, shape]); setSelectedShape(shape.id); setTool('select');
    } catch (cause) { setError(errorMessage(cause)); }
  }
  function print() {
    const item = doc && find(doc.id); if (!item) return;
    void toBlob(flatten(item.current.raster, item.current.shapes)).then(blob => {
      const url = URL.createObjectURL(blob), frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
      const cleanup = () => { frame.remove(); URL.revokeObjectURL(url); };
      frame.srcdoc = `<!doctype html><title>${item.name.replace(/[<&>"]/g, '')}</title><style>@page{margin:12mm}html,body{margin:0;height:100%}img{display:block;max-width:100%;max-height:100vh;margin:auto;object-fit:contain}</style><img src="${url}">`;
      frame.onload = () => { const image = frame.contentDocument?.querySelector('img'); void (image?.decode() ?? Promise.resolve()).catch(() => {}).then(() => { frame.contentWindow?.addEventListener('afterprint', () => setTimeout(cleanup, 100)); frame.contentWindow?.print(); setTimeout(cleanup, 120_000); }); };
      document.body.appendChild(frame);
    }, cause => setError(errorMessage(cause)));
  }
  async function openIn(appId: string) {
    const item = doc && find(doc.id); if (!item?.path) return;
    if (dirtyOf(item) && !(await save(item.id))) return;
    context.services.launch(appId, { path: find(item.id)?.path ?? item.path });
  }
  const go = (offset: number | 'first' | 'last') => {
    const list = docsRef.current; if (!list.length) return;
    const index = list.findIndex(d => d.id === activeRef.current), next = offset === 'first' ? 0 : offset === 'last' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, index + offset));
    activate(list[next].id);
  };

  const has = !!doc, multiple = docs.length > 1, index = docs.findIndex(d => d.id === activeId);
  useAppCommands(context, [
    { id: 'preview.new-clipboard', label: 'New from Clipboard', shortcut: 'Mod+N', execute: newFromClipboard },
    { id: 'preview.open', label: 'Open…', shortcut: 'Mod+O', execute: openDialog },
    { id: 'preview.close-image', label: 'Close Image', enabled: () => has, execute: () => closeImage() },
    { id: 'preview.save', label: 'Save', shortcut: 'Mod+S', enabled: () => has && (dirty || !doc?.path), execute: async () => { await save(); } },
    { id: 'preview.duplicate', label: 'Duplicate', shortcut: 'Mod+Shift+S', enabled: () => has, execute: duplicate },
    { id: 'preview.export', label: 'Export…', shortcut: 'Mod+Shift+E', enabled: () => has, execute: async () => { if (doc) await exportDoc(doc.id); } },
    { id: 'preview.revert', label: 'Revert to Saved', enabled: () => has && dirty && doc?.saved !== UNSAVED, execute: revert },
    { id: 'preview.show-in-files', label: 'Show in Files', enabled: () => !!doc?.path, execute: () => { if (doc?.path) context.services.launch('lope.files', { path: parentPath(doc.path) }); } },
    { id: 'preview.open-in-prism', label: 'Edit in Prism', enabled: () => canOpenIn(imageEditorManifest.fileAssociations, doc), execute: () => openIn('lope.image-editor') },
    { id: 'preview.open-in-luma', label: 'Edit in Luma', enabled: () => canOpenIn(photoExtensions, doc), execute: () => openIn('lope.lightroom') },
    { id: 'preview.print', label: 'Print…', shortcut: 'Mod+P', enabled: () => has, execute: print },
    { id: 'preview.undo', label: 'Undo', shortcut: 'Mod+Z', enabled: () => !!doc?.past.length && !adjust, execute: () => step('undo') },
    { id: 'preview.redo', label: 'Redo', shortcut: 'Mod+Shift+Z', enabled: () => !!doc?.future.length && !adjust, execute: () => step('redo') },
    { id: 'preview.cut', label: 'Cut', shortcut: 'Mod+X', enabled: () => editable && (!!selected || !!selection), execute: () => copy(true) },
    { id: 'preview.copy', label: 'Copy', shortcut: 'Mod+C', enabled: () => has, execute: () => copy() },
    { id: 'preview.paste', label: 'Paste', shortcut: 'Mod+V', execute: paste },
    { id: 'preview.delete', label: 'Delete', shortcut: 'Backspace', enabled: () => editable && (!!selected || !!selection || !!alpha), execute: () => { deleteSelection(); } },
    { id: 'preview.select-all', label: 'Select All', shortcut: 'Mod+A', enabled: () => editable, execute: () => { if (doc) { setTool('select'); setSelectedShape(null); setInverted(false); setSelection({ kind: 'rect', rect: { x: 0, y: 0, w: doc.current.raster.width, h: doc.current.raster.height } }); } } },
    { id: 'preview.deselect', label: 'Deselect All', enabled: () => !!selection || !!selectedShape, execute: () => { setSelection(null); setSelectedShape(null); setInverted(false); } },
    { id: 'preview.invert-selection', label: 'Invert Selection', shortcut: 'Mod+Shift+I', enabled: () => !!selection, checked: () => inverted, execute: () => setInverted(!inverted) },
    { id: 'preview.sidebar', label: 'Sidebar', checked: () => sidebar, execute: () => setSidebar(!sidebar) },
    { id: 'preview.actual-size', label: 'Actual Size', shortcut: 'Mod+0', enabled: () => has, execute: () => setZoom(1) },
    { id: 'preview.fit', label: 'Zoom to Fit', shortcut: 'Mod+9', enabled: () => has, execute: () => setFit('fit') },
    { id: 'preview.zoom-in', label: 'Zoom In', shortcut: 'Mod+=', enabled: () => has && zoom < MAX_ZOOM, execute: () => setZoom(zoom * 1.25) },
    { id: 'preview.zoom-out', label: 'Zoom Out', shortcut: 'Mod+-', enabled: () => has && zoom > MIN_ZOOM, execute: () => setZoom(zoom / 1.25) },
    { id: 'preview.zoom-selection', label: 'Zoom to Selection', shortcut: 'Mod+8', enabled: () => !!selection || !!selected, execute: zoomToSelection },
    { id: 'preview.checkerboard', label: 'Show Transparency Grid', checked: () => checkerboard, execute: () => setCheckerboard(!checkerboard) },
    { id: 'preview.slideshow', label: 'Slideshow', shortcut: 'Mod+Shift+F', enabled: () => has, execute: () => setSlideshow(true) },
    { id: 'preview.markup', label: 'Show Markup Toolbar', shortcut: 'Mod+Shift+A', checked: () => markup, execute: () => setMarkup(!markup) },
    { id: 'preview.inspector', label: 'Show Inspector', shortcut: 'Mod+I', checked: () => inspector, enabled: () => has, execute: () => setInspector(!inspector) },
    { id: 'preview.previous', label: 'Previous Image', shortcut: 'ArrowUp', enabled: () => multiple && index > 0, execute: () => go(-1) },
    { id: 'preview.next', label: 'Next Image', shortcut: 'ArrowDown', enabled: () => multiple && index < docs.length - 1, execute: () => go(1) },
    { id: 'preview.first', label: 'First Image', shortcut: 'Home', enabled: () => multiple && index > 0, execute: () => go('first') },
    { id: 'preview.last', label: 'Last Image', shortcut: 'End', enabled: () => multiple && index < docs.length - 1, execute: () => go('last') },
    { id: 'preview.adjust-color', label: 'Adjust Color…', enabled: () => has && !editingText, checked: () => !!adjust, execute: openAdjust },
    { id: 'preview.adjust-size', label: 'Adjust Size…', enabled: () => editable, execute: () => setSizing(true) },
    { id: 'preview.rotate-left', label: 'Rotate Left', shortcut: 'Mod+L', enabled: () => editable, execute: () => geometry(edit => rotate(edit, false), 'Rotated left') },
    { id: 'preview.rotate-right', label: 'Rotate Right', shortcut: 'Mod+R', enabled: () => editable, execute: () => geometry(edit => rotate(edit, true), 'Rotated right') },
    { id: 'preview.flip-horizontal', label: 'Flip Horizontal', enabled: () => editable, execute: () => geometry(edit => flip(edit, true), 'Flipped horizontally') },
    { id: 'preview.flip-vertical', label: 'Flip Vertical', enabled: () => editable, execute: () => geometry(edit => flip(edit, false), 'Flipped vertically') },
    { id: 'preview.crop', label: 'Crop', shortcut: 'Mod+Shift+K', enabled: () => editable && !!selection && !inverted, execute: cropToSelection },
    { id: 'preview.tool-rect', label: 'Rectangular Selection', checked: () => tool === 'select', enabled: () => has, execute: () => setTool('select') },
    { id: 'preview.tool-ellipse', label: 'Elliptical Selection', checked: () => tool === 'ellipse', enabled: () => has, execute: () => setTool('ellipse') },
    { id: 'preview.tool-lasso', label: 'Lasso Selection', checked: () => tool === 'lasso', enabled: () => has, execute: () => setTool('lasso') },
    { id: 'preview.tool-alpha', label: 'Instant Alpha', checked: () => tool === 'alpha', enabled: () => editable, execute: () => { setTool('alpha'); setMarkup(true); setStatus('Click a color and drag to choose how much of the surrounding area to remove.'); } },
    { id: 'preview.tool-sketch', label: 'Sketch', checked: () => tool === 'pen', enabled: () => editable, execute: () => { setTool('pen'); setMarkup(true); } },
    { id: 'preview.text', label: 'Add Text', enabled: () => editable, execute: insertText },
    ...(['rect', 'rounded', 'oval', 'line', 'arrow', 'star', 'bubble', 'highlight'] as ShapeKind[]).map(kind => ({ id: `preview.shape-${kind}` as const, label: `Add ${shapeLabels[kind]}`, enabled: () => editable, execute: () => insertShape(kind) })),
  ]);

  function keyDown(event: React.KeyboardEvent) {
    if ((event.target as HTMLElement).closest('input,textarea,select,[role="dialog"],.preview-menu')) return;
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Escape') {
      if (alpha) setAlpha(null); else if (adjust) setAdjust(null); else if (selection || selectedShape) { setSelection(null); setSelectedShape(null); setInverted(false); } else if (tool !== 'select') setTool('select'); else return;
      event.preventDefault(); return;
    }
    if (alpha && (event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete')) { event.preventDefault(); applyAlpha(); return; }
    if ((event.key === 'Backspace' || event.key === 'Delete') && !mod) { if (editable && deleteSelection()) event.preventDefault(); return; }
    if (event.key === 'Enter' && selected?.kind === 'text') { event.preventDefault(); setEditingText(selected.id); return; }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key] && !mod) {
      const [dx, dy] = arrows[event.key], amount = (event.shiftKey ? 10 : 1) * scale;
      if (editable && nudge(dx * amount, dy * amount)) { event.preventDefault(); return; }
      if (dx + dy !== 0 && multiple) { event.preventDefault(); go(dx + dy); }
    }
  }
  function drop(event: React.DragEvent) {
    event.preventDefault(); setDragOver(false);
    const files = [...event.dataTransfer.files];
    if (files.length) { void openFiles(files); return; }
    try { const paths: unknown = JSON.parse(event.dataTransfer.getData(FILE_DRAG_TYPE)); if (Array.isArray(paths)) void (async () => { for (const path of paths) if (typeof path === 'string') await openPath(path); })(); } catch { /* Ignore other drags. */ }
  }
  const raster = doc?.current.raster;
  const live = doc && doc.live && pristine(doc) ? doc.live : null;
  const stageStyle = useMemo(() => ({ ...style, width: style.width * scale }), [style, scale]);
  const transparentNow = useMemo(() => { const item = exporting && find(exporting.id); return item ? hasTransparency(item.current.raster) : false; }, [exporting]);
  const transparent = useMemo(() => !!doc && inspector && doc.format.alpha && hasTransparency(doc.current.raster), [doc?.current.raster, doc?.format, inspector]);

  return <div ref={root} className={`lope-app preview-app ${dragOver ? 'is-drop-target' : ''}`} tabIndex={-1} onKeyDown={keyDown}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes(FILE_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragOver(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false); }} onDrop={drop}>
    <header className="preview-toolbar glass-inset">
      <div className="preview-group">
        <button type="button" className={`preview-tool ${sidebar ? 'is-active' : ''}`} aria-pressed={sidebar} aria-label="Show sidebar" title="Sidebar" onClick={() => setSidebar(!sidebar)}><PanelLeft size={16}/></button>
        <div className="preview-title"><strong title={doc?.path ?? doc?.name}>{doc?.name ?? 'Preview'}</strong>{doc && <span>{dirty ? 'Edited' : `${docs.length > 1 ? `${index + 1} of ${docs.length} · ` : ''}${doc.current.raster.width} × ${doc.current.raster.height}`}</span>}</div>
      </div>
      <div className="preview-group">
        <button type="button" className={`preview-tool ${inspector ? 'is-active' : ''}`} aria-pressed={inspector} aria-label="Show inspector" title="Inspector" disabled={!has} onClick={() => setInspector(!inspector)}><Info size={16}/></button>
        <span className="preview-divider"/>
        <button type="button" className="preview-tool" aria-label="Zoom out" title="Zoom out" disabled={!has} onClick={() => setZoom(zoom / 1.25)}><ZoomOut size={16}/></button>
        <button type="button" className="preview-zoom" title="Zoom to fit" disabled={!has} onClick={() => setFit(fit === 'fit' ? 'none' : 'fit')}>{has ? `${Math.round(zoom * 100)}%` : '—'}</button>
        <button type="button" className="preview-tool" aria-label="Zoom in" title="Zoom in" disabled={!has} onClick={() => setZoom(zoom * 1.25)}><ZoomIn size={16}/></button>
        <span className="preview-divider"/>
        <button type="button" className="preview-tool" aria-label="Export" title="Export…" disabled={!has} onClick={() => doc && void exportDoc(doc.id)}><Share size={16}/></button>
        <button type="button" className={`preview-tool ${markup ? 'is-active' : ''}`} aria-pressed={markup} aria-label="Show markup toolbar" title="Markup" disabled={!has} onClick={() => setMarkup(!markup)}><PenTool size={16}/></button>
        <button type="button" className="preview-tool" aria-label="Rotate left" title="Rotate left (Shift-click to rotate right)" disabled={!editable} onClick={event => geometry(edit => rotate(edit, event.shiftKey || event.altKey), event.shiftKey || event.altKey ? 'Rotated right' : 'Rotated left')}><RotateCcw size={16}/></button>
      </div>
    </header>
    {markup && has && <MarkupBar tool={tool} onTool={next => { setTool(next); setAlpha(null); if (next === 'alpha') setStatus('Click a color and drag to choose how much of the surrounding area to remove.'); }} style={style} onStyle={changeStyle} selected={selected}
      onInsert={insertShape} onText={insertText} onAdjustColor={openAdjust} onAdjustSize={() => setSizing(true)} onCrop={cropToSelection} canCrop={!!selection && !inverted && editable} disabled={!editable && !adjust}/>}
    {error && <div className="application-error preview-error" role="alert"><span>{error}</span><Button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></Button></div>}
    <div className="preview-body">
      {sidebar && docs.length > 0 && <nav className="preview-sidebar" aria-label="Images">
        {docs.map((item, i) => <button type="button" key={item.id} className={item.id === activeId ? 'selected' : ''} aria-current={item.id === activeId ? 'true' : undefined} onClick={() => activate(item.id)} title={item.path ?? item.name}>
          <span className="preview-thumb">{thumbs[item.id] ? <img src={thumbs[item.id]} alt=""/> : <ImageIcon size={20}/>}</span>
          <span className="preview-thumb-name">{dirtyOf(item) && <i aria-label="Edited">•</i>}{item.name}</span>
          <span className="visually-hidden">{i + 1} of {docs.length}</span>
        </button>)}
      </nav>}
      <main className="preview-main">
        {doc && raster ? <Stage key={doc.id} docId={doc.id} raster={raster} display={adjust?.preview ?? null} live={live} shapes={shapes} zoom={zoom} tool={tool} style={stageStyle} checkerboard={checkerboard}
          selection={selection} selectedShape={selectedShape} editingText={editingText} alpha={alpha} api={stageApi} center={center}
          onZoom={value => setZoom(value)} onViewport={setViewport} onSelection={region => { setSelection(region); if (!region) setInverted(false); }} onSelectShape={setSelectedShape}
          onShapes={setShapes} onEditText={setEditingText} onAlpha={setAlpha}/>
          : <div className="preview-empty">
            {loading ? <p role="status"><span className="preview-spinner"/>Opening image…</p> : <>
              <span className="preview-empty-icon"><ImageIcon size={30}/></span>
              <h1>Preview</h1>
              <p>View, mark up, and convert images. Drop images here, or open one from your workspace.</p>
              <div className="preview-empty-actions"><Button variant="primary" onClick={openDialog}><FolderOpen size={14}/>Open Image…</Button><Button onClick={newFromClipboard}>New from Clipboard</Button></div>
              <p className="preview-formats">JPEG, PNG, HEIC, WebP, AVIF, GIF, TIFF, BMP, SVG, PSD, camera raw (DNG, CR3, NEF, ARW, and more), OpenEXR, Radiance HDR, TGA, ICO, ICNS, DDS, QOI, PCX, Netpbm, XBM, and more.</p>
            </>}
          </div>}
        {alpha && <div className="preview-floating glass" role="status"><span>Drag to adjust the area · {Math.round(alpha.tolerance / 2.55)}%</span><Button onClick={() => setAlpha(null)}>Cancel</Button><Button variant="primary" onClick={applyAlpha}>Remove</Button></div>}
        {inspector && doc && <Inspector info={{ name: doc.name, kind: doc.format.label, size: doc.size, width: doc.current.raster.width, height: doc.current.raster.height, dpi: doc.dpi, path: doc.path, modified: doc.modified, alpha: transparent, details: doc.details, exif: doc.exif, shapes }}
          selectedShape={selectedShape} onSelectShape={id => { setSelectedShape(id); setSelection(null); }} onDeleteShape={id => { setShapes(shapes.filter(s => s.id !== id)); if (selectedShape === id) setSelectedShape(null); }} onClose={() => setInspector(false)}/>}
        {adjust && <AdjustColorPanel value={adjust.value} onChange={changeAdjust} source={adjust.source} preview={adjust.previewData} busy={adjusting} onDone={finishAdjust} onCancel={() => setAdjust(null)}/>}
      </main>
    </div>
    <footer className="application-status preview-status"><span role="status">{status || (doc ? (tool === 'pen' ? 'Drag to sketch.' : selection ? `Selection ${Math.round(selection.rect.w)} × ${Math.round(selection.rect.h)}${inverted ? ' (inverted)' : ''}` : doc.format.label) : `${docs.length} images`)}</span>
      {doc && <span>{doc.current.raster.width} × {doc.current.raster.height} px{doc.size ? ` · ${formatBytes(doc.size)}` : ''} · {Math.round(zoom * 100)}%</span>}</footer>
    {sizing && doc && <AdjustSizeDialog width={doc.current.raster.width} height={doc.current.raster.height} dpi={doc.dpi} estimate={(w, h) => Math.round((doc.size ?? doc.current.raster.width * doc.current.raster.height * 3) * (w * h) / (doc.current.raster.width * doc.current.raster.height))}
      onClose={() => setSizing(false)} onApply={(w, h, dpi) => {
        setSizing(false); const item = find(doc.id); if (!item) return;
        if (w !== item.current.raster.width || h !== item.current.raster.height) geometry(edit => resize(edit, w, h), `Resized to ${w} × ${h}`);
        if (Math.abs(dpi - item.dpi) > 0.01) { mutate(list => list.map(d => d.id === item.id ? { ...d, dpi: Math.round(dpi * 100) / 100 } : d)); if (w === item.current.raster.width && h === item.current.raster.height) commit({ ...item.current }); }
      }}/>}
    {exporting && find(exporting.id) && <ExportDialog name={find(exporting.id)!.name} title={exporting.title} initial={exporting.initial} transparent={transparentNow} measure={measureExport}
      onExport={choice => void finishExport(choice)} onClose={() => { exporting.resolve(false); setExporting(null); }}/>}
    {guard && <Dialog title={guard.ids.length === 1 ? `Save changes to “${find(guard.ids[0])?.name}”?` : `${guard.ids.length} images have unsaved changes`} onClose={() => void resolveGuard('cancel')}>
      <div className="lope-application-dialog-form"><p>{guard.ids.length === 1 ? 'Your changes will be lost if you don’t save them.' : guard.ids.map(id => find(id)?.name).join(', ')}</p>
        <div className="dialog-actions"><Button onClick={() => void resolveGuard('cancel')}>Cancel</Button><Button onClick={() => void resolveGuard('discard')}>Don’t Save</Button><Button variant="primary" autoFocus onClick={() => void resolveGuard('save')}>{guard.ids.length === 1 ? 'Save' : 'Save All'}</Button></div></div></Dialog>}
    {overwrite && <Dialog title="Replace existing file?" onClose={() => { overwrite.resolve(false); setOverwrite(null); }}>
      <div className="lope-application-dialog-form"><p>“{baseName(overwrite.path)}” already exists. Replacing it overwrites its current contents.</p>
        <div className="dialog-actions"><Button onClick={() => { overwrite.resolve(false); setOverwrite(null); }}>Cancel</Button><Button variant="primary" onClick={() => { overwrite.resolve(true); setOverwrite(null); }}>Replace</Button></div></div></Dialog>}
    {slideshow && docs.length > 0 && <Slideshow docs={docs} start={Math.max(0, index)} onClose={index => { setSlideshow(false); if (docs[index]) activate(docs[index].id); root.current?.focus(); }}/>}
  </div>;
}

function thumbnail({ raster, shapes }: Edit) {
  const s = Math.min(1, 176 / Math.max(raster.width, raster.height)), out = canvas(raster.width * s, raster.height * s), c = context2d(out);
  c.imageSmoothingQuality = 'high';
  c.drawImage(s < 0.5 ? resample(raster, Math.max(1, Math.round(raster.width * s * 2)), Math.max(1, Math.round(raster.height * s * 2))) : raster, 0, 0, out.width, out.height);
  if (shapes.length) { c.scale(s, s); drawShapes(c, shapes); }
  return out.toDataURL('image/png');
}

function Slideshow({ docs, start, onClose }: { docs: PreviewDoc[]; start: number; onClose(index: number): void }) {
  const [index, setIndex] = useState(start), [playing, setPlaying] = useState(true), [url, setUrl] = useState(''), root = useRef<HTMLDivElement>(null);
  const item = docs[index], indexRef = useRef(index); indexRef.current = index;
  useEffect(() => {
    let revoke = '';
    if (item.live && pristine(item)) setUrl(item.live);
    else void toBlob(flatten(item.current.raster, item.current.shapes)).then(blob => { revoke = URL.createObjectURL(blob); setUrl(revoke); });
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [item]);
  useEffect(() => { if (!playing || docs.length < 2) return; const timer = setTimeout(() => setIndex(i => (i + 1) % docs.length), 4000); return () => clearTimeout(timer); }, [playing, index, docs.length]);
  useEffect(() => {
    const element = root.current; element?.focus();
    element?.requestFullscreen?.().catch(() => {});
    const exit = () => { if (!document.fullscreenElement) onClose(indexRef.current); };
    document.addEventListener('fullscreenchange', exit);
    return () => { document.removeEventListener('fullscreenchange', exit); if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {}); };
  }, []);
  const move = (offset: number) => setIndex(i => (i + offset + docs.length) % docs.length);
  return createPortal(<div ref={root} className="preview-slideshow" tabIndex={-1} role="dialog" aria-modal="true" aria-label="Slideshow" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(index); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === ' ') { event.preventDefault(); setPlaying(p => !p); }
  }}>
    {url && <img src={url} alt={item.name}/>}
    <div className="preview-slideshow-controls glass" data-glass-tone="dark">
      <button type="button" aria-label="Previous image" onClick={() => move(-1)}><ChevronLeft size={18}/></button>
      <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
      <button type="button" aria-label="Next image" onClick={() => move(1)}><ChevronRight size={18}/></button>
      <span>{item.name} · {index + 1} of {docs.length}</span>
      <button type="button" aria-label="Exit slideshow" onClick={() => onClose(index)}><X size={18}/></button>
    </div>
  </div>, document.querySelector('.desktop') ?? document.body);
}
