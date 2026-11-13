import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApp, useCommand, type AppContext } from '../../sdk/src';
import { Button, Dialog, Input, Sidebar, Toolbar } from '../../ui/src';
import type { FileEntry } from '../../contracts/src';
import './example.css';

/** The shell supplies AppProvider and an isolated application error boundary. */
export default function ExampleApp(_props: { context: AppContext }) {
  const draftId = useId();
  const { services, lifecycle } = useApp();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [state, setState] = useState<'loading' | 'empty' | 'error' | 'success'>('loading');
  const [message, setMessage] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const active = useRef(true);
  const generation = useRef(0);
  const compact = useSyncExternalStore(services.settings.subscribe.bind(services.settings), () => services.settings.get('example.compact', false));
  const refresh = useCallback(async () => {
    const id = ++generation.current; setState('loading');
    try {
      const files = await services.files.list('/Documents');
      if (!active.current || id !== generation.current) return;
      setEntries(files); setState(files.length ? 'success' : 'empty'); setMessage('');
    } catch (error) {
      if (active.current && id === generation.current) { setState('error'); setMessage(error instanceof Error ? error.message : 'Could not load Documents.'); }
    }
  }, [services.files]);
  useEffect(() => {
    active.current = true; lifecycle.setTitle('Example Notes'); void refresh();
    const unsubscribe = services.files.subscribe(() => { void refresh(); });
    return () => { active.current = false; generation.current++; unsubscribe(); };
  }, [lifecycle, refresh, services.files]);
  async function save() {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      const path = await services.dialogs.saveFile({ defaultName: 'Example.txt' });
      if (!path || !active.current) return;
      const files = services.files as typeof services.files & { writeBinary?: (path: string, data: Uint8Array, options: { createOnly: boolean }) => Promise<unknown> };
      if (!files.writeBinary) throw new Error('The shared filesystem does not support atomic file creation.');
      await files.writeBinary(path, new TextEncoder().encode(text), { createOnly: true });
      if (active.current) { setMessage('Your note was saved.'); setText(''); await refresh(); services.notify({ title: 'Example Notes', message: 'Saved to your workspace.', tone: 'success' }); }
    } catch (error) { if (active.current) { setState('error'); setMessage(error instanceof Error ? error.message : 'Could not save this note.'); } }
    finally { if (active.current) setBusy(false); }
  }
  useCommand(useMemo(() => ({ id: 'example.refresh', label: 'Refresh', shortcut: 'Mod+R', enabled: !busy, execute: refresh }), [busy, refresh]));
  useCommand(useMemo(() => ({ id: 'example.save', label: 'Save Note…', shortcut: 'Mod+S', enabled: Boolean(text.trim()) && !busy, execute: save }), [text, busy, services]));
  useCommand(useMemo(() => ({ id: 'example.clear', label: 'Clear Draft', enabled: Boolean(text) && !busy, execute: () => setText('') }), [text, busy]));
  useCommand(useMemo(() => ({ id: 'example.compact', label: 'Compact View', checked: compact, execute: () => services.settings.set('example.compact', !compact) }), [compact, services.settings]));
  return <div className={`lope-example ${compact ? 'compact' : ''}`}>
    <Sidebar><strong>Example Notes</strong><Button onClick={() => { void refresh(); }}>Documents</Button><Button onClick={() => setHelp(true)}>About this example</Button></Sidebar>
    <div className="example-main"><Toolbar><strong>New note</strong><Button disabled={busy || !text.trim()} onClick={() => { void save(); }}>Save note…</Button></Toolbar><div className="example-content">
      <form onSubmit={event => { event.preventDefault(); void save(); }}><label htmlFor={draftId}>Note<Input id={draftId} value={text} maxLength={10000} disabled={busy} onChange={event => setText(event.target.value)} placeholder="Enter note text"/></label><Button type="submit" disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Save to workspace'}</Button></form>
      {state === 'loading' && <p role="status">Loading Documents…</p>}
      {state === 'empty' && <p>Your Documents folder is empty. Write a note to begin.</p>}
      {state === 'error' && <div role="alert"><p>{message}</p><Button onClick={() => { void refresh(); }}>Try again</Button></div>}
      {state === 'success' && <><p role="status">{message || `${entries.length} items in Documents.`}</p><ul>{entries.map(entry => <li key={entry.path}>{entry.name}</li>)}</ul></>}
    </div></div>
    {help && <Dialog title="About Example Notes" onClose={() => setHelp(false)}><p>This app uses the shared SDK, commands, preferences, filesystem, controls, and dialogs. The shell owns its window and isolates render failures.</p><Button onClick={() => setHelp(false)}>Done</Button></Dialog>}
  </div>;
}
