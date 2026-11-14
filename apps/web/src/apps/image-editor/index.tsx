import { AppIcon } from '../../shell/Icons';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleHelp, LoaderCircle, X } from 'lucide-react';
import type { AppContext, Command } from '../../../../../packages/contracts/src';
import { useBeforeClose } from '../../../../../packages/sdk/src';
import { BLEND_MODES, History, addLayer, addMask, alignLayers, allLayers, color, context2d, createTextLayer, cropDocument, deserializeDocument, documentMemory, duplicateLayer, embedLayer, findLayer, fromPixels, groupLayers, identity, layer, mergeLayers, newDocument, newPixelLayer, pastePixels, replaceLayerTransform, flipSelected, transformLayerWorld, matrixOf, multiply, inverse, removeLayers, reorderLayer, resetSourceTransform, resizeCanvas, resizeImage, rotateDocument, revealAll, selectPolygon, selectionBounds, serializeDocument, surface, toBase64, uid, updateLayer, CanvasRenderer, type PixelClipboard, type RasterFilter, type ImageDocument, type Layer, type Point } from '../../../../../packages/image-engine/src';
import { psdCompatibility } from '../../../../../packages/image-engine/src/psd';
import { baseName, errorCode, errorMessage, useAppCommands } from '../hooks';
import { CanvasView } from './CanvasView';
import { ColorPicker, EffectsDialog, ExportDialog, FilterDialog, Modal, NewDocumentDialog, SizeDialog, TypeDialog, type DocumentPreset } from './dialogs';
import { MenuBar } from './menus';
import { Panels } from './panels';
import { adjustmentDefinitions, essentials, type AdjustmentId, type PanelId, type Workspace } from './panel-model';
import { filterNames } from './filter-model';
import { NumberField, OptionsBar, Toolbar } from './tools';
import { TOOLS, TOOL_GROUPS, initialBrush, type ToolId, type ToolOptions } from './tool-model';
import { sampleDocument } from './fixture';
import { ImageWorker } from './worker-client';
import { recoveryRecords, removeRecovery, saveRecovery, type RecoveryRecord } from './recovery';
import { sessionJournal, residentSession, type EditorSession, type EditorState,type PendingType } from './session';
import './image-editor.css';

