import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, Plus, Search, Globe2, Star, Download, MoreHorizontal,
  Home, ExternalLink, ShieldCheck, Pin, History, BookOpen, Compass, Volume2, VolumeX,
  ChevronDown, SlidersHorizontal, FileUp, FileText, LockKeyhole, AlertCircle, Check, Copy, Layers, Cpu } from 'lucide-react';
import type { AppContext, Command } from '../../../../../packages/contracts/src';
import { Button, Dialog, Input, Toolbar, Popover } from '../../../../../packages/ui/src';
import { addressSuggestions, destination, displayAddress, SEARCH_PROVIDERS, safeHostUrl, openedFile, openableFileType, MAX_OPENED_FILE_BYTES, OPENABLE_FILE_EXTENSIONS } from '../../../../../packages/browser-client/src';
import type { BrowserCommand, BrowserSession, BrowserShellBridge, BrowserTab } from '../../../../../packages/browser-client/src';
import { browserClient } from './service';
import { cloudAccount, useCloudAccount } from '../../accounts/service';
import { saveBrowserDownload } from './transfers';
import { browserMenus } from './manifest';
import { copyClipboardText } from '../../shell/system';
import { StreamSurface } from './StreamSurface';
import './browser.css';

type Panel = 'history' | 'bookmarks' | 'downloads' | 'about' | 'settings' | null;
const favorites = [
  { name: 'Wikipedia', url: 'https://www.wikipedia.org', letter: 'W', color: 'stone' },
  { name: 'Are.na', url: 'https://www.are.na', letter: '✳', color: 'orange' },
  { name: 'Internet Archive', url: 'https://archive.org', letter: '▥', color: 'blue' },
  { name: 'MDN', url: 'https://developer.mozilla.org', letter: 'M', color: 'purple' },
];
const bytes = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
const titleFor = (url: string) => { const file = openedFile(url); if (file) return file.name; try { return new URL(url).hostname; } catch { return url; } };

