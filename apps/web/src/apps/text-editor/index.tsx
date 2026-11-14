import { useCallback, useEffect, useRef, useState } from 'react';
import { FilePlus2, FolderOpen, Redo2, Save, Search, Undo2, X } from 'lucide-react';
import type { AppContext, FileService } from '../../../../../packages/contracts/src';
import { Button, Dialog, Input, Toolbar } from '../../../../../packages/ui/src';
import { useBeforeClose } from '../../../../../packages/sdk/src';
import { baseName, errorCode, errorMessage, useAppCommands, usePreference } from '../hooks';
import { acknowledgeSave, applyExternalChange, editDocument, findNext, isDirty, newDocument, replaceAllText, stepHistory, type EditorDocument } from './document';
import '../application.css';

type SafeFileService = FileService & { writeBinary?: (path: string, data: Uint8Array, options?: { createOnly?: boolean }) => Promise<{ version: string }> };
export default function TextEditor({ context }: { context: AppContext }) {
  const fs = context.services.files as SafeFileService;
  const requestedPath = typeof context.launchArgs.path === 'string' ? context.launchArgs.path : '';
  const initialLaunchPath = useRef(requestedPath);
  const [restoredPath] = useState(() => {
    const record = context.services.settings.get<{ path: string | null; launchPath: string } | null>(`editor.document.${context.windowId}`, null);
    return record && record.launchPath === requestedPath ? record.path || '' : requestedPath;
  });
  const [doc, setDoc] = useState<EditorDocument>(() => newDocument());
  const current = useRef(doc); current.current = doc;
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [status, setStatus] = useState('Ready to write');
  const [error, setError] = useState('');
  const [guard, setGuard] = useState(false);
  const guardResult = useRef<((value: boolean) => void) | null>(null);
  const [overwrite, setOverwrite] = useState<string | null>(null);
  const overwriteResult = useRef<((value: boolean) => void) | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wrap, setWrap] = usePreference(context, 'editor.wordWrap', true);
  const [cursor, setCursor] = useState({ start: 0, end: 0 });
  const editor = useRef<HTMLTextAreaElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const checking = useRef(0);

  function remember(path: string | null) {
    try { context.services.settings.set(`editor.document.${context.windowId}`, { path, launchPath: requestedPath }); }
    catch { context.services.notify({ title: 'Text Editor', message: 'The document is open, but its location could not be saved for session restoration.', tone: 'error' }); }
  }

  const update = useCallback((updater: EditorDocument | ((previous: EditorDocument) => EditorDocument)) => {
    const next = typeof updater === 'function' ? updater(current.current) : updater;
    current.current = next; setDoc(next);
  }, []);
  const requestSafe = useCallback((): Promise<boolean> => {
    if (!isDirty(current.current)) return Promise.resolve(true);
    if (guardResult.current || working.current) return Promise.resolve(false);
    setGuard(true);
    return new Promise(resolve => { guardResult.current = resolve; });
  }, []);
  function finishGuard(proceed: boolean) { setGuard(false); const resolve = guardResult.current; guardResult.current = null; resolve?.(proceed); }
  useBeforeClose(useCallback(() => working.current ? false : requestSafe(), [requestSafe]));
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; checking.current++; guardResult.current?.(false); overwriteResult.current?.(false); };
  }, []);
  useEffect(() => {
    context.lifecycle.setTitle(`${isDirty(doc) ? '● ' : ''}${doc.path ? baseName(doc.path) : 'Untitled'} — Text Editor`);
  }, [doc.path, doc.text, doc.savedText, context.lifecycle]);
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => { if (isDirty(current.current)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);
  async function load(path: string, guardChanges = true) {
    if (working.current || (guardChanges && !(await requestSafe()))) return;
    working.current = true; setBusy(true); setError(''); checking.current++;
    try {
      const data = await fs.read(path);
      if (!alive.current) return;
      update(newDocument(data.content, path, data.version)); remember(path); setStatus('Opened from your workspace'); setCursor({ start: 0, end: 0 });
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  const launchPath = requestedPath === initialLaunchPath.current ? restoredPath : requestedPath;
  const openedLaunch = useRef('');
  useEffect(() => { if (launchPath && openedLaunch.current !== launchPath) { openedLaunch.current = launchPath; void load(launchPath); } }, [launchPath]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = fs.subscribe(changed => {
      if (!current.current.path || working.current || (typeof changed === 'string' && changed !== current.current.path && !current.current.path.startsWith(changed + '/'))) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const path = current.current.path; if (!path || working.current) return;
        const id = ++checking.current;
        try {
          const data = await fs.read(path);
          if (!alive.current || id !== checking.current || path !== current.current.path || working.current) return;
          const previous = current.current; update(doc => applyExternalChange(doc, data.content, data.version));
          if (data.version !== previous.version) setStatus(isDirty(previous) ? 'The file changed elsewhere. Your edits are preserved.' : 'Reloaded changes from your workspace');
        } catch (cause) {
          if (!alive.current || id !== checking.current || path !== current.current.path) return;
          if (errorCode(cause) === 'NOT_FOUND' || /not found|enoent/i.test(errorMessage(cause))) update(doc => ({ ...doc, deleted: true, externalChange: true }));
          else setError(`Could not check for external changes: ${errorMessage(cause)}`);
        }
      }, 120);
    });
    return () => { unsubscribe(); clearTimeout(timer); checking.current++; };
  }, [fs, update]);
  async function open() {
    if (working.current || !(await requestSafe())) return;
    const path = await context.services.dialogs.openFile({ extensions: ['.txt', '.md', '.json', '.csv', '.js', '.ts', '.css', '.py', '.yaml', '.log'] });
    if (path) await load(path, false);
  }
  async function create() {
    if (working.current || !(await requestSafe())) return;
    update(newDocument()); remember(null); checking.current++; setError(''); setStatus('New document'); editor.current?.focus();
  }
  async function confirmOverwrite(path: string) {
    setOverwrite(path);
    return new Promise<boolean>(resolve => { overwriteResult.current = resolve; });
  }
  function finishOverwrite(proceed: boolean) { setOverwrite(null); const resolve = overwriteResult.current; overwriteResult.current = null; resolve?.(proceed); }
  async function save(as = false): Promise<boolean> {
    if (working.current) return false;
    working.current = true; setBusy(true); setError(''); checking.current++;
    try {
      const snapshot = current.current;
      let path = snapshot.path;
      if (as || !path) path = await context.services.dialogs.saveFile({ defaultName: snapshot.path || 'Untitled.txt' });
      if (!path) return false;
      const content = snapshot.text;
      const data = new TextEncoder().encode(content);
      if (data.byteLength > 8 * 1024 * 1024) throw new Error('This document exceeds the 8 MB save limit.');
      let version: string;
      if (path === snapshot.path && snapshot.version !== null) {
        if (snapshot.externalChange) throw new Error('This file changed elsewhere. Reload it or use Save As to preserve your edits.');
        const result = await fs.write(path, content, String(snapshot.version)); version = result.version;
      } else {
        // Atomic create prevents a new file from replacing a concurrently created file.
        if (!fs.writeBinary) throw new Error('Creating files is unavailable until the shared filesystem transfer service is connected.');
        try { version = (await fs.writeBinary(path, data, { createOnly: true })).version; }
        catch (cause) {
          if (errorCode(cause) !== 'CONFLICT' && !/already exists|destination exists|conflict/i.test(errorMessage(cause))) throw cause;
          const existing = await fs.read(path);
          if (!(await confirmOverwrite(path))) return false;
          version = (await fs.write(path, content, existing.version)).version;
        }
      }
      if (!version) throw new Error('The filesystem did not acknowledge this save. Your document is still open.');
      if (alive.current) { update(doc => acknowledgeSave(doc, path!, content, version)); remember(path); setStatus('Saved to your workspace'); }
      return true;
    } catch (cause) {
      if (alive.current) {
        if (errorCode(cause) === 'CONFLICT' || /version conflict/i.test(errorMessage(cause))) update(doc => ({ ...doc, externalChange: true }));
        setError(`Save failed. ${errorMessage(cause)}`);
      }
      return false;
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  function history(direction: 'undo' | 'redo') {
    if (busy) return;
    const result = stepHistory(current.current, direction, editor.current?.selectionStart, editor.current?.selectionEnd);
    update(result.doc);
    setStatus(isDirty(result.doc) ? 'Unsaved changes' : 'No unsaved changes');
    if (result.selection) requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(result.selection!.selectionStart, result.selection!.selectionEnd); });
  }
  function showFind(replace = false) { setFindOpen(true); setReplaceOpen(replace); requestAnimationFrame(() => findInput.current?.focus()); }
  function nextMatch(from = editor.current?.selectionEnd || 0) {
    const match = findNext(current.current.text, query, from, matchCase);
    if (!match) { setStatus('No matches found'); return null; }
    editor.current?.focus(); editor.current?.setSelectionRange(...match); setCursor({ start: match[0], end: match[1] }); setStatus(`Match at character ${match[0] + 1}`); return match;
  }
  function replaceOne() {
    const start = editor.current?.selectionStart || 0; const end = editor.current?.selectionEnd || 0;
    const selected = current.current.text.slice(start, end);
    const match = findNext(selected, query, 0, matchCase);
    if (!match || match[0] !== 0 || match[1] !== selected.length) { nextMatch(start); return; }
    update(doc => editDocument(doc, doc.text.slice(0, start) + replacement + doc.text.slice(end), start, end));
    requestAnimationFrame(() => nextMatch(start + replacement.length));
  }
  function replaceAll() { const result = replaceAllText(current.current.text, query, replacement, matchCase); update(doc => editDocument(doc, result.text, cursor.start, cursor.end)); setStatus(`Replaced ${result.count} ${result.count === 1 ? 'match' : 'matches'}`); }
  const dirty = isDirty(doc);
  const commands = [
    { id: 'editor.new' as const, label: 'New', shortcut: 'Mod+N', enabled: !busy, execute: create },
    { id: 'editor.open' as const, label: 'Open…', shortcut: 'Mod+O', enabled: !busy, execute: open },
    { id: 'editor.save' as const, label: 'Save', shortcut: 'Mod+S', enabled: !busy && (dirty || !doc.path), execute: async () => { await save(); } },
    { id: 'editor.save-as' as const, label: 'Save As…', shortcut: 'Mod+Shift+S', enabled: !busy, execute: async () => { await save(true); } },
    { id: 'editor.undo' as const, label: 'Undo', shortcut: 'Mod+Z', enabled: !busy && doc.undo.length > 0, execute: () => history('undo') },
    { id: 'editor.redo' as const, label: 'Redo', shortcut: 'Mod+Shift+Z', enabled: !busy && doc.redo.length > 0, execute: () => history('redo') },
    { id: 'editor.find' as const, label: 'Find…', shortcut: 'Mod+F', execute: () => showFind() },
    { id: 'editor.replace' as const, label: 'Find and Replace…', shortcut: 'Mod+H', execute: () => showFind(true) },
    { id: 'editor.wrap' as const, label: 'Word Wrap', checked: wrap, execute: () => setWrap(!wrap) },
  ];
  useAppCommands(context, commands);
  const row = doc.text.slice(0, cursor.start).split('\n');
  return <div className="lope-app editor-view" data-testid="editor-app">
    <Toolbar><div className="control-group"><Button aria-label="New document" disabled={busy} onClick={() => { void create(); }}><FilePlus2 size={17}/></Button><Button disabled={busy} onClick={() => { void open(); }}><FolderOpen size={16}/>Open</Button><strong className="document-name">{doc.path ? baseName(doc.path) : 'Untitled'}{dirty && <span className="unsaved-indicator" aria-label="Unsaved changes">●</span>}</strong></div><div className="control-group"><Button aria-label="Undo" disabled={busy || !doc.undo.length} onClick={() => history('undo')}><Undo2 size={16}/></Button><Button aria-label="Redo" disabled={busy || !doc.redo.length} onClick={() => history('redo')}><Redo2 size={16}/></Button><Button aria-label="Find and replace" onClick={() => showFind(true)}><Search size={16}/></Button><Button variant="primary" disabled={busy || (!dirty && Boolean(doc.path))} onClick={() => { void save(); }}><Save size={15}/>{busy ? 'Saving…' : 'Save'}</Button></div></Toolbar>
    {findOpen && <div className="editor-find" role="search" aria-label="Find and replace"><Input ref={findInput} aria-label="Find text" placeholder="Find" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); nextMatch(); } if (event.key === 'Escape') { setFindOpen(false); editor.current?.focus(); } }}/><label className="inline-check"><input type="checkbox" checked={matchCase} onChange={event => setMatchCase(event.target.checked)}/>Match case</label><Button disabled={!query} onClick={() => nextMatch()}>Next</Button><Button onClick={() => setReplaceOpen(!replaceOpen)} aria-expanded={replaceOpen}>Replace</Button><Button aria-label="Close find" onClick={() => { setFindOpen(false); editor.current?.focus(); }}><X size={15}/></Button>{replaceOpen && <div className="editor-replace"><Input aria-label="Replace with" placeholder="Replace with" value={replacement} onChange={event => setReplacement(event.target.value)}/><Button disabled={busy || !query} onClick={replaceOne}>Replace</Button><Button disabled={busy || !query} onClick={replaceAll}>Replace all</Button></div>}</div>}
    {doc.externalChange && <div className="editor-conflict" role="alert"><div><strong>{doc.deleted ? 'This file was deleted or moved.' : 'This file changed elsewhere.'}</strong><span>Your edits are still here. Save a copy or reload the version in your workspace.</span></div><Button disabled={busy} onClick={() => { void save(true); }}>Save As…</Button>{!doc.deleted && <Button disabled={busy} onClick={() => { if (doc.path) void load(doc.path); }}>Reload file</Button>}</div>}
    {error && <div className="application-error" role="alert"><span>{error}</span><Button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></Button></div>}
    <div className="editor-page"><textarea ref={editor} aria-label="Document content" value={doc.text} wrap={wrap ? 'soft' : 'off'} spellCheck={false} readOnly={busy} onChange={event => { update(doc => editDocument(doc, event.target.value, cursor.start, cursor.end)); setStatus('Unsaved changes'); }} onSelect={event => setCursor({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); history(event.shiftKey ? 'redo' : 'undo'); } }}/></div>
    <footer className="application-status"><span role="status">{status}</span><span>Ln {row.length}, Col {row[row.length - 1].length + 1} · {doc.text.length.toLocaleString()} characters · UTF-8</span></footer>
    {guard && <Dialog title="Save your changes?" onClose={() => finishGuard(false)}><div className="lope-application-dialog-form"><p>“{doc.path ? baseName(doc.path) : 'Untitled'}” has unsaved changes.</p>{error && <p role="alert">{error}</p>}<div className="dialog-actions"><Button disabled={busy} onClick={() => finishGuard(false)}>Cancel</Button><Button disabled={busy} onClick={() => finishGuard(true)}>Discard changes</Button><Button variant="primary" disabled={busy} onClick={async () => { if (await save()) finishGuard(true); }}>Save changes</Button></div></div></Dialog>}
    {overwrite && <Dialog title="Replace this file?" onClose={() => finishOverwrite(false)}><div className="lope-application-dialog-form"><p>“{overwrite}” already exists. Replacing it saves this document over its current contents.</p><div className="dialog-actions"><Button onClick={() => finishOverwrite(false)}>Cancel</Button><Button variant="primary" onClick={() => finishOverwrite(true)}>Replace file</Button></div></div></Dialog>}
  </div>;
}
