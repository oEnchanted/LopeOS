import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, Cloud, Download, FileText, Folder, FolderPlus, Home, RefreshCw, Search, X } from 'lucide-react';
import type { FileEntry } from '../../../../packages/contracts/src';
import { fileService } from '../../../../packages/runtime-client/src';
import { ensureLopeFolders, LOPE_DOCUMENTS, LOPE_DOWNLOADS } from '../../../../packages/runtime-client/src/lope-drive';
import { Button, Input } from '../../../../packages/ui/src';
import { normalizeWorkspacePath, validateFileName } from '../apps/files/operations';
import { TRASH_PATH, DRIVE_TRASH_PATH } from './trash';
const isTrashPath = (path: string) => [TRASH_PATH, DRIVE_TRASH_PATH].some(root => path === root || path.startsWith(root + '/'));
import './file-dialog.css';

export type DialogRequest = { mode: 'open' | 'save'; name: string; extensions?: string[]; resolve: (value: string | null) => void };
const join = (path: string, name: string) => `${path === '/' ? '' : path}/${name}`;
const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
const locations = [['/LopeDrive', 'LopeDrive', Cloud], ['/', 'Home', Home], [LOPE_DOCUMENTS, 'Documents', FileText], [LOPE_DOWNLOADS, 'Downloads', Download]] as const;
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The folder could not be opened.';
function initialLocation(name: string) {
  if (name.includes('/')) {
    try { const full = normalizeWorkspacePath(name.startsWith('/') || name.startsWith('~') ? name : '/' + name); if (!isTrashPath(full)) return { path: parent(full), name: full.split('/').at(-1)! }; } catch { /* Show invalid suggestions for correction. */ }
  }
  return { path: '/LopeDrive', name };
}

