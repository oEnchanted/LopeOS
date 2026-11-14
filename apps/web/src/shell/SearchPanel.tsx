import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type KeyboardEvent } from 'react';
import { Search, ArrowUpRight, FileText, Clock3, X, AppWindow, Folder, Layers, Clipboard, Calculator, Copy, Pin, Trash2, Plus, ArrowLeft, SlidersHorizontal, CornerDownLeft, ArrowUp, Square } from 'lucide-react';
import type { Command, FileEntry, SharedServices } from '../../../../packages/contracts/src';
import { preferences, usePreferences } from '../../../../packages/sdk/src/preferences';
import { applications } from './registry';
import { AppIcon } from './Icons';
import { SpotlightChat } from './SpotlightChat';
import { spotlightAI, MAX_MESSAGE_LENGTH } from './spotlight-ai/service';
import { readHistory, writeHistory, clipboardItems, addClipboardItem, importClipboardItem, copyClipboardText, removeClipboardItem, toggleClipboardPin, clearClipboard } from './system';
import { applicationAliases, getInstantAnswer, getCalculationError, matchScore, looksLikeFileQuery } from './spotlight-engine';
import { TRASH_PATH } from './trash';

type Scope = 'all' | 'apps' | 'files' | 'actions' | 'clipboard';
interface RecentSearch { query: string; time: number }
interface Result { id: string; label: string; description: string; icon: ReactNode; kind: string; run: () => void | Promise<void>; keepOpen?: boolean }
const categories = [
  { id: 'apps', label: 'Applications', icon: AppWindow, hint: 'Open an application' },
  { id: 'files', label: 'Files', icon: Folder, hint: 'Search workspace files' },
  { id: 'actions', label: 'Actions', icon: Layers, hint: 'Run a command' },
  { id: 'clipboard', label: 'Clipboard', icon: Clipboard, hint: 'View copied text' },
] as const;
const symbol = (icon: ReactNode) => <span className="search-result-symbol">{icon}</span>;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'That action could not be completed. Please try again.';

