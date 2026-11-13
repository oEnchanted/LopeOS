import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Cloud, Download, FileText, Folder, Grid2X2, Home, Info, List, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react';
import type { AppContext, FileEntry, FileService, SharedServices } from '../../../../../packages/contracts/src';
import { Button, Dialog, EmptyState, Input, Select, Toolbar } from '../../../../../packages/ui/src';
import { baseName, errorMessage, formatBytes, joinPath, parentPath, useAppCommands, usePreference } from '../hooks';
import { applications } from '../../shell/registry';
import { TRASH_PATH, DRIVE_TRASH_PATH, emptyTrash, listTrash, moveToTrash, removeTrashItem, restoreTrashItem, type TrashEntry } from '../../shell/trash';
import { FileConflictError, fileClipboard, normalizeWorkspacePath, transferEntries, validateFileName, type TransferResult } from './operations';
import { StoragePanel } from './StoragePanel';
import { AccountStatus } from '../../accounts/AccountPanel';
import { useCloudAccount } from '../../accounts/service';
import { isLopeDrivePath, LOPE_DRIVE, MAX_DRIVE_FILE_BYTES } from '../../../../../packages/runtime-client/src/lope-drive';
import { ActionMenu } from './ActionMenu';
import '../application.css';
import './files.css';

type TransferFiles = FileService & {
  readBinary?: (path: string) => Promise<{ data: Uint8Array; version: string }>;
  writeBinary?: (path: string, data: Uint8Array, options?: { createOnly?: boolean }) => Promise<unknown>;
};
type FileOpener = SharedServices & { openFile?: (path: string) => void | Promise<void> };
type DisplayEntry = FileEntry & Partial<Pick<TrashEntry, 'id' | 'originalPath' | 'deletedAt'>>;
type FileDialog = { kind: 'folder' | 'rename' | 'move' | 'go' | 'delete' | 'empty-trash' | 'info'; value: string; targets: DisplayEntry[] } | null;
type PendingTransfer = { entries: readonly FileEntry[]; destination: string; mode: 'copy' | 'move'; clipboard?: ReturnType<typeof fileClipboard.getSnapshot> };
const FILE_DRAG_TYPE = 'application/x-lope-files';
const isTrashPath = (path: string) => [TRASH_PATH, DRIVE_TRASH_PATH].some(root => path === root || path.startsWith(root + '/'));
const browsingPath = (path: string) => {
  const normalized = normalizeWorkspacePath(path);
  return isTrashPath(normalized) ? normalized.startsWith(DRIVE_TRASH_PATH) ? DRIVE_TRASH_PATH : TRASH_PATH : normalized;
};
const writablePath = (path: string) => {
  if (isTrashPath(browsingPath(path))) throw new Error('Trash is reserved for deleted items. Choose another location.');
  return path;
};