const LocalAiDialog=lazy(()=>import('./ai/LocalAiDialog').then(module=>({default:module.LocalAiDialog})));
type Session = EditorSession;
type Dialog = 'new' | 'image-size' | 'canvas-size' | 'export' | 'psd-export' | 'color-foreground' | 'color-background' | 'type' | 'effects' | 'transform' | 'feather' | 'expand' | 'contract' | 'about' | 'shortcuts' | 'compatibility' | 'workspace' | 'filter' | 'border' | 'smooth' | 'color-range' | 'local-ai' | null;
const clipboard:{current:PixelClipboard|null}=(globalThis as any).__lopeImageClipboard ||= {current:null};
const sessionFor = (doc: ImageDocument): Session => ({ history: new History(doc), zoom: .5, pan: { x: 0, y: 0 } });
const EXTENSIONS = ['.lopeimage', '.psd', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
const extension = (path: string) => path.slice(path.lastIndexOf('.')).toLowerCase();
export default function ImageEditor({ context }: { context: AppContext }) {
  const requestedPath = typeof context.launchArgs.path === 'string' ? context.launchArgs.path : '';
  const [resident]=useState(()=>residentSession(context.windowId));
  const [restored,setRestored]=useState(Boolean(resident));
  const [journal]=useState(()=>sessionJournal(context.windowId));
  const [sessions, setSessions] = useState<Session[]>(() => resident?.sessions||[]);
  const [activeId, setActiveId] = useState(resident?.activeId||''); const tab = sessions.find(s => s.history.current.id === activeId) || sessions[0]; const doc = tab?.history.current;
  const [tool, setTool] = useState<ToolId>(resident?.tool||'move'); const [brush, setBrush] = useState(resident?.brush||initialBrush); const [foreground, setForeground] = useState(resident?.foreground||'#c18f62'); const [background, setBackground] = useState(resident?.background||'#ffffff');
  const [typeDefaults,setTypeDefaults]=useState<NonNullable<Layer['text']>>(resident?.typeDefaults||{content:'Your text here',font:'Arial',size:72,color:'#c18f62',bold:false,italic:false,align:'left',leading:1.2,tracking:0});
  const [options, setOptions] = useState<ToolOptions>(resident?.options||{ autoSelect: true, showTransform: false, tolerance: 32, contiguous: true, feather: 0, selectionMode: 'replace' });
  const [workspace, setWorkspaceState] = useState<Workspace>(() => ({ ...essentials(), ...context.services.settings.get<Partial<Workspace>>('image-editor.workspace', {}) }));
  const [documentPresets,setDocumentPresets]=useState<DocumentPreset[]>(()=>context.services.settings.get('image-editor.document-presets',[]));
  const [recentPresets,setRecentPresets]=useState<DocumentPreset[]>(()=>context.services.settings.get('image-editor.recent-presets',[]));
  const [workspaceName,setWorkspaceName]=useState('Custom Workspace');const [savedWorkspaces,setSavedWorkspaces]=useState<Record<string,Workspace>>(()=>context.services.settings.get('image-editor.workspaces',{}));
  const [dialog, setDialog] = useState<Dialog>(null); const [dialogAmount, setDialogAmount] = useState(5); const [typeTarget, setTypeTarget] = useState<{ point: Point; id?: string }>({ point: { x: 100, y: 100 } });
  const pendingEdit=useRef<(()=>void)|null>(null);const [pendingType,setPendingType]=useState<PendingType|undefined>();const reloadIntent=useRef(false);
  const appRoot=useRef<HTMLDivElement>(null);
  const [aiTab,setAiTab]=useState<'portrait'|'generate'>('portrait');const [aiExpand,setAiExpand]=useState(false);
  const [rangeColor,setRangeColor]=useState('#c18f62');
  const [filterType,setFilterType]=useState<RasterFilter['type']>('gaussian-blur');const filterPreview=useRef(new ImageWorker());const filterPreviewSequence=useRef(0);const filterPreviewTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [draft, setDraft] = useState<ImageDocument | null>(null); const [transforming, setTransforming] = useState(false); const [transformValues, setTransformValues] = useState(identity());
  const [error, setError] = useState(''); const [status, setStatus] = useState('Ready'); const [busy, setBusy] = useState(''); const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [recoveries, setRecoveries] = useState<RecoveryRecord[]>([]); const [guard, setGuard] = useState<Session[] | null>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; message: string; accept: string; resolve: (yes: boolean) => void } | null>(null);
  const worker = useRef(new ImageWorker()); const recoveryWorker = useRef(new ImageWorker()); const working = useRef(false); const operation = useRef(0); const deviceInput = useRef<HTMLInputElement>(null);
  const all = useRef(sessions); all.current = sessions; const current = useRef(tab); current.current = tab; const currentDoc = useRef(doc); currentDoc.current = doc;
  const editorState=useRef<EditorState>(null!);editorState.current={sessions,activeId:tab?.history.current.id||'',tool,brush,foreground,background,options,typeDefaults,pendingType};
  const pixelColors=useRef({foreground,background});const maskColors=useRef({foreground:'#000000',background:'#ffffff'});
  const colorTarget=useRef(doc?.target||'pixels');
  useEffect(()=>{const target=doc?.quickMask?'mask':doc?.target||'pixels';if(colorTarget.current===target)return;const leaving=colorTarget.current==='mask'?maskColors:pixelColors;leaving.current={foreground,background};const entering=target==='mask'?maskColors:pixelColors;setForeground(entering.current.foreground);setBackground(entering.current.background);colorTarget.current=target;},[doc?.target,doc?.quickMask]);
  const alive = useRef(true); const guardResolve = useRef<((yes: boolean) => void) | null>(null); const confirmationRef = useRef(confirmation); confirmationRef.current = confirmation; const recoverySerial = useRef(Promise.resolve());
  function refresh() { setSessions([...all.current]); }
  function setWorkspace(next: Workspace) { setWorkspaceState(next); try { context.services.settings.set('image-editor.workspace', next); } catch { setError('Workspace preferences could not be saved.'); } }
  function commit(name: string, next: ImageDocument | ((doc: ImageDocument) => ImageDocument), coalesceKey='') {
    const s = current.current; if (!s || working.current) return;
    try { s.history.commit(name, typeof next === 'function' ? next(s.history.current) : next,coalesceKey); setDraft(null); setStatus(name); refresh(); } catch (cause) { setError(errorMessage(cause)); }
  }
  function select(ids: string[], target: 'pixels' | 'mask' = 'pixels') {
    const s = current.current; if (!s || working.current) return;
    s.history.view({ ...s.history.current, activeIds: ids, target });
    refresh();
  }
  const requestGuard = useCallback((targets: Session[]): Promise<boolean> => {
    const dirty = targets.filter(s => s.history.dirty); if (!dirty.length) return Promise.resolve(true); if (guardResolve.current || working.current) return Promise.resolve(false);
    setGuard(dirty); return new Promise(resolve => { guardResolve.current = resolve; });
  }, []);
  const beforeClose = useCallback(async () => {
    pendingEdit.current?.();const reloading=reloadIntent.current;reloadIntent.current=false;
    if(reloading){if(working.current)return false;journal.schedule({...editorState.current,sessions:all.current,pendingType:undefined});try{await journal.flush();return true;}catch(cause){setError(`Reload paused: ${errorMessage(cause)}`);return false;}}
    if (working.current || !(await requestGuard(all.current))) return false;
    await Promise.all(all.current.map(s => removeRecovery(s.history.current.id)));await journal.clear();return true;
  }, [requestGuard,journal]);
  useBeforeClose(beforeClose);
  function finishGuard(value: boolean) { setGuard(null); guardResolve.current?.(value); guardResolve.current = null; }
  async function confirm(title: string, message: string, accept = 'Continue') { return new Promise<boolean>(resolve => setConfirmation({ title, message, accept, resolve })); }
  function finishConfirmation(value: boolean) { confirmationRef.current?.resolve(value); setConfirmation(null); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; worker.current.dispose(); recoveryWorker.current.dispose();filterPreview.current.dispose();clearTimeout(filterPreviewTimer.current); guardResolve.current?.(false); confirmationRef.current?.resolve(false); }; }, []);
  useEffect(() => { context.lifecycle.setTitle(`${tab?.history.dirty ? '● ' : ''}${doc?.name || 'Prism'}${doc ? ' — Prism' : ''}`); }, [doc?.name, doc?.revision, tab?.history.dirty, context.lifecycle]);
  useEffect(() => { const unload = (event: BeforeUnloadEvent) => { if (pendingEdit.current||all.current.some(s => s.history.dirty)) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload); }, []);
  useEffect(()=>{const action=(event:Event)=>{reloadIntent.current=(event as CustomEvent).detail?.action==='reload';};window.addEventListener('lope:system-action',action,true);return()=>window.removeEventListener('lope:system-action',action,true);},[]);
  useEffect(()=>{
    let cancelled=false;
    const restore=async()=>{
      try{const saved=resident||await journal.load();if(cancelled)return;
        if(saved){if(saved.pendingType){const edit=saved.pendingType,s=saved.sessions.find(s=>s.history.current.id===edit.documentId);if(s){let next=s.history.current;if(edit.layerId)next=updateLayer(next,edit.layerId,l=>({...l,text:edit.text}));else{next=createTextLayer(next,edit.point,edit.text.content,edit.text.color);next=updateLayer(next,next.activeIds[0],l=>({...l,text:edit.text}));}s.history.commit('Restore Type Draft',next);}saved.pendingType=undefined;}all.current=saved.sessions;setSessions([...saved.sessions]);setActiveId(saved.activeId);setTool(saved.tool);setBrush(saved.brush);setForeground(saved.foreground);setBackground(saved.background);setOptions(saved.options);setTypeDefaults(saved.typeDefaults);setStatus('Session restored');}
        else{if(!requestedPath){const initial=[sessionFor(sampleDocument())];all.current=initial;setSessions(initial);}const records=await recoveryRecords();if(!cancelled)setRecoveries(records.sort((a,b)=>b.updated.localeCompare(a.updated)));}
      }catch(cause){journal.suspend();if(!cancelled)setError(`Session restoration failed: ${errorMessage(cause)}. Your stored documents have been kept.`);}
      finally{if(!cancelled)setRestored(true);}
    };void restore();return()=>{cancelled=true;};
  },[journal]);
  useEffect(() => {
    if(!restored)return;journal.onError=message=>{if(alive.current)setError(`Session backup failed: ${message}. Keep the document open and save a project copy.`);};
    journal.schedule({sessions,pendingType,activeId:tab?.history.current.id||'',tool,brush,foreground,background,options,typeDefaults});
  }, [restored,sessions,activeId,tool,brush,foreground,background,options,typeDefaults,pendingType,journal]);
  useEffect(()=>{const flush=()=>void journal.flush().catch(()=>{});const hidden=()=>{if(document.visibilityState==='hidden')flush();};window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);return()=>{window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);flush();};},[journal]);
  async function task<T>(label: string, execute: () => Promise<T>): Promise<T | undefined> {
    if (working.current) return undefined; const token = ++operation.current; working.current = true; setBusy(label); setError('');
    try { const result = await execute(); if (alive.current && token === operation.current) return result; }
    catch (cause) { if (alive.current && token === operation.current) setError(errorMessage(cause)); }
    finally { if (alive.current && token === operation.current) { working.current = false; setBusy(''); } }
  }
  function cancel() { operation.current++; worker.current.cancel(); working.current = false; setBusy(''); setStatus('Operation cancelled'); }
  function append(document: ImageDocument, path?: string, version?: string, savedRevision?: string) {
    const existing = all.current.find(s => s.path && s.path === path || s.history.current.id === document.id);
    if (existing) { setActiveId(existing.history.current.id); return; }
    const session = sessionFor(document); session.path = path; session.version = version; if (savedRevision) session.history.savedRevision = savedRevision;
    const next = [...all.current, session]; all.current = next; setSessions(next); setActiveId(document.id); setStatus(`Opened ${document.name}`);
  }
  async function readData(data: Uint8Array, name: string): Promise<{ document: ImageDocument; warnings: string[] }> {
    if (extension(name) === '.lopeimage') return { document: await worker.current.run<ImageDocument>('deserialize', new TextDecoder().decode(data)), warnings: [] };
    if (extension(name) === '.psd') return worker.current.run('psd-import', { data, name });
    if(data.length>24&&data[0]===137&&String.fromCharCode(...data.slice(1,4))==='PNG'&&data[24]===16)throw new Error('16-bit PNG editing is unavailable. The original has not been converted; open an RGB/8 copy.');
    const decoded = await worker.current.run<{ width: number; height: number; data: Uint8ClampedArray }>('raster-import', { data });
    const document = newDocument(decoded.width, decoded.height, name, [0,0,0,0]); const pixels = fromPixels(decoded.width, decoded.height, decoded.data); document.layers = [{ ...layer(baseName(name)), pixels }]; document.activeIds = [document.layers[0].id];
    document.original={name,data:toBase64(data),warnings:[]};
    return { document, warnings: [] };
  }
  async function openData(data: Uint8Array, name: string, path?: string, version?: string, place = false) {
    const result = await task(place ? 'Placing image…' : 'Opening image…', () => readData(data, name)); if (!result) return;
    if (result.warnings.length) {
      const accepted = await confirm('Photoshop compatibility', result.warnings.join('\n\n') + '\n\nThe complete source PSD will be preserved in your native project.', 'Open with report'); if (!accepted) return;
    }
    if (place && current.current) {
      const renderer = new CanvasRenderer(); const imported = result.document; const content = context2d(renderer.render(imported)).getImageData(0,0,imported.width,imported.height).data; renderer.dispose();
      const currentDoc = current.current.history.current; const scale = Math.min(1, currentDoc.width / imported.width, currentDoc.height / imported.height);
      commit('Place Embedded', addLayer(currentDoc, { ...layer(name, 'embedded'), source: fromPixels(imported.width, imported.height, content),embeddedAsset:{name,data:toBase64(data),format:extension(name)}, transform: { ...identity(), x: (currentDoc.width - imported.width * scale) / 2, y: (currentDoc.height - imported.height * scale) / 2, scaleX: scale, scaleY: scale } }));
    } else append(result.document, extension(name) === '.lopeimage' ? path : undefined, extension(name) === '.lopeimage' ? version : undefined);
  }
  async function open(place = false) {
    if (working.current) return; const path = await context.services.dialogs.openFile({ extensions: EXTENSIONS }); if (!path) return;
    if (all.current.some(s => s.path === path) && !place) { setActiveId(all.current.find(s => s.path === path)!.history.current.id); return; }
    const result = await task('Reading workspace file…', async () => { if (!context.services.files.readBinary) throw new Error('The shared filesystem binary service is unavailable. Use File → Open from Device or connect the workspace runtime.'); return context.services.files.readBinary(path); });
    if (result) await openData(result.data, baseName(path), path, result.version, place);
  }
  const openedLaunch = useRef('');
  useEffect(() => { if (!restored||!requestedPath || requestedPath === openedLaunch.current) return; openedLaunch.current = requestedPath;
    const existing=all.current.find(s=>s.path===requestedPath);if(existing){setActiveId(existing.history.current.id);return;}
    void (async () => { const result = await task('Opening workspace image…', async () => { if (!context.services.files.readBinary) throw new Error('The workspace binary file service is unavailable.'); return context.services.files.readBinary(requestedPath); }); if (result) await openData(result.data, baseName(requestedPath), requestedPath, result.version); })();
  }, [requestedPath,restored]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = context.services.files.subscribe(path => { clearTimeout(timer); timer = setTimeout(async () => {
      if (working.current) return;
      for (const s of all.current.filter(s => s.path && (!path || s.path === path || s.path.startsWith(path + '/')))) {
        try { const stat = await context.services.files.stat(s.path!); if (stat.version && stat.version !== s.version) { s.external = true; refresh(); setStatus('A project changed in the workspace. Reload it or save a copy.'); } }
        catch { s.external = true; refresh(); }
      }
    }, 250); }); return () => { off(); clearTimeout(timer); };
  }, [context.services.files]);
  async function write(path: string, data: Uint8Array, version?: string) {
    const fs = context.services.files; if (!fs.writeBinary) throw new Error('The shared filesystem binary service is unavailable. Use Download copy or connect the workspace runtime.');
    try { return await fs.writeBinary(path, data, version ? { version } : { createOnly: true }); }
    catch (cause) {
      if (version || errorCode(cause) !== 'CONFLICT') throw cause;
      if (!fs.readBinary) throw cause; const existing = await fs.readBinary(path);
      if (!(await confirm('Replace existing file?', `“${baseName(path)}” already exists in your workspace. Replace that version with this copy?`, 'Replace'))) return undefined;
      return fs.writeBinary(path, data, { version: existing.version });
    }
  }
  async function save(s = current.current, as = false): Promise<boolean> {
    if (!s || working.current) return false; const snapshot = s.history.current;
    let path = as ? undefined : s.path;
    if (!path) path = await context.services.dialogs.saveFile({ defaultName: snapshot.name.replace(/\.[^.]+$/, '') + '.lopeimage' }) || undefined;
    if (!path) return false;
    if (extension(path) !== '.lopeimage') { setError('Save native projects with the .lopeimage extension. Use Save a Copy for PSD or Export As for raster files.'); return false; }
    if (s.external && path === s.path) { setError('This project changed elsewhere. Reload it or use Save As to preserve your edits.'); return false; }
    const result = await task('Saving layered project…', async () => { const content = await worker.current.run<string>('serialize', { ...snapshot, name: baseName(path!) }); return write(path!, new TextEncoder().encode(content), path === s.path ? s.version : undefined); });
    if (!result?.version) return false;
    s.path = path; s.version = result.version; s.external = false; s.history.markSaved(snapshot.revision); s.history.view({ ...s.history.current, name: baseName(path) }); await removeRecovery(snapshot.id); refresh(); setStatus(`Saved ${baseName(path)}`); context.services.notify({ title: 'Prism', message: `Saved ${baseName(path)}`, tone: 'success' }); return true;
  }
  async function closeDocument(id?: string) {
    pendingEdit.current?.();
    const s = all.current.find(value => value.history.current.id === (id || current.current?.history.current.id)); if (!s || working.current || !(await requestGuard([s]))) return;
    await removeRecovery(s.history.current.id); const next = all.current.filter(value => value !== s); all.current = next; setSessions(next); setActiveId(next[next.length - 1]?.history.current.id || ''); setDraft(null); setTransforming(false);
  }
  async function closeAll(){pendingEdit.current?.();if(working.current||!(await requestGuard(all.current)))return;await Promise.all(all.current.map(s=>removeRecovery(s.history.current.id)));all.current=[];setSessions([]);setActiveId('');setDraft(null);setTransforming(false);journal.schedule({...editorState.current,sessions:[],activeId:'',pendingType:undefined});await journal.flush();}
  async function perform(name: string, action: string, payload: unknown) {
    const s = current.current; if (!s) return; const revision = s.history.current.revision;
    const result = await task(name + '…', () => worker.current.run<ImageDocument>(action, payload));
    if (result && current.current === s && s.history.current.revision === revision) commit(name, result);
  }
  async function copy(merged=false,cut=false){
    const snapshot=current.current?.history.current;if(!snapshot)return;const copied=await task('Copying selected pixels…',()=>worker.current.run<PixelClipboard>('clipboard-copy',{document:snapshot,merged}));if(!copied)return;clipboard.current=copied;refresh();
    if(cut)await perform('Cut','clear',snapshot);else setStatus(`Copied ${copied.pixels.width} × ${copied.pixels.height} pixels`);
  }
  function paste(inPlace=false){const snapshot=current.current?.history.current;if(!snapshot)return;if(clipboard.current)commit(inPlace?'Paste in Place':'Paste',pastePixels(snapshot,clipboard.current,inPlace));else setStatus('Copy pixels in the editor, or use Ctrl+V to paste an image from your device clipboard.');}
  async function pasteImage(file:File){
    const tab=current.current;const revision=tab?.history.current.revision;
    const pixels=await task('Pasting image…',async()=>{const data=new Uint8Array(await file.arrayBuffer());const decoded=await worker.current.run<{width:number;height:number;data:Uint8ClampedArray}>('raster-import',{data});return fromPixels(decoded.width,decoded.height,decoded.data);});if(!pixels)return;
    const copied:PixelClipboard={pixels,origin:{x:0,y:0},resolution:72};clipboard.current=copied;
    if(!tab){let next=newDocument(pixels.width,pixels.height,'Pasted image',[0,0,0,0]);next={...next,layers:[{...layer('Pasted image'),pixels}]};next.activeIds=[next.layers[0].id];append(next);}
    else if(current.current===tab&&tab.history.current.revision===revision)commit('Paste Image',pastePixels(tab.history.current,copied));
  }
  function previewFilter(filter:RasterFilter|null,smart:boolean){
    clearTimeout(filterPreviewTimer.current);filterPreview.current.cancel();const sequence=++filterPreviewSequence.current;const snapshot=current.current?.history.current;if(!filter||!snapshot){setDraft(null);return;}const selected=findLayer(snapshot);if(!selected)return;
    if(snapshot.selection||snapshot.target==='mask'){filterPreviewTimer.current=setTimeout(()=>{void filterPreview.current.run<ImageDocument>('filter',{document:snapshot,filter,smart}).then(result=>{if(alive.current&&sequence===filterPreviewSequence.current)setDraft(result);}).catch(cause=>{if(alive.current&&sequence===filterPreviewSequence.current)setError(errorMessage(cause));});},80);}
    else setDraft(updateLayer(snapshot,selected.id,l=>({...l,rasterFilters:[...(l.rasterFilters||[]),filter]})));
  }
  function download(data: Uint8Array, name: string, type: string) { const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function exportFile(format: string, quality: number, destination: 'workspace' | 'download') {
    const snapshot = current.current?.history.current; if (!snapshot) return;
    const name = snapshot.name.replace(/\.[^.]+$/, '') + '.' + format;
    const path = destination === 'workspace' ? await context.services.dialogs.saveFile({ defaultName: name }) : undefined; if (destination === 'workspace' && !path) return;
    const type = format === 'jpg' ? 'image/jpeg' : format === 'psd' ? 'image/vnd.adobe.photoshop' : `image/${format}`;
    const result = await task(format === 'psd' ? 'Writing layered PSD…' : 'Rendering export…', () => worker.current.run<Uint8Array>(format === 'psd' ? 'psd-export' : 'raster-export', format === 'psd' ? snapshot : { document: snapshot, type, quality })); if (!result) return;
    if (destination === 'download') { download(result, name, type); setStatus(`Downloaded ${name}`); setDialog(null); }
    else if (path) { const saved = await task('Writing export…', () => write(path, result)); if (saved) { setStatus(`Exported ${baseName(path)}`); setDialog(null); } }
  }
  function changeLayer(id: string, updater: (layer: Layer) => Layer, name: string) { commit(name, d => updateLayer(d, id, item=>{const next=updater(item);if(item.children&&next.transform!==item.transform&&next.children===item.children){const transformed=transformLayerWorld(item,multiply(matrixOf(next.transform),inverse(matrixOf(item.transform))));return {...next,children:transformed.children};}return next;}),/(Change|Opacity|^Move$|^Scale$|^Rotate$)/.test(name)?`${id}:${name}`:''); }
  function adjustment(id: AdjustmentId, smart = false) {
    if (!doc) return; const definition = adjustmentDefinitions[id];
    if (smart) { const active = findLayer(doc); if (!active || active.locked) return; commit('Add Smart Adjustment', updateLayer(doc, active.id, value => ({ ...value, filters: [...value.filters, { type: id, values: [...definition.initial] }] }))); }
    else commit('New Adjustment Layer', addLayer(doc, { ...layer(definition.label, 'adjustment'), adjustment: { type: id, values: [...definition.initial] }, mask: { pixels: surface(doc.width, doc.height, [255,255,255,255]), linked: true, enabled: true, transform: identity() } }));
    showPanel('Properties');
  }
  function showPanel(id: PanelId) { const next = { ...workspace, collapsed: false, hidden: workspace.hidden.filter(p => p !== id), active: [...workspace.active] }; const group = workspace.groups.findIndex(items => items.includes(id)); next.active[group >= 0 ? group : 1] = id; setWorkspace(next); }
  function view(zoom: number, pan = tab?.pan || { x: 0, y: 0 }) { if (tab) { tab.zoom = zoom; tab.pan = pan;tab.viewInitialized=true; refresh(); } }
  function fit(width?: number, height?: number,initial=false) { if (!current.current||initial&&current.current.viewInitialized) return; const area = document.querySelector(`[data-window-id="${context.windowId}"] .ie-canvas-area`)?.getBoundingClientRect(); const d = current.current.history.current; const zoom = Math.max(.02, Math.min(1, ((width || area?.width || 800) - 110) / d.width, ((height || area?.height || 600) - 110) / d.height)); current.current.zoom = zoom; current.current.pan = { x: 0, y: 0 };current.current.viewInitialized=true; refresh(); }
  useEffect(() => { const handler = () => fit(); window.addEventListener('lope:image-fit', handler); return () => window.removeEventListener('lope:image-fit', handler); }, [tab]);
  function textAt(point: Point, id?: string) { setTypeTarget({ point, id }); setDialog('type'); }
  function merge(visible = false, flatten = false) { if (!doc) return; const ids = visible ? doc.layers.filter(l => l.visible).map(l => l.id) : doc.activeIds; const chosen = { ...doc, layers: doc.layers.filter(l => ids.includes(l.id)) }; const r = new CanvasRenderer(); const data = context2d(r.render(chosen)).getImageData(0,0,doc.width,doc.height).data; r.dispose(); let next = mergeLayers(doc, ids, data); if (flatten) next = { ...next, layers: next.layers.filter(l => l.visible) }; commit(flatten ? 'Flatten Image' : visible ? 'Merge Visible' : 'Merge Layers', next); }
  function stepHistory(direction: 'undo' | 'redo') { if (!tab || working.current) return; direction === 'undo' ? tab.history.undo() : tab.history.redo(); setTransforming(false); setDraft(null); refresh(); }
  function transformDialog() { if (!doc) return; const active = findLayer(doc); if (!active) return; setTransformValues(active.transform); setDialog('transform'); }
  function rotateImage(clockwise:boolean){if(doc)commit('Rotate Image',rotateDocument(doc,clockwise));}
  const active = doc && findLayer(doc); const editable = Boolean(doc && !busy); const unlocked = Boolean(editable && active && !active.locked);
  const command = (id: string, label: string, execute: () => void | Promise<unknown>, shortcut?: string, enabled = true, checked?: boolean): Command => ({ id: id as Command['id'], label, shortcut, enabled:enabled&&restored, checked, execute: async () => { await execute(); } });
  const commands: Command[] = [
    command('image.local-ai','Local AI — Select & Mask…',()=>{setAiTab('portrait');setAiExpand(false);setDialog('local-ai');},undefined,editable),command('image.ai-fill','Generative Fill…',()=>{setAiTab('generate');setAiExpand(false);setDialog('local-ai');},undefined,editable&&Boolean(doc?.selection)),command('image.ai-expand','Generative Expand…',()=>{setAiTab('generate');setAiExpand(true);setDialog('local-ai');},undefined,editable),
    command('image.close-all','Close All',closeAll,'Mod+Alt+W',Boolean(sessions.length)&&!busy),command('image.trim','Trim Transparent Edges',()=>doc&&perform('Trim','trim',{document:doc}),undefined,editable),command('image.reveal-all','Reveal All',()=>doc&&commit('Reveal All',revealAll(doc)),undefined,editable),command('image.color-range','Color Range…',()=>{setRangeColor(foreground);setDialogAmount(40);setDialog('color-range');},undefined,editable),
    command('image.new', 'New…', () => setDialog('new'), 'Mod+N', !busy), command('image.open', 'Open…', () => open(), 'Mod+O', !busy), command('image.device-open', 'Open from Device…', () => deviceInput.current?.click(), undefined, !busy), command('image.place', 'Place Embedded…', () => open(true), undefined, editable),
    command('image.save', 'Save', () => save(), 'Mod+S', editable), command('image.save-as', 'Save As…', () => save(tab, true), 'Mod+Shift+S', editable), command('image.export', 'Export As…', () => setDialog('export'), 'Mod+Alt+Shift+S', editable), command('image.psd-export', 'Photoshop PSD…', () => setDialog('psd-export'), undefined, editable), command('image.close', 'Close', () => closeDocument(), 'Mod+W', editable),
    command('image.undo', `Undo${tab?.history.canUndo ? ' ' + tab.history.entries[tab.history.index].name : ''}`, () => stepHistory('undo'), 'Mod+Z', editable && Boolean(tab?.history.canUndo)), command('image.redo', 'Redo', () => stepHistory('redo'), 'Mod+Shift+Z', editable && Boolean(tab?.history.canRedo)),
    command('image.copy','Copy',()=>copy(),'Mod+C',editable&&Boolean(active)),command('image.copy-merged','Copy Merged',()=>copy(true),'Mod+Shift+C',editable),command('image.cut','Cut',()=>copy(false,true),'Mod+X',unlocked&&(active?.kind==='raster'||doc?.target==='mask')),command('image.paste','Paste',()=>paste(),'Mod+V',editable&&Boolean(clipboard.current)),command('image.paste-in-place','Paste in Place',()=>paste(true),'Mod+Shift+V',editable&&Boolean(clipboard.current)),command('image.clear','Clear',()=>doc&&perform('Clear','clear',doc),'Delete',unlocked&&(active?.kind==='raster'||doc?.target==='mask')),
    command('image.layer-via-copy','Layer via Copy',()=>doc&&perform('Layer via Copy','layer-via-copy',{document:doc}),'Mod+J',editable&&Boolean(active)),command('image.layer-via-cut','Layer via Cut',()=>doc&&perform('Layer via Cut','layer-via-copy',{document:doc,cut:true}),'Mod+Shift+J',unlocked&&active?.kind==='raster'),
    command('image.new-layer', 'New Layer…', () => commit('New Layer', d => newPixelLayer(d)), 'Mod+Shift+N', editable), command('image.duplicate', 'Duplicate Layer…', () => commit('Duplicate Layer', d => duplicateLayer(d)), undefined, editable && Boolean(active)), command('image.group', 'Group Layers', () => commit('Group Layers', d => groupLayers(d)), 'Mod+G', editable && Boolean(active)),
    command('image.ungroup', 'Ungroup Layers', () => { if (!doc || !active?.children) return; const replace = (items: Layer[]): Layer[] => items.flatMap(item => item.id === active.id ? item.children || [] : item.children ? [{ ...item, children: replace(item.children) }] : [item]); commit('Ungroup Layers', { ...doc, layers: replace(doc.layers), activeIds: active.children.map(l => l.id) }); }, 'Mod+Shift+G', unlocked && active?.kind === 'group'),
    command('image.delete-layer', 'Delete Layer', () => commit('Delete Layer', d => removeLayers(d, d.activeIds.filter(id => !findLayer(d, id)?.locked))), undefined, unlocked), command('image.mask', 'Add Layer Mask', () => commit('Add Layer Mask', d => addMask(d)), undefined, unlocked && !active?.mask), command('image.remove-mask', 'Delete Layer Mask', () => active && changeLayer(active.id, item => ({ ...item, mask: undefined }), 'Delete Layer Mask'), undefined, unlocked && Boolean(active?.mask)),
    command('image.clipping', active?.clipping ? 'Release Clipping Mask' : 'Create Clipping Mask', () => active && changeLayer(active.id, item => ({ ...item, clipping: !item.clipping }), 'Clipping Mask'), 'Mod+Alt+G', unlocked), command('image.embed', 'Convert to Smart Object', () => commit('Convert to Embedded Source', d => embedLayer(d)), undefined, unlocked && active?.kind === 'raster'), command('image.reset-source', 'Reset Transform', () => commit('Reset Smart Object Transform', d => resetSourceTransform(d)), undefined, unlocked && active?.kind === 'embedded'),
    command('image.rasterize', 'Rasterize Layer', () => { if (!active || !doc) return; const r = new CanvasRenderer(); const data = context2d(r.content({ ...active, mask: undefined, opacity: 1, fill: 1, effects: [] }, doc)).getImageData(0,0,doc.width,doc.height).data; r.dispose(); changeLayer(active.id, item => ({ ...item, kind: 'raster', pixels: fromPixels(doc.width,doc.height,data), text: undefined, shape: undefined, source: undefined,embeddedAsset:undefined, transform: identity(), filters: [],rasterFilters:[] }), 'Rasterize Layer'); }, undefined, unlocked && Boolean(active && ['text','shape','embedded'].includes(active.kind))),
    command('image.merge', 'Merge Layers', () => merge(), 'Mod+E', editable && doc!.activeIds.length > 1 && doc!.activeIds.every(id => doc!.layers.some(l => l.id === id && !l.locked))), command('image.merge-visible', 'Merge Visible', () => merge(true), 'Mod+Shift+E', editable), command('image.flatten', 'Flatten Image', () => merge(true,true), undefined, editable),
    command('image.bring-forward', 'Bring Forward', () => { if (!active || !doc) return; const at = doc.layers.indexOf(active); if (at >= 0 && at < doc.layers.length - 1) commit('Bring Forward', reorderLayer(doc, active.id, doc.layers[at+1].id)); }, 'Mod+]', unlocked), command('image.send-backward', 'Send Backward', () => { if (!active || !doc) return; const at = doc.layers.indexOf(active); if (at > 0) commit('Send Backward', reorderLayer(doc, doc.layers[at-1].id, active.id)); }, 'Mod+[', unlocked),
    command('image.fill', 'Fill with Foreground', () => doc && perform('Fill', 'fill', { document: doc, color: foreground }), 'Alt+Backspace', unlocked && (active?.kind === 'raster' || doc?.target === 'mask')), command('image.transform', 'Free Transform', () => setTransforming(true), 'Mod+T', unlocked), command('image.transform-dialog', 'Scale and Rotate…', transformDialog, undefined, unlocked), command('image.flip-horizontal', 'Flip Horizontal', () => doc&&commit('Flip Horizontal',flipSelected(doc,true)), undefined, unlocked), command('image.flip-vertical', 'Flip Vertical', () => doc&&commit('Flip Vertical',flipSelected(doc,false)), undefined, unlocked),
    command('image.image-size', 'Image Size…', () => setDialog('image-size'), 'Mod+Alt+I', editable), command('image.canvas-size', 'Canvas Size…', () => setDialog('canvas-size'), 'Mod+Alt+C', editable), command('image.crop', 'Crop', () => { if (!doc) return; const bounds = selectionBounds(doc); if (bounds) commit('Crop',cropDocument(doc,bounds)); else setTool('crop'); }, undefined, editable), command('image.rotate-cw', '90° Clockwise', () => rotateImage(true), undefined, editable), command('image.rotate-ccw', '90° Counter Clockwise', () => rotateImage(false), undefined, editable),
    command('image.edit-text', 'Edit Type…', () => textAt(active?.text ? { x: active.transform.x, y: active.transform.y } : { x: 100, y: 100 }, active?.text ? active.id : undefined), undefined, editable), command('image.effects', 'Blending Options…', () => setDialog('effects'), undefined, unlocked),
    command('image.quick-mask','Quick Mask Mode',()=>{const s=current.current;if(s){s.history.view({...s.history.current,quickMask:!s.history.current.quickMask});refresh();}},'Q',editable,Boolean(doc?.quickMask)),
    command('image.save-selection','Save Selection',()=>commit('Save Selection',d=>({...d,savedSelections:[...(d.savedSelections||[]),{id:uid(),name:`Alpha ${(d.savedSelections?.length||0)+1}`,pixels:d.selection!.slice()}]})),undefined,editable&&Boolean(doc?.selection)),
    command('image.select-all', 'All', () => commit('Select All', d => ({ ...d, selection: new Uint8Array(d.width * d.height).fill(255) })), 'Mod+A', editable), command('image.deselect', 'Deselect', () => { if (tab && doc?.selection) tab.lastSelection = { width: doc.width, height: doc.height, coverage: doc.selection.slice() }; commit('Deselect', d => ({ ...d, selection: null })); }, 'Mod+D', editable && Boolean(doc?.selection)), command('image.reselect', 'Reselect', () => commit('Reselect', d => ({ ...d, selection: tab?.lastSelection?.coverage.slice() || null })), 'Mod+Shift+D', editable && Boolean(tab?.lastSelection && tab.lastSelection.width === doc?.width && tab.lastSelection.height === doc?.height)), command('image.invert', 'Inverse', () => commit('Inverse Selection', d => ({ ...d, selection: d.selection?.map(v => 255 - v) || new Uint8Array(d.width * d.height).fill(255) })), 'Mod+Shift+I', editable), command('image.select-layers', 'All Layers', () => doc && select(allLayers(doc.layers).map(l => l.id)), 'Mod+Alt+A', editable),
    ...(['feather','expand','contract','border','smooth'] as const).map(id => command(`image.${id}`, `${id[0].toUpperCase()+id.slice(1)}…`, () => setDialog(id), id === 'feather' ? 'Shift+F6' : undefined, editable && Boolean(doc?.selection))),
    ...Object.entries(adjustmentDefinitions).map(([id, d]) => command(`image.adjust-${id}`, `${d.label}…`, () => adjustment(id as AdjustmentId), undefined, editable)),
    ...(['brightness','levels','hue'] as const).map(id => command(`image.smart-${id}`, `${adjustmentDefinitions[id].label}…`, () => adjustment(id,true), undefined, unlocked && active?.kind === 'embedded')),
    ...Object.entries(filterNames).map(([type,name])=>command(`image.filter-${type}`,name+'…',()=>{setFilterType(type as RasterFilter['type']);setDialog('filter');},type==='invert'?'Mod+I':type==='grayscale'?'Mod+Shift+U':undefined,unlocked&&Boolean(active&&(active.kind==='raster'||active.kind==='embedded'||doc?.target==='mask')))),
    command('image.zoom-in', 'Zoom In', () => view(Math.min(32,(tab?.zoom || 1)*1.5)), 'Mod+=', editable), command('image.zoom-out', 'Zoom Out', () => view(Math.max(.02,(tab?.zoom || 1)/1.5)), 'Mod+-', editable), command('image.fit', 'Fit on Screen', () => fit(), 'Mod+0', editable), command('image.actual', '100%', () => view(1,{ x:0,y:0 }), 'Mod+1', editable),
    command('image.rulers', 'Rulers', () => setWorkspace({ ...workspace, rulers: !workspace.rulers }), 'Mod+R', true, workspace.rulers), command('image.guides', 'Guides', () => setWorkspace({ ...workspace, guides: !workspace.guides }), undefined, true, workspace.guides), command('image.clear-guides', 'Clear Guides', () => commit('Clear Guides', d => ({ ...d, guides: [] })), undefined, editable && Boolean(doc?.guides.length)),
    ...(['Layers','History','Properties','Color','Adjustments','Channels','Paths'] as const).map(id => command(`image.${id.toLowerCase()}`, id, () => showPanel(id), undefined, true, !workspace.hidden.includes(id))), command('image.taskbar', 'Contextual Task Bar', () => setWorkspace({ ...workspace, taskBar: !workspace.taskBar }), undefined, true, workspace.taskBar), command('image.toggle-panels', 'Hide / Show Panels', () => setWorkspace({ ...workspace, collapsed: !workspace.collapsed })), command('image.toggle-columns', 'Toolbar Columns', () => setWorkspace({ ...workspace, columns: !Boolean(appRoot.current?.querySelector('.ie-toolbar-double')), autoColumns: false })),
    command('image.save-workspace', 'New Workspace…', () => setDialog('workspace')), command('image.restore-workspace', 'Restore Saved Workspace', () => setWorkspace(context.services.settings.get('image-editor.saved-workspace', essentials()))), command('image.reset-workspace', 'Reset Essentials', () => { setWorkspace(essentials()); setStatus('Essentials workspace reset'); }),
    command('image.about', 'About Prism…', () => setDialog('about')), command('image.shortcuts', 'Keyboard Shortcuts…', () => setDialog('shortcuts')), command('image.compatibility', 'Format Compatibility…', () => setDialog('compatibility')), command('image.sample', 'Open Layered Sample', () => append(sampleDocument())),
  ];
  useAppCommands(context, commands);
  const commandsRef = useRef(commands); commandsRef.current = commands;
  function execute(id: string) { const c = commandsRef.current.find(item => item.id === id); if (c && (typeof c.enabled === 'function' ? c.enabled() : c.enabled !== false)) void c.execute(); }
  useEffect(() => {
    const root = appRoot.current;
    const key = (event: Event) => {
      const e = event as KeyboardEvent;
      if ((e.target as HTMLElement).closest('[role="menu"],[role="menubar"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w' && !dialog && !guard && !confirmation) { e.preventDefault(); e.stopPropagation(); void closeDocument(); return; }
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
      if (dialog || guard || confirmation) return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v'&&!clipboard.current){e.stopPropagation();return;}
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') { e.preventDefault(); const sign=e.code==='BracketRight'?1:-1;setBrush(b => e.shiftKey?({...b,hardness:Math.max(0,Math.min(1,b.hardness+sign*.25))}):({ ...b, size: Math.max(1, Math.min(2500, b.size + sign*5)) })); return; }
      if(e.key.toLowerCase()==='q'){e.preventDefault();execute('image.quick-mask');return;}
      if (e.key.toLowerCase() === 'x') { e.preventDefault(); setForeground(background); setBackground(foreground); return; }
      if (e.key.toLowerCase() === 'd') { setForeground('#000000'); setBackground('#ffffff'); return; }
      if (/^[0-9]$/.test(e.key)) { const value = e.key === '0' ? 1 : +e.key / 10; setBrush(b => ({ ...b, [e.shiftKey ? 'flow' : 'opacity']: value })); return; }
      const group = TOOL_GROUPS.find(g => g.some(t => t.key.toLowerCase() === e.key.toLowerCase() && !t.disabled)); if (group) { e.preventDefault(); const at = group.findIndex(t => t.id === tool); setTool(e.shiftKey ? group[(at + 1) % group.length].id : group.find(t => t.id === tool)?.id || group[0].id); }
      if (e.key === 'Tab') { e.preventDefault(); setWorkspace({ ...workspace, collapsed: !workspace.collapsed }); }
    };
    root?.addEventListener('keydown', key); return () => root?.removeEventListener('keydown', key);
  }, [context.windowId, tool, foreground, background, workspace, dialog, guard, confirmation]);
  function dismissDialog() { filterPreviewSequence.current++;clearTimeout(filterPreviewTimer.current);filterPreview.current.cancel();setDialog(null); setDraft(null); }
  async function restoreRecovery() {
    const records = [...recoveries]; setRecoveries([]);
    for (const record of records) { const result = await task('Restoring interrupted session…', () => worker.current.run<ImageDocument>('deserialize', record.content)); if (result) append(result, record.path, record.version, record.savedRevision); }
    setStatus('Recovered editable documents');
  }
  return <div ref={appRoot} data-glass-tone="dark" className="lope-image-editor" data-testid="image-editor-app" data-session-ready={restored} data-document-revision={doc?.revision} data-tool={tool} onPaste={e=>{if((e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]'))return;const image=Array.from(e.clipboardData.files).find(file=>file.type.startsWith('image/'));if(image){e.preventDefault();void pasteImage(image);}}} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); const file = e.dataTransfer.files[0]; void file.arrayBuffer().then(buffer => openData(new Uint8Array(buffer), file.name)); }}>
    <input hidden type="file" ref={deviceInput} accept={EXTENSIONS.join(',')} aria-label="Open image from device" onChange={e => { const file = e.target.files?.[0]; if (file) void file.arrayBuffer().then(data => openData(new Uint8Array(data), file.name)); e.target.value = ''; }}/>
    <MenuBar commands={commands} execute={execute} onWorkspace={() => setWorkspaceMenu(!workspaceMenu)}/>
    <OptionsBar tool={tool} brush={brush} setBrush={setBrush} options={options} setOptions={setOptions} onAlign={alignment => commit('Align Layers', d => alignLayers(d, alignment as Parameters<typeof alignLayers>[1]))} onTransform={transformDialog} onFit={() => fit()} onActual={() => view(1)} onText={() => execute('image.edit-text')} foreground={foreground} typeStyle={active?.text||typeDefaults} onTypeStyle={text=>{setTypeDefaults(text);if(active?.text)changeLayer(active.id,l=>({...l,text}),'Type Style Change');}}/>
    {workspaceMenu && <div className="ie-workspace-menu"><strong>Essentials</strong>{Object.keys(savedWorkspaces).map(name=><button key={name} onClick={()=>{setWorkspace(savedWorkspaces[name]);setWorkspaceMenu(false);setStatus(`Restored ${name}`);}}>{name}</button>)}{['image.save-workspace','image.restore-workspace','image.reset-workspace'].map(id => <button key={id} onClick={() => { execute(id); setWorkspaceMenu(false); }}>{commands.find(c => c.id === id)?.label}</button>)}</div>}
    {error && <div className="ie-error" role="alert"><span>{error}</span><button aria-label="Dismiss image editor error" onClick={() => setError('')}><X size={14}/></button></div>}
    {tab?.external && <div className="ie-external-change" role="alert"><span>This project changed elsewhere. Your edits are preserved.</span><button onClick={() => void save(tab,true)}>Save As…</button><button onClick={async () => { if (!tab.path || !(await requestGuard([tab]))) return; const result = await task('Reloading project…', async () => { const data = await context.services.files.readBinary!(tab.path!); return { document: await worker.current.run<ImageDocument>('deserialize', new TextDecoder().decode(data.data)), version: data.version }; }); if (result) { tab.history = new History(result.document); tab.version = result.version; tab.external = false; refresh(); } }}>Reload</button></div>}
    <div className="ie-workspace"><Toolbar quickMask={doc?.quickMask} onQuickMask={()=>execute('image.quick-mask')} tool={tool} setTool={setTool} foreground={foreground} background={background} onColor={target => setDialog(`color-${target}`)} swap={() => { setForeground(background); setBackground(foreground); }} reset={() => { setForeground('#000000'); setBackground('#ffffff'); }} columns={workspace.columns} autoColumns={workspace.autoColumns!==false} setColumns={columns => setWorkspace({ ...workspace, columns, autoColumns: false })}/>
      <main className="ie-document-area"><div className="ie-document-tabs" role="tablist" aria-label="Image documents">{sessions.map(s => <div className={`ie-document-tab ${s === tab ? 'is-active' : ''}`} key={s.history.current.id}><button role="tab" aria-selected={s === tab} onClick={() => { setActiveId(s.history.current.id); setDraft(null); setTransforming(false); }}>{s.history.current.name} @ {Math.round(s.zoom*1000)/10}% ({findLayer(s.history.current)?.name || 'RGB'}, RGB/8){s.history.dirty && <span aria-label="Modified"> *</span>}</button><button className="ie-tab-close" aria-label={`Close ${s.history.current.name}`} onClick={() => void closeDocument(s.history.current.id)}><X size={11}/></button></div>)}</div>
        <CanvasView doc={draft || doc} tool={tool} brush={brush} options={options} foreground={foreground} background={background} zoom={tab?.zoom || .5} pan={tab?.pan || {x:0,y:0}} onView={view} onCommit={commit} onSelect={select} onColor={setForeground} onText={textAt} onOperation={(name,action,payload) => void perform(name,action,payload)} onError={setError} onCommand={execute} onPendingEdit={finish=>{pendingEdit.current=finish;}} onTypeDraft={setPendingType} typeStyle={active?.text||typeDefaults} onFit={(width,height)=>fit(width,height,true)} transforming={transforming} setTransforming={setTransforming} workspace={workspace} setWorkspace={setWorkspace} busy={Boolean(busy)||!restored}/>
        <footer className="ie-document-status"><input aria-label="Canvas zoom percentage" type="number" min={2} max={3200} value={Math.round((tab?.zoom || .5)*1000)/10} onChange={e => view(Math.min(32,Math.max(.02,+e.target.value/100)))}/><span>%</span><i/><span>{doc ? `${doc.width} px × ${doc.height} px (${doc.resolution} ppi)` : 'No document'}</span><ChevronDown size={10}/><span className="ie-status-message" role="status">{status}</span></footer>
      </main>
      <Panels commands={commands} background={background} onDocumentChange={commit} doc={doc} history={tab?.history} workspace={workspace} setWorkspace={setWorkspace} foreground={foreground} onColor={setForeground} onCommand={execute} onLayerChange={changeLayer} onSelect={select} onReorder={(id,target,inside) => commit('Reorder Layers', d => reorderLayer(d,id,target,inside))} onHistory={index => { if (tab && !busy) { tab.history.go(index); refresh(); } }} onSnapshot={index => { if (!tab) return; if (index === undefined) { try { tab.history.snapshot(); refresh(); } catch (error) { setError(errorMessage(error)); } } else commit('Restore Snapshot', tab.history.snapshots[index].document); }} onAdjustment={adjustment} onPath={id => { const path = doc?.paths.find(p => p.id === id); if (path && doc) commit('Selection from Path', selectPolygon(doc,path.points)); }}/>
    </div>
    {busy && <div className="ie-progress" role="status"><LoaderCircle className="ie-spinning" size={16}/><span>{busy}</span><button onClick={cancel}>Cancel</button></div>}
    {dialog==='local-ai'&&doc&&<Suspense fallback={<Modal title="Local AI" onClose={dismissDialog}><p>Loading local AI tools…</p></Modal>}><LocalAiDialog document={doc} initialTab={aiTab} initialExpand={aiExpand} onApply={commit} onClose={dismissDialog}/></Suspense>}
    {dialog==='color-range'&&doc&&<Modal title="Color Range" onClose={dismissDialog} footer={<><button onClick={dismissDialog}>Cancel</button><button className="ie-dialog-confirm" onClick={()=>{void perform('Color Range','color-range',{document:doc,color:color(rangeColor),amount:dialogAmount,mode:options.selectionMode});dismissDialog();}}>OK</button></>}><label className="ie-dialog-field">Sampled color<input type="color" aria-label="Sampled color" value={rangeColor} onChange={e=>setRangeColor(e.target.value)}/></label><NumberField label="Fuzziness" value={dialogAmount} min={1} max={255} onChange={setDialogAmount}/><p className="ie-dialog-note">Select similar colors across the visible image. Fuzziness controls soft selection coverage.</p></Modal>}
    {dialog === 'workspace' && <Modal title="New Workspace" onClose={dismissDialog} footer={<><button onClick={dismissDialog}>Cancel</button><button className="ie-dialog-confirm" disabled={!workspaceName.trim()} onClick={()=>{const next={...savedWorkspaces,[workspaceName.trim()]:workspace};setSavedWorkspaces(next);context.services.settings.set('image-editor.workspaces',next);context.services.settings.set('image-editor.saved-workspace',workspace);setStatus(`Saved workspace ${workspaceName.trim()}`);setDialog(null);}}>Save</button></>}><label className="ie-dialog-field">Name<input aria-label="Workspace name" value={workspaceName} onChange={e=>setWorkspaceName(e.target.value)}/></label><p className="ie-dialog-note">Save panel groups, active tabs, floating positions, toolbar columns, rulers and the Contextual Task Bar.</p></Modal>}
    {dialog === 'new' && <NewDocumentDialog saved={documentPresets} recent={recentPresets} onSavePreset={preset=>{try{const next=[preset,...documentPresets.filter(p=>p.name!==preset.name)].slice(0,50);context.services.settings.set('image-editor.document-presets',next);setDocumentPresets(next);}catch(cause){setError(errorMessage(cause));}}} onDeletePreset={name=>{try{const next=documentPresets.filter(p=>p.name!==name);context.services.settings.set('image-editor.document-presets',next);setDocumentPresets(next);}catch(cause){setError(errorMessage(cause));}}} onClose={dismissDialog} onCreate={(width,height,name,transparent,resolution) => { try { const d = newDocument(width,height,name,transparent ? [0,0,0,0] : [255,255,255,255]); d.resolution=resolution; append(d); setDialog(null); const recent=[{name:name.trim()||'Untitled',width,height,resolution,transparent},...recentPresets.filter(p=>p.name!==name.trim())].slice(0,12);context.services.settings.set('image-editor.recent-presets',recent);setRecentPresets(recent); } catch(cause) { setError(errorMessage(cause)); } }}/ >}
    {(dialog === 'image-size' || dialog === 'canvas-size') && doc && <SizeDialog doc={doc} canvas={dialog === 'canvas-size'} onClose={dismissDialog} onApply={(width,height,resolution,anchor) => { try { commit(dialog === 'canvas-size' ? 'Canvas Size' : 'Image Size', dialog === 'canvas-size' ? resizeCanvas(doc,width,height,anchor === 'top-left' ? {x:0,y:0} : anchor === 'bottom-right' ? {x:width-doc.width,y:height-doc.height} : undefined) : resizeImage(doc,width,height,resolution)); setDialog(null); fit(); } catch(cause) { setError(errorMessage(cause)); } }}/ >}
    {(dialog === 'color-foreground' || dialog === 'color-background') && <ColorPicker initial={dialog === 'color-foreground' ? foreground : background} target={dialog === 'color-foreground' ? 'Foreground' : 'Background'} onClose={dismissDialog} onApply={value => { dialog === 'color-foreground' ? setForeground(value) : setBackground(value); setDialog(null); }}/ >}
    {dialog === 'type' && doc && <TypeDialog initial={typeDefaults} existing={typeTarget.id ? findLayer(doc,typeTarget.id) : undefined} point={typeTarget.point} foreground={foreground} onClose={dismissDialog} onApply={text => { if (typeTarget.id) changeLayer(typeTarget.id,item => ({ ...item,text,name:text.content.slice(0,24) || item.name }),'Edit Type'); else { const next = createTextLayer(doc,typeTarget.point,text.content,foreground); const id=next.activeIds[0]; commit('New Type Layer',updateLayer(next,id,item => ({...item,text}))); } setDialog(null); }}/ >}
    {(dialog === 'export' || dialog === 'psd-export') && doc && <ExportDialog doc={doc} psd={dialog === 'psd-export'} warnings={dialog === 'psd-export' ? psdCompatibility(doc) : []} onClose={dismissDialog} onExport={(format,quality,destination) => void exportFile(format,quality,destination)}/ >}
    {dialog === 'effects' && active && <EffectsDialog existing={active} onClose={dismissDialog} onApply={effects => { changeLayer(active.id,item => ({ ...item,effects }),'Layer Style'); setDialog(null); }}/ >}
    {dialog==='filter'&&doc&&active&&<FilterDialog type={filterType} smart={active.kind==='embedded'&&doc.target!=='mask'} allowSmart={doc.target!=='mask'} onClose={dismissDialog} onPreview={previewFilter} onApply={(filter,smart)=>{dismissDialog();void perform(filterNames[filter.type], 'filter',{document:doc,filter,smart});}}/>}
    {dialog === 'transform' && doc && active && <Modal title="Transform" onClose={dismissDialog} footer={<><button onClick={dismissDialog}>Cancel</button><button className="ie-dialog-confirm" onClick={() => { commit('Free Transform', draft || replaceLayerTransform(doc,active.id,transformValues)); dismissDialog(); }}>OK</button></>}><div className="ie-transform-dialog">{(['x','y','scaleX','scaleY','rotation'] as const).map(key => <NumberField key={key} label={{x:'Horizontal',y:'Vertical',scaleX:'Width',scaleY:'Height',rotation:'Angle'}[key]} value={transformValues[key] * (key.startsWith('scale') ? 100 : 1)} suffix={key.startsWith('scale') ? '%' : key === 'rotation' ? '°' : 'px'} onChange={value => { const next = { ...transformValues,[key]:key.startsWith('scale') ? (value || 1)/100 : value }; setTransformValues(next); setDraft(replaceLayerTransform(doc,active.id,next)); }}/>)}</div><p className="ie-dialog-note">Source pixels remain unchanged until you explicitly rasterize or merge.</p></Modal>}
    {(dialog === 'feather' || dialog === 'expand' || dialog === 'contract'||dialog==='border'||dialog==='smooth') && doc && <Modal title={`${dialog[0].toUpperCase()+dialog.slice(1)} Selection`} onClose={dismissDialog} footer={<><button onClick={dismissDialog}>Cancel</button><button className="ie-dialog-confirm" onClick={() => { void perform(`${dialog} Selection`,['feather','border','smooth'].includes(dialog)?dialog:'grow',{document:doc,amount:dialog === 'contract' ? -dialogAmount : dialogAmount}); setDialog(null); }}>OK</button></>}><NumberField label="Radius" value={dialogAmount} min={1} max={dialog === 'feather' ? 100 : 64} suffix="pixels" onChange={setDialogAmount}/></Modal>}
    {dialog === 'about' && <Modal title="About Prism" onClose={dismissDialog} footer={<button className="ie-dialog-confirm" onClick={dismissDialog}>OK</button>}><div className="ie-about"><AppIcon name="image-editor" size={64}/><h2>LopeOS Prism</h2><p>Version 0.1.0</p><p>Original sample artwork and Lucide icons (ISC). PSD support: ag-psd (MIT).</p><button onClick={() => setDialog('compatibility')}>Format compatibility</button></div></Modal>}
    {dialog === 'shortcuts' && <Modal title="Keyboard Shortcuts" onClose={dismissDialog} footer={<button onClick={dismissDialog}>Close</button>}><div className="ie-shortcut-list">{[['V / M / L / W','Move / marquee / lasso / wand'],['B / E / S / J','Brush / eraser / clone / healing'],['C / T / U / P','Crop / type / shape / pen'],['H / Z / Space','Hand / zoom / temporary Hand'],['[ / ]','Decrease / increase brush size'],['D / X','Default colors / swap colors'],['Shift + tool letter','Cycle tools in a group'],['Ctrl+T / Enter / Esc','Transform / commit / cancel'],['Ctrl+Z / Ctrl+Shift+Z','Undo / redo'],['Ctrl+S / Ctrl+Shift+S','Save / Save As'],['Ctrl+D / Ctrl+Shift+I','Deselect / invert selection'],['Ctrl+0 / Ctrl+1','Fit / actual size'],['Shift / Alt / Shift+Alt','Add / subtract / intersect selection'],['Alt-click (clone / healing)','Set sample source']].map(([shortcut,label]) => <div key={shortcut}><kbd>{shortcut}</kbd><span>{label}</span></div>)}</div></Modal>}
    {dialog === 'compatibility' && <Modal title="Format Compatibility" onClose={dismissDialog} footer={<button onClick={dismissDialog}>Close</button>}><div className="ie-compatibility"><p><strong>Native .lopeimage:</strong> tiles, editable text/shapes, groups, masks, selections, paths, guides, adjustments, effects, preserved sources and filters. Full original PSD retained after import.</p><p><strong>PSD:</strong> limited RGB/8 support for raster layers, groups, basic text, masks, opacity, fill, supported blend modes and fourteen adjustment types. Review the export report for features that will be converted or lost.</p><p><strong>PNG/JPEG/WebP:</strong> raster import/export. PNG and WebP retain alpha; JPEG uses a white matte. GIF/BMP import uses the browser decoder; only the first GIF frame is imported.</p><p><strong>Color:</strong> browser sRGB, 8 bits per channel. ICC transforms, CMYK, Lab, 16/32-bit, RAW and PSB editing are unavailable.</p><p><strong>Approximations:</strong> healing uses sampled color correction; curves use three linear control points; typography, adjustments, layer effects and interpolation may differ from Photoshop.</p><p>Quick Mask, saved alpha selections, editable filters and local portrait selection are available. Optional Generative Fill and Expand connect to a user-installed localhost ComfyUI engine. Advanced filters, full channel editing, actions, plugins, cloud libraries and Adobe account services remain unavailable.</p></div></Modal>}
    {guard && <Modal title="Save changes before closing?" onClose={() => finishGuard(false)} footer={<><button onClick={() => finishGuard(false)}>Cancel</button><button onClick={async () => { await Promise.all(guard.map(s => removeRecovery(s.history.current.id))); finishGuard(true); }}>Don't Save</button><button className="ie-dialog-confirm" onClick={async () => { for (const s of guard) if (!(await save(s))) return; finishGuard(true); }}>Save</button></>}><p>Save changes to {guard.map(s => `“${s.history.current.name}”`).join(', ')}?</p></Modal>}
    {confirmation && <Modal title={confirmation.title} onClose={() => finishConfirmation(false)} footer={<><button onClick={() => finishConfirmation(false)}>Cancel</button><button className="ie-dialog-confirm" onClick={() => finishConfirmation(true)}>{confirmation.accept}</button></>}><div className="ie-confirmation-message">{confirmation.message}</div></Modal>}
    {recoveries.length > 0 && <Modal title="Recover interrupted session" onClose={() => setRecoveries([])} footer={<><button onClick={() => setRecoveries([])}>Later</button><button onClick={async () => { await Promise.all(recoveries.map(r => removeRecovery(r.id))); setRecoveries([]); }}>Discard Recovery</button><button className="ie-dialog-confirm" onClick={() => void restoreRecovery()}>Recover</button></>}><p>{recoveries.length} editable {recoveries.length === 1 ? 'document was' : 'documents were'} preserved during an interrupted session.</p>{recoveries.map(r => <p key={r.id}>{r.path ? baseName(r.path) : 'Unsaved image'} · {new Date(r.updated).toLocaleString()}</p>)}</Modal>}
  </div>;
}
