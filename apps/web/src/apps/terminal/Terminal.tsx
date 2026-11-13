import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import type { AppContext, Command } from '../../../../../packages/contracts/src';
import { Button, Input, Toolbar } from '../../../../../packages/ui/src';
import { runtimeClient, type ConnectionState, type SessionRecord } from '../../../../../packages/runtime-client/src';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

type Tab = SessionRecord & { title?: string; connection?: ConnectionState };
type PaneApi = { focus(): void; reconnect(): void; clear(): void; find(query: string, backwards?: boolean): void; copy(): Promise<void>; paste(): Promise<void> };
const message = (e: unknown) => e instanceof Error ? e.message : 'The workspace operation failed.';

function TerminalPane({ session, active, onState, onTitle, onApi }: { session: Tab; active: boolean; onState: (id: string, state: ConnectionState, detail?: string) => void; onTitle: (id: string, title: string) => void; onApi: (id: string, api: PaneApi | null) => void }) {
  const host = useRef<HTMLDivElement>(null), fitRef = useRef<FitAddon | null>(null), termRef = useRef<XTerm | null>(null);
  const activeRef = useRef(active); activeRef.current = active;
  const callbacks = useRef({ onState, onTitle, onApi }); callbacks.current = { onState, onTitle, onApi };
  const [gap, setGap] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const term = new XTerm({ cursorBlink: true, cursorStyle: 'bar', fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: 13, lineHeight: 1.3, scrollback: 5000, convertEol: false, allowProposedApi: false, screenReaderMode: true, theme: { background: '#111b28', foreground: '#e1ebf5', cursor: '#a6e4e8', selectionBackground: '#42647e88', black: '#1e2d3d', red: '#f58b91', green: '#a5d8a2', yellow: '#edcd8d', blue: '#85b8f0', magenta: '#c9a4e8', cyan: '#8bdbdf', white: '#e1ebf5', brightBlack: '#6c839a', brightRed: '#ffb1b4', brightGreen: '#c1e9ba', brightYellow: '#f4dfac', brightBlue: '#a9d0ff', brightMagenta: '#ddc5f5', brightCyan: '#b3f1f1', brightWhite: '#ffffff' }, linkHandler: { activate(event, uri) { if (!event.isTrusted) return; try { const url = new URL(uri); if (['https:', 'http:'].includes(url.protocol)) window.open(url.href, '_blank', 'noopener,noreferrer'); } catch {} } } });
    const fit = new FitAddon(), search = new SearchAddon(); term.loadAddon(fit); term.loadAddon(search);
    term.attachCustomKeyEventHandler(event => !(event.type === 'keydown' && (event.metaKey || event.ctrlKey) && event.shiftKey && ['t', 'w', 'f', 'c', 'v'].includes(event.key.toLowerCase())));
    term.open(host.current); termRef.current = term; fitRef.current = fit;
    // OSC 52 requests are consumed without accessing the browser clipboard.
    const osc = term.parser.registerOscHandler(52, () => true);
    const title = term.onTitleChange(value => callbacks.current.onTitle(session.id, value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 60)));
    const connection = runtimeClient.connectSession(session.id, {
      output(data, consumed) { term.write(data, consumed); },
      state(state, detail) { term.options.disableStdin = state !== 'connected'; callbacks.current.onState(session.id, state, detail); },
      ready(_, truncated) { if (truncated) { term.reset(); setGap(true); } },
      gap() { term.reset(); setGap(true); },
    });
    const input = term.onData(data => { try { connection.input(data); } catch (e) { callbacks.current.onState(session.id, 'unavailable', message(e)); } });
    const binaryInput = term.onBinary(data => { try { connection.inputBinary(data); } catch (e) { callbacks.current.onState(session.id, 'unavailable', message(e)); } });
    let resizeTimer: ReturnType<typeof setTimeout>;
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!activeRef.current || !host.current?.clientWidth || !host.current?.clientHeight) return;
        fit.fit(); connection.resize(Math.min(500, Math.max(2, term.cols)), Math.min(200, Math.max(1, term.rows)));
      }, 80);
    };
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize();
    const api: PaneApi = {
      focus() { term.focus(); }, reconnect() { connection.reconnect(); }, clear() { term.clear(); },
      find(query, backwards = false) { if (!query) { search.clearDecorations(); return; } backwards ? search.findPrevious(query) : search.findNext(query); },
      async copy() { const value = term.getSelection(); if (value) await navigator.clipboard.writeText(value); },
      async paste() { const value = await navigator.clipboard.readText(); if (value.length > 32768) throw new Error('Paste up to 32,768 characters at once, or upload a script through Files.'); term.paste(value); term.focus(); },
    };
    callbacks.current.onApi(session.id, api);
    return () => { clearTimeout(resizeTimer); observer.disconnect(); connection.disconnect(); input.dispose(); binaryInput.dispose(); title.dispose(); osc.dispose(); callbacks.current.onApi(session.id, null); term.dispose(); termRef.current = null; fitRef.current = null; };
  }, [session.id]);
  useEffect(() => { if (active) { const frame = requestAnimationFrame(() => { fitRef.current?.fit(); termRef.current?.focus(); }); return () => cancelAnimationFrame(frame); } }, [active]);
  return <section className="terminal-pane" hidden={!active} role="tabpanel" id={`terminal-panel-${session.id}`} aria-labelledby={`terminal-tab-${session.id}`}>
    {gap && <div className="terminal-replay-note" role="status">Older output has expired. Showing the retained tail; redraw an interactive program with Ctrl+L.<button onClick={() => setGap(false)} aria-label="Dismiss output replay notice">×</button></div>}
    <div ref={host} className="terminal-emulator" data-terminal-input="true" aria-label="Interactive Linux terminal" />
  </section>;
}

