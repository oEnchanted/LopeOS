import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, Check, Download, FileText, Folder, LoaderCircle, X } from 'lucide-react';
import type { FileEntry, SharedServices, WindowState } from '../../../../packages/contracts/src';
import { preferences, usePreferences } from '../../../../packages/sdk/src/preferences';
import { Button, Dialog } from '../../../../packages/ui/src';
import { AppIcon } from './Icons';
import { appById } from './registry';
import { readHistory, type StoredNotification } from './system';
import { interfaceScale, viewport } from './appearance';
import { scopedFiles } from './filePolicy';
import { emptyTrash, listTrash, moveToTrash, TRASH_PATH } from './trash';
import { ensureLopeFolders, LOPE_DOWNLOADS, LOPE_DRIVE } from '../../../../packages/runtime-client/src/lope-drive';
import './dock.css';

const FILE_DRAG_TYPE = 'application/x-lope-files';
const APP_DRAG_TYPE = 'application/x-lope-dock-app';
type Panel = { kind: 'downloads' | 'app' | 'trash'; anchor: HTMLButtonElement; appId?: string };
type DockProps = {
  pinned: string[]; running: Set<string>; windows: WindowState[]; history: StoredNotification[];
  services: SharedServices; activate: (id: string) => void; newWindow: (id: string) => void;
  restore: (id: string) => void; quit: (id: string) => Promise<void>; showSearch: () => void;
  setPinned: (change: (previous: string[]) => string[]) => void;
};

