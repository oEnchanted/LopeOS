import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, FileText, MessageSquare, Minus, Plus, Redo2, Save, Search, Settings, Share2, Undo2, X } from 'lucide-react';
import type { AppContext, Command } from '../../../../../packages/contracts/src';
import { useBeforeClose } from '../../../../../packages/sdk/src';
import { WriterEngine, assertReceipt, createDocument, emptySnapshot, inspectPackage, type CompatibilityReport, type SelectionCapture, type WriterSnapshot } from '../../../../../packages/document-engine/src';
import { baseName, errorCode, errorMessage, useAppCommands } from '../hooks';
import { addClipboardItem, copyClipboardText } from '../../shell/system';
import { Prompt } from './Prompt';
import { Ribbon, tabs } from './Ribbon';
import { WriterDialog, type DialogKind } from './WriterDialog';
import { SidePane } from './SidePane';
import { Backstage } from './Backstage';
import { Preferences } from './PreferencesWindow';
import { useWriterPreferences, playWriterSound } from './preferences';
import { useExitPresence, useReducedMotion } from './motion';
import { useSystemAppearance } from './systemAppearance';
import { readRecovery, writeRecovery, type RecoveryRecord } from './recovery';
import { PictureInteractions, type PictureActions } from './PictureInteractions';
import './writer.css';
import './appearance.css';
import './motion.css';