export default function Terminal({ context }: { context?: AppContext } = {}) {
  const [tabs, setTabs] = useState<Tab[]>([]), [active, setActive] = useState(''), [status, setStatus] = useState('Connecting to workspace…');
  const [available, setAvailable] = useState<SessionRecord[]>([]), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [query, setQuery] = useState(''), [searchVisible, showSearch] = useState(false);
  const apis = useRef(new Map<string, PaneApi>()), tabsRef = useRef(tabs); tabsRef.current = tabs;
  const activeRef = useRef(active); activeRef.current = active;
  const storage = useRef(''), connectVersion = useRef(0);
  const persist = (next: Tab[]) => { if (storage.current) sessionStorage.setItem(storage.current, JSON.stringify(next.map(t => t.id))); };
  const add = useCallback((session: SessionRecord) => { setTabs(previous => { const next = previous.some(t => t.id === session.id) ? previous : [...previous, session]; persist(next); return next; }); setActive(session.id); }, []);
  const connect = async () => {
    const version = ++connectVersion.current; setBusy(true);
    try {
      const identity = await runtimeClient.identity(); await runtimeClient.health();
      storage.current = `lope.terminal.${identity.workspaceId}.${context?.windowId || 'default'}`;
      const sessions = await runtimeClient.listSessions();
      if (version !== connectVersion.current) return;
      let ids: string[] = []; try { ids = JSON.parse(sessionStorage.getItem(storage.current) || '[]'); if (!Array.isArray(ids)) ids = []; } catch {}
      const restored = sessions.filter(s => ids.includes(s.id));
      setAvailable(sessions.filter(s => !ids.includes(s.id))); setReady(true); setStatus('Linux workspace connected');
      if (restored.length) { setTabs(restored); setActive(restored[0].id); }
      else if (!sessions.length) {
        const created = await runtimeClient.createSession({ cwd: typeof context?.launchArgs.cwd === 'string' ? context.launchArgs.cwd : '/' });
        if (version !== connectVersion.current) { await runtimeClient.closeSession(created.id); return; }
        add(created);
      } else { setTabs([]); setActive(''); }
    } catch (e) { if (version === connectVersion.current) { setReady(false); setStatus(message(e)); } }
    finally { if (version === connectVersion.current) setBusy(false); }
  };
  useEffect(() => { void connect(); return () => { connectVersion.current++; }; }, []);
  const newTab = async () => {
    setBusy(true);
    try { add(await runtimeClient.createSession({ cwd: typeof context?.launchArgs.cwd === 'string' ? context.launchArgs.cwd : '/' })); }
    catch (e) { setStatus(message(e)); } finally { setBusy(false); }
  };
  const closeTab = async (id = activeRef.current) => {
    if (!id) return;
    try {
      await runtimeClient.closeSession(id);
      setTabs(previous => { const next = previous.filter(t => t.id !== id); persist(next); if (activeRef.current === id) setActive(next.at(-1)?.id || ''); return next; });
    } catch (e) { setStatus(`Could not close shell: ${message(e)}`); }
  };
  const onState = useCallback((id: string, state: ConnectionState, detail?: string) => { setTabs(previous => previous.map(t => t.id === id ? { ...t, connection: state } : t)); if (detail) setStatus(detail); else if (state === 'connected') setStatus('Linux workspace connected'); }, []);
  const onTitle = useCallback((id: string, title: string) => { setTabs(previous => previous.map(t => t.id === id ? { ...t, title } : t)); }, []);
  const onApi = useCallback((id: string, api: PaneApi | null) => { api ? apis.current.set(id, api) : apis.current.delete(id); }, []);
  const action = async (name: 'copy' | 'paste') => { try { await apis.current.get(activeRef.current)?.[name](); } catch (e) { setStatus(message(e)); } };
  const latest = useRef({ newTab, closeTab, action }); latest.current = { newTab, closeTab, action };
  useEffect(() => {
    if (!context) return;
    const commands: Command[] = [
      { id: 'terminal.new-tab', label: 'New Tab', shortcut: 'Mod+Shift+T', execute: () => latest.current.newTab() },
      { id: 'terminal.close-tab', label: 'Close Tab', shortcut: 'Mod+Shift+W', execute: () => latest.current.closeTab() },
      { id: 'terminal.find', label: 'Find…', shortcut: 'Mod+Shift+F', execute: () => showSearch(true) },
      { id: 'terminal.copy', label: 'Copy Selection', execute: () => latest.current.action('copy') },
      { id: 'terminal.paste', label: 'Paste', execute: () => latest.current.action('paste') },
      { id: 'terminal.clear', label: 'Clear Scrollback', execute: () => apis.current.get(activeRef.current)?.clear() },
    ];
    const release = commands.map(c => context.services.commands.register(c));
    release.push(context.lifecycle.onBeforeClose(async () => {
      try { await Promise.all(tabsRef.current.map(t => runtimeClient.closeSession(t.id))); persist([]); return true; }
      catch (e) { setStatus(`Could not close all shells: ${message(e)}`); return false; }
    }));
    return () => release.forEach(fn => fn());
  }, [context]);
  const current = tabs.find(t => t.id === active);
  return <div className="lope-terminal" data-terminal-input="true" data-glass-tone="dark" onKeyDown={event => {
    // Bubble protection complements the shell's capture-phase terminal-focus guard.
    event.stopPropagation();
    if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
      const key = event.key.toLowerCase();
      if (['t', 'w', 'f', 'c', 'v'].includes(key)) { event.preventDefault(); if (key === 't') void newTab(); if (key === 'w') void closeTab(); if (key === 'f') showSearch(true); if (key === 'c') void action('copy'); if (key === 'v') void action('paste'); }
    }
  }}>
    {!ready ? <form className="terminal-connect" onSubmit={event => { event.preventDefault(); void connect(); }}>
      <span className="terminal-symbol" aria-hidden="true">›_</span><h2>Terminal</h2>
      <p role="status">{status}</p><p>Terminal uses the same workspace files as Files and Text Editor.</p>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Connecting…' : 'Try again'}</Button>
    </form> : <>
      <Toolbar><div className="terminal-tabs" role="tablist" aria-label="Shell sessions">{tabs.map((tab, index) => <div className="terminal-tab-wrap" key={tab.id}>
        <button className="terminal-tab" type="button" role="tab" id={`terminal-tab-${tab.id}`} aria-controls={`terminal-panel-${tab.id}`} aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1} onClick={() => setActive(tab.id)} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setActive(tabs[(index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id); } }}><span className={`terminal-state-dot ${tab.connection || 'connecting'}`} />{tab.title || `Shell ${index + 1}`}</button>
        <button className="terminal-tab-close" title="Close shell and its jobs" aria-label={`Close shell ${index + 1}`} onClick={() => void closeTab(tab.id)}>×</button>
      </div>)}</div><Button variant="ghost" aria-label="New terminal tab" title="New tab" disabled={busy} onClick={() => void newTab()}>＋</Button><Button variant="ghost" disabled={!current} onClick={() => showSearch(!searchVisible)}>Find</Button><Button variant="ghost" disabled={!current} onClick={() => void action('copy')}>Copy</Button><Button variant="ghost" disabled={!current} onClick={() => void action('paste')}>Paste</Button></Toolbar>
      {searchVisible && <form className="terminal-search" role="search" onSubmit={event => { event.preventDefault(); apis.current.get(active)?.find(query); }}><Input autoFocus aria-label="Find in terminal output" placeholder="Find in output" value={query} onChange={e => { setQuery(e.target.value); apis.current.get(active)?.find(e.target.value); }} /><Button type="button" onClick={() => apis.current.get(active)?.find(query, true)}>Previous</Button><Button type="submit">Next</Button><Button type="button" aria-label="Close terminal search" onClick={() => { showSearch(false); apis.current.get(active)?.focus(); }}>×</Button></form>}
      <div className="terminal-panes">{tabs.map(tab => <TerminalPane key={tab.id} session={tab} active={tab.id === active} onState={onState} onTitle={onTitle} onApi={onApi} />)}{!tabs.length && <div className="terminal-empty"><p>No open shells</p><Button onClick={() => void newTab()}>New shell</Button></div>}</div>
      <footer className="terminal-status" role="status"><span>{current?.connection === 'connected' ? 'Connected · Linux / Unix' : current?.connection || 'Ready'}</span><span title={status}>{status}</span>{current?.connection === 'unavailable' && <Button variant="ghost" onClick={() => apis.current.get(active)?.reconnect()}>Reconnect</Button>}{available.length > 0 && <select aria-label="Resume an existing shell" value="" onChange={event => { const s = available.find(t => t.id === event.target.value); if (s) { add(s); setAvailable(previous => previous.filter(t => t.id !== s.id)); } }}><option value="">Resume existing shell…</option>{available.map(s => <option key={s.id} value={s.id}>{s.cwd} · {s.state}</option>)}</select>}</footer>
    </>}
  </div>;
}