export function Dock({ pinned, running, windows, history, services, activate, newWindow, restore, quit, showSearch, setPinned }: DockProps) {
  const p = usePreferences();
  const fs = useMemo(() => scopedFiles(services.files, 'lope.files'), [services.files]);
  const [revealed, setRevealed] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 40 });
  const [downloads, setDownloads] = useState<FileEntry[]>([]);
  const [downloadsLoading, setDownloadsLoading] = useState(false);
  const [downloadsError, setDownloadsError] = useState('');
  const [trashCount, setTrashCount] = useState(0);
  const [trashError, setTrashError] = useState('');
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const popup = useRef<HTMLElement>(null);
  const trashButton = useRef<HTMLButtonElement>(null);
  const trashBusy = useRef(false);
  const activeAppId = windows.filter(win => win.state !== 'minimized').sort((a, b) => b.zIndex - a.zIndex)[0]?.appId;
  const pinnedIds = [...new Set(pinned)].filter(id => appById(id));
  const runningIds = [...running].filter(id => !pinnedIds.includes(id) && appById(id));
  const recentIds = p.showRecentApps ? readHistory<string[]>('recentApps', []).filter(id => !pinnedIds.includes(id) && !runningIds.includes(id) && appById(id)).slice(0, p.recentItemCount) : [];
  const minimized = p.minimizeDestination === 'dock' ? windows.filter(win => win.state === 'minimized') : [];

  function dismiss(returnFocus = false) {
    if (returnFocus) panel?.anchor.focus();
    setPanel(null);
  }
  function togglePanel(next: Panel) {
    setPanel(current => current?.kind === next.kind && current.anchor === next.anchor ? null : next);
  }
  function openLocation(path: string) {
    dismiss(); services.launch('lope.files', { path });
  }
  async function openDownload(entry: FileEntry) {
    if (preferences.getSnapshot().fileAccess['lope.files'] === false) {
      setDownloadsError('Workspace file access is disabled for Files in Settings.'); return;
    }
    dismiss(); await services.openFile(entry.path);
  }
  useLayoutEffect(() => {
    const element = nav.current;
    if (!element) return;
    const measure = () => {
      const lastItem = element.lastElementChild as HTMLElement | null;
      if (!lastItem) return setOverflow(false);
      const style = getComputedStyle(element);
      // Measure the item layout: tooltips and hover transforms can inflate scrollWidth/Height.
      const horizontal = p.dockPosition === 'bottom';
      const end = horizontal ? lastItem.offsetLeft + lastItem.offsetWidth : lastItem.offsetTop + lastItem.offsetHeight;
      const padding = parseFloat(horizontal ? style.paddingRight : style.paddingBottom);
      setOverflow(end + padding > (horizontal ? element.clientWidth : element.clientHeight) + 1);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [pinnedIds.join(','), runningIds.join(','), recentIds.join(','), minimized.length, p.dockSize, p.dockPosition]);
  useEffect(() => {
    if (!revealed || panel || dropActive) return;
    const timer = setTimeout(() => setRevealed(false), 4500);
    return () => clearTimeout(timer);
  }, [revealed, panel, dropActive]);
  useEffect(() => {
    let active = true, request = 0;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const id = ++request;
      try { const items = await listTrash(fs); if (active && id === request) { setTrashCount(items.length); setTrashError(''); } }
      catch (error) { if (active && id === request) { setTrashCount(0); setTrashError(error instanceof Error ? error.message : 'Trash is unavailable.'); } }
    };
    void refresh();
    const release = fs.subscribe(path => {
      if (path && path !== '/' && path !== TRASH_PATH && !path.startsWith(TRASH_PATH + '/')) return;
      clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 150);
    });
    return () => { active = false; clearTimeout(timer); release(); };
  }, [fs, p.fileAccess]);
  useEffect(() => {
    if (panel?.kind !== 'downloads') return;
    let active = true, request = 0;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const id = ++request; setDownloadsLoading(true);
      try {
        await ensureLopeFolders(fs);
        const entries = await fs.list(LOPE_DOWNLOADS);
        if (active && id === request) { setDownloads(entries.sort((a, b) => new Date(b.modified).valueOf() - new Date(a.modified).valueOf() || a.name.localeCompare(b.name))); setDownloadsError(''); }
      } catch (error) { if (active && id === request) { setDownloads([]); setDownloadsError(error instanceof Error ? error.message : 'Downloads are unavailable.'); } }
      finally { if (active && id === request) setDownloadsLoading(false); }
    };
    void refresh(); const release = fs.subscribe(path => {
      if (path && path !== LOPE_DRIVE && path !== LOPE_DOWNLOADS && !path.startsWith(LOPE_DOWNLOADS + '/')) return;
      clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 150);
    });
    return () => { active = false; clearTimeout(timer); release(); };
  }, [panel?.kind, fs, p.fileAccess]);
  useLayoutEffect(() => {
    if (!panel || !popup.current) return;
    const place = () => {
      const scale = interfaceScale(), bounds = panel.anchor.getBoundingClientRect(), size = popup.current!.getBoundingClientRect(), area = viewport();
      const width = size.width / scale, height = size.height / scale;
      const left = p.dockPosition === 'left' ? bounds.right / scale + 16 : p.dockPosition === 'right' ? bounds.left / scale - width - 16 : (bounds.left + bounds.width / 2) / scale - width / 2;
      const top = p.dockPosition === 'bottom' ? bounds.top / scale - height - 20 : (bounds.top + bounds.height / 2) / scale - height / 2;
      setPosition({ left: Math.max(8, Math.min(left, area.width - width - 8)), top: Math.max(40, Math.min(top, area.height - height - 8)) });
    };
    place(); const observer = new ResizeObserver(place); observer.observe(popup.current);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [panel, p.dockPosition, p.interfaceScale]);
  useEffect(() => {
    if (!panel) return;
    popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !nav.current?.contains(event.target as Node)) setPanel(null); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); panel.anchor.focus(); setPanel(null); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [panel]);

  async function trashPaths(paths: string[]) {
    if (trashBusy.current) return;
    trashBusy.current = true; setBusy(true); let moved = 0;
    try {
      // A selected folder already contains its selected descendants.
      const unique = [...new Set(paths)].filter(path => !paths.some(parent => parent !== path && path.startsWith(parent + '/')));
      for (const path of unique) { await moveToTrash(fs, path); moved++; }
      services.notify({ title: 'Moved to Trash', message: `${moved} ${moved === 1 ? 'item' : 'items'}. Use Put Back in Trash to restore.` });
    } catch (error) { services.notify({ title: 'Couldn’t move everything to Trash', message: `${moved ? `${moved} items moved. ` : ''}${error instanceof Error ? error.message : 'Please try again.'}`, tone: 'error' }); }
    finally { trashBusy.current = false; setBusy(false); }
  }
  async function empty() {
    if (trashBusy.current) return;
    trashBusy.current = true; setBusy(true); setTrashError('');
    try { await emptyTrash(fs); setTrashCount((await listTrash(fs)).length); setConfirmEmpty(false); trashButton.current?.focus(); }
    catch (error) { setTrashError(error instanceof Error ? error.message : 'Trash could not be emptied.'); }
    finally { trashBusy.current = false; setBusy(false); }
  }
  function panelKeys(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Tab') { event.preventDefault(); dismiss(true); }
  }
  function appIcon(id: string) {
    const app = appById(id)!;
    const count = p.notificationBadges && p.appBadges[id] !== false ? history.filter(item => item.appId === id).length : 0;
    return <button key={id} className={'dock-item ' + (running.has(id) ? 'is-running' : '')} aria-label={'Open ' + app.name} aria-current={activeAppId === id ? 'true' : undefined} aria-haspopup="menu" aria-expanded={panel?.appId === id} data-dock-app={id}
      onClick={() => { dismiss(); activate(id); }} onContextMenu={event => { event.preventDefault(); togglePanel({ kind: 'app', appId: id, anchor: event.currentTarget }); }}
      onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); togglePanel({ kind: 'app', appId: id, anchor: event.currentTarget }); } }}
      draggable onDragStart={event => { dismiss(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(APP_DRAG_TYPE, id); }}
      onDragOver={event => { if (event.dataTransfer.types.includes(APP_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
      onDrop={event => { const source = event.dataTransfer.getData(APP_DRAG_TYPE); if (!appById(source)) return; event.preventDefault(); if (source === id) return; setPinned(previous => { const next = previous.filter(value => value !== source); const index = next.indexOf(id); next.splice(index < 0 ? next.length : index, 0, source); return next; }); }}>
      <span className="dock-tooltip">{app.name}</span><AppIcon name={app.icon} size={p.dockSize}/>{count > 0 && <span className="dock-badge">{count > 9 ? '9+' : count}</span>}<span className="running-indicator"/>
    </button>;
  }
  const menuApp = panel?.appId ? appById(panel.appId) : undefined;
  const appWindows = windows.filter(win => win.appId === menuApp?.id).sort((a, b) => b.zIndex - a.zIndex);
  return <>
    {p.dockAutoHide && <button className="dock-reveal" data-position={p.dockPosition} aria-label="Reveal application Dock" onClick={() => setRevealed(true)} onFocus={() => setRevealed(true)} onDragEnter={() => setRevealed(true)}/>}
    <nav ref={nav} className={'dock glass ' + (revealed || panel || dropActive ? 'is-revealed' : '')} aria-label="Application Dock" data-position={p.dockPosition} data-autohide={p.dockAutoHide} data-magnify={p.dockMagnification} data-indicators={p.runningIndicators} data-overflow={overflow} onKeyDown={event => {
      const keys = p.dockPosition === 'bottom' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      // Only consume Dock navigation keys; global shortcuts (⌘K, ⌘W, Alt+F10) must still reach the shell.
      if (event.altKey || event.metaKey || event.ctrlKey || ![...keys, 'Home', 'End'].includes(event.key)) return;
      event.stopPropagation(); event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === keys[0] ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }}>
      <button className="dock-item" aria-label="All applications" onClick={() => { dismiss(); showSearch(); }}><span className="dock-tooltip">All applications</span><AppIcon name="apps" size={p.dockSize}/></button>
      <span className="dock-separator"/>{pinnedIds.map(appIcon)}
      {(runningIds.length > 0 || recentIds.length > 0) && <span className="dock-separator"/>}{runningIds.map(appIcon)}{recentIds.map(appIcon)}
      <span className="dock-separator"/>
      {minimized.map(win => <button key={win.id} className="dock-item dock-window-tile glass-inset" aria-label={'Restore ' + win.title} onClick={() => { dismiss(); restore(win.id); }}><span className="dock-tooltip">{win.title}</span><span className="dock-window-lines"/><AppIcon name={appById(win.appId)!.icon} size={25}/><span className="dock-window-title">{win.title}</span></button>)}
      <button className="dock-item" aria-label="Downloads" aria-haspopup="dialog" aria-expanded={panel?.kind === 'downloads'} onClick={event => togglePanel({ kind: 'downloads', anchor: event.currentTarget })} onContextMenu={event => { event.preventDefault(); togglePanel({ kind: 'downloads', anchor: event.currentTarget }); }}><span className="dock-tooltip">Downloads</span><AppIcon name="downloads" size={p.dockSize}/></button>
      <button ref={trashButton} className={'dock-item dock-trash ' + (dropActive ? 'is-drop-target' : '')} aria-label="Trash" aria-describedby="dock-trash-status" aria-haspopup="menu" aria-expanded={panel?.kind === 'trash'} aria-busy={busy} data-full={trashCount > 0} onClick={() => openLocation(TRASH_PATH)}
        onContextMenu={event => { event.preventDefault(); togglePanel({ kind: 'trash', anchor: event.currentTarget }); }}
        onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); togglePanel({ kind: 'trash', anchor: event.currentTarget }); } }}
        onDragOver={event => { if (!busy && event.dataTransfer.types.includes(FILE_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropActive(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false); }}
        onDrop={event => { event.preventDefault(); setDropActive(false); try { const paths: unknown = JSON.parse(event.dataTransfer.getData(FILE_DRAG_TYPE)); if (Array.isArray(paths) && paths.length && paths.every(path => typeof path === 'string')) void trashPaths(paths); } catch { /* Ignore unrelated drags. */ } }}>
        <span className="dock-tooltip" id="dock-trash-status">{busy ? 'Updating Trash…' : trashError ? 'Trash unavailable' : trashCount ? `Trash · ${trashCount} ${trashCount === 1 ? 'item' : 'items'}` : 'Trash is empty'}</span><AppIcon name={trashCount ? 'trash-full' : 'trash'} size={p.dockSize}/>
      </button>
    </nav>
    {panel && <section ref={popup} className={'dock-panel glass ' + (panel.kind === 'downloads' ? 'dock-downloads' : 'dock-menu')} style={position} role={panel.kind === 'downloads' ? 'dialog' : 'menu'} aria-label={panel.kind === 'downloads' ? 'Downloads' : menuApp ? `${menuApp.name} Dock menu` : 'Trash'} onKeyDown={panelKeys}>
      {panel.kind === 'downloads' ? <>
        <header className="dock-panel-heading"><div><strong>Downloads</strong><small>{downloads.length ? `${downloads.length} ${downloads.length === 1 ? 'item' : 'items'} · Newest first` : 'Your downloaded files'}</small></div><button aria-label="Close Downloads" onClick={() => dismiss(true)}><X size={16}/></button></header>
        <div className="dock-download-list">
          {downloadsLoading && !downloads.length ? <p className="dock-empty" role="status"><LoaderCircle size={26}/>Loading downloads…</p> : downloadsError ? <p className="dock-empty" role="alert">{downloadsError}</p> : !downloads.length ? <div className="dock-empty"><Download size={30}/><strong>No downloads yet</strong><span>Files saved to Downloads appear here.</span></div> : downloads.slice(0, 20).map(entry => <button key={entry.path} className="dock-download-entry" onClick={() => { void openDownload(entry); }}><span className="glass-inset dock-file-symbol">{entry.type === 'directory' ? <Folder size={22}/> : <FileText size={22}/>}</span><span><strong>{entry.name}</strong><small>{entry.type === 'directory' ? 'Folder' : new Intl.NumberFormat(p.region, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1 }).format(entry.size / 1024)}</small></span><ArrowUpRight size={15}/></button>)}
        </div>
        <button className="dock-panel-footer" onClick={() => openLocation(LOPE_DOWNLOADS)}>Open in Files <ArrowUpRight size={15}/></button>
      </> : panel.kind === 'app' && menuApp ? <>
        <div className="dock-menu-heading">{menuApp.name}</div>
        {appWindows.map(win => <button key={win.id} role="menuitem" className="dock-menu-window" onClick={() => { dismiss(); restore(win.id); }}><span className="dock-check">{win.focused && win.state !== 'minimized' && <Check size={13}/>}</span><span>{win.title}</span>{win.state === 'minimized' && <small>Minimized</small>}</button>)}
        {appWindows.length > 0 && <div className="dock-menu-separator" role="separator"/>}
        <button role="menuitem" onClick={() => { dismiss(); activate(menuApp.id); }}>Open {menuApp.name}</button>
        {!menuApp.singleton && <button role="menuitem" onClick={() => { dismiss(); newWindow(menuApp.id); }}>New Window</button>}
        <button role="menuitem" onClick={() => { setPinned(previous => previous.includes(menuApp.id) ? previous.filter(id => id !== menuApp.id) : [...previous, menuApp.id]); dismiss(true); const anchor = panel.anchor; requestAnimationFrame(() => { if (!anchor.isConnected) nav.current?.querySelector<HTMLButtonElement>('button')?.focus(); }); }}>{pinned.includes(menuApp.id) ? 'Remove from Dock' : 'Keep in Dock'}</button>
        {running.has(menuApp.id) && <><div className="dock-menu-separator" role="separator"/><button role="menuitem" onClick={() => { dismiss(); void quit(menuApp.id).catch(error => services.notify({ title: 'Couldn’t quit application', message: String(error), tone: 'error' })); }}>Quit {menuApp.name}</button></>}
      </> : <>
        <div className="dock-menu-heading">{trashCount ? `${trashCount} ${trashCount === 1 ? 'item' : 'items'} in Trash` : 'Trash'}</div>
        {trashError && <p className="dock-menu-error">{trashError}</p>}
        <button role="menuitem" onClick={() => openLocation(TRASH_PATH)}>Open Trash</button>
        <button role="menuitem" disabled={!trashCount || busy || !!trashError} onClick={() => { dismiss(true); setConfirmEmpty(true); }}>Empty Trash…</button>
      </>}
    </section>}
    {confirmEmpty && <Dialog title="Empty Trash?" dismissible={!busy} onClose={() => setConfirmEmpty(false)}><p>All items in Trash will be permanently deleted. You can’t undo this action.</p>{trashError && <p role="alert">{trashError}</p>}<div className="dialog-actions"><Button disabled={busy} onClick={() => setConfirmEmpty(false)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => void empty()}>{busy ? 'Emptying…' : 'Empty Trash'}</Button></div></Dialog>}
  </>;
}
