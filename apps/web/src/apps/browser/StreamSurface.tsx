import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../../packages/ui/src';

/** Only the trusted Selkies client is framed. Websites run top-level in remote Chromium. */
export function StreamSurface({ url, visible, muted, onStatus, onShortcut, onActivity }: {
  url: string; visible: boolean; muted: boolean; onStatus: (status: string) => void; onShortcut: (event: KeyboardEvent) => boolean; onActivity: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const validUrl = url.startsWith('/api/browser/stream/') && !url.includes('..');
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'pipelineStatusUpdate' && typeof event.data.video === 'boolean') {
        setPlaying(event.data.video); if (event.data.video) { setTimedOut(false); onStatus('Streaming'); }
      }
      // Selkies 2.2 reports its pipeline through stats replies instead of pipelineStatusUpdate.
      if (event.data?.type === 'stats' && (event.data.data?.isVideoPipelineActive === true || Number(event.data.data?.clientFps) > 0)) {
        setPlaying(true); setTimedOut(false); onStatus('Streaming');
        frame.current?.contentWindow?.postMessage({ type: 'statsOpen', open: false }, location.origin);
      }
      if (event.data?.type === 'clientRoleUpdate') onStatus('Connecting stream');
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [onStatus]);
  useEffect(() => {
    setLoaded(false); setPlaying(false); setTimedOut(false);
    const timer = setTimeout(() => setTimedOut(true), 15000); return () => clearTimeout(timer);
  }, [url, attempt]);
  useEffect(() => {
    if (loaded) frame.current?.contentWindow?.postMessage({ type: 'setMute', value: muted }, location.origin);
  }, [muted, loaded]);
  useEffect(() => {
    if (!loaded || playing) return;
    const child = frame.current?.contentWindow;
    child?.postMessage({ type: 'statsOpen', open: true }, location.origin);
    const poll = setInterval(() => child?.postMessage({ type: 'getStats' }, location.origin), 1000);
    // Never hold a loaded stream behind the connecting state if stats are not reported.
    const fallback = setTimeout(() => { setPlaying(true); setTimedOut(false); onStatus('Streaming'); }, 8000);
    return () => { clearInterval(poll); clearTimeout(fallback); };
  }, [loaded, playing, onStatus]);
  useEffect(() => {
    if (!loaded) return;
    const child = frame.current?.contentWindow;
    const keydown = (event: KeyboardEvent) => { if (onShortcut(event)) event.stopImmediatePropagation(); };
    child?.addEventListener('keydown', keydown, true);
    child?.addEventListener('pointerdown', onActivity, true); child?.addEventListener('wheel', onActivity, true);
    return () => { child?.removeEventListener('keydown', keydown, true); child?.removeEventListener('pointerdown', onActivity, true); child?.removeEventListener('wheel', onActivity, true); };
  }, [loaded, onShortcut, onActivity]);
  if (!validUrl) return <div className="lb-state"><h2>Stream address unavailable</h2><p>Reconnect your browser session.</p></div>;
  return <div className={`lb-stream ${visible ? '' : 'lb-stream-hidden'}`} aria-hidden={!visible}>
    <iframe key={attempt} ref={frame} src={url} title="Website content in remote Chromium" allow="autoplay; clipboard-write"
      referrerPolicy="no-referrer" onLoad={() => { setLoaded(true);
        frame.current?.contentWindow?.postMessage({ type: 'resetResolutionToWindow' }, location.origin);
        frame.current?.contentWindow?.postMessage({ type: 'setMute', value: muted }, location.origin);
      }} />
    {!playing && <div className="lb-stream-cover" role="status"><div className={timedOut ? 'lb-state' : 'lb-stream-loading'}>
      {timedOut ? <><h2>The browser stream isn’t responding</h2><p>Check the browser runtime connection, then retry.</p><Button onClick={() => setAttempt(v => v + 1)}>Reconnect stream</Button></>
        : <><span className="lb-spinner"/><p>Connecting your browser…</p></>}
    </div></div>}
  </div>;
}
