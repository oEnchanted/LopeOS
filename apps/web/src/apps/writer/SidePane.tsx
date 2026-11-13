import { useEffect, useRef, useState, type PointerEvent, type CSSProperties } from 'react';
import { Check, ChevronDown, ChevronUp, MessageSquare, Search, X } from 'lucide-react';
import { WriterEngine, assertReceipt, type WriterSnapshot } from '../../../../../packages/document-engine/src';
import type { PaneKind } from './index';

type Props = {
  exiting?: boolean; kind: Exclude<PaneKind, null>; engine: WriterEngine | null; snapshot: WriterSnapshot;
  close: () => void; navigationTab: string; setNavigationTab: (tab: string) => void;
  perform: (action: () => unknown | Promise<unknown>) => Promise<void>;
};
type Heading = { nodeId: string; textPreview: string | null; headingLevel?: number };
type TextMatch = Extract<Awaited<ReturnType<WriterEngine['api']['query']['match']>>['items'][number], { matchKind: 'text' }>;

export function SidePane({ exiting = false, kind, engine, snapshot, close, navigationTab, setNavigationTab, perform }: Props) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [results, setResults] = useState<TextMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [activeResult, setActiveResult] = useState(0);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [commentFilter, setCommentFilter] = useState('All');
  const [width, setWidth] = useState(kind === 'navigation' ? 275 : 310);
  const [canReplaceAll, setCanReplaceAll] = useState(false);
  const resultRevision = useRef(-1);
  const root = useRef<HTMLElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const editable = snapshot.state?.documentMode !== 'viewing';

  useEffect(() => {
    if (!engine?.ui || !snapshot.ready || kind !== 'navigation') return;
    return engine.ui.search.observe(s => setCanReplaceAll(s.canReplaceAll));
  }, [engine, snapshot.ready, kind]);
  useEffect(() => {
    if (kind === 'navigation') queryInput.current?.focus();
  }, [kind, navigationTab]);
  useEffect(() => {
    if (!engine?.ui || kind !== 'navigation' || !snapshot.ready) return;
    let active = true;
    setSearching(Boolean(query)); setResults([]); setTotal(0);
    engine.ui.search.find(query, { caseSensitive: matchCase });
    const timer = setTimeout(async () => {
      if (!query) { setSearching(false); return; }
      try {
        const revision = engine.snapshot.revision;
        const found = await engine.api.query.match({ select: { type: 'text', pattern: query, caseSensitive: matchCase }, limit: 1000 });
        if (!active || revision !== engine.snapshot.revision) return;
        resultRevision.current = revision;
        setResults(found.items.filter((item): item is TextMatch => item.matchKind === 'text'));
        setTotal(found.total); setActiveResult(0);
      } catch (cause) { if (active) void perform(() => { throw cause; }); }
      finally { if (active) setSearching(false); }
    }, 160);
    return () => { active = false; clearTimeout(timer); };
  }, [engine, query, matchCase, kind, snapshot.ready, snapshot.revision]);
  useEffect(() => {
    let active = true;
    if (kind === 'navigation' && snapshot.ready) void Promise.resolve(engine?.api.blocks.list({ nodeTypes: ['heading'], limit: 1000 }))
      .then(s => { if (active) setHeadings(s?.blocks || []); }).catch(() => {});
    return () => { active = false; };
  }, [engine, kind, snapshot.ready, snapshot.revision]);

  async function action(id: string, task: () => unknown | Promise<unknown>) {
    if (pending) return;
    setPending(id);
    await perform(task);
    setPending(null);
  }
  async function go(index: number) {
    const match = results[index];
    if (!engine?.ui || !match || resultRevision.current !== engine.snapshot.revision) return;
    setActiveResult(index);
    assertReceipt(await engine.ui.selection.applyAndWait(match.target));
    const block = match.blocks[0];
    assertReceipt(await engine.ui.viewport.scrollIntoView({ target: { kind: 'text', blockId: block.blockId, range: block.range }, behavior: 'instant' }));
  }
  function resize(event: PointerEvent<HTMLDivElement>) {
    drag.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
  }
  const maxWidth = () => Math.max(220, Math.min(460, (root.current?.parentElement?.clientWidth || 900) * .4));
  const title = { navigation: 'Navigation', styles: 'Styles', comments: 'Comments', review: 'Revisions' }[kind];
  const threads = snapshot.state?.comments.items.filter(c => !c.parentCommentId) || [];
  const visibleThreads = threads.filter(c => commentFilter === 'All' || (commentFilter === 'Resolved' ? c.status === 'resolved' : c.status !== 'resolved'));
  const revisions = snapshot.state?.trackChanges.items || [];
  const closePane = () => { if (kind === 'navigation') engine?.ui?.search.close(); close(); engine?.focus(); };
  return <aside ref={root} className={`writer-side-pane wr-pane-${kind} ${exiting ? 'wr-pane-exiting' : ''}`} onFocusCapture={() => { if (exiting) engine?.focus(); }} aria-label={`${title} pane`} style={{ width, '--wr-pane-width': `${width}px` } as CSSProperties}>
    <div className="wr-pane-resizer" role="separator" aria-label={`Resize ${title} pane`} aria-orientation="vertical" tabIndex={0} aria-valuemin={220} aria-valuemax={Math.round(maxWidth())} aria-valuenow={Math.round(width)}
      onPointerDown={resize} onPointerMove={e => { if (drag.current) setWidth(Math.max(220, Math.min(maxWidth(), drag.current.width + (e.clientX - drag.current.x) * (kind === 'navigation' ? 1 : -1)))); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const direction = (e.key === 'ArrowRight' ? 1 : -1) * (kind === 'navigation' ? 1 : -1); setWidth(w => Math.max(220, Math.min(maxWidth(), w + direction * 20))); } }}/>
    <header><h2>{title}</h2><button aria-label={`Close ${title} pane`} onClick={closePane}><X size={16}/></button></header>
    <div className="wr-pane-content">
      {kind === 'navigation' && <>
        <div className="wr-navigation-search"><input ref={queryInput} aria-label="Search document" placeholder="Search document" value={query}
          onChange={e => { setQuery(e.target.value); if (e.target.value && navigationTab !== 'Replace') setNavigationTab('Results'); }}
          onKeyDown={e => { if (e.key === 'Enter' && results.length) { e.preventDefault(); void perform(() => go((activeResult + (e.shiftKey ? -1 : 1) + results.length) % results.length)); } }}/><Search size={16}/></div>
        <div className="wr-navigation-tabs" role="tablist" aria-label="Navigation views">{['Headings','Pages','Results','Replace'].map(tab => <button key={tab} role="tab" aria-selected={navigationTab === tab} className={navigationTab === tab ? 'selected' : ''} onClick={() => setNavigationTab(tab)}>{tab}</button>)}</div>
        {navigationTab === 'Headings' && <div className="wr-headings">{headings.length ? headings.map(h => <button key={h.nodeId} style={{ paddingLeft: 16 + ((h.headingLevel || 1)-1)*14 }} onClick={() => void perform(() => engine?.navigateToText(h.nodeId))}>{h.textPreview || '(Blank heading)'}</button>) : <p>Apply a heading style to organize your document here.</p>}</div>}
        {navigationTab === 'Pages' && <div className="wr-page-list">{Array.from({ length: Math.min(snapshot.pages,100) }, (_, i) => <button key={i} aria-current={snapshot.page === i+1 ? 'page' : undefined} onClick={() => engine?.goToPage(i+1)}><span>{i+1}</span><small>Page {i+1}</small></button>)}</div>}
        {(navigationTab === 'Results' || navigationTab === 'Replace') && <>
          <div className="wr-search-summary" role="status"><span>{query ? searching ? 'Searching…' : total ? `${activeResult+1} of ${total} results` : 'No results found.' : 'Search for words in your document.'}</span>
            <button aria-label="Previous result" disabled={!results.length || searching} onClick={() => void perform(() => go((activeResult - 1 + results.length) % results.length))}><ChevronUp size={15}/></button>
            <button aria-label="Next result" disabled={!results.length || searching} onClick={() => void perform(() => go((activeResult + 1) % results.length))}><ChevronDown size={15}/></button></div>
          <label className="wr-match-case"><input type="checkbox" checked={matchCase} onChange={e => setMatchCase(e.target.checked)}/>Match case</label>
          {navigationTab === 'Replace' && <div className="wr-replace"><input aria-label="Replace with" placeholder="Replace with" value={replacement} onChange={e => setReplacement(e.target.value)}/><div>
            <button disabled={!editable || !results.length || searching || Boolean(pending)} onClick={() => void action('replace', async () => { if (!engine || resultRevision.current !== engine.snapshot.revision) throw new Error('Search results changed. Search again before replacing.'); await engine.invoke('replace', { target: results[activeResult].target, text: replacement }); })}>{pending === 'replace' ? 'Replacing…' : 'Replace'}</button>
            <button disabled={!canReplaceAll || searching || Boolean(pending)} onClick={() => void action('replace-all', async () => { assertReceipt(await engine?.ui?.search.replaceAll(replacement)); })}>Replace All</button>
          </div></div>}
          <div className="wr-search-results" aria-label="Search results">{results.map((match, index) => <button key={match.id} className={`wr-search-result ${activeResult === index ? 'selected' : ''}`} aria-label={`Result ${index+1}: ${match.snippet}`} onClick={() => void perform(() => go(index))}>
            <span>{match.snippet.slice(0,match.highlightRange.start)}<mark>{match.snippet.slice(match.highlightRange.start,match.highlightRange.end)}</mark>{match.snippet.slice(match.highlightRange.end)}</span>
          </button>)}</div>{total > results.length && <p className="wr-pane-description">Showing the first {results.length} results. Narrow your search to find more.</p>}
        </>}
      </>}
      {kind === 'styles' && <>
        <p className="wr-pane-description">Apply a style to the selected text.</p>
        <div className="wr-pane-styles">{[['Normal','Normal'],['NoSpacing','No Spacing'],['Heading1','Heading 1'],['Heading2','Heading 2'],['Heading3','Heading 3'],['Title','Title']].map(([id,name]) => <button key={id} className={snapshot.state?.styles.activeParagraphStyleId === id ? 'selected' : ''} disabled={!editable} style={{ fontSize: id === 'Title' ? 25 : id.startsWith('Heading') ? 18 : 13, color: id.startsWith('Heading') ? '#0f4761' : '#222' }} onMouseDown={e => e.preventDefault()} onClick={() => void perform(async () => { await engine?.command('linked-style', id); engine?.focus(); })}>{name}{snapshot.state?.styles.activeParagraphStyleId === id && <Check size={14}/>}</button>)}</div>
        <button className="wr-pane-action" disabled={!editable} onClick={() => void perform(async () => { assertReceipt(await engine?.ui?.styles.updateToMatchSelection()); })}>Update current style to match selection</button>
      </>}
      {kind === 'comments' && <>
        <div className="wr-comment-filters" aria-label="Filter comments">{['All','Active','Resolved'].map(filter => <button key={filter} aria-pressed={filter === commentFilter} className={filter === commentFilter ? 'selected' : ''} onClick={() => setCommentFilter(filter)}>{filter}</button>)}</div>
        <p className="wr-pane-description">{visibleThreads.length ? `${visibleThreads.length} ${visibleThreads.length === 1 ? 'thread' : 'threads'}` : commentFilter === 'All' ? 'Select text and choose New Comment on Review to start a conversation.' : `No ${commentFilter.toLowerCase()} comments.`}</p>
        {!threads.length && <div className="wr-pane-empty"><MessageSquare size={32}/><strong>No comments yet</strong></div>}
        <div className="wr-comment-list">{visibleThreads.map(c => <article key={c.id} className={`wr-comment ${c.status === 'resolved' ? 'resolved' : ''} ${snapshot.state?.selection.activeCommentIds.includes(c.id) ? 'is-current' : ''}`}>
          <div className="wr-comment-author"><span>{(c.creatorName || 'Document author')[0].toUpperCase()}</span><strong>{c.creatorName || 'Document author'}</strong><small>{c.status === 'resolved' ? 'Resolved' : 'Comment'}</small></div><p>{c.text}</p>
          <div className="wr-thread-actions"><button disabled={Boolean(pending)} onClick={() => void action(c.id, async () => { assertReceipt(await engine?.ui?.comments.scrollTo(c.id)); })}>Show in document</button><button disabled={Boolean(pending) || !editable} onClick={() => void action(c.id, async () => { assertReceipt(await (c.status === 'resolved' ? engine?.ui?.comments.reopen(c.id) : engine?.ui?.comments.resolve(c.id))); })}>{c.status === 'resolved' ? 'Reopen' : 'Resolve'}</button></div>
          {snapshot.state?.comments.items.filter(r => r.parentCommentId === c.id).map(r => <div key={r.id} className="wr-comment-reply"><strong>{r.creatorName || 'Document author'}</strong><p>{r.text}</p></div>)}
          {c.status !== 'resolved' && <form onSubmit={e => { e.preventDefault(); const value = reply[c.id]?.trim(); if (!value) return; void action(c.id, async () => { assertReceipt(await engine?.ui?.comments.reply(c.id, { text: value })); setReply(current => ({ ...current, [c.id]: '' })); }); }}><input aria-label={`Reply to comment ${c.id}`} placeholder="Reply…" disabled={!editable || Boolean(pending)} value={reply[c.id] || ''} onChange={e => setReply(current => ({ ...current, [c.id]: e.target.value }))}/><button type="submit" disabled={!editable || !reply[c.id]?.trim() || Boolean(pending)}>Reply</button></form>}
        </article>)}</div>
      </>}
      {kind === 'review' && <>
        <p className="wr-pane-description">{snapshot.state?.trackChanges.total || 0} changes</p>
        {!revisions.length && <div className="wr-pane-empty"><Check size={32}/><strong>No tracked changes</strong><span>Changes appear here when Track Changes is on.</span></div>}
        <div className="wr-revision-list">{revisions.map(c => <article key={c.id}><strong>{c.type || 'Change'}</strong><p>{c.excerpt || 'Formatting or text change'}</p><div>
          <button disabled={Boolean(pending)} onClick={() => void action(c.id, async () => { assertReceipt(await engine?.ui?.trackChanges.scrollTo(c.id)); })}>Show</button>
          <button disabled={!editable || Boolean(pending)} onClick={() => void action(c.id, async () => { assertReceipt(await engine?.ui?.trackChanges.acceptAsync(c.id)); })}><Check size={13}/>Accept</button>
          <button disabled={!editable || Boolean(pending)} onClick={() => void action(c.id, async () => { assertReceipt(await engine?.ui?.trackChanges.rejectAsync(c.id)); })}><X size={13}/>Reject</button>
        </div></article>)}</div>
      </>}
    </div>
  </aside>;
}
