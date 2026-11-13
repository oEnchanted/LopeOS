import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Copy, Cpu, Download, HardDrive, LoaderCircle, MessageCircle, RotateCcw, Trash2 } from 'lucide-react';
import { spotlightAI, MODEL_DOWNLOAD_LABEL, MODEL_NAME } from './spotlight-ai/service';
import { copyClipboardText } from './system';

export function SpotlightChat({ onPrompt, focusInput }: { onPrompt: (text: string) => void; focusInput: () => void }) {
  const state = useSyncExternalStore(spotlightAI.subscribe, spotlightAI.getSnapshot);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');
  const [options, setOptions] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastMessage = state.messages.at(-1);
  const loading = state.phase === 'loading' || state.phase === 'checking';
  const generating = state.phase === 'generating';

  useEffect(() => {
    void spotlightAI.checkSupport();
  }, []);
  useEffect(() => {
    if (follow.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [state.messages, state.phase]);
  useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(''), 1800); return () => window.clearTimeout(timer); }, [copied]);

  async function copy(id: string, content: string) {
    focusInput();
    try { await copyClipboardText(content); setCopied(id); setNotice('Reply copied.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'The reply could not be copied.'); }
  }
  function reset() { spotlightAI.clearChat(); setNotice(''); follow.current = true; onPrompt(''); }
  function stop() { spotlightAI.stop(); focusInput(); }
  const ready = state.modelLoaded && ['ready', 'generating'].includes(state.phase);

  return <div className="spotlight-chat" id="spotlight-chat-conversation">
    <header className="spotlight-chat-heading">
      <div className="spotlight-chat-identity"><span className="spotlight-chat-symbol"><MessageCircle size={18}/></span><div><strong>Spotlight</strong><small><span className={`spotlight-ai-dot${ready ? ' is-ready' : ''}`}/>{generating ? 'Generating reply…' : state.phase === 'resetting' ? 'Clearing conversation…' : ready ? 'Model ready' : 'Model not loaded'}</small></div></div>
      <div className="spotlight-chat-tools">
        {state.messages.length > 0 && <button title="New chat" aria-label="New chat" onClick={reset}><MessageCircle size={16}/></button>}
        <button title="Model options" aria-label="Model options" aria-expanded={options} onClick={() => setOptions(value => !value)}><Cpu size={17}/></button>
      </div>
    </header>
    {options && <div className="spotlight-model-options glass-inset">
      <div><strong>{MODEL_NAME}</strong><p>{MODEL_DOWNLOAD_LABEL} download. Uses your browser’s graphics support. Replies and conversation history stay in this tab.</p></div>
      <div className="spotlight-model-controls">
        <button disabled={!state.modelLoaded || state.phase === 'removing'} onClick={() => { spotlightAI.unload(); focusInput(); }}><Cpu size={14}/>Unload model</button>
        <button disabled={loading || generating || state.phase === 'removing'} onClick={() => { focusInput(); void spotlightAI.removeModel(); }}><Trash2 size={14}/>Remove download</button>
      </div>
    </div>}

    {state.messages.length > 0 ? <div className="spotlight-chat-thread" role="region" aria-label="Spotlight conversation" ref={thread} onScroll={() => { const element = thread.current; if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48; }}>
      {state.messages.map(message => <article key={message.id} className={`spotlight-chat-message is-${message.role}`} aria-label={message.role === 'user' ? 'You' : 'Spotlight reply'}>
        <span className="spotlight-chat-speaker">{message.role === 'user' ? 'You' : <><MessageCircle size={12}/>Spotlight</>}</span>
        <div className="spotlight-chat-content" dir="auto">{message.content || (generating && lastMessage?.id === message.id ? <span className="spotlight-thinking"><span/><span/><span/></span> : 'No reply generated.')}</div>
        {message.role === 'assistant' && message.content && <div className="spotlight-reply-actions"><button aria-label="Copy reply" onClick={() => void copy(message.id, message.content)}>{copied === message.id ? <Check size={13}/> : <Copy size={13}/>}<span>{copied === message.id ? 'Copied' : 'Copy'}</span></button>{message.stopped && <small>Stopped</small>}</div>}
      </article>)}
    </div> : <div className="spotlight-chat-welcome">
      <div className="spotlight-chat-orbit"><MessageCircle size={32} strokeWidth={1.4}/></div>
      <h2>Spotlight chat</h2>
      <p>{ready ? 'Type a message above to start a conversation.' : state.phase === 'unsupported' ? 'Chat requires a browser that supports the local model.' : 'Download the AI model to chat in your browser.'}</p>
    </div>}

    {loading && <div className="spotlight-model-loading" role="status"><div><LoaderCircle size={15} className="spotlight-ai-spinner"/><span>{state.phase === 'checking' ? 'Checking browser support…' : 'Loading model…'}</span><button onClick={stop}>Cancel download</button></div>{state.phase === 'loading' && <progress aria-label="Model download progress" max={1} value={state.progress}/>}<small>{state.status}</small></div>}
    {state.phase === 'unsupported' && <div className="spotlight-chat-unavailable" role="status"><Cpu size={20}/><div><strong>This browser can’t run the local model.</strong><p>{state.error || state.status || 'Use a browser with WebGPU and hardware acceleration enabled, on HTTPS or localhost.'}</p><button onClick={() => { focusInput(); void spotlightAI.checkSupport(); }}>Check again</button></div></div>}
    {!state.modelLoaded && !loading && state.phase !== 'unsupported' && state.phase !== 'removing' && <div className="spotlight-model-setup glass-inset"><div><HardDrive size={17}/><span><strong>{MODEL_NAME}</strong><small>{MODEL_DOWNLOAD_LABEL} download</small></span></div><button className="spotlight-primary" aria-label="Download model" onClick={() => { focusInput(); void spotlightAI.initialize(); }}><Download size={15}/>{state.phase === 'error' ? 'Try download again' : 'Download model'}</button></div>}
    {state.phase === 'removing' && <p className="spotlight-chat-status" role="status">Removing the model download…</p>}
    {state.error && state.phase !== 'unsupported' && <div className="spotlight-chat-error" role="alert">{state.error}</div>}
    {(generating || ready && state.messages.length > 0) && <div className="spotlight-chat-response-controls">{generating ? <span role="status">Replying…</span> : <button onClick={() => { focusInput(); follow.current = true; void spotlightAI.retry(); }}><RotateCcw size={13}/>Retry response</button>}</div>}
    {notice && <p className="spotlight-chat-status" role="status">{notice}</p>}
    <div className="spotlight-chat-note"><Cpu size={12}/><span>{ready ? 'Local AI · no live web access · answers may be inaccurate' : 'Messages are processed on this device.'}</span></div>
    <span className="search-announcement" role="status" aria-live="polite" aria-atomic="true">{generating ? 'Spotlight is replying.' : lastMessage?.role === 'assistant' && lastMessage.content ? `Spotlight: ${lastMessage.content}` : ''}</span>
  </div>;
}