export default function Browser({ context, shell }: { context?: AppContext; shell?: BrowserShellBridge }) {
  const account = useCloudAccount();
  const accountId = account.account?.id ?? null;
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState('');
  const [address, setAddress] = useState('');
  const [addressFocused, setAddressFocused] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState('');
  const [muted, setMuted] = useState(false);
  const [streamStatus, setStreamStatus] = useState('Connecting stream');
  const [clearDialog, setClearDialog] = useState(false);
  const [tabMenu, setTabMenu] = useState<string | null>(null);
  const [pasteDialog, setPasteDialog] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [queuedNavigation, setQueuedNavigation] = useState<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<{ tabId: string; url: string; sequence: number } | null>(null);
  const navigationSequence = useRef(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const addressRef = useRef<HTMLInputElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const state = useRef(session); state.current = session;
  const engineTab = session?.tabs.find(item => item.id === session.activeTabId);
  const tab = engineTab && pendingNavigation?.tabId === engineTab.id
    ? { ...engineTab, url: pendingNavigation.url, loading: true, error: undefined } : engineTab;
  const onNewTab = !tab || tab.url === 'about:blank';
  const startTask = useRef<ReturnType<typeof browserClient.create> | null>(null);
  const lastLaunch = useRef<unknown>(null);
  const mounted = useRef(true);
  const activePrivate = useRef<string | null>(null);
  const accountGeneration = useRef(0);
  const previousAccount = useRef(accountId);
  const imported = useRef(new Set<string>());
  const [localDownloads, setLocalDownloads] = useState<Record<string, { path?: string; error?: string }>>({});
  const lastActivity = useRef(0);
  const activity = useCallback(() => {
    if (state.current && Date.now() - lastActivity.current > 15000) {
      lastActivity.current = Date.now(); void browserClient.touch(state.current.id).catch(() => {});
    }
  }, []);

  const accept = useCallback((next: BrowserSession) => {
    if (next.hosting && next.hosting.accountId !== (cloudAccount.getSnapshot().account?.id ?? null)) return;
    if (!mounted.current) return;
    const current = state.current;
    if (current && current.id === next.id && current.generation === next.generation && (current.revision ?? 0) > (next.revision ?? 0)) return;
    state.current = next; setSession(next);
  }, []);
  const connect = useCallback(async () => {
    const generation = accountGeneration.current;
    setConnecting(true); setError('');
    try { startTask.current ??= browserClient.create(); const next = await startTask.current; if (generation === accountGeneration.current) { accept(next); setConnected(true); } }
    catch (failure) { if (generation === accountGeneration.current) { startTask.current = null; setError(failure instanceof Error ? failure.message : 'The browser runtime is unavailable.'); } }
    finally { if (mounted.current && generation === accountGeneration.current) setConnecting(false); }
  }, [accept]);
  useLayoutEffect(() => {
    if (previousAccount.current === accountId) return;
    previousAccount.current = accountId; accountGeneration.current++;
    state.current = null; setSession(null); setConnected(false); startTask.current = null;
    activePrivate.current = null; lastLaunch.current = null; imported.current.clear(); setLocalDownloads({});
    setQueuedNavigation(null); setPendingNavigation(null); navigationSequence.current++;
    void connect();
  }, [accountId, connect]);
  useEffect(() => { mounted.current = true; void connect(); return () => { mounted.current = false; }; }, [connect]);
  useEffect(() => {
    const endPrivate = () => { if (activePrivate.current) void fetch(`/api/browser/sessions/${activePrivate.current}`, { method: 'DELETE', keepalive: true, credentials: 'same-origin' }).catch(() => {}); };
    window.addEventListener('pagehide', endPrivate); return () => window.removeEventListener('pagehide', endPrivate);
  }, []);
  useEffect(() => {
    if (!session?.id) return;
    const id = session.id;
    return browserClient.subscribe(id, accept, setConnected, () => {
      if (state.current?.id !== id) return;
      state.current = null; setSession(null); startTask.current = null; activePrivate.current = null;
      void connect();
    });
  }, [session?.id, accept, connect]);
  useEffect(() => {
    if (!context?.services.files.writeBinary || !session) return;
    const generation = accountGeneration.current;
    for (const item of session.downloads) {
      const key = session.id + ':' + item.id;
      if (item.state !== 'completed' || item.fileId || item.totalBytes > 1024 * 1024 * 1024 || imported.current.has(key)) continue;
      imported.current.add(key);
      void browserClient.download(session.id, item.id).then(blob => {
        const assertCurrent = () => {
          if (!mounted.current || generation !== accountGeneration.current || accountId !== (cloudAccount.getSnapshot().account?.id ?? null)) throw new Error('Your account changed before the download could be saved.');
        };
        return saveBrowserDownload(context.services.files, blob, item.name, assertCurrent);
      }).then(path => { if (generation === accountGeneration.current) setLocalDownloads(current => ({ ...current, [item.id]: { path } })); })
        .catch(failure => { if (generation === accountGeneration.current) setLocalDownloads(current => ({ ...current, [item.id]: { error: failure instanceof Error ? failure.message : 'Could not save to LopeDrive.' } })); });
    }
  }, [session?.id, session?.downloads, context?.services.files, accountId]);
  useEffect(() => { if (!addressFocused && queuedNavigation === null) setAddress(tab?.url === 'about:blank' ? '' : tab?.url ?? ''); }, [tab?.url, tab?.id, addressFocused, queuedNavigation]);
  useEffect(() => { context?.lifecycle.setTitle(`${tab?.title || 'New Tab'} — Lope Browser`); }, [tab?.title, context?.lifecycle]);
  useEffect(() => context?.lifecycle.onBeforeClose(async () => {
    if (activePrivate.current) { await browserClient.destroy(activePrivate.current); activePrivate.current = null; }
    return true;
  }), [context?.lifecycle]);

  const run = useCallback(async (command: BrowserCommand) => {
    const current = state.current; if (!current) { setError('Connect the browser runtime first.'); return; }
    setError('');
    try { const next = await browserClient.command(current.id, command);
      if (state.current?.id === next.id && (state.current.generation === current.generation || state.current.generation === next.generation || command.type === 'data.clear')) accept(next);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The browser operation failed.'); }
  }, [accept]);
  const navigate = useCallback((input: string) => {
    const current = state.current;
    try {
      const url = destination(input, current?.searchProvider);
      setError(''); setAddress(url === 'about:blank' ? '' : url); setAddressFocused(false); addressRef.current?.blur();
      surface.current?.focus({ preventScroll: true });
      if (current?.activeTabId) {
        const sequence = ++navigationSequence.current;
        setPendingNavigation({ tabId: current.activeTabId, url, sequence });
        setFocusRequest(value => value + 1);
        void run({ type: 'navigate', tabId: current.activeTabId, input: url }).finally(() => {
          setPendingNavigation(value => value?.sequence === sequence ? null : value);
        });
      } else {
        setQueuedNavigation(input);
        if (!connecting) { startTask.current = null; void connect(); }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Enter a website or search.'); }
  }, [run, connecting, connect]);
  useEffect(() => {
    if (queuedNavigation === null || !session?.activeTabId) return;
    setQueuedNavigation(null); navigate(queuedNavigation);
  }, [queuedNavigation, session?.activeTabId, navigate]);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    const current = state.current, selected = current?.tabs.find(item => item.id === current.activeTabId);
    if (selected?.find) void run({ type: 'find.clear', tabId: selected.id });
  }, [run]);
  /** Reads the file here, so LopeDrive decrypts it on this device and only its bytes reach the browser worker. */
  const openFile = useCallback(async (path: string) => {
    const current = state.current; const files = context?.services.files;
    if (!current || !files) { setError('Connect the browser runtime to open a file.'); return; }
    const generation = accountGeneration.current; const name = path.split('/').at(-1) || 'file.html';
    try {
      if (!openableFileType(name)) throw new Error('Lope Browser can open HTML files (.html, .htm or .xhtml).');
      if ((await files.stat(path)).size > MAX_OPENED_FILE_BYTES) throw new Error('Lope Browser can open HTML files up to 32 MB.');
      const data = files.readBinary ? (await files.readBinary(path)).data : new TextEncoder().encode((await files.read(path)).content);
      if (generation !== accountGeneration.current) throw new Error('Your account changed. Open the file again.');
      setError(''); accept(await browserClient.openFile(current.id, new File([new Uint8Array(data)], name)));
    } catch (failure) { if (generation === accountGeneration.current) setError(failure instanceof Error ? failure.message : 'Could not open this file.'); }
  }, [accept, context?.services.files]);
  const chooseFile = useCallback(async () => {
    try { const path = await context?.services.dialogs.openFile({ extensions: OPENABLE_FILE_EXTENSIONS }); if (path) await openFile(path); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not choose a file.'); }
  }, [context?.services.dialogs, openFile]);
  useEffect(() => {
    const args = context?.launchArgs;
    if (!args || args === lastLaunch.current || !session?.activeTabId) return;
    if (typeof args.url === 'string') { lastLaunch.current = args; navigate(args.url); }
    else if (typeof args.path === 'string') { lastLaunch.current = args; void openFile(args.path); }
  }, [context?.launchArgs, session?.activeTabId, navigate, openFile]);
  useEffect(() => shell?.onOpenUrl?.(url => navigate(url)), [shell, navigate]);
  const openDevice = useCallback((input: string) => {
    try {
      const url = safeHostUrl(destination(input, state.current?.searchProvider));
      if (!url) { setError('Enter a website or search to open on this device.'); return; }
      if (shell) shell.openInHost(url); else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Enter a website or search.'); }
  }, [shell]);
  const openHost = useCallback(() => {
    const current = state.current;
    const selected = current?.tabs.find(t => t.id === current.activeTabId);
    openDevice(addressFocused || pendingNavigation || !selected || selected.url === 'about:blank' ? address : selected.url);
  }, [openDevice, address, addressFocused, pendingNavigation]);
  const togglePrivate = useCallback(async () => {
    try {
      if (activePrivate.current) { await browserClient.destroy(activePrivate.current); activePrivate.current = null;
        accept(await browserClient.create()); }
      else { const next = await browserClient.create('private'); activePrivate.current = next.id; accept(next); }
      setMenu(null); setPanel(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not change browser session.'); }
  }, [accept]);

  const action = useCallback((name: string) => {
    setMenu(null); const current = state.current;
    const selected = current?.tabs.find(item => item.id === current.activeTabId);
    const withTab = (type: 'back' | 'forward' | 'reload' | 'stop' | 'home' | 'print' | 'devtools' | 'tab.close' | 'tab.duplicate' | 'bookmark.add') => {
      if (selected) void run({ type, tabId: selected.id });
    };
    switch (name) {
      case 'new-tab': void run({ type: 'tab.create' }).then(() => { addressRef.current?.focus(); addressRef.current?.select(); }); break;
      case 'private': void togglePrivate(); break;
      case 'open-file': void chooseFile(); break;
      case 'duplicate': withTab('tab.duplicate'); break;
      case 'close-tab': withTab('tab.close'); break;
      case 'bookmark': withTab('bookmark.add'); break;
      case 'reopen': void run({ type: 'tab.reopen' }); break;
      case 'copy-address': if (selected && safeHostUrl(selected.url)) void copyClipboardText(selected.url, 'copy').catch(() => setError('Select the address bar and copy the address.')); break;
      case 'paste': setPasteDialog(true); break;
      case 'find': setFindOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.lb-find input')?.select()); break;
      case 'find-next': case 'find-previous': if (selected?.find?.text) void run({ type: 'find', tabId: selected.id, text: selected.find.text, forward: name === 'find-next' }); else setFindOpen(true); break;
      case 'clear-data': setClearDialog(true); break;
      case 'history': case 'bookmarks': case 'downloads': case 'about': case 'settings': setPanel(name); setQuery(''); break;
      case 'zoom-in': case 'zoom-out': case 'zoom-reset': if (selected) void run({ type: 'zoom', tabId: selected.id,
        value: name === 'zoom-reset' ? 1 : Math.max(0.25, Math.min(3, Math.round((selected.zoom + (name === 'zoom-in' ? 0.1 : -0.1)) * 10) / 10)) }); break;
      case 'open-host': openHost(); break;
      case 'next-tab': case 'previous-tab': if (current?.tabs.length) {
        const index = current.tabs.findIndex(item => item.id === current.activeTabId);
        const next = current.tabs[(index + (name === 'next-tab' ? 1 : -1) + current.tabs.length) % current.tabs.length];
        void run({ type: 'tab.activate', tabId: next.id }); setFocusRequest(value => value + 1); } break;
      case 'back': case 'forward': case 'reload': case 'stop': case 'home': case 'print': case 'devtools': withTab(name); break;
    }
  }, [run, togglePrivate, openHost, chooseFile]);
  // Incremental find: search as the text changes, after a short pause.
  useEffect(() => {
    if (!findOpen || !tab || find === (tab.find?.text ?? '')) return;
    const timer = setTimeout(() => void run(find ? { type: 'find', tabId: tab.id, text: find } : { type: 'find.clear', tabId: tab.id }), 150);
    return () => clearTimeout(timer);
  }, [find, findOpen, tab?.id, tab?.find?.text, run]);
  const actions = useMemo(() => [
    ['new-tab', 'New Tab', '⌘T'], ['private', session?.mode === 'private' ? 'End Private Session' : 'New Private Session', ''],
    ['open-file', 'Open File…', '⌘O'],
    ['duplicate', 'Duplicate Tab', ''], ['close-tab', 'Close Tab', '⌘W'], ['print', 'Save Page as PDF', '⌘P'],
    ['copy-address', 'Copy Page Address', ''], ['paste', 'Paste into Website…', ''], ['find', 'Find in Page', '⌘F'], ['find-next', 'Find Next', '⌘G'], ['find-previous', 'Find Previous', '⌘⇧G'],
    ['reload', 'Reload Page', '⌘R'], ['stop', 'Stop Loading', 'Esc'], ['home', 'Start Page', ''],
    ['zoom-in', 'Zoom In', '⌘+'], ['zoom-out', 'Zoom Out', '⌘−'], ['zoom-reset', 'Actual Size', '⌘0'],
    ['devtools', 'Developer Tools', ''], ['back', 'Back', '⌘['], ['forward', 'Forward', '⌘]'],
    ['reopen', 'Reopen Closed Tab', '⌘⇧T'], ['history', 'Show History', ''], ['clear-data', 'Clear Browsing Data…', ''],
    ['bookmark', 'Bookmark This Page', '⌘D'], ['bookmarks', 'Show Bookmarks', ''],
    ['downloads', 'Show Downloads', ''], ['next-tab', 'Next Tab', ''], ['previous-tab', 'Previous Tab', ''],
    ['about', 'About Lope Browser', ''], ['open-host', 'Open in Host Browser', ''],
  ], [session?.mode]);
  useEffect(() => {
    if (!context) return;
    const subscriptions = actions.map(([name, label, shortcut]) => context.services.commands.register({
      id: `browser.${name}`, label, shortcut: shortcut || undefined,
      execute: () => action(name), enabled: ['about', 'open-host'].includes(name) || connected,
    } satisfies Command));
    return () => subscriptions.forEach(unsubscribe => unsubscribe());
  }, [actions, action, context, connected]);

  const shortcut = useCallback((event: KeyboardEvent | ReactKeyboardEvent) => {
    activity();
    if (event.key === 'Escape') {
      if (menu || tabMenu || findOpen || addressFocused) {
        event.preventDefault(); setMenu(null); setTabMenu(null); setAddressFocused(false); closeFind(); addressRef.current?.blur(); return true;
      }
      const selected = state.current?.tabs.find(item => item.id === state.current?.activeTabId);
      if (selected?.loading || pendingNavigation) { event.preventDefault(); setPendingNavigation(null); action('stop'); return true; }
      return false;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); action(event.key === 'ArrowLeft' ? 'back' : 'forward'); return true;
    }
    if (event.key === 'F5') { event.preventDefault(); action('reload'); return true; }
    if (event.ctrlKey && event.key === 'Tab') { event.preventDefault(); action(event.shiftKey ? 'previous-tab' : 'next-tab'); return true; }
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
    const key = event.key.toLowerCase();
    const mapping: Record<string, string> = { t: event.shiftKey ? 'reopen' : 'new-tab', o: 'open-file', w: 'close-tab', r: 'reload', f: 'find', p: 'print', d: 'bookmark', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset',
      '[': 'back', ']': 'forward', g: event.shiftKey ? 'find-previous' : 'find-next' };
    if (key === 'l') { event.preventDefault(); addressRef.current?.focus(); addressRef.current?.select(); return true; }
    // ⌘1–8 select that tab and ⌘9 the last one, as in other browsers.
    if (/^[1-9]$/.test(event.key) && !event.shiftKey) {
      const tabs = state.current?.tabs ?? []; const target = event.key === '9' ? tabs.at(-1) : tabs[Number(event.key) - 1];
      event.preventDefault(); if (target) { void run({ type: 'tab.activate', tabId: target.id }); setFocusRequest(value => value + 1); } return true;
    }
    if (mapping[key]) { event.preventDefault(); action(mapping[key]); return true; }
    return false;
  }, [action, activity, run, closeFind, menu, tabMenu, findOpen, addressFocused, pendingNavigation]);
  const suggestions = useMemo(() => !addressFocused || !session || address === (tab?.url ?? '') ? [] : addressSuggestions(address, {
    tabs: session.tabs, activeTabId: session.activeTabId, bookmarks: session.bookmarks, history: session.history, provider: session.searchProvider,
  }), [address, addressFocused, session, tab?.url]);
  useEffect(() => setHighlighted(0), [address]);
  const choose = (index: number) => {
    const item = suggestions[index];
    if (!item) { navigate(address); return; }
    if (item.kind === 'tab' && item.tabId) { void run({ type: 'tab.activate', tabId: item.tabId }); setFocusRequest(value => value + 1); setAddressFocused(false); addressRef.current?.blur(); }
    else navigate(item.url);
  };
  const upload = session?.uploads[0];
  const handleUpload = async (files?: File[], workspace = false) => {
    if (!session || !upload) return;
    const generation = accountGeneration.current;
    try {
      if (workspace) {
        const paths = shell?.chooseWorkspaceFile ? await shell.chooseWorkspaceFile({ multiple: upload.multiple })
          : [await context?.services.dialogs.openFile()].filter((path): path is string => !!path);
        if (paths.length && context?.services.files.readBinary) {
          const selected = await Promise.all(paths.map(async path => {
            const value = await context.services.files.readBinary!(path);
            return new File([new Uint8Array(value.data)], path.split('/').at(-1) || 'selected-file');
          }));
          if (generation !== accountGeneration.current) throw new Error('Your account changed. Choose the file again.');
          accept(await browserClient.uploadFiles(session.id, upload.id, selected));
        } else if (paths.length) accept(await browserClient.uploadWorkspace(session.id, upload.id, paths));
      } else if (files?.length) accept(await browserClient.uploadFiles(session.id, upload.id, files));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The file upload failed.'); }
  };
  const saveDownload = async (transferId: string, name: string) => {
    if (!session) return;
    try { const blob = await browserClient.download(session.id, transferId); const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not retrieve the download.'); }
  };
  const showingFile = !!openedFile(tab?.url ?? '');
  const website = !!safeHostUrl(tab?.url ?? '');
  const siteTitle = website || showingFile ? titleFor(tab!.url) : 'Start page';
  const bookmarked = session?.bookmarks.some(item => item.url === tab?.url);
  const selectedTab = (target: BrowserTab) => <><span className="lb-tab-icon">{target.loading || pendingNavigation?.tabId === target.id ? <span className="lb-spinner"/> : target.favicon?.startsWith('data:image/') ? <img src={target.favicon} alt=""/> : target.pinned ? <Pin size={12}/> : openedFile(target.url) ? <FileText size={13}/> : <Globe2 size={13}/>}</span><span>{target.title || 'New Tab'}</span></>;

  return <div className={`lope-browser ${session?.mode === 'private' ? 'lb-private' : ''}`} data-browser-input="true" ref={surface} tabIndex={-1}
    onKeyDownCapture={event => { if (shortcut(event)) event.stopPropagation(); }} onPointerDownCapture={event => {
      activity();
      if (event.target instanceof Element && !event.target.closest('button,input,textarea,select,a,[contenteditable="true"]')) surface.current?.focus({ preventScroll: true });
    }} onClick={() => { if (tabMenu) setTabMenu(null); }}>
    <div className="lb-tabstrip"><div className="lb-tabs" role="tablist" aria-label="Browser tabs" onKeyDown={event => {
      if (!session || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const index = session.tabs.findIndex(item => item.id === tab?.id);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? session.tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + session.tabs.length) % session.tabs.length;
      void run({ type: 'tab.activate', tabId: session.tabs[nextIndex].id });
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[nextIndex]?.focus();
    }}>
      {session?.tabs.map((target, index) => <div key={target.id} className={`lb-tab ${target.id === tab?.id ? 'active' : ''} ${target.pinned ? 'pinned' : ''}`}
        draggable onDragStart={event => event.dataTransfer.setData('text/lope-tab', target.id)} onDragOver={event => event.preventDefault()}
        onDrop={event => { event.preventDefault(); const tabId = event.dataTransfer.getData('text/lope-tab'); if (session.tabs.some(t => t.id === tabId)) void run({ type: 'tab.reorder', tabId, index }); }}
        onContextMenu={event => { event.preventDefault(); setTabMenu(target.id); }}
        onAuxClick={event => { if (event.button === 1 && !target.pinned) { event.preventDefault(); void run({ type: 'tab.close', tabId: target.id }); } }}>
        <button role="tab" tabIndex={target.id === tab?.id ? 0 : -1} aria-selected={target.id === tab?.id} title={target.title} onClick={() => { void run({ type: 'tab.activate', tabId: target.id }); setFocusRequest(value => value + 1); setTabMenu(null); }}>{selectedTab(target)}</button>
        {!target.pinned && <button className="lb-tab-close" aria-label={`Close ${target.title || 'tab'}`} onClick={() => void run({ type: 'tab.close', tabId: target.id })}><X size={12}/></button>}
      </div>)}
      {!session && <div className="lb-tab active lb-placeholder-tab"><Compass size={13}/><span>New Tab</span></div>}
      <button className="lb-icon-button lb-add" title="New tab" aria-label="New tab" disabled={!connected} onClick={() => action('new-tab')}><Plus size={16}/></button>
    </div><button className="lb-session-chip" onClick={() => action('private')} disabled={!connected} title={session?.mode === 'private' ? 'End private session' : 'Open a private session'}>{session?.mode === 'private' ? <><LockKeyhole size={12}/>Private</> : <><Compass size={12}/>Lope</>}</button></div>
    <Toolbar><div className="lb-navigation">
      <IconButton label="Back" icon={<ArrowLeft size={16}/>} disabled={!tab?.canGoBack || !connected} onClick={() => action('back')}/>
      <IconButton label="Forward" icon={<ArrowRight size={16}/>} disabled={!tab?.canGoForward || !connected} onClick={() => action('forward')}/>
      <IconButton label={tab?.loading ? 'Stop loading' : 'Reload page'} icon={tab?.loading ? <X size={16}/> : <RotateCw size={15}/>} disabled={!tab || !connected} onClick={() => action(tab?.loading ? 'stop' : 'reload')}/>
    </div><div className="lb-address-wrap"><form className={`lb-address ${addressFocused ? 'focused' : ''}`} onSubmit={event => { event.preventDefault(); navigate(address); }}>
      <button type="button" className="lb-site-info" title={showingFile ? 'File from LopeDrive' : 'Site information'} aria-label={showingFile ? 'File from LopeDrive' : 'Site information'} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>
        {showingFile ? <FileText size={14}/> : tab?.url.startsWith('https:') && !tab.error ? <ShieldCheck size={14}/> : <Globe2 size={14}/>}</button>
      <input ref={addressRef} aria-label="Search or enter address" autoComplete="off" spellCheck={false}
        value={addressFocused ? address : displayAddress(address)} placeholder="Search or enter an address"
        onChange={event => setAddress(event.target.value)} onFocus={() => { setAddressFocused(true); requestAnimationFrame(() => addressRef.current?.select()); }}
        onBlur={() => setTimeout(() => setAddressFocused(false), 150)} role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0}
        aria-controls={suggestions.length ? 'lb-suggestions' : undefined} aria-activedescendant={suggestions.length ? `lb-suggestion-${highlighted}` : undefined}
        onKeyDown={event => {
          if (!suggestions.length) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setHighlighted(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); }
          else if (event.key === 'Enter') { event.preventDefault(); choose(highlighted); }
          else if (event.key === 'Escape') { event.preventDefault(); setAddress(tab?.url === 'about:blank' ? '' : tab?.url ?? ''); }
        }}/>
      {tab && tab.zoom !== 1 && <button type="button" className="lb-zoom" title="Reset zoom" onClick={() => action('zoom-reset')}>{Math.round(tab.zoom * 100)}%</button>}
      <button type="button" aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark page'} title={bookmarked ? 'Remove bookmark' : 'Bookmark page'} disabled={onNewTab || !connected || (!website && !bookmarked)}
        className={bookmarked ? 'lb-star active' : 'lb-star'} onClick={() => { const item = session?.bookmarks.find(b => b.url === tab?.url); if (item) void run({ type: 'bookmark.remove', id: item.id }); else action('bookmark'); }}><Star size={15} fill={bookmarked ? 'currentColor' : 'none'}/></button>
    </form>{suggestions.length > 0 && <div className="lb-suggestions" id="lb-suggestions" role="listbox" aria-label="Suggestions">{suggestions.map((item, index) => <div role="option" id={`lb-suggestion-${index}`} aria-selected={index === highlighted} className={index === highlighted ? 'highlighted' : ''} key={item.kind + item.url}
      onMouseDown={event => event.preventDefault()} onMouseEnter={() => setHighlighted(index)} onClick={() => choose(index)}>
      {item.kind === 'search' ? <Search size={15}/> : item.kind === 'url' ? <Globe2 size={15}/> : item.kind === 'tab' ? <Layers size={15}/> : item.kind === 'bookmark' ? <Star size={15}/> : <History size={15}/>}
      <span><b>{item.kind === 'search' ? `${item.title} — Search with ${SEARCH_PROVIDERS[session?.searchProvider ?? 'duckduckgo'].name}` : item.title}</b>{item.kind !== 'search' && <small>{displayAddress(item.url)}</small>}</span>
      {item.kind === 'tab' ? <em>Switch to tab</em> : <ArrowRight size={14}/>}</div>)}</div>}</div>
      <IconButton label="Start page" icon={<Home size={16}/>} onClick={() => action('home')} disabled={!tab || !connected}/>
      <button className="lb-device-button glass-inset" title="Open this address in your device’s browser" aria-label="Open on this device" disabled={showingFile || (!address.trim() && onNewTab)} onClick={openHost}><ExternalLink size={14}/><span>Open on this device</span></button>
      <IconButton label="Downloads" icon={<Download size={16}/>} onClick={() => { setPanel(panel === 'downloads' ? null : 'downloads'); setQuery(''); }} pressed={panel === 'downloads'}/>
      <IconButton label="Browser menu" icon={<MoreHorizontal size={19}/>} onClick={() => setMenu(menu ? null : 'More')} pressed={!!menu}/>
    </Toolbar>
    <div className="lb-bookmark-bar"><button onClick={() => setPanel(panel === 'bookmarks' ? null : 'bookmarks')}><BookOpen size={12}/>Bookmarks</button><span className="lb-divider"/>
      {(session?.bookmarks.slice(0, 5) ?? []).map(item => <button key={item.id} onClick={() => navigate(item.url)} title={item.url}><Globe2 size={11}/>{item.title}</button>)}
      {!session?.bookmarks.length && favorites.slice(0, 3).map(item => <button key={item.url} onClick={() => navigate(item.url)}>{item.name}</button>)}
      <button className="lb-history-toggle" onClick={() => { setPanel(panel === 'history' ? null : 'history'); setQuery(''); }}><History size={12}/>History</button>
    </div>
    {session?.mode === 'private' && <div className="lb-private-notice"><LockKeyhole size={12}/>Private session · Site data is discarded when you end this session. Downloads you save remain.<button onClick={togglePrivate}>End session</button></div>}
    {error && <div className="lb-notice" role="alert"><AlertCircle size={14}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}
    {session && !connected && <div className="lb-notice" role="status"><AlertCircle size={14}/><span>Connection lost. Reconnecting to your browser…</span></div>}
    {session?.status === 'crashed' && <div className="lb-notice" role="alert"><AlertCircle size={14}/><span>The browser engine stopped. Restart to restore normal tabs. Private sessions will end.</span><Button onClick={async () => {
      try { const next = await browserClient.command(session.id, { type: 'engine.restart' }); activePrivate.current = null; accept(next); setError(''); }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not restart the browser engine.'); }
    }}>Restart browser</Button></div>}
    <div className="lb-body">
      <main className="lb-content" aria-label="Page content" aria-busy={!!tab?.loading}>
        {session?.streamUrl && <StreamSurface url={session.streamUrl} visible={!onNewTab && !tab?.error} muted={muted} focusRequest={focusRequest} onStatus={setStreamStatus} onShortcut={shortcut} onActivity={activity} onOpenHost={website ? openHost : undefined}/>}
        {(() => {
          // Remote Chromium runs in kiosk mode without its own context menu; the worker
          // reports right-clicks on links and images and LopeOS draws the menu here.
          const menu = session?.contextMenu;
          if (!menu || menu.tabId !== tab?.id || onNewTab) return null;
          const dismiss = () => void run({ type: 'context.dismiss' });
          const copy = (text: string) => { void copyClipboardText(text, 'copy').catch(() => setError('Your browser blocked copying. Use the keyboard shortcut instead.')); dismiss(); };
          const paste = async () => {
            dismiss();
            try { const text = await navigator.clipboard.readText(); if (text) void run({ type: 'paste', tabId: menu.tabId, text }); }
            catch { setPasteDialog(true); } // The host browser did not allow reading the clipboard.
          };
          const page = (type: 'back' | 'forward' | 'reload' | 'print' | 'select-all') => { dismiss(); void run({ type, tabId: menu.tabId }); };
          const quoted = menu.selection && (menu.selection.length > 24 ? menu.selection.slice(0, 24).trimEnd() + '…' : menu.selection);
          const flip = `${menu.x / menu.width > 0.7 ? ' lb-context-menu--left' : ''}${menu.y / menu.height > 0.6 ? ' lb-context-menu--up' : ''}`;
          return <div className="lb-context-layer" onPointerDown={dismiss} onContextMenu={event => event.preventDefault()}>
            <div className={`lb-context-menu${flip}`} style={{ left: `${menu.x / menu.width * 100}%`, top: `${menu.y / menu.height * 100}%` }} onPointerDown={event => event.stopPropagation()}>
              <Popover label="Page actions">
                {menu.selection && <>
                  <button onClick={() => copy(menu.selection!)}>Copy</button>
                  <button onClick={() => void run({ type: 'context.search', menuId: menu.id })}>Search {SEARCH_PROVIDERS[session.searchProvider].name} for “{quoted}”</button>
                </>}
                {menu.editable && <>
                  <button onClick={() => void paste()}>Paste</button>
                  <button onClick={() => page('select-all')}>Select all</button>
                </>}
                {(menu.selection || menu.editable) && (menu.link || menu.image) && <hr/>}
                {menu.link && <>
                  <button onClick={() => void run({ type: 'context.openLink', menuId: menu.id })}>Open link in new tab</button>
                  <button onClick={() => void run({ type: 'context.saveLink', menuId: menu.id })}>Save link to LopeDrive</button>
                  <button onClick={() => copy(menu.link!)}>Copy link address</button>
                </>}
                {menu.image && <>
                  <button onClick={() => void run({ type: 'context.saveImage', menuId: menu.id })}>Save image to LopeDrive</button>
                  {!menu.image.startsWith('data:') && <button onClick={() => copy(menu.image!)}>Copy image address</button>}
                </>}
                {!menu.link && !menu.image && !menu.selection && !menu.editable && <>
                  <button disabled={!tab?.canGoBack} onClick={() => page('back')}>Back</button>
                  <button disabled={!tab?.canGoForward} onClick={() => page('forward')}>Forward</button>
                  <button onClick={() => page('reload')}>Reload</button>
                  <hr/>
                  <button onClick={() => page('select-all')}>Select all</button>
                  <button onClick={() => page('print')}>Save page as PDF</button>
                </>}
              </Popover>
            </div>
          </div>;
        })()}
        {onNewTab ? <div className="lb-start"><div className="lb-start-top"><span><Compass size={13}/> Lope Browser</span><button onClick={() => setPanel('settings')} aria-label="Browser preferences"><SlidersHorizontal size={15}/></button></div>
          <div className="lb-start-center"><div className="lb-mark"><Compass size={35} strokeWidth={1.35}/></div><h1>New Tab</h1>
            <form className="lb-start-search" onSubmit={event => { event.preventDefault(); navigate(String(new FormData(event.currentTarget).get('search') ?? '')); }}><Search size={19}/><input name="search" aria-label="Search the web" placeholder={`Search with ${SEARCH_PROVIDERS[session?.searchProvider ?? 'duckduckgo'].name} or enter a URL`} autoComplete="off"/><button title="Search in LopeOS" aria-label="Search"><ArrowRight size={18}/></button><button type="button" className="lb-start-device" title="Search or open in your device’s browser" aria-label="Search on this device" onClick={event => { const form = event.currentTarget.form; if (form) openDevice(String(new FormData(form).get('search') ?? '')); }}><ExternalLink size={16}/></button></form>
            <div className="lb-favorites">{(session?.bookmarks.length ? session.bookmarks.slice(0, 6).map((item, i) => ({ name: item.title, url: item.url, letter: titleFor(item.url)[0].toUpperCase(), color: favorites[i % 4].color })) : favorites).map(item => <button key={item.url} onClick={() => navigate(item.url)}><span className={`lb-favorite-icon ${item.color}`}>{item.letter}</span><span>{item.name}</span></button>)}</div>
            <div className="lb-start-connection" role="status"><span className={connected ? 'lb-dot connected' : 'lb-dot'}/>{queuedNavigation !== null ? `Opening ${queuedNavigation} when connected…` : connecting ? 'Connecting…' : connected ? (session?.capabilities.stream ? 'Ready to browse' : 'Connected · Page streaming unavailable') : 'Browser unavailable'}
              {queuedNavigation !== null && <Button variant="ghost" onClick={() => setQueuedNavigation(null)}>Cancel</Button>}
              {!connected && !connecting && <Button variant="ghost" onClick={() => { startTask.current = null; void connect(); }}>Reconnect</Button>}</div>
          </div><div className="lb-start-footer"><span>Search with {SEARCH_PROVIDERS[session?.searchProvider ?? 'duckduckgo'].name}</span><button onClick={() => setPanel('about')}>About Lope Browser <ArrowRight size={12}/></button></div>
        </div> : tab?.error ? <div className="lb-state"><AlertCircle size={35}/><h2>{tab.error.kind === 'certificate' ? 'This connection could not be verified' : tab.error.kind === 'crashed' ? 'This page stopped responding' : 'This page couldn’t be opened'}</h2><p>{tab.error.message}</p><div><Button onClick={() => action('reload')}>Try again</Button><Button variant="ghost" onClick={openHost}>Open in host browser <ExternalLink size={13}/></Button></div></div>
        : !session?.streamUrl ? <div className="lb-state"><Compass size={35}/><h2>Interactive browsing is unavailable</h2><p>Your website needs a connected browser streaming runtime. You can open this page in your host browser.</p><code>{displayAddress(tab?.url ?? '')}</code><div><Button onClick={openHost}>Open in host browser <ExternalLink size={13}/></Button><Button variant="ghost" onClick={() => action('home')}>Back to start</Button></div></div> : null}
        {tab?.loading && <div className="lb-loading-line" role="progressbar" aria-label="Page loading"/>}
        {findOpen && <form className="lb-find" role="search" onSubmit={event => { event.preventDefault(); action('find-next'); }}>
          <Input autoFocus value={find} onChange={event => setFind(event.target.value)} placeholder="Find in page" aria-label="Find in page"
            onKeyDown={event => { if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); action('find-previous'); } }}/>
          <output className="lb-find-count" aria-live="polite">{tab?.find && tab.find.text === find ? (tab.find.total ? `${tab.find.active} of ${tab.find.total}${tab.find.total >= 1000 ? '+' : ''}` : 'No matches') : ''}</output>
          <button type="button" aria-label="Previous match" disabled={!tab?.find?.total} onClick={() => action('find-previous')}><ArrowLeft size={14}/></button>
          <button aria-label="Next match" disabled={!tab?.find?.total}><ArrowRight size={14}/></button>
          <button type="button" aria-label="Close find" onClick={closeFind}><X size={14}/></button></form>}
      </main>
      {panel && <aside className="lb-panel" aria-label={`${panel} panel`}><div className="lb-panel-heading"><h2>{panel === 'about' ? 'About this browser' : panel === 'settings' ? 'Browser preferences' : panel[0].toUpperCase() + panel.slice(1)}</h2><IconButton label="Close panel" icon={<X size={15}/>} onClick={() => setPanel(null)}/></div>
        {(panel === 'history' || panel === 'bookmarks') && <Input className="lb-panel-search" placeholder={`Search ${panel}`} aria-label={`Search ${panel}`} value={query} onChange={event => setQuery(event.target.value)}/>}
        {panel === 'history' && <div className="lb-panel-list">{session?.history.filter(item => (item.title + item.url).toLowerCase().includes(query.toLowerCase())).map(item => <button className="lb-visit" key={item.id} onClick={() => navigate(item.url)}><History size={14}/><span><b>{item.title}</b><small>{displayAddress(item.url)}</small><time>{new Date(item.visitedAt).toLocaleString()}</time></span></button>)}{!session?.history.length && <Empty icon={<History size={25}/>} text="The places you visit will appear here."/>}</div>}
        {panel === 'bookmarks' && <div className="lb-panel-list">{session?.bookmarks.filter(item => (item.title + item.url).toLowerCase().includes(query.toLowerCase())).map(item => <div className="lb-bookmark-row" key={item.id}><button className="lb-visit" onClick={() => navigate(item.url)}><Star size={14}/><span><b>{item.title}</b><small>{displayAddress(item.url)}</small></span></button><IconButton label={`Remove ${item.title}`} icon={<X size={13}/>} onClick={() => void run({ type: 'bookmark.remove', id: item.id })}/></div>)}{!session?.bookmarks.length && <Empty icon={<Star size={25}/>} text="No bookmarks. Select the star in the address bar to add one."/>}</div>}
        {panel === 'downloads' && <div className="lb-panel-list">{session?.downloads.map(item => { const local = localDownloads[item.id]; const fileId = item.fileId ?? local?.path; return <div className="lb-download" key={item.id}><div><Download size={17}/><b>{item.name}</b>{item.state === 'completed' && <Check size={14}/>}</div><small>{local?.error || item.error || (local?.path ? 'Saved to LopeDrive' : item.state === 'progress' ? `${bytes(item.receivedBytes)}${item.totalBytes ? ` of ${bytes(item.totalBytes)}` : ''}` : item.state)}</small>{item.state === 'progress' && <progress value={item.totalBytes ? item.receivedBytes : undefined} max={item.totalBytes || undefined}/>}
          {(item.state === 'progress' || item.state === 'importing') && <Button variant="ghost" onClick={() => void run({ type: 'download.cancel', id: item.id })}>Cancel</Button>}
          {['completed', 'failed'].includes(item.state) && (fileId ? <Button variant="ghost" onClick={() => shell ? shell.showInFiles(fileId) : context?.services.launch('lope.files', { path: fileId.slice(0, fileId.lastIndexOf('/')), select: fileId })}>Show in Files</Button> : <Button variant="ghost" onClick={() => void saveDownload(item.id, item.name)}>Save to device</Button>)}
        </div>; })}{!session?.downloads.length && <Empty icon={<Download size={25}/>} text="Your downloads will appear here."/>}<p className="lb-panel-note">{context?.services.files.writeBinary ? 'Completed downloads up to 256 MiB are saved in LopeDrive/Downloads. Account sync encrypts them on this device.' : 'Completed files can be saved to your device.'}</p></div>}
        {panel === 'settings' && <div className="lb-panel-prose"><h3>Search engine</h3><select aria-label="Search engine" value={session?.searchProvider ?? 'duckduckgo'} disabled={!connected} onChange={event => void run({ type: 'settings', searchProvider: event.target.value as BrowserSession['searchProvider'] })}>{Object.entries(SEARCH_PROVIDERS).map(([key, provider]) => <option key={key} value={key}>{provider.name}</option>)}</select><h3>Site permissions</h3><p className="lb-site-origin"><Globe2 size={14}/>{siteTitle}</p><p>Camera, microphone, location, notifications, and website clipboard access are blocked. Device forwarding is unavailable in this build.</p><Button variant="ghost" onClick={openHost}>Open in host browser <ExternalLink size={13}/></Button><h3>Browsing data</h3><p>Normal sessions keep website sign-ins and tabs in a separate browser profile. Private sessions discard site data when ended.</p><Button onClick={() => setClearDialog(true)} disabled={!connected}>Clear browsing data…</Button></div>}
        {panel === 'about' && <div className="lb-panel-prose"><div className="lb-about-mark"><Compass size={31}/></div><h3>Lope Browser</h3><p>Websites run in a remote Chromium session.</p><dl><dt>Engine</dt><dd>{session?.engineVersion || 'Not connected'}</dd><dt>Surface</dt><dd>{session?.streamUrl ? 'Selkies 2.2.1 · WebSocket media' : 'Not connected'}</dd><dt>OpenGL</dt><dd>{!session ? 'Not connected' : session.capabilities.opengl ? 'Hardware accelerated · WebGL enabled' : session.capabilities.webgl ? 'Software rendering (SwiftShader) · WebGL enabled' : 'Unavailable'}</dd></dl><h3>Your browser profile</h3><p>Websites run in an isolated browser on the LopeOS server. Website content and sign-in cookies are processed there, separately from your end-to-end encrypted LopeDrive. Your password and vault keys stay on this device.</p><h3>Opening files</h3><p>When you open an HTML file from Files, only that file is sent to the browser on the LopeOS server, which shows it on its own private address. Files it links to, such as images or stylesheets beside it, aren’t sent. Opened files close when the browser restarts.</p><h3>Compatibility</h3><p>WebGL and accelerated Canvas 2D are available. WebGPU, DRM video, passkeys, security keys, and some sign-in providers may need your host browser.</p><h3>Accessibility</h3><p>Browser controls support keyboard navigation and screen readers. The remote webpage does not expose its accessibility tree to local assistive technology. Open the page in your host browser to use a local screen reader.</p><Button onClick={openHost}>Open in host browser <ExternalLink size={13}/></Button></div>}
      </aside>}
    </div>
    <footer className="lb-status"><span><span className={connected ? 'lb-dot connected' : 'lb-dot'}/>{connected ? (session?.streamUrl ? streamStatus : 'Engine connected · Stream unavailable') : connecting ? 'Connecting' : 'Disconnected'}</span>{connected && <span className="lb-gpu-chip" title={session?.capabilities.opengl ? 'Hardware GPU acceleration active' : 'Software OpenGL rendering · WebGL works without a GPU'}><Cpu size={10}/>{session?.capabilities.opengl ? 'GPU' : 'SW'}</span>}<span className="lb-status-center">{onNewTab ? 'Lope Browser' : siteTitle}</span><div><IconButton label={muted ? 'Enable audio' : 'Mute audio'} icon={muted ? <VolumeX size={13}/> : <Volume2 size={13}/>} disabled={!session?.streamUrl} onClick={() => setMuted(value => !value)}/><IconButton label="Open in host browser" icon={<ExternalLink size={13}/>} disabled={onNewTab || showingFile} onClick={openHost}/></div></footer>
    {menu && <div className="lb-menu-layer" onMouseDown={() => setMenu(null)}><div className="lb-menu" onMouseDown={event => event.stopPropagation()}><Popover label="Browser menu"><div className="lb-menu-categories">{browserMenus.map(group => <button className={menu === group.label ? 'selected' : ''} key={group.label} onClick={() => setMenu(group.label)}>{group.label}<ChevronDown size={10}/></button>)}</div>{browserMenus.find(group => group.label === (menu === 'More' ? 'File' : menu))?.items.map((item, index) => typeof item === 'string' ? (() => { const name = item.replace('browser.', ''); const [, label, keys] = actions.find(entry => entry[0] === name) ?? [name, name, '']; return <button className="lb-menu-action" key={item} disabled={!connected && !['about', 'open-host'].includes(name)} onClick={() => action(name)}>{label}<kbd>{keys}</kbd></button>; })() : <hr key={index}/>)}<hr/><button className="lb-menu-action" onClick={() => { setMenu(null); setPanel('settings'); }}><SlidersHorizontal size={13}/>Browser preferences</button></Popover></div></div>}
    {tabMenu && <div className="lb-tab-menu"><Popover label="Tab actions">{[['Duplicate tab', 'duplicate'], ['Reopen closed tab', 'reopen']].map(([label, name]) => <button key={name} onClick={() => { if (name === 'duplicate') void run({ type: 'tab.duplicate', tabId: tabMenu }); else action(name); setTabMenu(null); }}>{label}</button>)}<button onClick={() => { const target = session?.tabs.find(t => t.id === tabMenu); if (target) void run({ type: 'tab.pin', tabId: tabMenu, pinned: !target.pinned }); setTabMenu(null); }}>{session?.tabs.find(t => t.id === tabMenu)?.pinned ? 'Unpin tab' : 'Pin tab'}</button><button onClick={() => { const index = session?.tabs.findIndex(t => t.id === tabMenu) ?? 0; void run({ type: 'tab.reorder', tabId: tabMenu, index: Math.max(0, index - 1) }); setTabMenu(null); }}>Move tab left</button><button onClick={() => { const index = session?.tabs.findIndex(t => t.id === tabMenu) ?? 0; void run({ type: 'tab.reorder', tabId: tabMenu, index: index + 1 }); setTabMenu(null); }}>Move tab right</button><button onClick={() => { void run({ type: 'tab.close', tabId: tabMenu }); setTabMenu(null); }}>Close tab</button><button onClick={() => { void run({ type: 'tab.closeOthers', tabId: tabMenu }); setTabMenu(null); }}>Close other tabs</button><button onClick={() => { void run({ type: 'tab.closeRight', tabId: tabMenu }); setTabMenu(null); }}>Close tabs to the right</button></Popover></div>}
    {upload && <Dialog title="Choose a file for this website" onClose={() => void run({ type: 'upload.cancel', id: upload.id })}><div className="lb-dialog"><FileUp size={28}/><p>{titleFor(session?.tabs.find(t => t.id === upload.tabId)?.url ?? '')}</p><p>Only selected files will be sent to this website as readable content. Your vault key is never sent.</p><div>{(context?.services.files.readBinary || session?.capabilities.workspaceFiles) && <Button onClick={() => void handleUpload(undefined, true)}>Choose from Files</Button>}<label className="lb-file-choice">Choose from device<input type="file" multiple={upload.multiple} aria-label="Choose from device" onChange={event => void handleUpload(Array.from(event.target.files ?? []))}/></label></div><Button variant="ghost" onClick={() => void run({ type: 'upload.cancel', id: upload.id })}>Cancel</Button></div></Dialog>}
    {clearDialog && <Dialog title="Clear browsing data?" onClose={() => setClearDialog(false)}><div className="lb-dialog"><History size={28}/><p>All tabs, history, bookmarks, cookies, website storage, and staged downloads in this session will be deleted. You will be signed out of websites. Saved workspace files remain.</p><div><Button onClick={async () => { setClearDialog(false); await run({ type: 'data.clear' }); }}>Clear data</Button><Button variant="ghost" onClick={() => setClearDialog(false)}>Cancel</Button></div></div></Dialog>}
    {pasteDialog && <Dialog title="Paste into website" onClose={() => setPasteDialog(false)}><form className="lb-dialog" onSubmit={event => { event.preventDefault(); const text = String(new FormData(event.currentTarget).get('text') ?? ''); if (tab) void run({ type: 'paste', tabId: tab.id, text }); setPasteDialog(false); }}><Copy size={26}/><p>Paste text here to send it to the website’s focused input.</p><textarea name="text" aria-label="Text to paste" required/><div><Button type="submit">Paste text</Button><Button variant="ghost" type="button" onClick={() => setPasteDialog(false)}>Cancel</Button></div></form></Dialog>}
  </div>;
}

function IconButton({ label, icon, onClick, disabled, pressed }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return <button className={`lb-icon-button ${pressed ? 'pressed' : ''}`} title={label} aria-label={label} aria-pressed={pressed} onClick={onClick} disabled={disabled}>{icon}</button>;
}
function Empty({ icon, text }: { icon: React.ReactNode; text: string }) { return <div className="lb-empty">{icon}<p>{text}</p></div>; }