export default function Files({ context }: { context: AppContext }) {
  const fs = context.services.files as TransferFiles;
  const cloud = useCloudAccount();
  const initialPath = (() => { try { return typeof context.launchArgs.path === 'string' ? browsingPath(context.launchArgs.path) : LOPE_DRIVE; } catch { return LOPE_DRIVE; } })();
  const [location, setLocation] = useState({ paths: [initialPath], index: 0 });
  const path = location.paths[location.index];
  const inTrash = isTrashPath(path);
  const inDrive = isLopeDrivePath(path);
  const locationName = inTrash ? 'Trash' : baseName(path);
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sort, setSort] = usePreference(context, 'files.sort', 'name');
  const [descending, setDescending] = usePreference(context, 'files.descending', false);
  const [showHidden, setShowHidden] = usePreference(context, 'files.showHidden', false);
  const [view, setView] = usePreference<'list' | 'grid'>(context, 'files.view', 'list');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState<FileDialog>(null);
  const [dialogError, setDialogError] = useState('');
  const [openWith, setOpenWith] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const [transferError, setTransferError] = useState('');
  const [progress, setProgress] = useState('');
  const [storageRevision, setStorageRevision] = useState(0);
  const [dropTarget, setDropTarget] = useState('');
  const clipboard = useSyncExternalStore(fileClipboard.subscribe, fileClipboard.getSnapshot);
  const working = useRef(false);
  const currentPath = useRef(path); currentPath.current = path;
  const searchInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const anchor = useRef<string | null>(null);
  const typeAhead = useRef({ value: '', time: 0 });
  const appliedLaunchSelection = useRef('');
  const visible = useMemo(() => entries.filter(entry => (inTrash || showHidden || !entry.name.startsWith('.')) && entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    const comparison = sort === 'size' ? a.size - b.size || a.name.localeCompare(b.name) : sort === 'modified' ? new Date(b.deletedAt || b.modified).valueOf() - new Date(a.deletedAt || a.modified).valueOf() || a.name.localeCompare(b.name) : sort === 'kind' ? a.type.localeCompare(b.type) || (a.name.split('.').at(-1) || '').localeCompare(b.name.split('.').at(-1) || '') || a.name.localeCompare(b.name) : a.name.localeCompare(b.name, undefined, { numeric: true });
    return descending ? -comparison : comparison;
  }), [entries, query, sort, descending, inTrash, showHidden]);
  const targets = visible.filter(entry => selected.has(entry.path));
  const handlers = !inTrash && targets.length === 1 && targets[0].type === 'file' ? applications.filter(app => app.fileAssociations?.includes('.' + targets[0].name.split('.').at(-1)?.toLowerCase())) : [];
  const selectedRef = useRef(selected); selectedRef.current = selected;

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const next = inTrash ? await listTrash(fs, path) : (await fs.list(path)).filter(entry => !isTrashPath(entry.path));
      if (!mounted.current || id !== requestId.current) return;
      setEntries(next); setSelected(new Set([...selectedRef.current].filter(key => next.some(entry => entry.path === key)))); setLoadError('');
    } catch (cause) { if (mounted.current && id === requestId.current) setLoadError(errorMessage(cause)); }
    finally { if (mounted.current && id === requestId.current) setLoading(false); }
  }, [fs, path, inTrash]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestId.current++; }; }, []);
  useEffect(() => context.lifecycle.onBeforeClose(() => !working.current), [context.lifecycle]);
  useEffect(() => { setEntries([]); setSelected(new Set()); setQuery(''); setStatus(''); setError(''); setLoadError(''); anchor.current = null; void refresh(); context.lifecycle.setTitle(`${locationName} — Files`); }, [path, refresh, context.lifecycle, locationName]);
  useEffect(() => {
    try {
      const requested = typeof context.launchArgs.path === 'string' ? browsingPath(context.launchArgs.path) : undefined;
      if (typeof requested === 'string' && requested !== path) setLocation(previous => ({ paths: [...previous.paths.slice(0, previous.index + 1), requested], index: previous.index + 1 }));
    } catch (cause) { setError(errorMessage(cause)); }
    appliedLaunchSelection.current = '';
  }, [context.launchArgs]);
  useEffect(() => {
    const requested = context.launchArgs.select;
    if (typeof requested !== 'string') return;
    const signature = `${path}|${requested}`;
    if (appliedLaunchSelection.current === signature) return;
    const entry = entries.find(item => item.path === requested || item.name === baseName(requested));
    if (entry) { setSelected(new Set([entry.path])); appliedLaunchSelection.current = signature; }
  }, [entries, context.launchArgs.select, path]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = fs.subscribe(changed => {
      if (working.current) return;
      if (typeof changed === 'string' && !(inTrash && isTrashPath(changed)) && changed !== path && parentPath(changed) !== path && !path.startsWith(changed + '/')) return;
      clearTimeout(timer); timer = setTimeout(() => { if (!working.current) void refresh(); }, 100);
    });
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [fs, path, inTrash, refresh]);
  useEffect(() => { setSelected(previous => new Set([...previous].filter(key => visible.some(entry => entry.path === key)))); }, [query, showHidden]);

  function startOperation() {
    if (working.current) return false;
    working.current = true; setBusy(true); setError(''); setStatus(''); return true;
  }
  async function finishOperation() {
    working.current = false;
    if (mounted.current) { setBusy(false); setProgress(''); setStorageRevision(value => value + 1); if (currentPath.current === path) await refresh(); }
  }

  function navigate(next: string) {
    if (working.current) return;
    try { next = browsingPath(next); } catch (cause) { setError(errorMessage(cause)); return; }
    if (next === path) return;
    setLocation(previous => ({ paths: [...previous.paths.slice(0, previous.index + 1), next], index: previous.index + 1 }));
  }
  async function open(entry = targets[0]) {
    if (!entry || inTrash || busy) return;
    if (entry.type === 'directory') { navigate(entry.path); return; }
    try {
      const openFile = (context.services as FileOpener).openFile;
      if (!openFile) throw new Error('File opening is unavailable. The application registry needs to be connected.');
      await openFile(entry.path);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  function showDialog(kind: NonNullable<FileDialog>['kind']) {
    setDialogError('');
    setDialog({ kind, value: kind === 'rename' ? targets[0]?.name || '' : kind === 'move' || kind === 'go' ? path : '', targets: kind === 'empty-trash' ? entries : targets });
  }
  function stageClipboard(mode: 'copy' | 'cut') {
    if (!targets.length || inTrash || working.current) return;
    try {
      fileClipboard.set(mode, targets);
      setStatus(`${targets.length} ${targets.length === 1 ? 'item' : 'items'} ready to ${mode === 'cut' ? 'move' : 'copy'}. Open a destination and paste.`);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function transfer(operation: PendingTransfer, conflict: 'error' | 'keep-both' | 'skip' = 'error') {
    if (!startOperation()) return;
    try {
      const result: TransferResult = await transferEntries(fs, operation.entries, operation.destination, { mode: operation.mode, conflict }, progress => setProgress(`${operation.mode === 'copy' ? 'Copying' : 'Moving'} · ${progress.completed} of ${progress.total} complete: ${progress.name}`));
      if (operation.clipboard && operation.mode === 'move' && fileClipboard.getSnapshot() === operation.clipboard) {
        fileClipboard.remove(result.completed.map(item => item.source)); operation = { ...operation, clipboard: fileClipboard.getSnapshot() };
      }
      const verb = operation.mode === 'copy' ? 'copied' : 'moved';
      setStatus(`${result.completed.length} ${result.completed.length === 1 ? 'item' : 'items'} ${verb}${result.skipped.length ? ` · ${result.skipped.length} skipped` : ''}.`);
      if (result.failure) {
        const remaining = operation.entries.filter(entry => !result.completed.some(item => item.source === entry.path) && !result.skipped.includes(entry.path));
        if (result.failure instanceof FileConflictError) {
          setPendingTransfer({ ...operation, entries: remaining }); setTransferError(errorMessage(result.failure));
        } else { setPendingTransfer(null); setError(`${result.completed.length ? `${result.completed.length} items ${verb}. ` : ''}${errorMessage(result.failure)}${result.failed ? ' Check the destination before trying again.' : ''}`); }
      } else {
        setPendingTransfer(null);
        if (currentPath.current === operation.destination) { const next = new Set(result.completed.map(item => item.destination)); selectedRef.current = next; setSelected(next); }
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { await finishOperation(); }
  }
  async function drop(event: DragEvent, destination: string) {
    event.preventDefault(); event.stopPropagation(); setDropTarget('');
    if (working.current || isTrashPath(destination)) return;
    if (event.dataTransfer.files.length) { await upload(event.dataTransfer.files, destination); return; }
    const copy = event.altKey || event.ctrlKey;
    try {
      const paths: unknown = JSON.parse(event.dataTransfer.getData(FILE_DRAG_TYPE));
      if (!Array.isArray(paths) || !paths.length || paths.length > 1000 || !paths.every(value => typeof value === 'string')) return;
      const items: FileEntry[] = [];
      for (const value of paths) items.push(await fs.stat(writablePath(normalizeWorkspacePath(value))));
      await transfer({ entries: items, destination, mode: copy ? 'copy' : 'move' });
    } catch (cause) { setError(errorMessage(cause)); }
  }
  function dragOver(event: DragEvent, destination: string) {
    if (busy || isTrashPath(destination) || !event.dataTransfer.types.some(type => type === FILE_DRAG_TYPE || type === 'Files')) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') || event.altKey || event.ctrlKey ? 'copy' : 'move';
    setDropTarget(destination);
  }
  async function commitDialog(value?: string) {
    if (!dialog || busy) return;
    const operation = { ...dialog, value: value ?? dialog.value };
    if (operation.kind === 'move') {
      try { const destination = writablePath(normalizeWorkspacePath(operation.value)); setDialog(null); await transfer({ entries: operation.targets, destination, mode: 'move' }); }
      catch (cause) { setDialogError(errorMessage(cause)); }
      return;
    }
    if (!startOperation()) return;
    setDialogError(''); let count = 0;
    try {
      if (operation.kind === 'folder') await fs.mkdir(writablePath(joinPath(path, validateFileName(operation.value))));
      else if (operation.kind === 'rename') {
        const destination = writablePath(joinPath(parentPath(operation.targets[0].path), validateFileName(operation.value)));
        if (destination !== operation.targets[0].path) await fs.rename(operation.targets[0].path, destination);
      }
      else if (operation.kind === 'go') {
        const destination = browsingPath(operation.value);
        const folder = isTrashPath(destination) ? { type: 'directory' } : await fs.stat(destination);
        if (folder.type !== 'directory') throw new Error('Choose an existing destination folder.');
        working.current = false; navigate(destination);
      } else if (operation.kind === 'delete') {
        for (const entry of operation.targets) { await removeTrashItem(fs, entry as TrashEntry); count++; }
      } else if (operation.kind === 'empty-trash') await emptyTrash(fs, path);
      setStatus(operation.kind === 'folder' ? 'Folder created.' : operation.kind === 'empty-trash' ? 'Trash emptied.' : operation.kind === 'delete' ? 'Selected items permanently deleted.' : 'Files updated.');
      setDialog(null); setSelected(new Set());
    } catch (cause) { setDialogError(`${count ? `${count} items deleted. ` : ''}${errorMessage(cause)}`); if (count) setDialog({ ...operation, targets: operation.targets.slice(count) }); }
    finally { await finishOperation(); }
  }
  async function trashSelected() {
    if (busy || inTrash || !targets.length) return;
    if (!startOperation()) return; let count = 0;
    try {
      for (const entry of targets) { await moveToTrash(fs, entry.path); count++; }
      setStatus(`${count} ${count === 1 ? 'item' : 'items'} moved to Trash.`);
      setSelected(new Set());
    } catch (cause) { setError(`${count ? `${count} items moved to Trash. ` : ''}${errorMessage(cause)}`); }
    finally { await finishOperation(); }
  }
  async function putBack() {
    if (busy || !inTrash || !targets.length || targets.some(entry => !entry.originalPath)) return;
    if (!startOperation()) return; let count = 0;
    try {
      for (const entry of targets) { await restoreTrashItem(fs, entry as TrashEntry); count++; }
      setStatus(`${count} ${count === 1 ? 'item' : 'items'} put back in ${count === 1 ? 'its' : 'their'} original location.`);
      setSelected(new Set());
    } catch (cause) { setError(`${count ? `${count} items restored. ` : ''}${errorMessage(cause)}`); }
    finally { await finishOperation(); }
  }
  async function upload(files: FileList | null, destination = path) {
    if (inTrash || !files?.length || !fs.writeBinary) return;
    if (!startOperation()) return; let count = 0;
    try {
      for (const file of Array.from(files)) {
        const limit = isLopeDrivePath(destination) ? MAX_DRIVE_FILE_BYTES : 8 * 1024 * 1024;
        if (file.size > limit) throw new Error(`${file.name} exceeds the ${formatBytes(limit)} per-file transfer limit.`);
        writablePath(joinPath(destination, file.name));
      }
      for (const file of Array.from(files)) {
        setProgress(`Uploading ${count + 1} of ${files.length}: ${file.name}`);
        await fs.writeBinary(writablePath(joinPath(destination, file.name)), new Uint8Array(await file.arrayBuffer()), { createOnly: true }); count++;
      }
      setStatus(`Uploaded ${count} ${count === 1 ? 'file' : 'files'}.`);
    } catch (cause) { setError(`${count ? `${count} files uploaded. ` : ''}${errorMessage(cause)}`); }
    finally { await finishOperation(); if (input.current) input.current.value = ''; }
  }
  async function download() {
    if (inTrash || targets.length !== 1 || targets[0].type !== 'file' || !fs.readBinary) return;
    if (!startOperation()) return;
    try {
      const { data } = await fs.readBinary(targets[0].path);
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)]));
      const link = document.createElement('a'); link.href = url; link.download = targets[0].name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Download started.');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { await finishOperation(); }
  }
  function select(entry: FileEntry, extend: boolean, toggle: boolean) {
    if (extend && anchor.current) {
      const start = visible.findIndex(item => item.path === anchor.current); const end = visible.indexOf(entry);
      if (start >= 0) { setSelected(new Set(visible.slice(Math.min(start, end), Math.max(start, end) + 1).map(item => item.path))); return; }
    }
    anchor.current = entry.path;
    setSelected(previous => {
      const next = toggle ? new Set(previous) : new Set<string>();
      if (toggle && next.has(entry.path)) next.delete(entry.path); else next.add(entry.path);
      return next;
    });
  }
  function keyOnEntry(event: KeyboardEvent<HTMLButtonElement>, entry: FileEntry) {
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      event.preventDefault(); event.stopPropagation();
      if (!selected.has(entry.path)) setSelected(new Set([entry.path]));
      const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left + 24, y: rect.top + 24 }); return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (busy) return;
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void open(entry); }
    if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); event.stopPropagation();
      const columns = view === 'grid' ? Math.max(1, Math.floor((event.currentTarget.parentElement?.clientWidth || 122) / (event.currentTarget.offsetWidth + 12))) : 1;
      const index = visible.indexOf(entry); const step = (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) * (event.key === 'ArrowUp' || event.key === 'ArrowDown' ? columns : 1);
      const next = visible[event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + step))];
      if (next) { select(next, event.shiftKey, false); const button = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-file-path]') || []).find(item => item.dataset.filePath === next.path); button?.focus(); }
    }
    if (event.key.length === 1 && event.key !== ' ' && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation();
      const now = Date.now();
      typeAhead.current = { value: (now - typeAhead.current.time < 800 ? typeAhead.current.value : '') + event.key.toLocaleLowerCase(), time: now };
      const next = visible.find(item => item.name.toLocaleLowerCase().startsWith(typeAhead.current.value));
      if (next) { select(next, false, false); Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-file-path]') || []).find(item => item.dataset.filePath === next.path)?.focus(); }
    }
  }
  const usable = !busy && !loading && !loadError;
  const commands = [
    { id: 'files.new-window' as const, label: 'New Window', shortcut: 'Mod+N', execute: () => context.services.launch('lope.files') },
    { id: 'files.open' as const, label: 'Open', shortcut: 'Enter', enabled: usable && !inTrash && targets.length === 1, execute: () => open() },
    { id: 'files.open-with' as const, label: 'Open With…', enabled: usable && handlers.length > 0, execute: () => setOpenWith(true) },
    { id: 'files.new-folder' as const, label: 'New Folder…', shortcut: 'Mod+Shift+N', enabled: usable && !inTrash, execute: () => showDialog('folder') },
    { id: 'files.upload' as const, label: 'Upload…', enabled: usable && !inTrash && Boolean(fs.writeBinary), execute: () => input.current?.click() },
    { id: 'files.download' as const, label: 'Download', enabled: usable && !inTrash && targets.length === 1 && targets[0].type === 'file' && Boolean(fs.readBinary), execute: download },
    { id: 'files.rename' as const, label: 'Rename…', shortcut: 'F2', enabled: usable && !inTrash && targets.length === 1, execute: () => showDialog('rename') },
    { id: 'files.move' as const, label: 'Move to…', enabled: usable && !inTrash && targets.length > 0, execute: () => showDialog('move') },
    { id: 'files.copy' as const, label: 'Copy', shortcut: 'Mod+C', enabled: usable && !inTrash && targets.length > 0 && Boolean(fs.copy), execute: () => stageClipboard('copy') },
    { id: 'files.cut' as const, label: 'Cut', shortcut: 'Mod+X', enabled: usable && !inTrash && targets.length > 0, execute: () => stageClipboard('cut') },
    { id: 'files.paste' as const, label: 'Paste', shortcut: 'Mod+V', enabled: usable && !inTrash && !!clipboard?.entries.length && (clipboard.mode === 'cut' || Boolean(fs.copy)), execute: () => { if (clipboard) return transfer({ entries: clipboard.entries, destination: path, mode: clipboard.mode === 'cut' ? 'move' : 'copy', clipboard }); } },
    { id: 'files.duplicate' as const, label: 'Duplicate', shortcut: 'Mod+D', enabled: usable && !inTrash && targets.length > 0 && Boolean(fs.copy), execute: () => transfer({ entries: targets, destination: path, mode: 'copy' }, 'keep-both') },
    { id: 'files.delete' as const, label: 'Move to Trash', shortcut: 'Mod+Backspace', enabled: usable && !inTrash && targets.length > 0, execute: trashSelected },
    { id: 'files.delete-permanently' as const, label: 'Delete Permanently…', shortcut: 'Mod+Backspace', enabled: usable && inTrash && targets.length > 0, execute: () => showDialog('delete') },
    { id: 'files.put-back' as const, label: 'Put Back', enabled: usable && inTrash && targets.length > 0 && targets.every(entry => Boolean(entry.originalPath)), execute: putBack },
    { id: 'files.empty-trash' as const, label: 'Empty Trash…', enabled: usable && inTrash && entries.length > 0, execute: () => showDialog('empty-trash') },
    { id: 'files.info' as const, label: 'Get Info', shortcut: 'Mod+I', enabled: targets.length === 1, execute: () => showDialog('info') },
    { id: 'files.terminal' as const, label: 'Open in Terminal', enabled: !inTrash && !inDrive && targets.length <= 1 && (!targets.length || targets[0].type === 'directory'), execute: () => context.services.launch('terminal', { cwd: targets[0]?.path || path }) },
    { id: 'files.select-all' as const, label: 'Select All', shortcut: 'Mod+A', enabled: () => visible.length > 0 && !(document.activeElement instanceof HTMLElement && document.activeElement.matches('input,textarea,select,[contenteditable=true]')), execute: () => setSelected(new Set(visible.map(item => item.path))) },
    { id: 'files.lope-drive' as const, label: 'LopeDrive', execute: () => navigate(LOPE_DRIVE) },
    { id: 'files.home' as const, label: 'Home', execute: () => navigate('/') },
    { id: 'files.documents' as const, label: 'Documents', execute: () => navigate('/Documents') },
    { id: 'files.downloads' as const, label: 'Downloads', execute: () => navigate('/Downloads') },
    { id: 'files.trash' as const, label: 'Trash', execute: () => navigate(TRASH_PATH) },
    { id: 'files.list' as const, label: 'As List', checked: view === 'list', execute: () => setView('list') },
    { id: 'files.grid' as const, label: 'As Grid', checked: view === 'grid', execute: () => setView('grid') },
    { id: 'files.hidden' as const, label: 'Show Hidden Files', shortcut: 'Mod+Shift+.', checked: showHidden, execute: () => setShowHidden(!showHidden) },
    { id: 'files.go' as const, label: 'Go to Folder…', shortcut: 'Mod+Shift+G', enabled: !busy, execute: () => showDialog('go') },
    { id: 'files.parent' as const, label: 'Enclosing Folder', shortcut: 'Mod+ArrowUp', enabled: !busy && path !== '/', execute: () => navigate(parentPath(path)) },
    { id: 'files.find' as const, label: 'Find in Folder', shortcut: 'Mod+F', execute: () => { searchInput.current?.focus(); searchInput.current?.select(); } },
    { id: 'files.refresh' as const, label: 'Refresh', shortcut: 'Mod+R', enabled: !busy, execute: () => { setError(''); setStorageRevision(value => value + 1); return refresh(); } },
  ];
  useAppCommands(context, commands);
  const run = (id: string) => { const command = commands.find(item => item.id === id); if (command && (typeof command.enabled === 'function' ? command.enabled() : command.enabled !== false)) void command.execute(); };
  const menuIds = inTrash ? ['files.put-back', 'files.info', null, 'files.delete-permanently', 'files.empty-trash'] : ['files.open', 'files.open-with', null, 'files.copy', 'files.cut', 'files.paste', 'files.duplicate', null, 'files.rename', 'files.move', 'files.info', 'files.download', null, 'files.new-folder', 'files.go', 'files.hidden', 'files.delete'];
  const menuItems = menuIds.map(id => { const command = commands.find(item => item.id === id); return command ? { id: command.id, label: command.label, shortcut: command.shortcut, checked: command.checked, disabled: typeof command.enabled === 'function' ? !command.enabled() : command.enabled === false } : null; });
  return <div className="lope-app files-view" ref={root} data-testid="files-app" aria-label="Files" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'Period' && !(event.target as HTMLElement).closest('input,textarea,[role="dialog"]')) { event.preventDefault(); event.stopPropagation(); setShowHidden(!showHidden); }
    if (event.key === 'Escape' && !dialog && !pendingTransfer && !menu) { setSelected(new Set()); setQuery(''); }
  }}>
    <aside className="application-sidebar" aria-label="Locations"><div className="files-sidebar-content"><div className="files-locations"><p className="sidebar-caption">WORKSPACE</p>{[[LOPE_DRIVE, 'LopeDrive', Cloud], [DRIVE_TRASH_PATH, 'LopeDrive Trash', Trash2], ['/', 'Home', Home], ['/Documents', 'Documents', FileText], ['/Downloads', 'Downloads', Download], [TRASH_PATH, 'Trash', Trash2]].map(([value, label, Icon]) => { const ItemIcon = Icon as typeof Home; return <Button key={String(value)} disabled={busy} className={`${path === value ? 'selected' : ''} ${dropTarget === value ? 'file-drop-target' : ''}`} aria-label={String(label)} title={String(label)} aria-current={path === value ? 'page' : undefined} onClick={() => navigate(String(value))} onDragOver={event => dragOver(event, String(value))} onDragLeave={() => setDropTarget('')} onDrop={event => void drop(event, String(value))}><ItemIcon size={17}/><span>{String(label)}</span></Button>; })}</div><div className="files-cloud-status"><AccountStatus compact/><Button onClick={() => context.services.launch('lope.settings', { page: 'account' })}>{cloud.account ? 'Manage account' : 'Sign in or create account'}</Button></div></div>{!inDrive && <StoragePanel fs={fs} revision={storageRevision}/>}</aside>
    <section className="application-main" aria-busy={busy || loading}>
      <Toolbar><div className="control-group"><Button aria-label="Back" disabled={busy || location.index === 0} onClick={() => setLocation(previous => ({ ...previous, index: previous.index - 1 }))}><ArrowLeft size={16}/></Button><Button aria-label="Forward" disabled={busy || location.index === location.paths.length - 1} onClick={() => setLocation(previous => ({ ...previous, index: previous.index + 1 }))}><ArrowRight size={16}/></Button><Button aria-label="Enclosing folder" disabled={busy || path === '/'} onClick={() => run('files.parent')}><ArrowUp size={16}/></Button><strong className="files-location-title">{locationName}</strong></div><div className="control-group">{inTrash && <Button disabled={!usable || !entries.length} onClick={() => run('files.empty-trash')}><Trash2 size={15}/>Empty Trash…</Button>}{!inTrash && <><Button aria-label="New folder" disabled={!usable} onClick={() => run('files.new-folder')}><Plus size={17}/></Button><Button aria-label="Upload files" title={fs.writeBinary ? 'Upload files' : 'Binary upload service is unavailable'} disabled={!usable || inTrash || !fs.writeBinary} onClick={() => run('files.upload')}><Upload size={16}/></Button></>}<Button aria-label="Refresh files" disabled={busy} onClick={() => run('files.refresh')}><RefreshCw size={16}/></Button><Button aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16}/></Button><Button aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={16}/></Button><Button aria-label="File actions" aria-haspopup="menu" aria-expanded={!!menu} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: rect.right - 236, y: rect.bottom + 6 }); }}><MoreHorizontal size={18}/></Button></div></Toolbar>
      <input hidden type="file" multiple ref={input} onChange={event => { void upload(event.target.files); }}/>
      <div className={`files-content ${dropTarget === path ? 'file-drop-target' : ''}`} onDragOver={event => dragOver(event, path)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(''); }} onDrop={event => void drop(event, path)} onContextMenu={event => { event.preventDefault(); if (!(event.target as HTMLElement).closest('[data-file-path]')) setSelected(new Set()); setMenu({ x: event.clientX, y: event.clientY }); }}>
        <nav className="file-breadcrumbs" aria-label="Breadcrumb"><Button onClick={() => navigate('/')}>Home</Button>{path.split('/').filter(Boolean).map((part, index, parts) => <span key={index}><ChevronRight size={12}/><Button onClick={() => navigate('/' + parts.slice(0, index + 1).join('/'))}>{part === '.Trash' ? 'Trash' : part}</Button></span>)}</nav>
        <div className="application-heading"><div><h1>{path === '/' ? 'Home' : locationName}</h1>{(inTrash || inDrive) && <p>{inTrash ? 'Put items back or delete them permanently.' : cloud.account ? 'Saved on this device and synced to your account.' : 'Saved on this device. Sign in to sync files to your account.'}</p>}</div><span>{visible.length} {visible.length === 1 ? 'item' : 'items'}</span></div>
        <div className="file-controls"><label className="search-control"><Search size={15}/><Input ref={searchInput} aria-label="Search files" placeholder="Search this folder" value={query} onChange={event => setQuery(event.target.value)}/></label><Select aria-label="Sort files" value={sort} onChange={event => setSort(event.target.value)}><option value="name">Name</option><option value="modified">{inTrash ? 'Date deleted' : 'Last modified'}</option><option value="size">Size</option><option value="kind">Kind</option></Select><Button aria-label="Reverse sort order" title={descending ? 'Reverse sort order' : 'Reverse sort order'} aria-pressed={descending} onClick={() => setDescending(!descending)}>{descending ? <ArrowDown size={15}/> : <ArrowUp size={15}/>}</Button></div>
        {(error || loadError) && <div className="application-error" role="alert"><strong>{loadError ? 'This folder could not be loaded.' : 'Files could not complete this action.'}</strong><span>{error || loadError}</span><div className="control-group"><Button disabled={busy} onClick={() => run('files.refresh')}>{loadError ? 'Try again' : 'Refresh files'}</Button>{error && <Button aria-label="Dismiss file error" onClick={() => setError('')}><X size={14}/></Button>}</div></div>}
        {loading && !entries.length ? <div className="application-state" role="status">Loading files…</div> : !loadError && !visible.length ? <EmptyState title={query ? 'No matching files' : inTrash ? 'Trash is empty' : 'This folder is empty'} description={query ? 'Try another name.' : inTrash ? 'Items you move to Trash will appear here until you put them back or empty Trash.' : 'Create a folder or upload files.'}/> : <div className={`file-items ${view}`} aria-label={inTrash ? 'Trash contents' : 'Folder contents'}>
          {view === 'list' && <div className="file-item-heading" aria-hidden="true"><span>Name</span><span>{inTrash ? 'Date deleted' : 'Modified'}</span><span>Size</span></div>}
          {visible.map(entry => <button type="button" className={`file-item ${selected.has(entry.path) ? 'selected' : ''} ${clipboard?.mode === 'cut' && clipboard.entries.some(item => item.path === entry.path) ? 'file-cut' : ''} ${dropTarget === entry.path ? 'file-drop-target' : ''}`} key={entry.path} data-file-path={entry.path} aria-label={`${entry.name}, ${entry.type}`} aria-pressed={selected.has(entry.path)} onClick={event => { if (!busy) select(entry, event.shiftKey, event.ctrlKey || event.metaKey); }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); if (!selected.has(entry.path)) setSelected(new Set([entry.path])); setMenu({ x: event.clientX, y: event.clientY }); }} onDragOver={event => { if (entry.type === 'directory') dragOver(event, entry.path); }} onDragLeave={() => setDropTarget('')} onDrop={event => { if (entry.type === 'directory') void drop(event, entry.path); }} onDoubleClick={() => { void open(entry); }} onKeyDown={event => keyOnEntry(event, entry)} draggable={!inTrash && !busy} onDragStart={event => {
            const paths = selected.has(entry.path) ? targets.map(item => item.path) : [entry.path];
            if (!selected.has(entry.path)) setSelected(new Set(paths));
            event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData(FILE_DRAG_TYPE, JSON.stringify(paths));
          }} title={inTrash ? entry.originalPath ? `Original location: ${entry.originalPath}` : 'Original location unavailable. This item can still be deleted permanently.' : undefined}><span className="file-item-name">{entry.type === 'directory' ? <Folder className="file-folder" size={view === 'grid' ? 44 : 21}/> : <FileText size={view === 'grid' ? 39 : 20}/>}<span>{entry.name}{inTrash && <small className="file-original-path">{entry.originalPath || 'Original location unavailable'}</small>}</span></span><time dateTime={entry.deletedAt || entry.modified}>{Number.isNaN(new Date(entry.deletedAt || entry.modified).valueOf()) ? '—' : new Date(entry.deletedAt || entry.modified).toLocaleDateString()}</time><span>{entry.type === 'directory' ? '—' : formatBytes(entry.size)}</span></button>)}
        </div>}
      </div>
      <footer className="application-status"><span role="status">{busy ? progress || 'Working…' : status || (targets.length ? `${targets.length} selected${targets.every(entry => entry.type === 'file') ? ` · ${formatBytes(targets.reduce((size, entry) => size + entry.size, 0))}` : ''}` : `${visible.length} items`)}</span><div className="control-group">
        {inTrash ? <Button disabled={!usable || !targets.length || targets.some(entry => !entry.originalPath)} onClick={() => run('files.put-back')}><RotateCcw size={14}/>Put Back</Button> : <><Button disabled={!usable || targets.length !== 1} onClick={() => run('files.open')}>Open</Button><Button disabled={!usable || targets.length !== 1} onClick={() => run('files.rename')}>Rename</Button><Button disabled={!usable || !targets.length} onClick={() => run('files.move')}>Move</Button><Button aria-label="Download selected file" disabled={!usable || targets.length !== 1 || targets[0]?.type !== 'file' || !fs.readBinary} onClick={() => run('files.download')}><Download size={15}/></Button></>}
        <Button aria-label="File information" disabled={targets.length !== 1} onClick={() => run('files.info')}><Info size={15}/></Button><Button aria-label={inTrash ? 'Delete selected items permanently' : 'Move selected items to Trash'} disabled={!usable || !targets.length} onClick={() => run(inTrash ? 'files.delete-permanently' : 'files.delete')}><Trash2 size={15}/></Button>
      </div></footer>
    </section>
    {menu && <ActionMenu position={menu} items={menuItems} onAction={run} onClose={closeMenu}/>}
    {pendingTransfer && <Dialog title="Items already exist" dismissible={!busy} onClose={() => setPendingTransfer(null)}><div className="lope-application-dialog-form"><p role="alert">{transferError}</p><p>Keep both gives incoming items unique names. Skip leaves existing items untouched and continues with the others.</p><div className="dialog-actions"><Button disabled={busy} onClick={() => setPendingTransfer(null)}>Cancel</Button><Button disabled={busy} onClick={() => void transfer(pendingTransfer, 'skip')}>Skip</Button><Button variant="primary" disabled={busy} onClick={() => void transfer(pendingTransfer, 'keep-both')}>Keep Both</Button></div></div></Dialog>}
    {openWith && <Dialog title="Open With" onClose={() => setOpenWith(false)}><div className="lope-application-dialog-form"><p>Choose an application for {targets[0]?.name}.</p>{handlers.map(app => <Button key={app.id} onClick={() => { if (targets[0]) context.services.launch(app.id, { path: targets[0].path }); setOpenWith(false); }}>{app.name}</Button>)}</div></Dialog>}
    {dialog && <Dialog title={dialog.kind === 'folder' ? 'New folder' : dialog.kind === 'rename' ? 'Rename item' : dialog.kind === 'move' ? 'Move items' : dialog.kind === 'go' ? 'Go to Folder' : dialog.kind === 'info' ? 'File information' : dialog.kind === 'empty-trash' ? 'Empty Trash?' : 'Delete selected items permanently?'} dismissible={!busy} onClose={() => { if (!busy) setDialog(null); }}>
      <form className="lope-application-dialog-form" onKeyDown={event => { if (!['Escape', 'Tab'].includes(event.key)) event.stopPropagation(); }} onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get('value'); void commitDialog(typeof value === 'string' ? value : undefined); }}>
        {dialog.kind === 'info' ? <dl className="file-info"><dt>Name</dt><dd>{dialog.targets[0].name}</dd><dt>{inTrash ? 'Original path' : 'Path'}</dt><dd>{(inTrash ? dialog.targets[0].originalPath : dialog.targets[0].path) || 'Unavailable'}</dd><dt>Kind</dt><dd>{dialog.targets[0].type}</dd><dt>Size</dt><dd>{dialog.targets[0].type === 'directory' ? 'Folder' : formatBytes(dialog.targets[0].size)}</dd><dt>Modified</dt><dd>{new Date(dialog.targets[0].modified).toLocaleString()}</dd></dl> : dialog.kind === 'empty-trash' ? <p>Permanently delete all items in Trash, including folder contents? This cannot be undone.</p> : dialog.kind === 'delete' ? <p>This permanently deletes {dialog.targets.length === 1 ? `“${dialog.targets[0].name}”` : `${dialog.targets.length} selected items`}, including folder contents. This cannot be undone.</p> : <label>{dialog.kind === 'move' ? 'Destination folder path' : dialog.kind === 'go' ? 'Folder path' : 'Name'}<Input key={`${dialog.kind}-${dialog.targets[0]?.path || path}`} name="value" autoFocus defaultValue={dialog.value} required disabled={busy} placeholder={dialog.kind === 'move' || dialog.kind === 'go' ? '/Documents' : 'Untitled folder'}/></label>}
        {dialogError && <p className="application-error" role="alert">{dialogError}</p>}
        <div className="dialog-actions"><Button type="button" disabled={busy} onClick={() => setDialog(null)}>{dialog.kind === 'info' ? 'Done' : 'Cancel'}</Button>{dialog.kind !== 'info' && <Button type="submit" disabled={busy}>{busy ? 'Working…' : dialog.kind === 'delete' ? 'Delete Permanently' : dialog.kind === 'empty-trash' ? 'Empty Trash' : dialog.kind === 'folder' ? 'Create' : dialog.kind === 'go' ? 'Go' : 'Save'}</Button>}</div>
      </form>
    </Dialog>}
  </div>;
}
