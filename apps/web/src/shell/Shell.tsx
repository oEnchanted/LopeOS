import { Component, Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { registerBackupPreparation } from '../backup/lifecycle';
import { registerUpdatePreparation } from '../updates/service';
import { UpdateExperience } from '../updates/UpdateUI';
import { Search, SlidersHorizontal, Wifi, Bluetooth, Sun, Moon, Bell, Check, ChevronRight, X, ArrowUpRight, Folder, FileText, ArrowLeft, LoaderCircle, PanelTop } from 'lucide-react';
import type { AppContext, Bounds, Command, Notification, SharedServices, StatusItem, WindowState } from '../../../../packages/contracts/src';
import { AppProvider } from '../../../../packages/sdk/src';
import { Button } from '../../../../packages/ui/src';
import { fileService, terminalService } from '../../../../packages/runtime-client/src';
import { createBrowserService } from '../apps/browser/service';
import { applications, appById } from './registry';
import { Commands } from './commands';
import { AppIcon, LopeMark } from './Icons';
import { WindowFrame } from './WindowFrame';
import { useWindowFullscreen } from './useWindowFullscreen';
import { constrainBounds, resizeBounds } from './window-geometry';
import { wallpapers } from './wallpapers';
import { preferences, usePreferences } from '../../../../packages/sdk/src/preferences';
import { cloudAccount, useCloudAccount } from '../accounts/service';
import { appearanceAttributes, appearanceStyle, interfaceScale, viewport, workArea } from './appearance';
import { resolveDesktopBackground } from './background';
import { SystemStatus, QuickSettings, PrivacyScreen } from './SystemControls';
import { SearchPanel } from './SearchPanel';
import { HoverReader } from './DesktopExtras';
import { Dock } from './Dock';
import { HostWidget } from './HostWidget';
import { useHostPresence } from './host-status';
import { TRASH_PATH } from './trash';
import { scopedFiles } from './filePolicy';
import { capabilities, useCapabilities, notificationHistory, recordNotification, readHistory, writeHistory, clearHistory, installClipboardHistory, setMediaPreferences, playAlert, diagnostics, shellAction, type StoredNotification } from './system';
import { WeatherStatusBridge } from '../apps/weather/WeatherStatusBridge';
import { isPerfectHue, isWallpaperAvailable, type PersonalWallpaper } from '../apps/settings/wallpaper-policy';

import { FileDialog, type DialogRequest } from './FileDialog';

const loadedApps = new Map(applications.map(app => [app.id, lazy(app.entry)]));
const beforeClose = new Map<string, Set<() => boolean | Promise<boolean>>>();
const MAX_WINDOWS = 32;
const storage = preferences;
function createWindow(appId: string, index = 0, args: Record<string, unknown> = {}): WindowState {
  const app = appById(appId)!;
  const area = workArea(); const width = Math.min(app.defaultSize.width, area.width - 24), height = Math.min(app.defaultSize.height, area.height - 30);
  return { id: crypto.randomUUID(), appId, title: app.name, state: 'normal', focused: true, zIndex: index + 1, launchArgs: args,
    bounds: constrainBounds({ x: (viewport().width - width) / 2 + (index % 5) * 24, y: Math.max(60, (viewport().height - height) / 2 - 32) + (index % 5) * 18, width, height }) };
}
const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finiteBounds = (value: unknown): value is Bounds => plainObject(value) && ['x', 'y', 'width', 'height'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));
/** Saved and account-synced layouts are untrusted: rebuild each record field by field. */
function restoredWindow(value: unknown, seen: Set<string>): WindowState | null {
  if (!plainObject(value) || typeof value.appId !== 'string' || !finiteBounds(value.bounds)) return null;
  const app = appById(value.appId); if (!app) return null;
  const id = typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.id) && !seen.has(value.id) ? value.id : crypto.randomUUID(); seen.add(id);
  const args = plainObject(value.restoreArgs) ? value.restoreArgs : plainObject(value.launchArgs) ? value.launchArgs : {};
  return { id, appId: app.id, title: typeof value.title === 'string' ? value.title.slice(0, 200) : app.name,
    state: value.state === 'minimized' || value.state === 'maximized' ? value.state : 'normal', focused: value.focused === true,
    zIndex: typeof value.zIndex === 'number' && Number.isSafeInteger(value.zIndex) && value.zIndex >= 0 ? Math.min(value.zIndex, 100_000) : 1,
    bounds: constrainBounds(value.bounds), ...(finiteBounds(value.restoreBounds) ? { restoreBounds: value.restoreBounds } : {}),
    launchArgs: args, ...(plainObject(value.restoreArgs) ? { restoreArgs: value.restoreArgs } : {}) };
}
function initialWindows(): WindowState[] {
  const p = storage.getSnapshot(); let result: WindowState[] = [];
  try { const saved = JSON.parse(localStorage.getItem('lope.session.layout.v1') ?? localStorage.getItem('lope.layout.v1') ?? 'null'); const seen = new Set<string>(); if (p.restoreLayout && Array.isArray(saved)) result = saved.map(w => restoredWindow(w, seen)).filter((w): w is WindowState => !!w && p.appLaunch[w.appId] !== false).slice(0, 16); else if (!saved) result = [createWindow('lope.welcome')]; } catch { result = [createWindow('lope.welcome')]; }
  // Renumber stacking (stable for ties) so the menu bar's active window is the one painted on top.
  const stacking = [...result].sort((a, b) => a.zIndex - b.zIndex);
  const top = stacking.filter(w => w.state !== 'minimized').at(-1);
  result = result.map(w => ({ ...w, zIndex: stacking.indexOf(w) + 1, focused: w === top }));
  for (const id of p.startupApps) if (appById(id) && p.appLaunch[id] !== false && !result.some(w => w.appId === id)) result.push(createWindow(id, result.length));
  return result;
}
class AppBoundary extends Component<{ children: ReactNode; onRetry?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error : new Error(String(error)) }; }
  componentDidCatch() { diagnostics('app-error'); }
  render() {
    const { error } = this.state; if (!error) return this.props.children;
    // Some engines (WebKit) keep a failed module download for the document's lifetime; a guarded reload then recovers.
    const download = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload|ChunkLoadError/i.test(error.message);
    return <div className="app-loading" role="alert"><PanelTop/><h3>This app couldn’t open.</h3>{download && <p>LopeOS couldn’t download this app. Check your connection, then try again.</p>}<div className="app-loading-actions"><Button onClick={() => { this.props.onRetry?.(); this.setState({ error: null }); }}>Try again</Button>{download && <Button onClick={() => shellAction('reload')}>Reload LopeOS</Button>}</div></div>;
  }
}
/** React.lazy caches a rejected import forever; retrying must start a fresh import. */
function reloadApplication(appId: string) { const app = appById(appId); if (app) loadedApps.set(appId, lazy(app.entry)); }
function WindowApplication({ win, services, title, close, restore }: { win: WindowState; services: SharedServices; title: (id: string, title: string) => void; close: (id: string) => void; restore: (id: string, args: Record<string, unknown>) => void }) {
  const callbacks = useRef({ title, close, restore }); callbacks.current = { title, close, restore };
  const files = useMemo(() => {
    const access = scopedFiles(services.files, win.appId);
    if (win.appId !== 'lope.editor') return access;
    const remember = (path: string) => callbacks.current.restore(win.id, { path });
    return { ...access,
      async read(path: string) { const result = await access.read(path); remember(path); return result; },
      async write(...args: Parameters<typeof access.write>) { const result = await access.write(...args); remember(args[0]); return result; },
      ...(access.create ? { async create(path: string, content: string) { const result = await access.create!(path, content); remember(path); return result; } } : {}),
      ...(access.writeBinary ? { async writeBinary(...args: Parameters<NonNullable<typeof access.writeBinary>>) { const result = await access.writeBinary!(...args); remember(args[0]); return result; } } : {}),
    };
  }, [win.id, services.files]);
  // A context can outlive its window (async continuations, retained references).
  const alive = useRef(true);
  // A layout effect runs before children's passive effects, so apps can register commands after a StrictMode remount.
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const scopedServices = useMemo<SharedServices>(() => {
    const dialog = <T,>(open: () => Promise<T>) => !alive.current ? Promise.reject(new Error('This window has closed.')) : storage.getSnapshot().fileAccess[win.appId] !== false ? open() : Promise.reject(new Error('Workspace file access is disabled for this application in Settings.'));
    return { ...services, files, dialogs: { openFile: options => dialog(() => services.dialogs.openFile(options)), saveFile: options => dialog(() => services.dialogs.saveFile(options)) }, openFile: path => storage.getSnapshot().fileAccess[win.appId] !== false ? services.openFile(path) : Promise.reject(new Error('Workspace file access is disabled for this application in Settings.')), notify: n => services.notify({ ...n, appId: win.appId } as Notification), commands: {
    // Each window sees only its own commands; shell and other windows' commands stay with the shell.
    register(command) { return alive.current ? services.commands.register({ ...command, id: `${win.id}.${command.id}` }) : () => {}; },
    get(id) { return services.commands.get(`${win.id}.${id}`); },
    list() { return services.commands.list().filter(command => command.id.startsWith(`${win.id}.`)).map(command => ({ ...command, id: command.id.slice(win.id.length + 1) as Command['id'] })); },
    execute(id) { return services.commands.get(`${win.id}.${id}`) ? services.commands.execute(`${win.id}.${id}`) : Promise.resolve(); },
  } };
  }, [win.id, services, files]);
  const context = useMemo<AppContext>(() => ({ windowId: win.id, launchArgs: win.launchArgs || {}, services: scopedServices, lifecycle: {
    setTitle: name => callbacks.current.title(win.id, name), close: () => callbacks.current.close(win.id),
    onBeforeClose(handler) { const handlers = beforeClose.get(win.id) ?? new Set(); handlers.add(handler); beforeClose.set(win.id, handlers); return () => { handlers.delete(handler); if (!handlers.size) beforeClose.delete(win.id); }; },
  } }), [win.id, win.launchArgs, scopedServices]);
  useEffect(() => { const manifest = appById(win.appId); const cleanup = (manifest?.commands ?? []).map(command => scopedServices.commands.register(command)); manifest?.lifecycle?.onLaunch?.(context); return () => cleanup.forEach(release => release()); }, [win.id]);
  const [attempt, setAttempt] = useState(0);
  const App = loadedApps.get(win.appId)!;
  return <AppBoundary key={attempt} onRetry={() => { reloadApplication(win.appId); setAttempt(value => value + 1); }}><AppProvider context={context}><Suspense fallback={<div className="app-loading"><LoaderCircle size={24}/><span>Opening {appById(win.appId)?.name}…</span></div>}><App context={context}/></Suspense></AppProvider></AppBoundary>;
}