export function FileDialog({ request, onDone }: { request: DialogRequest; onDone: (path: string | null) => void }) {
  const [initial] = useState(() => initialLocation(request.name));
  const [history, setHistory] = useState({ paths: [initial.path], index: 0 });
  const path = history.paths[history.index];
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [name, setName] = useState(initial.name);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState(false);
  const [address, setAddress] = useState(path);
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [revision, setRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus(); input.current?.select();
    return () => { alive.current = false; previous?.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setEntries([]); setLoadError('');
    ensureLopeFolders(fileService).catch(() => {}).then(() => fileService.list(path)).then(value => { if (active) setEntries(value.filter(entry => !isTrashPath(entry.path))); }, cause => { if (active) setLoadError(message(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, revision]);
  useEffect(() => fileService.subscribe(() => setRevision(value => value + 1)), []);
  useEffect(() => { setAddress(path); setQuery(''); setError(''); setFolder(null); }, [path]);
  function navigate(destination: string) {
    try {
      const next = normalizeWorkspacePath(destination);
      if (isTrashPath(next)) throw new Error('Choose a folder outside Trash.');
      if (next !== path) {
        setLoading(true);
        if (request.mode === 'open') setName('');
        setHistory(previous => ({ paths: [...previous.paths.slice(0, previous.index + 1), next], index: previous.index + 1 }));
      }
    } catch (cause) { setError(message(cause)); }
  }
  const matches = (entry: FileEntry) => entry.type === 'directory' || !request.extensions?.length || request.extensions.some(ext => entry.name.toLowerCase().endsWith(ext.toLowerCase()));
  const visible = entries.filter(entry => (hidden || !entry.name.startsWith('.')) && matches(entry) && entry.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name, undefined, { numeric: true }));
  let valid = true;
  try { validateFileName(name); } catch { valid = false; }
  async function submit() {
    if (loading || working || loadError) return;
    try {
      validateFileName(name);
      const existing = entries.find(entry => entry.name === name);
      if (existing?.type === 'directory') { navigate(existing.path); return; }
      if (request.mode === 'open' && (!existing || !matches(existing))) throw new Error('Select an available file to open.');
      onDone(join(path, name));
    } catch (cause) { setError(message(cause)); }
  }
  async function createFolder() {
    if (folder === null || working) return;
    setWorking(true); setError('');
    try { const destination = join(path, validateFileName(folder)); if (isTrashPath(destination)) throw new Error('Trash is reserved for deleted items.'); await fileService.mkdir(destination); if (alive.current) navigate(destination); }
    catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setWorking(false); }
  }
  const crumbs = [{ path: '/', name: 'Home' }, ...path.split('/').filter(Boolean).map((part, index, parts) => ({ path: '/' + parts.slice(0, index + 1).join('/'), name: part }))];
  return <div className="modal-backdrop"><section className="file-dialog workspace-picker glass" role="dialog" aria-modal="true" aria-label={request.mode === 'save' ? 'Save As' : 'Open file'}>
    <header className="picker-heading"><div><h2>{request.mode === 'save' ? 'Save As' : 'Open file'}</h2><p>{request.mode === 'save' ? 'Choose a folder and name for your file.' : 'Browse your workspace to choose a file.'}</p></div><Button type="button" aria-label="Cancel file dialog" onClick={() => onDone(null)}><X size={18}/></Button></header>
    <div className="picker-body"><aside className="picker-sidebar glass-inset" aria-label="Locations"><span>Locations</span>{locations.map(([value, label, Icon]) => <Button type="button" key={value} disabled={working} aria-current={path === value ? 'page' : undefined} onClick={() => navigate(value)}><Icon size={18}/>{label}</Button>)}</aside>
    <main className="picker-main"><div className="picker-toolbar"><Button type="button" aria-label="Back" disabled={working || history.index === 0} onClick={() => { setLoading(true); setHistory(h => ({ ...h, index: h.index - 1 })); }}><ArrowLeft size={16}/></Button><Button type="button" aria-label="Forward" disabled={working || history.index === history.paths.length - 1} onClick={() => { setLoading(true); setHistory(h => ({ ...h, index: h.index + 1 })); }}><ArrowRight size={16}/></Button><Button type="button" aria-label="Parent folder" disabled={working || path === '/'} onClick={() => navigate(parent(path))}><ArrowUp size={16}/></Button><form onSubmit={e => { e.preventDefault(); navigate(address); }}><Input aria-label="Folder path" value={address} disabled={working} onChange={e => setAddress(e.target.value)}/></form><Button type="button" aria-label="Refresh folder" disabled={loading || working} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16}/></Button></div>
    <nav className="picker-breadcrumbs" aria-label="Folder breadcrumbs">{crumbs.map(crumb => <button key={crumb.path} disabled={working} onClick={() => navigate(crumb.path)} aria-current={crumb.path === path ? 'location' : undefined}>{crumb.name}</button>)}</nav>
    <div className="picker-tools"><label><Search size={15}/><Input aria-label="Search this folder" placeholder="Search this folder" value={query} onChange={e => setQuery(e.target.value)}/></label><Button type="button" disabled={loading || working || !!loadError} onClick={() => { setFolder('Untitled folder'); setError(''); }}><FolderPlus size={16}/>New folder</Button></div>
    <div className="picker-list" aria-label="Folder contents" aria-busy={loading}>{loading ? <p role="status">Loading folder…</p> : loadError ? <div role="alert"><p>{loadError}</p><Button type="button" onClick={() => setRevision(v => v + 1)}>Try again</Button></div> : visible.length ? visible.map(entry => <button key={entry.path} type="button" disabled={working} aria-label={`${entry.name}, ${entry.type}`} aria-pressed={entry.type === 'file' && name === entry.name} onClick={() => { setError(''); entry.type === 'directory' ? navigate(entry.path) : setName(entry.name); }} onDoubleClick={() => { if (entry.type === 'file' && request.mode === 'open') onDone(entry.path); }}><span>{entry.type === 'directory' ? <Folder size={22}/> : <FileText size={22}/>}<span>{entry.name}</span></span><small>{entry.type === 'directory' ? 'Folder' : `${Math.max(1, Math.ceil(entry.size / 1024))} KB`}</small></button>) : <p>{query ? 'No matching files or folders.' : 'This folder is empty.'}</p>}</div>
    <label className="picker-hidden"><input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)}/>Show hidden files</label>
    </main></div>
    <footer className="picker-footer">{folder !== null && <form className="picker-new-folder" onSubmit={e => { e.preventDefault(); void createFolder(); }}><label>New folder<Input autoFocus aria-label="New folder name" value={folder} disabled={working} onChange={e => setFolder(e.target.value)}/></label><Button type="button" disabled={working} onClick={() => setFolder(null)}>Cancel folder</Button><Button type="submit" disabled={working || !folder}>Create</Button></form>}
    <form onSubmit={e => { e.preventDefault(); void submit(); }}><label className="picker-name">File name<Input ref={input} value={name} disabled={working} onChange={e => { setName(e.target.value); setError(''); }}/></label><div className="picker-destination">{request.mode === 'save' ? 'Save in' : 'Location'}: {path}</div>{error && <p className="picker-error" role="alert">{error}</p>}<div className="picker-actions"><Button type="button" onClick={() => onDone(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={!valid || loading || working || !!loadError || folder !== null}>{request.mode === 'save' ? 'Save' : 'Open'}</Button></div></form></footer>
  </section></div>;
}