export function SearchPanel({ services, commands, close, initialScope = 'all' }: { services: SharedServices; commands: Command[]; close: () => void; initialScope?: 'all' | 'apps' }) {
  const p = usePreferences();
  const ai = useSyncExternalStore(spotlightAI.subscribe, spotlightAI.getSnapshot);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>(initialScope);
  const [selectedId, setSelectedId] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileStatus, setFileStatus] = useState('');
  const [searchingFiles, setSearchingFiles] = useState(false);
  const [status, setStatus] = useState('');
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [historyVersion, setHistoryVersion] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const q = query.trim();
  const pendingSubmit = useRef<string | null>(null);
  const [fileQueryKey, setFileQueryKey] = useState('');
  const [completedFileQuery, setCompletedFileQuery] = useState('');

  useEffect(() => {
    mounted.current = true;
    previous.current = document.activeElement as HTMLElement;
    input.current?.focus();
    return () => { spotlightAI.stop(); mounted.current = false; if (previous.current?.isConnected) previous.current.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const refresh = () => setHistoryVersion(v => v + 1);
    window.addEventListener('lope:history-updated', refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => { window.removeEventListener('lope:history-updated', refresh); window.clearInterval(timer); };
  }, []);
  const clips = useMemo(() => clipboardItems(), [historyVersion, p.clipboardHistory, p.clipboardRetentionMinutes]);
  const recent = useMemo(() => {
    const history = readHistory<RecentSearch[]>('search', []);
    return p.searchHistoryDays && Array.isArray(history) ? history.filter(s => s && typeof s.query === 'string' && s.time > Date.now() - p.searchHistoryDays * 86400000).slice(0, p.recentItemCount) : [];
  }, [historyVersion, p.searchHistoryDays, p.recentItemCount]);
  const recentApps = useMemo(() => {
    const history = readHistory<string[]>('recentApps', []);
    return Array.isArray(history) ? history.filter(id => typeof id === 'string') : [];
  }, [historyVersion]);
  const answer = scope === 'all' ? getInstantAnswer(q) : null;
  const calculationError = scope === 'all' && !answer ? getCalculationError(q) : null;
  const explicitFileQuery = scope === 'all' && looksLikeFileQuery(q);
  const fileScope = scope === 'files' || explicitFileQuery;
  const shouldSearchFiles = p.searchFiles && q.length >= 2 && (scope === 'files' || scope === 'all' && !answer && !calculationError && (explicitFileQuery || q.length < 100 && q.split(/\s+/).length <= 3));
  const filesPending = shouldSearchFiles && completedFileQuery !== q;
  const currentFiles = fileQueryKey === q ? files : [];
  const conversationMode = scope === 'all' && !answer && !calculationError && !explicitFileQuery && !currentFiles.length;
  const canSend = ai.phase === 'ready' && !filesPending && !!q && q.length <= MAX_MESSAGE_LENGTH;

  // Publish partial matches and ignore obsolete requests; one inaccessible folder must not stop a search.
  useEffect(() => {
    let cancelled = false;
    setFiles([]); setFileQueryKey(q); setCompletedFileQuery(''); setFileStatus(''); setSearchingFiles(false);
    if (!shouldSearchFiles) return;
    setSearchingFiles(true);
    const timer = window.setTimeout(async () => {
      const queue = [...p.searchRoots]; const visited = new Set<string>(); const found = new Map<string, FileEntry>();
      // A slow workspace must not hold ordinary chat hostage. Files has the full search.
      const deadline = scope === 'all' && !explicitFileQuery ? Date.now() + 1500 : Infinity;
      let failures = 0; let count = 0; let timedOut = false;
      while (queue.length && count < 80 && found.size < 100 && !cancelled) {
        const path = queue.shift()!;
        if (visited.has(path) || path === TRASH_PATH || path.startsWith(TRASH_PATH + '/')) continue;
        visited.add(path); count++;
        try {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          let entries: FileEntry[];
          try {
            entries = await Promise.race([
              services.files.list(path),
              ...(Number.isFinite(deadline) ? [new Promise<never>((_, reject) => { timeout = setTimeout(() => { timedOut = true; reject(new Error('File lookup deadline')); }, Math.max(0, deadline - Date.now())); })] : []),
            ]);
          } finally { if (timeout) clearTimeout(timeout); }
          if (cancelled) return;
          for (const entry of entries) {
            if (entry.path === TRASH_PATH || entry.path.startsWith(TRASH_PATH + '/')) continue;
            if (p.searchExclusions.some(exclusion => exclusion && entry.path.toLowerCase().includes(exclusion.toLowerCase()))) continue;
            if (matchScore(q, entry.name, entry.path) > 0) found.set(entry.path, entry);
            if (entry.type === 'directory' && queue.length < 2000) queue.push(entry.path);
            if (found.size >= 100) break;
          }
          setFiles([...found.values()].sort((a, b) => matchScore(q, b.name, b.path) - matchScore(q, a.name, a.path)));
        } catch { failures++; if (timedOut) break; }
      }
      if (!cancelled) {
        setSearchingFiles(false); setCompletedFileQuery(q);
        setFileStatus(timedOut ? 'Workspace search took too long. Choose Files to keep searching.' : failures === count ? 'Workspace unavailable. Check the connection or search folders in Settings.' : `${found.size} workspace ${found.size === 1 ? 'match' : 'matches'}.${queue.length ? ' Search limit reached; narrow your search folders in Settings.' : ''}${failures ? ` ${failures} folders could not be searched.` : ''}`);
      }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [q, scope, shouldSearchFiles, p.searchRoots, p.searchExclusions, services.files]);

  function changeScope(next: Scope) { pendingSubmit.current = null; setScope(next); setSelectedId(''); setStatus(''); input.current?.focus(); }
  function changeQuery(next: string) { pendingSubmit.current = null; setQuery(next); setSelectedId(''); setStatus(''); input.current?.focus(); }
  function announce(message: string) { setStatus(message); setIsError(false); }
  async function act(action: () => void | Promise<unknown>, success?: string) {
    if (pending.current) return;
    input.current?.focus();
    pending.current = true; setBusy(true); setStatus('');
    try { await action(); if (mounted.current && success) announce(success); }
    catch (error) { if (mounted.current) { setStatus(errorMessage(error)); setIsError(true); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  function remember() {
    if (q && p.searchHistoryDays && scope !== 'clipboard') writeHistory('search', [{ query: q.slice(0, 160), time: Date.now() }, ...recent.filter(s => s.query !== q)].slice(0, 50));
  }
  const results: Result[] = [];
  {
    if (answer) results.push({ id: 'answer', label: answer.value, description: answer.detail, icon: symbol(<Calculator size={20}/>), kind: answer.kind === 'conversion' ? 'Conversion' : 'Calculator', keepOpen: true, run: async () => { await copyClipboardText(answer.value); announce('Result copied to clipboard.'); } });
    if (scope === 'apps' && p.searchApps) {
      const matched = applications.filter(app => p.appLaunch[app.id] !== false).map(app => ({ app, score: q ? matchScore(q, app.name, app.description, applicationAliases(app.id)) : 1 })).filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || (recentApps.indexOf(a.app.id) < 0 ? 999 : recentApps.indexOf(a.app.id)) - (recentApps.indexOf(b.app.id) < 0 ? 999 : recentApps.indexOf(b.app.id)));
      for (const { app } of matched.slice(0, 100)) results.push({ id: app.id, label: app.name, description: app.description, icon: <AppIcon name={app.icon} size={38}/>, kind: 'Application', run: () => services.launch(app.id) });
    }
    if (scope === 'actions' && p.searchCommands) {
      const matched = commands.filter(c => c.id !== 'shell.search' && (typeof c.enabled === 'function' ? c.enabled() : c.enabled) !== false).map(command => ({ command, score: q ? matchScore(q, command.label) : 1 })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
      for (const { command } of matched.slice(0, 100)) results.push({ id: command.id, label: command.label, description: command.shortcut ? `Action · ${command.shortcut}` : 'Desktop action', icon: symbol(<Layers size={20}/>), kind: 'Action', run: () => services.commands.execute(command.id) });
    }
    if ((scope === 'all' || scope === 'files') && p.searchFiles) for (const file of currentFiles.slice(0, scope === 'files' ? 100 : 8)) results.push({ id: `file:${file.path}`, label: file.name, description: file.path, icon: symbol(file.type === 'directory' ? <Folder size={20}/> : <FileText size={20}/>), kind: file.type === 'directory' ? 'Folder' : 'File', run: () => services.openFile(file.path) });
    if (scope === 'clipboard' && p.clipboardHistory) for (const clip of clips.filter(clip => !q || clip.text.toLocaleLowerCase().includes(q.toLocaleLowerCase()))) results.push({ id: `clip:${clip.id}`, label: clip.text.split('\n').find(line => line.trim())?.slice(0, 150) || 'Text', description: `${clip.pinned ? 'Pinned · ' : ''}${clip.text.length.toLocaleString()} characters · ${new Date(clip.time).toLocaleTimeString(p.region, { hour: 'numeric', minute: '2-digit' })}`, icon: symbol(clip.pinned ? <Pin size={19}/> : <Clipboard size={19}/>), kind: 'Clipboard', keepOpen: true, run: async () => { await copyClipboardText(clip.text); announce('Copied to clipboard.'); } });
  }
  const selected = Math.max(0, results.findIndex(result => result.id === selectedId));
  const current = results[selected];
  const selectedClip = scope === 'clipboard' ? clips.find(clip => `clip:${clip.id}` === current?.id) : undefined;
  useEffect(() => { dialog.current?.querySelector<HTMLElement>(`[data-result-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' }); }, [selected, current?.id]);

  function run(result = current) {
    if (!result || pending.current) return;
    if (result.keepOpen) { void act(result.run); return; }
    remember(); close();
    try { Promise.resolve(result.run()).catch(error => services.notify({ title: 'Action unavailable', message: errorMessage(error), tone: 'error' })); }
    catch (error) { services.notify({ title: 'Action unavailable', message: errorMessage(error), tone: 'error' }); }
  }
  function sendChat() {
    if (!canSend) return;
    const request = spotlightAI.send(q);
    if (spotlightAI.getSnapshot().phase === 'generating') changeQuery('');
    else input.current?.focus();
    void request;
  }
  useEffect(() => {
    if (pendingSubmit.current !== q || filesPending || searchingFiles || scope !== 'all') return;
    pendingSubmit.current = null;
    if (current) run(current);
    else if (conversationMode) sendChat();
  }, [filesPending, searchingFiles, completedFileQuery, q, scope]);
  function submitMain() {
    if (scope === 'all' && filesPending && !current) { pendingSubmit.current = q; announce('Checking workspace files…'); return; }
    if (conversationMode) sendChat(); else run();
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && /^[0-4]$/.test(event.key)) {
      event.preventDefault(); event.stopPropagation(); changeScope((['all', 'apps', 'files', 'actions', 'clipboard'] as Scope[])[Number(event.key)]); return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); if (conversationMode && ['loading', 'checking', 'generating'].includes(ai.phase)) { spotlightAI.stop(); input.current?.focus(); return; } if (q) changeQuery(''); else if (scope !== 'all') changeScope('all'); else close(); return;
    }
    if (event.key === 'Tab') {
      // Move focus explicitly on every Tab. WebKit's native order skips buttons (unless the
      // user enabled Safari's "Press Tab to highlight each item") and would leave the dialog.
      const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') ?? [])].filter(node => node.getClientRects().length > 0);
      if (nodes.length) {
        event.preventDefault();
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        nodes[index < 0 ? (event.shiftKey ? nodes.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length].focus();
      }
      event.stopPropagation(); return;
    }
    if (event.target !== input.current) return;
    if (conversationMode) { if (event.key === 'Enter') { event.preventDefault(); submitMain(); } return; }
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {
      event.preventDefault(); const step = event.key.startsWith('Page') ? 6 : 1;
      const next = Math.max(0, Math.min(results.length - 1, selected + (event.key.endsWith('Down') ? step : -step))); setSelectedId(results[next]?.id || '');
    }
    if (event.key === 'Enter') { event.preventDefault(); submitMain(); }
    if (event.key === 'Backspace' && !query && scope !== 'all') changeScope('all');
  }

  return <div className="search-backdrop spotlight-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialog} className={`spotlight spotlight-desktop${conversationMode ? ' is-chat' : ''}`} role="dialog" aria-modal="true" aria-label="Find applications" aria-description="Spotlight: search applications, files, actions, clipboard history, and local AI chat" onKeyDown={onKeyDown}>
      <div className="spotlight-input spotlight-searchbar glass">
        {scope === 'all' ? <Search size={26} strokeWidth={1.7}/> : <button className="spotlight-back" aria-label="All results" title="All results" onClick={() => changeScope('all')}><ArrowLeft size={23}/></button>}
        <input ref={input} placeholder={scope === 'clipboard' ? 'Search your clipboard' : scope === 'files' ? 'Search workspace files' : scope === 'apps' ? 'Search applications' : scope === 'actions' ? 'Search actions' : 'Search or ask'} aria-label="Search LopeOS" value={query} onChange={event => changeQuery(event.target.value)} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} maxLength={conversationMode ? MAX_MESSAGE_LENGTH : 2048} data-clipboard-private={conversationMode ? true : undefined} aria-controls={conversationMode ? 'spotlight-chat-conversation' : 'lope-search-results'} aria-autocomplete={conversationMode ? 'none' : 'list'} aria-activedescendant={current ? `spotlight-result-${selected}` : undefined} aria-describedby="spotlight-keyboard-help"/>
        {conversationMode && (ai.phase === 'generating' ? <button className="spotlight-chat-send is-stop" aria-label="Stop response" title="Stop response" onClick={() => { spotlightAI.stop(); input.current?.focus(); }}><Square size={14} fill="currentColor"/></button> : <button className="spotlight-chat-send" aria-label="Send message" title="Send message" disabled={!canSend} onClick={submitMain}><ArrowUp size={20}/></button>)}
        <button aria-label={query ? 'Clear search' : 'Close search'} title={query ? 'Clear search' : 'Close search'} onClick={() => query ? changeQuery('') : close()}><X size={18}/></button>
      </div>
      <div className="spotlight-body glass">
        <nav className="spotlight-scopes" aria-label="Search categories">{[{ id: 'all', label: 'All' }, ...categories].map(category => <button key={category.id} aria-pressed={scope === category.id} onClick={() => changeScope(category.id as Scope)}>{category.label}</button>)}</nav>
        {conversationMode ? <SpotlightChat onPrompt={changeQuery} focusInput={() => input.current?.focus()}/> : <>
        {!q && scope !== 'all' && recent.length > 0 && <div className="search-recent"><Clock3 size={13}/>{recent.map(item => <button key={item.query} onClick={() => changeQuery(item.query)}>{item.query}</button>)}</div>}
        {scope === 'clipboard' && <div className="spotlight-clipboard-head"><div><strong>Clipboard history</strong><p>{p.clipboardHistory ? `Text stays in this session for ${p.clipboardRetentionMinutes} minutes, including pinned items.` : 'Clipboard history saves text for this session.'}</p></div>{p.clipboardHistory && <button className="spotlight-small-button" disabled={!clips.length || busy} onClick={() => { clearClipboard(); input.current?.focus(); announce('Clipboard history cleared.'); }}><Trash2 size={14}/>Clear history</button>}</div>}
        {scope === 'clipboard' && !p.clipboardHistory ? <div className="spotlight-empty"><Clipboard size={32}/><h3>Clipboard history is off</h3><p>Turn on history to remember text copied or pasted in LopeOS. Import or paste text from other apps.</p><button className="spotlight-primary" onClick={() => { preferences.set('clipboardHistory', true); input.current?.focus(); }}>Enable clipboard history</button></div> : <>
          {scope === 'clipboard' && <div className="spotlight-clipboard-compose"><textarea aria-label="Text to save" placeholder="Paste or type text…" value={draft} onChange={event => setDraft(event.target.value)} rows={2}/><div><button className="spotlight-small-button" disabled={busy} onClick={() => void act(() => importClipboardItem(), 'Clipboard imported.')}><Clipboard size={14}/>Import clipboard</button><button className="spotlight-small-button" disabled={!draft.trim() || busy} onClick={() => void act(() => { if (addClipboardItem(draft)) { setDraft(''); changeQuery(''); } }, 'Text saved to clipboard history.')}><Plus size={15}/>Save text</button></div></div>}
          {fileScope && !p.searchFiles && <div className="spotlight-empty"><Folder size={32}/><h3>File search is off</h3><p>Search file and folder names in {p.searchRoots.join(' and ')}.</p><button className="spotlight-primary" onClick={() => { preferences.set('searchFiles', true); input.current?.focus(); }}>Enable file search</button></div>}
          {scope === 'apps' && !p.searchApps && <div className="spotlight-empty"><AppWindow size={32}/><h3>Application search is off</h3><button className="spotlight-primary" onClick={() => { preferences.set('searchApps', true); input.current?.focus(); }}>Enable application search</button></div>}
          {scope === 'actions' && !p.searchCommands && <div className="spotlight-empty"><Layers size={32}/><h3>Action search is off</h3><button className="spotlight-primary" onClick={() => { preferences.set('searchCommands', true); input.current?.focus(); }}>Enable action search</button></div>}
          <div className="spotlight-results" id="lope-search-results" role="listbox" aria-label="Search results" aria-busy={searchingFiles}>
            {results.map((result, index) => <button key={result.id} id={`spotlight-result-${index}`} data-result-index={index} role="option" aria-selected={selected === index} tabIndex={-1} className={`${selected === index ? 'selected' : ''}${result.id === 'answer' ? ' spotlight-answer' : ''}`} onMouseDown={event => event.preventDefault()} onMouseMove={() => setSelectedId(result.id)} onClick={() => { setSelectedId(result.id); input.current?.focus(); run(result); }}>
              {result.icon}<span className="spotlight-result-copy"><strong>{result.label}</strong><small>{result.description}</small></span>
              {result.id === 'answer' ? <Copy size={17}/> : <span className="spotlight-result-kind">{result.kind}</span>}
              {result.id !== 'answer' && (selected === index ? <CornerDownLeft size={16}/> : <ArrowUpRight size={16}/>)}
            </button>)}
          </div>
          {!results.length && !(fileScope && !p.searchFiles || scope === 'apps' && !p.searchApps || scope === 'actions' && !p.searchCommands) && <div className="spotlight-empty spotlight-empty-small"><Search size={23}/><p>{fileScope && q.length < 2 ? 'Type at least two characters to search your workspace.' : scope === 'clipboard' && !q ? 'Your saved text will appear here.' : searchingFiles ? 'Searching your workspace…' : 'No matches. Try a different search.'}</p></div>}
          {selectedClip && <div className="spotlight-clip-preview"><div><strong>Text preview</strong><span><button aria-label={selectedClip.pinned ? 'Unpin item' : 'Pin item'} title={selectedClip.pinned ? 'Unpin item' : 'Pin item'} aria-pressed={selectedClip.pinned} onClick={() => { toggleClipboardPin(selectedClip.id); input.current?.focus(); }}><Pin size={15}/></button><button aria-label="Delete item" title="Delete item" onClick={() => { removeClipboardItem(selectedClip.id); input.current?.focus(); }}><Trash2 size={15}/></button><button aria-label="Copy item" title="Copy item" disabled={busy} onClick={() => run()}><Copy size={15}/></button></span></div><pre>{selectedClip.text}</pre></div>}
        </>}
        {calculationError && <p className="spotlight-message" role="status">{calculationError}</p>}
        {(searchingFiles || fileStatus) && <div className="search-status" role="status">{searchingFiles ? 'Searching workspace folders…' : fileStatus}</div>}
        {status && <div className={`spotlight-message${isError ? ' is-error' : ''}`} role={isError ? 'alert' : 'status'}>{status}</div>}
        </>}
        {conversationMode && filesPending && <div className="search-status" role="status">Checking workspace files…</div>}
        {conversationMode && !filesPending && fileStatus.startsWith('Workspace search took too long') && <div className="search-status" role="status">{fileStatus}</div>}
        <div className="search-announcement" role="status" aria-live="polite">{current ? `${current.label}, ${current.kind}` : ''}</div>
        <footer className="spotlight-footer" id="spotlight-keyboard-help"><span className="spotlight-brand">{conversationMode ? 'On-device AI' : 'Spotlight'}</span>{conversationMode ? <span className={q.length > MAX_MESSAGE_LENGTH ? 'spotlight-input-limit' : ''}>{query.length}/{MAX_MESSAGE_LENGTH}</span> : <span><kbd>↑ ↓</kbd> Navigate</span>}<span><kbd>↵</kbd> {conversationMode ? 'Send' : current?.kind === 'Clipboard' || current?.id === 'answer' ? 'Copy' : 'Open'}</span><span><kbd>esc</kbd> {q || scope !== 'all' ? 'Back' : 'Close'}</span><button aria-label="Search settings" title="Search settings" onClick={() => { close(); services.launch('lope.settings', { page: 'search' }); }}><SlidersHorizontal size={15}/></button></footer>
      </div>
    </section>
  </div>;
}