export type PaneKind = 'navigation' | 'styles' | 'comments' | 'review' | null;
type Source = { bytes: Uint8Array; path: string | null; version: string | null; title: string; preserveOriginal: boolean; readOnly: boolean; recovered?: boolean };
export interface RecentDocument { path: string; name: string; opened: string }
const blankSource = (): Source => ({ bytes: createDocument(), path: null, version: null, title: 'Document1', preserveOriginal: false, readOnly: false });
function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function Writer({ context }: { context: AppContext }) {
  const [preferences, updatePreference] = useWriterPreferences(context.services.settings);
  const reducedMotion = useReducedMotion();
  const systemAppearance = useSystemAppearance();
  const animate = preferences.animations && !reducedMotion && !systemAppearance.reduceMotion;
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [printReviewWarning, setPrintReviewWarning] = useState(false);
  const [source, setSource] = useState<Source>(blankSource);
  const [snapshot, setSnapshot] = useState<WriterSnapshot>(emptySnapshot);
  const [savedRevision, setSavedRevision] = useState(0);
  const [activeTab, setActiveTab] = useState('Home');
  const [collapsed, setCollapsed] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [rightPane, setRightPane] = useState<Exclude<PaneKind, 'navigation'>>(null);
  const leftPresence = useExitPresence(navigationOpen ? 'navigation' as const : null, animate);
  const rightPresence = useExitPresence(rightPane, animate);
  const [navigationTab, setNavigationTab] = useState('Headings');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [backstage, setBackstage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(true);
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [conflict, setConflict] = useState(false);
  const [compatibility, setCompatibility] = useState<{ source: Source; report: CompatibilityReport } | null>(null);
  const [recovery, setRecovery] = useState<RecoveryRecord | null>(null);
  const [autosave, setAutosave] = useState(() => context.services.settings.get('writer.autosave', true));
  const [guard, setGuard] = useState(false);
  const [overwrite, setOverwrite] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [queryCommand, setQueryCommand] = useState('');
  const [printSource, setPrintSource] = useState<Uint8Array | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const app = useRef<HTMLDivElement>(null);
  const engine = useRef<WriterEngine | null>(null);
  const capture = useRef<SelectionCapture | null>(null);
  const pictureActions = useRef<PictureActions>(null);
  const [selectedPictureId, setSelectedPictureId] = useState<string | null>(null);
  const guardResolve = useRef<((result: boolean) => void) | null>(null);
  const overwriteResolve = useRef<((result: boolean) => void) | null>(null);
  const working = useRef(false);
  const recoveryWorking = useRef(false);
  const recoveryEpoch = useRef(0);
  const printRequest = useRef(0);
  const mounted = useRef(true);
  const current = useRef({ source, snapshot, savedRevision, conflict, autosave });
  current.current = { source, snapshot, savedRevision, conflict, autosave };
  const requestedPath = typeof context.launchArgs.path === 'string' ? context.launchArgs.path : '';
  const fs = context.services.files;
  const dirty = snapshot.revision !== savedRevision || Boolean(source.recovered);

  function report(cause: unknown) { if (mounted.current) setError(errorMessage(cause)); }
  const perform = async (action: () => unknown | Promise<unknown>, allowOpening = false) => {
    try { if (opening && !allowOpening) throw new Error('Wait for the document to finish opening.'); setError(''); await action(); } catch (cause) { report(cause); }
  };
  function remember(path: string) {
    try {
      const recents = context.services.settings.get<RecentDocument[]>('writer.recent', []);
      context.services.settings.set('writer.recent', [{ path, name: baseName(path), opened: new Date().toISOString() }, ...recents.filter(r => r.path !== path)].slice(0, 12));
      context.services.settings.set(`writer.document.${context.windowId}`, { path, launchPath: requestedPath });
    } catch { setNotice('The document is open. Recent-file history could not be stored.'); }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; guardResolve.current?.(false); overwriteResolve.current?.(false); };
  }, []);
  useEffect(() => {
    const editor = new WriterEngine(value => { if (engine.current === editor) setSnapshot(value); }, cause => { if (engine.current === editor) report(cause); }, {
      ...preferences, user: { name: preferences.userName.trim() || 'LopeOS User', email: preferences.userEmail.trim() || 'local@lopeos.invalid' },
    });
    engine.current = editor; recoveryEpoch.current++; printRequest.current++; setPrintSource(null);
    setSnapshot(emptySnapshot); setSavedRevision(0); setConflict(false); setError('');
    void editor.mount(host.current!, source.bytes, source.readOnly).then(() => {
      if (engine.current !== editor) return;
      setSaveStatus(source.recovered ? 'Recovered • unsaved changes' : 'Saved');
    }).catch(cause => { if (engine.current === editor) report(cause); });
    return () => { editor.destroy(); if (engine.current === editor) engine.current = null; };
  }, [source.bytes, source.readOnly]);
  useEffect(() => {
    if (snapshot.ready) void engine.current?.applyPreferences({ ...preferences, user: { name: preferences.userName.trim() || 'LopeOS User', email: preferences.userEmail.trim() || 'local@lopeos.invalid' } }).catch(report);
  }, [preferences, snapshot.ready]);
  useEffect(() => context.services.settings.subscribe(() => setAutosave(context.services.settings.get('writer.autosave', true))), [context.services.settings]);
  useEffect(() => { if (!opening && snapshot.ready && !dialog && !preferencesOpen && !backstage && !app.current?.querySelector('[role="dialog"]')) { const focused = document.activeElement; if (!focused || focused === document.body || focused === app.current || host.current?.contains(focused)) engine.current?.focus(); } }, [opening, snapshot.ready]);
  function changeAutosave(value: boolean) { setAutosave(value); context.services.settings.set('writer.autosave',value); }
  useEffect(() => {
    context.lifecycle.setTitle(`${dirty ? '● ' : ''}${source.title} — Quill`);
  }, [source.title, dirty, context.lifecycle]);

  const safeToLeave = useCallback((): Promise<boolean> => {
    const c = current.current;
    if (working.current) return Promise.resolve(false);
    if (c.snapshot.revision === c.savedRevision && !c.source.recovered) return Promise.resolve(true);
    if (guardResolve.current) return Promise.resolve(false);
    setGuard(true); return new Promise(resolve => { guardResolve.current = resolve; });
  }, []);
  useBeforeClose(safeToLeave);
  function finishGuard(value: boolean) { setGuard(false); guardResolve.current?.(value); guardResolve.current = null; }
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      const c = current.current;
      if (c.snapshot.revision !== c.savedRevision || c.source.recovered) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
  }, []);

  async function readPath(path: string, guardChanges = true) {
    if (working.current || (guardChanges && !(await safeToLeave()))) return;
    working.current = true; setOpening(true); setBusy(true); setSaveStatus('Opening…'); setBackstage(null); setError('');
    if (host.current) host.current.inert = true;
    if (host.current?.contains(document.activeElement)) app.current?.focus({ preventScroll: true });
    try {
      if (!fs.readBinary) throw new Error('The workspace binary file service is unavailable. Connect the LopeOS runtime to open DOCX files.');
      const file = await fs.readBinary(path);
      const report = inspectPackage(file.data);
      const next: Source = { bytes: file.data, path, version: file.version, title: baseName(path), preserveOriginal: report.preserveOriginal || /\.dotx$/i.test(path), readOnly: false };
      if (report.warnings.length) setCompatibility({ source: next, report });
      else { setSnapshot(emptySnapshot); setSource(next); remember(path); playWriterSound(preferences.eventSounds); }
    } catch (cause) { report(cause); setSaveStatus(dirty ? 'Unsaved changes' : 'Saved'); }
    finally { working.current = false; setOpening(false); setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const record = await readRecovery(context.windowId);
        if (!active) return;
        if (record && record.launchPath === requestedPath) { setRecovery(record); return; }
        const stored = context.services.settings.get<{ path: string | null; launchPath: string } | null>(`writer.document.${context.windowId}`, null);
        const path = stored && stored.launchPath === requestedPath ? stored.path || '' : requestedPath;
        if (path) await readPath(path, false);
        else if (preferences.showGallery) setBackstage('Home');
      } catch { if (active) setNotice('Document recovery storage is unavailable in this browser.'); }
      finally { if (active) setOpening(false); }
    })();
    return () => { active = false; };
  }, [requestedPath]);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = fs.subscribe(changed => {
      const c = current.current;
      if (!c.source.path || working.current || (changed && changed !== c.source.path && !c.source.path.startsWith(changed.replace(/\/$/, '') + '/'))) return;
      clearTimeout(timer); timer = setTimeout(async () => {
        const file = current.current.source;
        if (!file.path || working.current) return;
        try {
          const stat = await fs.stat(file.path);
          if (active && file === current.current.source && !working.current && stat.version && stat.version !== file.version) setConflict(true);
        } catch (cause) { if (active && file === current.current.source && !working.current) { setConflict(true); setNotice(`Could not verify the current file: ${errorMessage(cause)}`); } }
      }, 250);
    });
    return () => { active = false; clearTimeout(timer); unsubscribe(); };
  }, [fs]);

  async function save(as = false, automatic = false): Promise<boolean> {
    if (opening || working.current || !engine.current?.snapshot.ready) return false;
    const c = current.current;
    if (automatic && (!c.source.path || c.conflict || c.source.preserveOriginal || c.source.readOnly)) return false;
    working.current = true; setBusy(true); setSaveStatus('Saving…'); setError('');
    try {
      if (!fs.writeBinary) throw new Error('Connect the LopeOS workspace runtime to save DOCX files. Your changes remain in this window.');
      let path = c.source.path;
      if (as || !path || c.source.preserveOriginal || c.source.readOnly) {
        const name = `${c.source.title.replace(/\.(docx|dotx)$/i, '')}${c.source.preserveOriginal ? ' — copy' : ''}.docx`;
        const folder = preferences.documentsFolder.replace(/^\/+|\/+$/g,'');
        path = await context.services.dialogs.saveFile({ defaultName: folder ? `${folder}/${name}` : name });
      }
      if (!path) { setSaveStatus('Unsaved changes'); return false; }
      if (!/\.docx$/i.test(path)) path += '.docx';
      if (c.source.preserveOriginal && path === c.source.path) throw new Error('Save to a different filename to preserve the original package.');
      if (c.conflict && path === c.source.path) throw new Error('The file changed elsewhere. Reload it or use Save As to preserve both versions.');
      const revision = engine.current.snapshot.revision;
      const bytes = await engine.current.export(); inspectPackage(bytes);
      let version: string;
      if (path === c.source.path && c.source.version) version = (await fs.writeBinary(path, bytes, { version: c.source.version })).version;
      else {
        try { version = (await fs.writeBinary(path, bytes, { createOnly: true })).version; }
        catch (cause) {
          if (errorCode(cause) !== 'CONFLICT') throw cause;
          const existing = await fs.stat(path);
          if (!existing.version) throw new Error('This filesystem cannot safely replace an existing file. Choose another name.');
          setOverwrite(path);
          const confirmed = await new Promise<boolean>(resolve => { overwriteResolve.current = resolve; });
          if (!confirmed) { setSaveStatus('Unsaved changes'); return false; }
          version = (await fs.writeBinary(path, bytes, { version: existing.version })).version;
        }
      }
      if (!version) throw new Error('The filesystem did not acknowledge the save.');
      // Update metadata without remounting the engine or losing undo/selection.
      const next = { ...current.current.source, path, version, title: baseName(path), preserveOriginal: false, recovered: false };
      current.current.source = next;
      // Preserve the mount bytes so the metadata update keeps the engine and undo stack alive.
      setSource(next);
      setSavedRevision(revision); current.current.savedRevision = revision; setConflict(false);
      const stillDirty = engine.current.snapshot.revision !== revision;
      setSaveStatus(stillDirty ? 'Unsaved changes' : 'Saved'); remember(path);
      if (!stillDirty) await writeRecovery(context.windowId).catch(() => {});
      if (!automatic) context.services.notify({ title: 'Quill', message: `Saved ${baseName(path)}`, tone: 'success' });
      if (!automatic) playWriterSound(preferences.eventSounds);
      return !stillDirty;
    } catch (cause) { if (errorCode(cause) === 'CONFLICT') setConflict(true); setSaveStatus('Save failed • changes kept'); report(cause); return false; }
    finally {
      working.current = false;
      if (mounted.current) {
        setBusy(false);
        const focused = document.activeElement as HTMLElement | null;
        const returnToDocument = !focused || focused === document.body || Boolean(focused.closest('.writer-workspace, .writer-command-area > button[aria-label="Save"]'));
        if (!automatic && returnToDocument && !app.current?.querySelector('[role="dialog"]')) engine.current?.focus();
      }
    }
  }
  useEffect(() => {
    if (!dirty || !snapshot.ready || source.readOnly) return;
    const canAutoSave = autosave && source.path && !source.preserveOriginal && !conflict;
    if (!preferences.recoveryEnabled && !canAutoSave) return;
    if (!working.current) setSaveStatus('Unsaved changes');
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const flush = async () => {
      if (!active || !engine.current) return;
      if (recoveryWorking.current || working.current) { timer = setTimeout(flush, 300); return; }
      recoveryWorking.current = true;
      try {
        const file = current.current.source; const editingEngine = engine.current; const epoch = recoveryEpoch.current;
        const bytes = await editingEngine.export();
        if (epoch !== recoveryEpoch.current || engine.current !== editingEngine || file !== current.current.source || (editingEngine.snapshot.revision === current.current.savedRevision && !file.recovered)) return;
        if (preferences.recoveryEnabled) await writeRecovery({ id: context.windowId, bytes, path: file.path, version: file.version, title: file.title, savedAt: new Date().toISOString(), launchPath: requestedPath, preserveOriginal: file.preserveOriginal });
        if (!active || epoch !== recoveryEpoch.current) return;
        if (current.current.autosave && file.path && !current.current.conflict) await save(false, true);
        else setSaveStatus(preferences.recoveryEnabled ? 'Recovery copy saved • unsaved changes' : 'Unsaved changes');
      } catch (cause) { setNotice(`Recovery could not be updated: ${errorMessage(cause)}`); }
      finally { recoveryWorking.current = false; }
    };
    const recoveryDelay = preferences.recoveryEnabled ? preferences.recoveryDelay * 1000 : Infinity;
    timer = setTimeout(flush, canAutoSave ? Math.min(1600,recoveryDelay) : recoveryDelay);
    return () => { active = false; clearTimeout(timer); };
  }, [snapshot.revision, dirty, snapshot.ready, autosave, preferences.recoveryEnabled, preferences.recoveryDelay, conflict]);

  function freezeSelection() { capture.current = engine.current?.capture() ?? null; }
  function selectPicture(id: string | null) {
    setSelectedPictureId(id);
    if (id) setActiveTab('Picture Format');
    else setActiveTab(tab => tab === 'Picture Format' ? 'Home' : tab);
  }
  useEffect(() => { setSelectedPictureId(null); }, [source.bytes]);
  async function command(id: string, value?: unknown) {
    if (id === 'ruler') { updatePreference('ruler',!preferences.ruler); engine.current?.focus(); return; }
    if (id === 'formatting-marks') { updatePreference('formattingMarks',!preferences.formattingMarks); engine.current?.focus(); return; }
    await perform(async () => { capture.current = null; await engine.current?.command(id, value); engine.current?.focus(); });
  }
  function openDialog(kind: DialogKind) { const informational = ['about','help','account','share','clipboard'].includes(kind || ''); if (opening && !informational) return; void perform(async () => { const editor = engine.current; capture.current = !opening && editor?.snapshot.ready ? await editor.captureFresh() : null; if (editor === engine.current) setDialog(kind); }, informational); }
  function togglePane(kind: PaneKind) {
    if (kind === 'navigation') setNavigationOpen(open => !open);
    else setRightPane(p => p === kind ? null : kind);
    if (kind === rightPane || (kind === 'navigation' && navigationOpen)) engine.current?.focus();
  }
  async function open() { if (!(await safeToLeave())) return; const path = await context.services.dialogs.openFile({ extensions: ['.docx', '.dotx', '.doc', '.docm'] }); if (path) await readPath(path, false); }
  async function create() { if (!(await safeToLeave())) return; working.current = true; recoveryEpoch.current++; setBusy(true); setOpening(true); if (host.current) host.current.inert = true; if (host.current?.contains(document.activeElement)) app.current?.focus({preventScroll:true}); try { await writeRecovery(context.windowId).catch(() => {}); setSnapshot(emptySnapshot); setSource(blankSource()); context.services.settings.set(`writer.document.${context.windowId}`, { path: null, launchPath: requestedPath }); setBackstage(null); } finally { working.current = false; setBusy(false); setOpening(false); } }
  async function exportDocument() { await perform(async () => download(await engine.current!.export(), `${source.title.replace(/\.(docx|dotx)$/i, '')}.docx`)); }
  function closeBackstage() {
    printRequest.current++; setBackstage(null);
    const focused = document.activeElement as HTMLElement | null;
    if (!focused || focused === document.body || focused.closest('.writer-backstage, .writer-workspace')) engine.current?.focus();
  }
  async function preview(skipWarning = false) {
    const editor = engine.current; if (opening || !editor?.snapshot.ready) return;
    if (!skipWarning && preferences.warnReviewPrint && ((snapshot.state?.comments.total || 0) + (snapshot.state?.trackChanges.total || 0) > 0)) { setPrintReviewWarning(true); return; }
    const request = ++printRequest.current;
    setPrintSource(null); setBackstage('Print');
    await perform(async () => { if (preferences.updateFields) await editor.updateExistingFields(); const bytes = await editor.export(); if (request === printRequest.current && editor === engine.current) setPrintSource(bytes); });
  }
  async function clipboard(kind: 'copy' | 'cut' | 'paste') {
    await perform(async () => {
      const editor = engine.current; if (!editor?.ui) return;
      const selected = await editor.api.selection.current({ includeText: true }), revision = editor.snapshot.revision;
      const stillCurrent = () => { if (host.current?.inert || editor !== engine.current || revision !== editor.snapshot.revision) throw new Error('The document changed while accessing the clipboard. Select the passage and try again.'); };
      if (kind === 'paste') { const text = await navigator.clipboard.readText(); if (!text) return; stillCurrent(); await editor.insertTextAtSelection(text, selected.selectionTarget || undefined); try { addClipboardItem(text, 'paste'); } catch {} }
      else { if (!selected.text) throw new Error('Select text first.'); await copyClipboardText(selected.text, kind); if (kind === 'cut' && selected.selectionTarget) { stillCurrent(); assertReceipt(await editor.api.delete({ target: selected.selectionTarget })); } }
    });
  }
  const commands: Command[] = [
    { id: 'writer.new', label: 'New', shortcut: 'Mod+N', execute: create },
    { id: 'writer.open', label: 'Open…', shortcut: 'Mod+O', execute: open },
    { id: 'writer.save', label: 'Save', shortcut: 'Mod+S', enabled: !opening && !busy && snapshot.ready, execute: async () => { await save(); } },
    { id: 'writer.save-as', label: 'Save As…', shortcut: 'Mod+Shift+S', enabled: !busy, execute: async () => { await save(true); } },
    { id: 'writer.export', label: 'Export DOCX', execute: exportDocument },
    { id: 'writer.print', label: 'Print / Export PDF…', shortcut: 'Mod+P', execute: () => preview() },
    { id: 'writer.preferences', label: 'Preferences…', shortcut: 'Mod+,', enabled: !dialog && !guard && !compatibility && !overwrite, execute: () => { setBackstage(null); setPreferencesOpen(true); } },
    ...(['undo', 'redo', 'bold', 'italic', 'underline'] as const).map(id => ({ id: `writer.${id}` as const, label: id[0].toUpperCase() + id.slice(1), enabled: !opening && (snapshot.state?.toolbar.commands[id]?.enabled ?? false), execute: () => command(id) })),
    ...(['copy', 'cut', 'paste'] as const).map(id => ({ id: `writer.${id}` as const, label: id[0].toUpperCase() + id.slice(1), execute: () => clipboard(id) })),
    { id: 'writer.find', label: 'Find', shortcut: 'Mod+F', execute: () => { setNavigationOpen(true); setNavigationTab('Results'); } },
    { id: 'writer.replace', label: 'Replace', shortcut: 'Mod+H', execute: () => { setNavigationOpen(true); setNavigationTab('Replace'); } },
    { id: 'writer.font', label: 'Font…', shortcut: 'Mod+D', execute: () => openDialog('font') },
    { id: 'writer.paragraph', label: 'Paragraph…', execute: () => openDialog('paragraph') },
    { id: 'writer.table', label: 'Insert Table…', execute: () => openDialog('table') },
    { id: 'writer.picture', label: 'Insert Picture…', execute: () => openDialog('picture') },
    { id: 'writer.link', label: 'Hyperlink…', shortcut: 'Mod+K', execute: () => openDialog('link') },
    { id: 'writer.comment', label: 'New Comment', shortcut: 'Mod+Alt+M', execute: () => openDialog('comment') },
    { id: 'writer.toc', label: 'Update Table of Contents', execute: () => perform(async () => { await engine.current?.updateTOC(); }) },
    { id: 'writer.track', label: 'Track Changes', enabled: !opening && snapshot.ready && !source.readOnly, checked: snapshot.state?.documentMode === 'suggesting', shortcut: 'Mod+Shift+E', execute: () => { if (!opening) engine.current?.setMode(snapshot.state?.documentMode === 'suggesting' ? 'editing' : 'suggesting'); } },
    { id: 'writer.accept', label: 'Accept Change', execute: () => command('acceptChange') },
    { id: 'writer.reject', label: 'Reject Change', execute: () => command('rejectChange') },
    { id: 'writer.comments', label: 'Comments', execute: () => togglePane('comments') },
    { id: 'writer.navigation', label: 'Navigation Pane', execute: () => togglePane('navigation') },
    { id: 'writer.ruler', label: 'Ruler', execute: () => command('ruler') },
    { id: 'writer.marks', label: 'Show/Hide ¶', shortcut: 'Mod+Shift+8', execute: () => command('formatting-marks') },
    { id: 'writer.collapse', label: 'Collapse Ribbon', shortcut: 'Mod+F1', checked: collapsed, execute: () => setCollapsed(!collapsed) },
    { id: 'writer.about', label: 'About Quill', execute: () => openDialog('about') },
  ];
  useAppCommands(context, commands);
  function run(id: string) { const c = commands.find(c => c.id === `writer.${id}`); if (c) void c.execute(); }

  const zoom = snapshot.state?.zoom.value ?? 100;
  const inTable = Boolean(snapshot.state?.selection.tableSelection || engine.current?.ui?.tables.isInTable());
  useEffect(() => {
    if (!activeTab.startsWith('Table ') || inTable) return;
    const timer = setTimeout(() => { if (!engine.current?.ui?.tables.isInTable()) setActiveTab(tab => tab.startsWith('Table ') ? 'Home' : tab); }, 120);
    return () => clearTimeout(timer);
  }, [activeTab, inTable]);
  return <div className="writer-app" tabIndex={-1} ref={app} data-testid="writer-app" data-document-mode={snapshot.state?.documentMode} data-theme={preferences.theme} data-dark-page={preferences.darkPage} data-motion={animate ? 'on' : 'off'} data-modern-comments={preferences.modernComments} data-group-titles={preferences.groupTitles} data-large-controls={preferences.largerControls} data-vertical-ruler={preferences.verticalRuler} data-horizontal-scrollbar={preferences.horizontalScrollbar} data-vertical-scrollbar={preferences.verticalScrollbar} data-paste-options={preferences.showPasteOptions} onKeyDown={e => {
    if (e.key === 'Escape' && !(e.target as HTMLElement).closest('[role="dialog"], [role="menu"], .wr-menu')) { if (backstage) closeBackstage(); setQueryCommand(''); }
  }} onKeyDownCapture={e => {
    if ((e.target as HTMLElement).closest('[role="dialog"]')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); if (!dialog && !guard && !compatibility && !overwrite) run('preferences'); }
    if (e.altKey && e.key.toLowerCase() === 'q') { e.preventDefault(); app.current?.querySelector<HTMLInputElement>('.writer-command-search input')?.focus(); }
    if (e.key === 'F6') {
      e.preventDefault();
      const selectors = ['.writer-command-search input','[role="tab"][aria-selected="true"]','[role="textbox"][aria-label="Document content"]','.writer-side-pane button','.writer-statusbar button'];
      const regions = selectors.map(s => app.current?.querySelector<HTMLElement>(s)).filter((n): n is HTMLElement => Boolean(n));
      const currentRegion = regions.findIndex(n => n === document.activeElement || n.contains(document.activeElement));
      regions[(currentRegion + (e.shiftKey ? -1 : 1) + regions.length) % regions.length]?.focus();
    }
  }}>
    <div className="writer-command-area">
      <span className="writer-document-symbol"><FileText size={18}/></span>
      <button className="writer-autosave" aria-pressed={autosave} title="Automatically save workspace documents after edits" onClick={() => changeAutosave(!autosave)}>AutoSave <span className={autosave ? 'is-on' : ''}>{autosave ? 'On' : 'Off'}<i/></span></button>
      <button aria-label="Save" title="Save (Ctrl+S)" disabled={busy || !snapshot.ready || opening} onMouseDown={e => e.preventDefault()} onClick={() => run('save')}><Save size={17}/></button>
      <button aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!snapshot.state?.history.canUndo} onMouseDown={e => e.preventDefault()} onClick={() => void command('undo')}><Undo2 size={17}/></button>
      <button aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!snapshot.state?.history.canRedo} onMouseDown={e => e.preventDefault()} onClick={() => void command('redo')}><Redo2 size={17}/></button>
      <span className="writer-title"><span className="writer-filename" title={source.title}>{preferences.showExtensions ? source.title : source.title.replace(/\.(docx|dotx)$/i,'')}</span><small>• {busy ? saveStatus : conflict ? 'Changed elsewhere' : dirty ? 'Unsaved' : source.readOnly ? 'Read-only' : 'Saved'}</small><ChevronDown size={12}/></span>
      <div className="writer-command-search" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setQueryCommand(''); }} onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); setQueryCommand(''); e.currentTarget.querySelector('input')?.focus(); }
        if (queryCommand && ['ArrowDown','ArrowUp'].includes(e.key)) { e.preventDefault(); const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]; const index = items.indexOf(document.activeElement as HTMLButtonElement); items[index < 0 ? e.key === 'ArrowDown' ? 0 : items.length-1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
      }}><Search size={15}/><input aria-label="Search commands" placeholder="Search (Alt+Q)" value={queryCommand} onChange={e => setQueryCommand(e.target.value)}/>{queryCommand && <div role="menu" aria-label="Matching commands">{commands.filter(c => c.label.toLowerCase().includes(queryCommand.toLowerCase())).slice(0, 8).map(c => <button key={c.id} role="menuitem" disabled={c.enabled === false} onClick={() => { setQueryCommand(''); void c.execute(); }}>{c.label}<small>{c.shortcut?.replace('Mod', 'Ctrl')}</small></button>)}{!commands.some(c => c.label.toLowerCase().includes(queryCommand.toLowerCase())) && <p className="writer-command-empty">No matching commands</p>}</div>}</div>
      <button className="writer-account" aria-label="LopeOS account" title="LopeOS account and cloud sync" data-pride={preferences.pride} onClick={() => openDialog('account')}>{preferences.userInitials || preferences.userName[0] || 'L'}</button>
      <button aria-label="Preferences" title="Preferences (Ctrl/⌘+,)" onClick={() => run('preferences')}><Settings size={17}/></button>
    </div>
    <div className="writer-tab-row">
      <div className="writer-tabs" role="tablist" aria-label="Ribbon tabs">{tabs.map((tab, i) => <button key={tab} role="tab" tabIndex={activeTab === tab ? 0 : -1} aria-selected={activeTab === tab && !backstage} onDoubleClick={() => setCollapsed(!collapsed)} onClick={() => { if (tab === 'File') setBackstage('Home'); else { setActiveTab(tab); setCollapsed(false); setBackstage(null); } }} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; if (next === 'File') setBackstage('Home'); else { setActiveTab(next); setCollapsed(false); setBackstage(null); } const buttons = e.currentTarget.parentElement!.querySelectorAll('button'); buttons[tabs.indexOf(next)].focus(); } }}>{tab}</button>)}{inTable && <><button role="tab" aria-selected={activeTab === 'Table Design'} className="writer-context-tab" onClick={() => setActiveTab('Table Design')}>Table Design</button><button role="tab" aria-selected={activeTab === 'Table Layout'} className="writer-context-tab" onClick={() => setActiveTab('Table Layout')}>Table Layout</button></>}{(selectedPictureId || activeTab === 'Picture Format') && <button role="tab" aria-selected={activeTab === 'Picture Format'} className="writer-context-tab" onClick={() => { setActiveTab('Picture Format'); setCollapsed(false); }}>Picture Format</button>}</div>
      <div className="writer-tab-actions"><button onClick={() => togglePane('comments')}><MessageSquare size={14}/>Comments</button><button onClick={() => openDialog('mode')}>{source.readOnly ? 'Viewing' : snapshot.state?.documentMode === 'suggesting' ? 'Reviewing' : 'Editing'}<ChevronDown size={11}/></button><button className="writer-share" onClick={() => openDialog('share')}><Share2 size={13}/>Share<ChevronDown size={11}/></button></div>
    </div>
    {!collapsed && <Ribbon pictureId={selectedPictureId} pictureLayout={() => pictureActions.current?.layout()} pictureResetCrop={() => pictureActions.current?.resetCrop()} pictureCrop={() => pictureActions.current?.crop()} measurementUnit={preferences.measurementUnit} key={activeTab} tab={activeTab} snapshot={opening ? { ...snapshot, ready: false } : snapshot} engine={opening ? null : engine.current} command={command} run={run} dialog={openDialog} pane={togglePane} freeze={freezeSelection} setTab={setActiveTab} perform={perform}/>}
    <button className="writer-collapse" aria-label={collapsed ? 'Expand ribbon' : 'Collapse ribbon'} title="Ribbon display options (Ctrl+F1)" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronDown size={12}/> : <ChevronUp size={12}/>}</button>
    {conflict && <div className="writer-message warning" role="alert"><strong>This file changed elsewhere.</strong> Your edits are preserved.<button onClick={() => void save(true)}>Save a copy</button><button onClick={() => source.path && void readPath(source.path)}>Reload</button></div>}
    {error && <div className="writer-message error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}
    {recovery && <div className="writer-message warning" role="alert"><strong>Document Recovery</strong><span>An unsaved copy of {recovery.title} is available.</span><button onClick={() => void (async () => { if (!(await safeToLeave())) return; setSnapshot(emptySnapshot); setSource({ bytes: recovery.bytes, path: recovery.path, version: recovery.version, title: recovery.title, preserveOriginal: recovery.preserveOriginal, readOnly: false, recovered: true }); setRecovery(null); })()}>Recover</button><button onClick={() => void (async () => { if (!(await safeToLeave())) return; await writeRecovery(context.windowId); const path = recovery.path; setRecovery(null); if (path) await readPath(path, false); })()}>Discard recovery</button></div>}
    <div className="writer-editing-area">
      {leftPresence.value && <SidePane exiting={leftPresence.exiting} key="navigation" kind="navigation" engine={engine.current} snapshot={snapshot} close={() => setNavigationOpen(false)} navigationTab={navigationTab} setNavigationTab={setNavigationTab} perform={perform}/>}
      <div className="writer-workspace" aria-label="Document workspace"><div className="writer-engine-mount" inert={opening || !snapshot.ready} ref={host}/>{(!snapshot.ready || opening) && <div className="writer-opening">Opening document…</div>}</div>
      {rightPresence.value && <SidePane exiting={rightPresence.exiting} key={rightPresence.value} kind={rightPresence.value} engine={engine.current} snapshot={snapshot} close={() => setRightPane(null)} navigationTab={navigationTab} setNavigationTab={setNavigationTab} perform={perform}/>}
    </div>
    <footer className="writer-statusbar"><button onClick={() => { setNavigationOpen(true); setNavigationTab('Pages'); }}>Page {snapshot.page} of {snapshot.pages}</button><button onClick={() => openDialog('wordcount')}>{snapshot.words.toLocaleString()} words</button><button onClick={() => openDialog('language')}>English (United States)</button><span className="writer-save-status" role="status">{notice || saveStatus}</span>{snapshot.missingFonts.length > 0 && <span className="writer-font-warning" title={`Unavailable fonts: ${snapshot.missingFonts.join(', ')}. Substitutions may change line wrapping.`}>Font substitution: {snapshot.missingFonts.join(', ')}</span>}<div className="writer-view-controls"><button aria-label="Read mode" aria-pressed={snapshot.state?.documentMode === 'viewing'} className={snapshot.state?.documentMode === 'viewing' ? 'selected' : ''} onClick={() => engine.current?.setMode('viewing')}><BookOpen size={14}/></button><button aria-label="Print layout" aria-pressed={snapshot.state?.documentMode !== 'viewing'} className={snapshot.state?.documentMode !== 'viewing' ? 'selected' : ''} disabled={source.readOnly} onClick={() => engine.current?.setMode('editing')}><FileText size={14}/></button><button aria-label="Fit page width" onClick={() => engine.current?.fitWidth()}>↔</button><button aria-label="Zoom out" onClick={() => engine.current?.setZoom(Math.max(25, zoom - 10))}><Minus size={12}/></button><input aria-label="Document zoom" type="range" min="25" max="200" step="5" value={zoom} onChange={e => engine.current?.setZoom(Number(e.target.value))}/><button aria-label="Zoom in" onClick={() => engine.current?.setZoom(Math.min(200, zoom + 10))}><Plus size={12}/></button><button onClick={() => openDialog('zoom')}>{Math.round(zoom)}%</button></div></footer>
    {backstage && <Backstage section={backstage} setSection={setBackstage} close={closeBackstage} source={source} context={context} run={run} openPath={path => void readPath(path)} printSource={printSource} preferences={preferences} error={error} engine={engine.current} perform={perform}/>}
    <PictureInteractions textScale={systemAppearance.textScale} increaseContrast={systemAppearance.increaseContrast} systemTheme={systemAppearance.theme} ref={pictureActions} root={app} engine={engine.current} snapshot={snapshot} selectedId={selectedPictureId} select={selectPicture} format={() => openDialog('pictureformat')} defaultWrap={preferences.defaultPictureWrap} unit={preferences.measurementUnit} blocked={opening || Boolean(dialog || preferencesOpen || backstage || guard || overwrite || compatibility)} perform={perform}/>
    {dialog && <WriterDialog key={dialog} selectedPictureId={selectedPictureId} selectPicture={selectPicture} readOnly={source.readOnly} kind={dialog} engine={engine.current} snapshot={snapshot} capture={capture.current} close={() => { setDialog(null); capture.current = null; }} perform={perform} preferences={preferences} setTab={setActiveTab}/>}
    {preferencesOpen && <Preferences preferences={preferences} update={updatePreference} autosave={autosave} setAutosave={changeAutosave} context={context} close={() => { setPreferencesOpen(false); engine.current?.focus(); }}/>}
    {printReviewWarning && <Prompt title="Print document markup?" onCancel={() => setPrintReviewWarning(false)}><h2>Print document markup?</h2><p>This document contains comments or tracked changes. Check the review display before printing.</p><div className="writer-dialog-actions"><button onClick={() => setPrintReviewWarning(false)}>Cancel</button><button className="primary" onClick={() => { setPrintReviewWarning(false); void preview(true); }}>Continue to Print</button></div></Prompt>}
    {guard && <Prompt title="Save your changes?" onCancel={() => finishGuard(false)} busy={busy}><h2>Save your changes?</h2><p>Do you want to save changes to {source.title}?</p><p>Your unsaved edits will be lost if you discard them.</p><div className="writer-dialog-actions"><button onClick={() => finishGuard(false)}>Cancel</button><button onClick={() => { recoveryEpoch.current++; void writeRecovery(context.windowId); finishGuard(true); }}>Don’t Save</button><button className="primary" disabled={busy} onClick={() => void save().then(ok => { if (ok) finishGuard(true); })}>Save</button></div></Prompt>}
    {overwrite && <Prompt title="Replace existing document?" onCancel={() => { setOverwrite(null); overwriteResolve.current?.(false); overwriteResolve.current = null; }}><h2>Replace existing document?</h2><p>{overwrite} already exists. Replacing it will overwrite its contents.</p><div className="writer-dialog-actions"><button onClick={() => { setOverwrite(null); overwriteResolve.current?.(false); overwriteResolve.current = null; }}>Cancel</button><button className="primary" onClick={() => { setOverwrite(null); overwriteResolve.current?.(true); overwriteResolve.current = null; }}>Replace</button></div></Prompt>}
    {compatibility && <Prompt title="Document compatibility" onCancel={() => setCompatibility(null)}><h2>Document compatibility</h2><p>Some features in {compatibility.source.title} have limited support.</p><ul>{compatibility.report.warnings.map(w => <li key={w}>{w}</li>)}</ul><p>Editing requires saving a copy. The original package stays intact.</p><div className="writer-dialog-actions"><button onClick={() => setCompatibility(null)}>Cancel</button><button onClick={() => { setSource({ ...compatibility.source, readOnly: true }); remember(compatibility.source.path!); setCompatibility(null); }}>Open read-only</button><button className="primary" onClick={() => { setSource(compatibility.source); remember(compatibility.source.path!); setCompatibility(null); }}>Edit a copy</button></div></Prompt>}
  </div>;
}