export function Shell() {
  const p = usePreferences(); const capture = useCapabilities();
  const restoringBackup = useRef(false);
  const { account, encryption } = useCloudAccount();
  const [privacy, setPrivacy] = useState(false); const [menuReveal, setMenuReveal] = useState(false);
  const [history, setHistory] = useState(notificationHistory); const desktopRestore = useRef<WindowState[]>([]);
  const [windows, setWindows] = useState<WindowState[]>(initialWindows);
  const [running, setRunning] = useState(() => new Set(windows.map(win => win.appId)));
  const [menu, setMenu] = useState<string | null>(null);
  const [popover, setPopover] = useState<string | null>(null);
  const [search, setSearch] = useState<false | 'all' | 'apps'>(false);
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; appId?: string } | null>(null);
  const openDesktopMenu = (e: React.MouseEvent) => { e.preventDefault(); setContextMenu({ x: e.clientX/interfaceScale(), y: e.clientY/interfaceScale() }); };
  useHostPresence();
  const pinned = p.pinned; const setPinned = (change: (previous: string[]) => string[]) => storage.set('pinned', change(storage.getSnapshot().pinned));
  const [appearance, setAppearance] = useState(0); const [clock, setClock] = useState(new Date());
  const [statusItems, setStatusItems] = useState<StatusItem[]>([]);
  const commands = useRef(new Commands()).current;
  const active = windows.filter(w => w.state !== 'minimized').sort((a, b) => b.zIndex - a.zIndex)[0];
  const { fullscreenWindowId, toggleFullscreen, exitFullscreen } = useWindowFullscreen(active?.id);
  const activeApp = active && appById(active.appId);
  const callbacks = useRef({ launch: (_id: string, _args?: Record<string, unknown>) => {}, notify: (_n: Notification) => {} });
  const dialogOpen = useRef(false); const windowLimitNotice = useRef(0);
  const requestDialog = (request: Omit<DialogRequest, 'resolve'>) => dialogOpen.current
    ? Promise.reject<string | null>(new Error('Another file dialog is already open. Finish or cancel it first.'))
    : new Promise<string | null>(resolve => { dialogOpen.current = true; setDialog({ ...request, resolve: path => { dialogOpen.current = false; resolve(path); } }); });
  const services = useMemo<SharedServices>(() => ({
    commands, files: fileService, terminal: terminalService, browser: createBrowserService(), settings: storage,
    launch: (id, args) => callbacks.current.launch(id, args), notify: n => callbacks.current.notify(n),
    openURL: url => { try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); callbacks.current.launch(storage.getSnapshot()['defaults.browser'], { url }); } catch { callbacks.current.notify({ title: 'Couldn’t open the link', message: 'Enter a valid HTTP or HTTPS address.', tone: 'error' }); } },
    async openFile(path) { try { const entry = await fileService.stat(path); const extension = '.' + path.split('.').pop()?.toLowerCase(); const handler = applications.find(app => app.fileAssociations?.includes(extension)); callbacks.current.launch(entry.type === 'directory' ? 'lope.files' : extension === '.txt' ? storage.getSnapshot()['defaults.text'] : handler?.id ?? storage.getSnapshot()['defaults.text'], { path }); } catch (error) { callbacks.current.notify({ title: 'Couldn’t open the file', message: error instanceof Error ? error.message : 'The file is unavailable.', tone: 'error' }); } },
    // One OS file dialog at a time. A second request must not replace the first and leave its caller waiting forever.
    dialogs: { openFile: options => requestDialog({ mode: 'open', name: '', extensions: options?.extensions }), saveFile: options => requestDialog({ mode: 'save', name: options?.defaultName || 'untitled.txt' }) },
    statusItems: { register(item) { setStatusItems(previous => [...previous.filter(i => i.id !== item.id), item]); return () => setStatusItems(previous => previous.filter(i => i.id !== item.id)); } },
  }), [commands]);
  const notify = (notification: Notification & { appId?: string }) => {
    const current = storage.getSnapshot(); const item: StoredNotification = { ...notification, id: crypto.randomUUID(), time: Date.now() };
    recordNotification(item); setHistory(notificationHistory());
    const allowed = !current.dnd && current.appAlerts[item.appId || 'lope.welcome'] !== false;
    if (!allowed) return;
    setNotifications(previous => [...previous.slice(-4), item]); setTimeout(() => setNotifications(previous => previous.filter(n => n.id !== item.id)), 6500);
    if (current.appSounds[item.appId || 'lope.welcome'] !== false) void playAlert().catch(() => {});
    const hiddenPreview = current.presentationMode || capabilities.snapshot().captures.some(c => c.kind === 'screen') || current.notificationPreviews !== 'always';
    if (current.browserAlerts && 'Notification' in window && window.Notification.permission === 'granted' && !hiddenPreview) try { const native = new window.Notification(item.title, { body: item.message }); setTimeout(() => native.close(), 7000); } catch {}
  };
  const focus = (id: string) => setWindows(previous => { if (previous.find(w => w.id === id)?.focused && previous.find(w => w.id === id)?.state !== 'minimized') return previous; const z = Math.max(0, ...previous.map(w => w.zIndex)) + 1; return previous.map(w => ({ ...w, focused: w.id === id, ...(w.id === id ? { zIndex: z, state: w.state === 'minimized' ? 'normal' as const : w.state } : {}) })); });
  // Bound open windows so a looping app (or held shortcut) cannot freeze the desktop.
  const atWindowLimit = (current: WindowState[]) => {
    if (current.length < MAX_WINDOWS) return false;
    if (Date.now() - windowLimitNotice.current > 5000) { windowLimitNotice.current = Date.now(); setTimeout(() => callbacks.current.notify({ title: 'Too many windows', message: `LopeOS keeps up to ${MAX_WINDOWS} windows open. Close a window to open another.`, tone: 'error' })); }
    return true;
  };
  const launch = (rawId: string, args: Record<string, unknown> = {}) => {
    if (restoringBackup.current) return;
    const id = appById(rawId) ? rawId : rawId === 'text-editor' ? 'lope.editor' : rawId.startsWith('lope.') ? rawId : `lope.${rawId}`;
    const app = appById(id); if (storage.getSnapshot().appLaunch[id] === false && !['lope.settings','lope.welcome'].includes(id)) { notify({ title: 'Application opening is disabled', message: 'You can allow this app in Settings → Applications.' }); return; } if (!app) { notify({ title: 'App unavailable', message: `No application is registered for ${rawId}.` }); return; }
    writeHistory('recentApps', [id, ...readHistory<string[]>('recentApps', []).filter(item => item !== id)].slice(0, 20));
    if (storage.getSnapshot().interfaceSounds) void playAlert(true).catch(() => {});
    setSearch(false); setMenu(null); setPopover(null); setContextMenu(null); setRunning(previous => new Set([...previous, id]));
    setWindows(previous => {
      const existing = previous.find(win => win.appId === id && (app.singleton || args.path && win.launchArgs?.path === args.path));
      const z = Math.max(0, ...previous.map(w => w.zIndex)) + 1;
      if (existing) return previous.map(w => ({ ...w, focused: w.id === existing.id, ...(w.id === existing.id ? { state: w.state === 'minimized' ? 'normal' as const : w.state, zIndex: z, ...(Object.keys(args).length ? { launchArgs: args } : {}) } : {}) }));
      if (atWindowLimit(previous)) return previous;
      return [...previous.map(w => ({ ...w, focused: false })), { ...createWindow(id, previous.length, args), zIndex: z }];
    });
  };
  callbacks.current = { launch, notify };
  useEffect(() => {
    const synced = (event: Event) => {
      const keys = (event as CustomEvent<{ keys: string[] }>).detail?.keys ?? [];
      if (keys.includes('storage:lope.session.layout.v1') && storage.getSnapshot().restoreLayout) {
        const restored = initialWindows();
        // Restore saved applications without closing documents open on this device.
        setWindows(current => {
          const existing = new Set(current.map(win => win.appId + ':' + String(win.launchArgs?.path ?? '')));
          const additions = restored.filter(win => !existing.has(win.appId + ':' + String(win.launchArgs?.path ?? '')));
          const ids = new Set(current.map(win => win.id));
          return [...current, ...additions.map(win => ({ ...win, id: ids.has(win.id) ? crypto.randomUUID() : win.id, focused: false }))].slice(0, 24);
        });
        setRunning(current => new Set([...current, ...restored.map(win => win.appId)]));
      }
      if (keys.some(key => key.startsWith('db:') && !key.includes('lope.photo-library.v1'))) callbacks.current.notify({ title: 'Account data synced', message: 'Reopen Quill or Prism to load synced recovery drafts. Open documents have not changed.' });
    };
    window.addEventListener('lope:account-sync-applied', synced);
    return () => window.removeEventListener('lope:account-sync-applied', synced);
  }, []);
  // Encrypted sync locks on every page load, including after a software update.
  // Bring the unlock form forward once per account instead of pausing silently.
  const syncUnlockPrompted = useRef<string | null>(null);
  useEffect(() => {
    if (!account || encryption !== 'locked' || syncUnlockPrompted.current === account.id) return;
    syncUnlockPrompted.current = account.id;
    callbacks.current.notify({ title: 'Sync is paused', message: 'Enter your account password in Settings to resume syncing. Your files on this device are still available.' });
    callbacks.current.launch('lope.settings', { page: 'account' });
  }, [account, encryption]);
  const close = async (id: string) => { if (restoringBackup.current) return false; for (const handler of beforeClose.get(id) ?? []) if (!await handler()) return false; setWindows(previous => previous.filter(w => w.id !== id)); beforeClose.delete(id); return true; };
  const quit = async (id: string) => { for (const win of windows.filter(w => w.appId === id)) if (!await close(win.id)) return; await appById(id)?.lifecycle?.onQuit?.(); setRunning(previous => new Set([...previous].filter(app => app !== id))); };
  const signOut = async () => {
    if (restoringBackup.current) return;
    for (const win of windows) for (const handler of beforeClose.get(win.id) ?? []) if (!await handler()) return;
    await cloudAccount.signOut();
    capabilities.stopAll();
    for (const win of windows) beforeClose.delete(win.id);
    window.dispatchEvent(new Event('lope:sign-out'));
  };
  const update = (id: string, change: Partial<WindowState>) => setWindows(previous => previous.map(win => win.id === id ? { ...win, ...change } : win));
  const title = (id: string, name: string) => setWindows(previous => previous.some(w => w.id === id && w.title !== name) ? previous.map(w => w.id === id ? { ...w, title: name } : w) : previous);
  const fullscreen = (id: string) => { focus(id); setMenu(null); setPopover(null); setSearch(false); setContextMenu(null); setMenuReveal(false); toggleFullscreen(id); };
  const maximize = (id: string) => { exitFullscreen(); setWindows(previous => previous.map(win => win.id === id ? { ...win, state: win.state === 'maximized' ? 'normal' : 'maximized', bounds: win.state === 'maximized' ? constrainBounds(win.restoreBounds ?? win.bounds) : win.bounds, restoreBounds: win.state === 'maximized' ? undefined : win.bounds } : win)); };
  const snap = (side: 'left' | 'right') => { exitFullscreen(); const area = workArea(); if (active) update(active.id, { state: 'normal', restoreBounds: active.bounds, bounds: { x: side === 'left' ? area.x : area.x + area.width / 2 + 4, y: area.y, width: area.width / 2 - 4, height: area.height } }); };
  const minimize = (id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-window-id="${CSS.escape(id)}"]`);
    if (el && p.windowAnimation === 'gentle' && !p.reduceMotion && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
      const animation = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'forwards' });
      animation.onfinish = () => {
        // Hide the mounted window before releasing the final transparent frame.
        flushSync(() => update(id, { state: 'minimized', focused: false }));
        animation.cancel();
      };
    } else update(id, { state: 'minimized', focused: false });
  };
  const showDesktop = () => { if (p.showDesktopBehavior === 'toggle' && desktopRestore.current.length && !windows.some(w => w.state !== 'minimized')) { const saved = desktopRestore.current; setWindows(current => current.map(w => ({...w,state:saved.find(s=>s.id===w.id)?.state ?? w.state}))); desktopRestore.current=[]; } else { desktopRestore.current = windows; setWindows(current=>current.map(w=>({...w,state:'minimized',focused:false}))); } };
  const showSearch = () => { if (restoringBackup.current) return; setSearch('all'); setMenu(null); setPopover(null); };
  const showApplications = () => { if (restoringBackup.current) return; setSearch('apps'); setMenu(null); setPopover(null); setContextMenu(null); };
  const builtin: Command[] = [
    { id: 'shell.about', label: 'About LopeOS', execute: () => launch('lope.welcome') }, { id: 'shell.settings', label: 'System Settings…', execute: () => launch('lope.settings') },
    { id: 'shell.search', label: 'Spotlight Search…', shortcut: p.searchShortcut === 'Mod+K' ? '⌘ K' : '⌥ Space', execute: showSearch }, { id: 'shell.new', label: 'New window', shortcut: '⌘ N', execute: () => { if (active && storage.getSnapshot().appLaunch[active.appId] !== false) setWindows(current => atWindowLimit(current) ? current : [...current, createWindow(active.appId, current.length)]); } },
    { id: 'shell.close', label: 'Close window', shortcut: '⌘ W', enabled: !!active, execute: async () => { if (active) await close(active.id); } },
    { id: 'shell.quit', label: `Quit ${activeApp?.name ?? 'application'}`, enabled: !!active, execute: async () => { if (active) await quit(active.appId); } },
    { id: 'shell.minimize', label: 'Minimize', enabled: !!active, execute: () => { if (active) minimize(active.id); } },
    { id: 'shell.maximize', label: active?.state === 'maximized' ? 'Restore window' : 'Maximize', enabled: !!active, execute: () => { if (active) maximize(active.id); } },
    { id: 'shell.fullscreen', label: fullscreenWindowId ? 'Exit full screen' : 'Enter full screen', enabled: !!active, execute: () => { if (active) fullscreen(active.id); } },
    { id: 'shell.left', label: 'Tile window to left', enabled: !!active, execute: () => snap('left') }, { id: 'shell.right', label: 'Tile window to right', enabled: !!active, execute: () => snap('right') },
    { id: 'shell.center', label: 'Center window', enabled: !!active, execute: () => { exitFullscreen(); if (active) update(active.id, { state: 'normal', bounds: constrainBounds({ ...active.bounds, x: (viewport().width - active.bounds.width) / 2, y: (viewport().height - active.bounds.height) / 2 - 25 }) }); } },
    { id: 'shell.desktop', label: 'Show desktop', execute: showDesktop },
    { id: 'shell.signOut', label: 'Sign out…', enabled: !!account, execute: signOut },
    { id: 'shell.restoreAll', label: 'Bring all to front', execute: () => setWindows(p => p.map(w => ({ ...w, state: w.state === 'minimized' ? 'normal' : w.state }))) },
    { id: 'shell.theme', label: 'Dark appearance', checked: storage.get<string>('theme', 'light') === 'dark', execute: () => storage.set('theme', storage.get<string>('theme', 'light') === 'dark' ? 'light' : 'dark') },
    { id: 'shell.transparency', label: 'Reduce transparency', checked: storage.get('reduceTransparency', storage.get('reducedTransparency', false)), execute: () => storage.set('reduceTransparency', !storage.get('reduceTransparency', storage.get('reducedTransparency', false))) },
    { id: 'shell.shortcuts', label: 'Keyboard shortcuts', execute: () => { launch('lope.welcome'); notify({ title: 'Keyboard shortcuts', message: '⌘/Ctrl K: search · Alt + arrows: move window · Alt + Shift + arrows: resize · Alt F10: menus' }); } },
  ];
  builtin.forEach(command => commands.register(command));
  const menuItems: Record<string, (string | null)[]> = {
    LopeOS: ['shell.about', null, 'shell.settings', 'shell.search', null, 'shell.desktop', ...(account ? [null, 'shell.signOut'] : [])],
    [activeApp?.name ?? 'Desktop']: ['shell.about', null, 'shell.quit'],
    File: [...(active?.appId === 'lope.editor' ? [`editor.${active.id}.open`, `editor.${active.id}.save`, null] : []), 'shell.new', 'shell.close'],
    View: ['shell.theme', 'shell.transparency', null, 'shell.search', 'shell.desktop'],
    Window: ['shell.minimize', 'shell.maximize', 'shell.fullscreen', null, 'shell.left', 'shell.right', 'shell.center', null, 'shell.restoreAll'],
    Help: ['shell.about', 'shell.shortcuts'],
  };
  for (const definition of activeApp?.menus ?? []) menuItems[definition.label] = [...definition.items.map(item => typeof item === 'string' ? item : null), ...(menuItems[definition.label]?.length ? [null, ...menuItems[definition.label].filter(id => !id?.startsWith('editor.'))] : [])];
  const menuLabels = [...new Set(['LopeOS', activeApp?.name ?? 'Desktop', 'File',
    ...(activeApp?.menus ?? []).map(definition => definition.label).filter(label => label !== 'Window' && label !== 'Help'),
    'View', 'Window', 'Help'])];
  const getCommand = (id: string) => (active && commands.get(`${active.id}.${id}`)) || commands.get(id);
  const runCommand = (id: string) => { if (restoringBackup.current && id.startsWith('shell.')) return; setMenu(null); setContextMenu(null); const command = getCommand(id); if (command) void commands.execute(command.id).catch(error => notify({ title: 'Couldn’t finish that action', message: error.message, tone: 'error' })); };
  useEffect(() => { if (restoringBackup.current) return; try { localStorage.setItem('lope.session.layout.v1', JSON.stringify(windows)); } catch { diagnostics('storage-unavailable'); } }, [windows]);
  useEffect(() => registerUpdatePreparation(async () => {
    if (restoringBackup.current) throw new Error('Wait for the current workspace operation to finish before updating.');
    restoringBackup.current = true;
    const restoreFocus = () => setWindows(current => current.map(win => {
      const previous = windows.find(saved => saved.id === win.id);
      return previous ? { ...win, state: previous.state, focused: previous.focused, zIndex: previous.zIndex } : win;
    }));
    try {
      for (const win of windows) {
        const guards = beforeClose.get(win.id);
        if (!guards?.size) continue;
        // Save prompts must be visible even for minimized or covered apps.
        flushSync(() => setWindows(current => {
          const top = Math.max(0, ...current.map(value => value.zIndex)) + 1;
          return current.map(value => ({ ...value, focused: value.id === win.id, ...(value.id === win.id ? { state: value.state === 'minimized' ? 'normal' as const : value.state, zIndex: top } : {}) }));
        }));
        for (const handler of guards) if (!await handler()) {
          restoreFocus(); restoringBackup.current = false; return null;
        }
      }
      restoreFocus();
      setSearch(false); setPopover(null); setMenu(null); setContextMenu(null);
      // Keep apps mounted until success so a failed download can return to them.
      return {
        resume: () => { restoringBackup.current = false; },
        retire: () => {
          capabilities.stopAll();
          // Preserve the saved layout while removing app unload guards. Users
          // already chose Save/Discard in each app before the download started.
          flushSync(() => { setWindows([]); setRunning(new Set()); });
          for (const win of windows) beforeClose.delete(win.id);
        },
      };
    } catch (cause) { restoreFocus(); restoringBackup.current = false; throw cause; }
  }), [windows]);
  useEffect(() => registerBackupPreparation(async () => {
    if (restoringBackup.current) throw new Error('A backup is already being restored.');
    restoringBackup.current = true;
    const closing = windows.filter(win => win.appId !== 'lope.settings');
    const restoreFocus = () => setWindows(current => current.map(win => {
      const previous = windows.find(saved => saved.id === win.id);
      return previous ? { ...win, state: previous.state, focused: previous.focused, zIndex: previous.zIndex } : win;
    }));
    try {
      for (const win of closing) {
        const guards = beforeClose.get(win.id);
        if (!guards?.size) continue;
        // Some app prompts live inside their window; reveal minimized/covered windows.
        flushSync(() => setWindows(current => {
          const top = Math.max(0, ...current.map(value => value.zIndex)) + 1;
          return current.map(value => ({ ...value, focused: value.id === win.id, ...(value.id === win.id ? { state: value.state === 'minimized' ? 'normal' as const : value.state, zIndex: top } : {}) }));
        }));
        for (const handler of guards) if (!await handler()) { restoreFocus(); restoringBackup.current = false; return null; }
      }
    } catch (cause) { restoreFocus(); restoringBackup.current = false; throw cause; }
    capabilities.stopAll();
    // Unmount writers before replacing their stores, and preserve the saved layout.
    flushSync(() => {
      setWindows(current => current.filter(win => win.appId === 'lope.settings').map(win => ({ ...win, focused: true, state: win.state === 'minimized' ? 'normal' as const : win.state })));
      setRunning(new Set(['lope.settings'])); setSearch(false); setPopover(null); setMenu(null);
    });
    for (const win of closing) beforeClose.delete(win.id);
    return () => { restoringBackup.current = false; };
  }), [windows]);
  useEffect(() => { const tick = () => { if (!document.hidden) setClock(new Date()); }; tick(); const timer = setInterval(tick, p.clockSeconds ? 1000 : 15000); document.addEventListener('visibilitychange', tick); return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); }; }, [p.clockSeconds]);
  useEffect(() => { const change = () => setAppearance(n => n + 1); const resize = () => { change(); setWindows(current => current.map(w => ({ ...w, bounds: constrainBounds(w.bounds) }))); }; const media = matchMedia('(prefers-color-scheme: dark)'); window.addEventListener('resize', resize); window.addEventListener('blur', change); window.addEventListener('focus', change); media.addEventListener('change', change); return () => { window.removeEventListener('resize', resize); window.removeEventListener('blur', change); window.removeEventListener('focus', change); media.removeEventListener('change', change); }; }, []);
  useEffect(() => { setWindows(current => current.map(w=>({...w,bounds:constrainBounds(w.bounds)}))); }, [p.interfaceScale]);
  useEffect(() => { const refresh = () => setHistory(notificationHistory()); window.addEventListener('lope:history-updated', refresh); refresh(); return () => window.removeEventListener('lope:history-updated', refresh); }, [p.notificationHistoryDays]);
  useEffect(() => { if (p.dnd) setNotifications([]); }, [p.dnd]);
  useEffect(() => {
    // Browser full-screen transitions can skip the menu bar's pointerleave event.
    const changed = () => setMenuReveal(false);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(installClipboardHistory, []);
  useEffect(() => { setMediaPreferences(); document.addEventListener('play',setMediaPreferences,true); document.addEventListener('loadedmetadata',setMediaPreferences,true); return () => { document.removeEventListener('play',setMediaPreferences,true); document.removeEventListener('loadedmetadata',setMediaPreferences,true); }; }, [p.soundMuted,p.soundVolume,p.mediaCaptions]);
  useEffect(() => { if (!p.wallpaperRotation) return; const rotate = () => { if (document.hidden) return; const list=[...wallpapers.filter(isWallpaperAvailable).map(w=>w.id),...(storage.get('personalWallpaper',null)?['personal']:[])]; const current=storage.getSnapshot().wallpaper; storage.set('wallpaper',list[(list.indexOf(current)+1)%list.length]); }; const timer=setInterval(rotate,p.wallpaperRotation*60000); return()=>clearInterval(timer); }, [p.wallpaperRotation]);
  useEffect(() => { let last=Date.now(); const activity=()=>{last=Date.now();}; const check=()=>{if(p.privacyOnHidden&&document.hidden||p.idlePrivacyMinutes>0&&Date.now()-last>=p.idlePrivacyMinutes*60000)setPrivacy(true);}; const timer=setInterval(check,10000); window.addEventListener('pointerdown',activity);window.addEventListener('keydown',activity);window.addEventListener('pointermove',activity);document.addEventListener('visibilitychange',check);return()=>{clearInterval(timer);window.removeEventListener('pointerdown',activity);window.removeEventListener('keydown',activity);window.removeEventListener('pointermove',activity);document.removeEventListener('visibilitychange',check);};},[p.idlePrivacyMinutes,p.privacyOnHidden,privacy]);
  useEffect(() => { const action = async (event: Event) => { if (restoringBackup.current) return; const name=(event as CustomEvent).detail.action; if(name==='sign-out'){try{await signOut();}catch(error){notify({title:'Couldn’t sign out',message:error instanceof Error?error.message:String(error),tone:'error'});}return;}if(name==='privacy'){setPrivacy(true);setPopover(null);return;}if(name==='show-desktop'){showDesktop();return;}if(name==='reload'||name==='close-apps'){for(const win of [...windows].sort((a,b)=>Number(a.appId==='lope.settings')-Number(b.appId==='lope.settings')))for(const handler of beforeClose.get(win.id)??[])if(!await handler())return;if(name==='reload'){window.location.reload();return;}setWindows([]);setRunning(new Set());capabilities.stopAll();return;}if(name==='clear-layout')try{localStorage.removeItem('lope.session.layout.v1');}catch{}};window.addEventListener('lope:system-action',action);return()=>window.removeEventListener('lope:system-action',action);});
  useEffect(() => { const handler = () => showSearch(); const openFile = (e: Event) => launch('lope.editor', { path: (e as CustomEvent).detail.path }); window.addEventListener('lope:search', handler); window.addEventListener('lope:open-file', openFile); return () => { window.removeEventListener('lope:search', handler); window.removeEventListener('lope:open-file', openFile); }; }, []);
  useLayoutEffect(() => { if (menu || contextMenu) document.querySelector<HTMLButtonElement>('.dropdown-menu button:not(:disabled)')?.focus(); }, [menu, contextMenu]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || privacy) return;
      if (restoringBackup.current && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); return; }
      const editable = (e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true],.xterm');
      const searchKey = p.searchShortcut === 'Mod+K' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' || p.searchShortcut === 'Alt+Space' && e.altKey && e.code === 'Space' || (e.metaKey || e.ctrlKey) && e.code === 'Space';
      if (!restoringBackup.current && !dialog && searchKey && !e.isComposing) { e.preventDefault(); if (search) setSearch(false); else showSearch(); return; }
      if (e.key === 'Escape') { if (fullscreenWindowId && !menu && !popover && !search && !contextMenu && !dialog && !(e.target as HTMLElement).closest('[role="dialog"]')) { e.preventDefault(); exitFullscreen(); } setMenu(null); setPopover(null); setSearch(false); setContextMenu(null); if (dialog) { dialog.resolve(null); setDialog(null); } return; }
      if (search || dialog) {
        // Move focus explicitly on every Tab: WebKit's native order skips buttons and escapes the modal.
        if (e.key === 'Tab') { const modal = document.querySelector(search ? '.spotlight' : '.file-dialog'); const nodes = [...(modal?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? [])].filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0); if (nodes.length) { e.preventDefault(); const index = nodes.indexOf(document.activeElement as HTMLElement); nodes[index < 0 ? (e.shiftKey ? nodes.length - 1 : 0) : (index + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length].focus(); } }
        return;
      }
      if (restoringBackup.current) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w' && active) { e.preventDefault(); void close(active.id); }
      if (e.defaultPrevented) return;
      // Keep native text-editing shortcuts, while allowing Save, Find, and other
      // application commands to work when the document or a search field has focus.
      const appShortcut = !editable || (e.metaKey || e.ctrlKey) && e.key.length === 1 && !['a', 'c', 'v', 'x', 'y', 'z'].includes(e.key.toLowerCase());
      if (active && appShortcut && !(e.target as HTMLElement).closest('.xterm,[data-terminal-input="true"],[role="dialog"]')) {
        for (const command of commands.list().filter(c => c.id.startsWith(`${active.id}.`) && c.shortcut)) {
          const keys = command.shortcut!.toLowerCase().split('+'); const key = keys.at(-1)!;
          if (e.key.toLowerCase() === key && (keys.includes('mod') ? e.metaKey || e.ctrlKey : !e.metaKey && !e.ctrlKey) && keys.includes('shift') === e.shiftKey && keys.includes('alt') === e.altKey) { const enabled = typeof command.enabled === 'function' ? command.enabled() : command.enabled; if (enabled !== false) { e.preventDefault(); runCommand(command.id); return; } }
        }
      }
      if (e.altKey && e.key === 'F10') { e.preventDefault(); setMenu('LopeOS'); }
      if (e.altKey && !editable && active && !fullscreenWindowId && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) { e.preventDefault(); const b = active.bounds; const dx = e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0, dy = e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0; update(active.id, { state: 'normal', bounds: e.shiftKey ? resizeBounds(b, dx ? 'e' : 's', dx, dy, activeApp!.minSize) : constrainBounds({ ...b, x: b.x + dx, y: b.y + dy }) }); }
    }; window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });
  const theme = storage.get<string>('theme', 'light');
  const personal = storage.get<PersonalWallpaper | null>('personalWallpaper', null);
  const background = resolveDesktopBackground(p, personal);
  const wallpaper = background.wallpaper;
  const menuKeyboard = (e: React.KeyboardEvent) => { const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) { e.preventDefault(); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setMenu(menuLabels[(menuLabels.indexOf(menu!) + (e.key === 'ArrowRight' ? 1 : -1) + menuLabels.length) % menuLabels.length]); } else if (e.key === 'Escape' || e.key === 'Tab') { setMenu(null); document.querySelector<HTMLButtonElement>(`[data-menu="${menu}"]`)?.focus(); } };
  const previewHidden = p.presentationMode || capture.captures.some(c=>c.kind==='screen') || p.notificationPreviews === 'never' || p.notificationPreviews === 'when-active' && !document.hasFocus();
  return <div className="desktop" {...appearanceAttributes(p)} data-window-fullscreen={!!fullscreenWindowId} data-wallpaper={background.id} data-account-name={account?.accountName} data-appearance-version={appearance} style={{...appearanceStyle(p),'--dock-size':p.dockSize+'px','--wallpaper-art':background.backgroundImage} as React.CSSProperties} onPointerMove={e => { if (fullscreenWindowId && menuReveal && !(e.target as HTMLElement).closest('.menubar,.menubar-reveal')) setMenuReveal(false); }}>
    <UpdateExperience/>
    {p.statusItems.includes('weather') && <WeatherStatusBridge services={services}/>}
    {(p.menuBarVisibility === 'auto' || fullscreenWindowId) && <button className="menubar-reveal" aria-label="Reveal menu bar" onPointerEnter={()=>{if(fullscreenWindowId)setMenuReveal(true);}} onClick={()=>setMenuReveal(v=>!v)} onFocus={()=>setMenuReveal(true)}/>}
    <div className={`wallpaper wallpaper--${background.id}`} style={{ backgroundImage: background.backgroundImage, backgroundSize:p.wallpaperFit==='fill'?'cover':p.wallpaperFit==='fit'?'contain':'auto',backgroundRepeat:'no-repeat' }} onContextMenu={openDesktopMenu}/>
    {p.hostWidget && <HostWidget onContextMenu={openDesktopMenu}/>}
    <header className={"menubar glass "+(menuReveal||menu||popover||!fullscreenWindowId&&capture.captures.length?"is-revealed":"")} onPointerLeave={()=>{if(fullscreenWindowId)setMenuReveal(false);}}><nav role="menubar" aria-label="Application menu" onKeyDown={e => { if (['ArrowRight','ArrowLeft'].includes(e.key) && (e.target as HTMLElement).hasAttribute('data-menu')) { e.preventDefault(); const index = menuLabels.indexOf((e.target as HTMLElement).getAttribute('data-menu')!); const next = menuLabels[(index + (e.key === 'ArrowRight' ? 1 : -1) + menuLabels.length) % menuLabels.length]; document.querySelector<HTMLButtonElement>(`[data-menu="${next}"]`)?.focus(); if (menu) setMenu(next); } else if (e.key === 'ArrowDown' && (e.target as HTMLElement).hasAttribute('data-menu')) { e.preventDefault(); setMenu((e.target as HTMLElement).getAttribute('data-menu')); } }}>
      {menuLabels.map((label, index) => <div className={`menu-anchor ${index > 1 ? 'contextual-menu' : ''}`} key={label}><button role="menuitem" data-menu={label} aria-label={index === 0 ? 'LopeOS system menu' : label} aria-haspopup="menu" aria-expanded={menu === label} tabIndex={index === 0 ? 0 : -1} className={`menu-trigger ${index === 1 ? 'active-app-name' : ''} ${menu === label ? 'is-open' : ''}`} onClick={() => { setMenu(menu === label ? null : label); setPopover(null); }} onMouseEnter={() => { if (menu) setMenu(label); }}>{index === 0 ? <LopeMark size={20}/> : label}</button>{menu === label && <div className="dropdown-menu glass" role="menu" aria-label={label} onKeyDown={menuKeyboard}>{menuItems[label].map((id, i) => { const command = id && getCommand(id); if (!id) return <div role="separator" className="menu-separator" key={i}/>; if (!command) return null; const enabled = typeof command.enabled === 'function' ? command.enabled() : command.enabled; const checked = typeof command.checked === 'function' ? command.checked() : command.checked; return <button key={id} role={command.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={command.checked !== undefined ? !!checked : undefined} disabled={enabled === false} onClick={() => runCommand(id)}><span className="check-slot">{checked && <Check size={13}/>}</span><span>{command.label}</span><kbd>{command.shortcut}</kbd></button>; })}</div>}</div>)}
    </nav><SystemStatus activePopover={popover} services={services} items={statusItems} clock={clock} setPopover={name=>{setPopover(popover===name?null:name);setMenu(null);}} showSearch={showSearch} hasNotifications={history.length>0||notifications.length>0}/></header>
    <main className="window-layer" aria-label="Desktop windows">{windows.map(win => <div key={win.id} style={{ display: win.state === 'minimized' || fullscreenWindowId && fullscreenWindowId !== win.id ? 'none' : undefined }}><WindowFrame win={win} focused={active?.id === win.id} fullscreen={fullscreenWindowId === win.id} onFocus={() => focus(win.id)} onClose={() => void close(win.id)} onMinimize={() => minimize(win.id)} onMaximize={() => maximize(win.id)} onFullscreen={() => fullscreen(win.id)} onBounds={(bounds, snapped) => update(win.id, { bounds, ...(snapped ? { restoreBounds: win.bounds } : {}) })}><WindowApplication win={win} services={services} close={id => void close(id)} title={title} restore={(id, args) => setWindows(previous => previous.map(w => w.id === id && w.restoreArgs?.path !== args.path ? { ...w, restoreArgs: args } : w))}/></WindowFrame></div>)}</main>
    {wallpaper && isPerfectHue(wallpaper) && wallpaper.permission === 'authorized' && wallpaper.creditURL && <a className="wallpaper-credit" href={wallpaper.creditURL} target="_blank" rel="noreferrer">perfecthue</a>}
    <Dock pinned={pinned} running={running} windows={windows} history={history} services={services} activate={id => { setSearch(false); setMenu(null); setPopover(null); setContextMenu(null); const existing = windows.filter(win => win.appId === id).sort((a, b) => b.zIndex - a.zIndex)[0]; if (existing) focus(existing.id); else launch(id); }} newWindow={launch} restore={focus} quit={quit} setPinned={setPinned} showSearch={showApplications}/>
    {(menu || popover || contextMenu) && <div className="dismiss-layer" onMouseDown={() => { setMenu(null); setPopover(null); setContextMenu(null); }}/>} 
    {popover === 'settings' && <QuickSettings services={services}/>}
    {popover === 'calendar' && <Calendar date={clock}/>}
    {popover === 'notifications' && <section className="system-popover notifications-popover glass" aria-label="Notification history"><div className="popover-heading"><strong>Notifications</strong><button onClick={()=>{clearHistory('notifications');setNotifications([]);}} aria-label="Clear notification history">Clear</button></div>{history.length ? history.slice().reverse().map(n => <div className="notification-item" key={n.id}><small className="toast-source">{notificationSource(n)?.name ?? 'LopeOS'}</small><strong>{previewHidden?'LopeOS notification':n.title}</strong><p>{previewHidden?'Preview hidden by your privacy preferences.':n.message}</p><small>{new Date(n.time).toLocaleString(p.region,{dateStyle:p.dateStyle,timeStyle:'short'})}</small></div>) : <div className="notifications-empty"><Check size={26}/><strong>No notifications</strong>{!p.notificationHistoryDays && <span>Notification history is off.</span>}</div>}</section>}
    {contextMenu && <div className="desktop-context dropdown-menu glass" role="menu" style={{ left: Math.max(8,Math.min(contextMenu.x, viewport().width - 242)), top: Math.max(40, Math.min(contextMenu.y, viewport().height - 180)) }} onKeyDown={menuKeyboard}>{contextMenu.appId ? <><button role="menuitem" onClick={() => launch(contextMenu.appId!)}>Open {appById(contextMenu.appId)?.name}</button><button role="menuitem" onClick={() => { setPinned(p => p.includes(contextMenu.appId!) ? p.filter(id => id !== contextMenu.appId) : [...p, contextMenu.appId!]); setContextMenu(null); }}>{pinned.includes(contextMenu.appId) ? 'Remove from Dock' : 'Keep in Dock'}</button><div className="menu-separator"/><button role="menuitem" onClick={() => { void quit(contextMenu.appId!); setContextMenu(null); }}>Quit application</button></> : <><button role="menuitem" onClick={() => launch('lope.files')}>Open workspace</button><button role="menuitem" onClick={showApplications}>Find an application…</button><div className="menu-separator"/><button role="menuitem" onClick={() => launch('lope.settings')}>Change wallpaper…</button><button role="menuitem" onClick={() => runCommand('shell.restoreAll')}>Bring all windows to front</button><div className="menu-separator"/><button role="menuitem" onClick={() => { storage.set('hostWidget', !p.hostWidget); setContextMenu(null); }}>{p.hostWidget ? 'Hide server widget' : 'Show server widget'}</button></>}</div>}
    {search && <SearchPanel initialScope={search} services={services} commands={commands.list().filter(c=>c.id.startsWith('shell.')||active&&c.id.startsWith(active.id+'.'))} close={()=>setSearch(false)}/>}
    {dialog && <FileDialog request={dialog} onDone={path => { dialog.resolve(path); setDialog(null); }}/>}
    <div className="toast-stack" aria-live="polite">{notifications.slice(-2).map(n => { const source = notificationSource(n); return <div className="toast glass" key={n.id}><span className="toast-icon">{source ? <AppIcon name={source.icon} size={22}/> : <LopeMark size={22}/>}</span><div><small className="toast-source">{source?.name ?? 'LopeOS'}</small><strong>{previewHidden?'LopeOS notification':n.title}</strong><p>{previewHidden?'Preview hidden by your privacy preferences.':n.message}</p></div><button aria-label="Dismiss notification" onClick={() => setNotifications(p => p.filter(item => item.id !== n.id))}><X size={14}/></button></div>; })}</div>
    <HoverReader/>{privacy && <PrivacyScreen reveal={()=>setPrivacy(false)}/>}
  </div>;
}
/** App notifications always name their sender; only the shell itself may appear as LopeOS. */
function notificationSource(notification: { appId?: string }) {
  const app = notification.appId && notification.appId !== 'lope.welcome' ? appById(notification.appId) : undefined;
  return app ? { name: app.name, icon: app.icon } : undefined;
}
function Calendar({ date }: { date: Date }) {
  const p = usePreferences();
  const first = new Date(date.getFullYear(), date.getMonth(), 1).getDay(); const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return <section className="system-popover calendar-popover glass" aria-label="Calendar"><div className="calendar-date">{date.toLocaleDateString(p.region, { weekday: 'long' })}</div><h2>{date.toLocaleDateString(p.region, { month: 'long', day: 'numeric' })}</h2><div className="calendar-month">{date.toLocaleDateString(p.region, { month: 'long', year: 'numeric' })}</div><div className="calendar-grid">{['S','M','T','W','T','F','S'].map((d, i) => <b key={i}>{d}</b>)}{Array.from({ length: first }, (_, i) => <span key={`blank-${i}`}/>)}{Array.from({ length: days }, (_, i) => <span key={i} className={date.getDate() === i + 1 ? 'today' : ''}>{i + 1}</span>)}</div></section>;
}
