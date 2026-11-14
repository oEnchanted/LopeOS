import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../../packages/ui/src';

/** Only the trusted Selkies client is framed. Websites run top-level in remote Chromium. */
export function StreamSurface({ url, visible, muted, focusRequest = 0, onStatus, onShortcut, onActivity, onOpenHost }: {
  url: string; visible: boolean; muted: boolean; focusRequest?: number;
  onStatus: (status: string) => void; onShortcut: (event: KeyboardEvent) => boolean; onActivity: () => void; onOpenHost?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const focusedRequest = useRef(0);
  const callbacks = useRef({ onStatus, onShortcut, onActivity });
  callbacks.current = { onStatus, onShortcut, onActivity };
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const validUrl = /^\/api\/browser\/stream\/(?:[a-zA-Z0-9_-]+\/)*(?:\?[^#]*)?$/.test(url);

  useEffect(() => {
    setLoaded(false); setPlaying(false); setTimedOut(false);
    callbacks.current.onStatus('Connecting stream');
  }, [url, attempt]);

  useEffect(() => {
    if (!validUrl || playing) return;
    const timer = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(timer);
  }, [validUrl, url, attempt, playing]);

  useEffect(() => {
    if (!loaded || !validUrl) return;
    const child = frame.current?.contentWindow;
    if (!child) return;
    let stopped = false;
    let receivedFrames = false;
    let poll: ReturnType<typeof setTimeout>;
    const post = (message: object) => child.postMessage(message, location.origin);
    const ready = () => {
      if (stopped) return;
      if (!receivedFrames) post({ type: 'statsOpen', open: false });
      receivedFrames = true; setPlaying(true); setTimedOut(false);
      callbacks.current.onStatus('Streaming');
    };
    const reconnecting = () => {
      receivedFrames = false; setPlaying(false);
      callbacks.current.onStatus('Reconnecting stream');
      post({ type: 'statsOpen', open: true });
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== child) return;
      // Selkies defaults isVideoPipelineActive to true before it receives media.
      // Only presented frames establish readiness; a timer must never uncover a blank player.
      if (event.data?.type === 'stats') {
        if (event.data.data?.isVideoPipelineActive !== false && (Number(event.data.data?.clientFps) > 0 || Number(event.data.data?.latest?.client?.fps) > 0)) {
          ready();
        } else if (event.data.data?.isVideoPipelineActive === false && receivedFrames) {
          reconnecting();
        }
      } else if (event.data?.type === 'pipelineStatusUpdate' && event.data.video === false && receivedFrames) {
        reconnecting();
      }
    };
    const keydown = (event: KeyboardEvent) => {
      callbacks.current.onActivity();
      if (callbacks.current.onShortcut(event)) event.stopImmediatePropagation();
    };
    const activity = () => callbacks.current.onActivity();
    // Selkies 2.2.1 can attach its window capture listener before iframe load.
    // Reattach that input context after ours so browser shortcuts are handled once,
    // before a chord can also be forwarded to remote Chromium.
    const input = (child as Window & { webrtcInput?: {
      inputAttached: boolean; detach_context(): void; attach_context(): void;
    } }).webrtcInput;
    const reattach = input?.inputAttached && typeof input.detach_context === 'function' && typeof input.attach_context === 'function';
    if (reattach) input.detach_context();
    window.addEventListener('message', receive);
    // Selkies sends pipeline events to its own window, and stats to the parent.
    child.addEventListener('message', receive);
    child.addEventListener('keydown', keydown, true);
    child.addEventListener('pointerdown', activity, true);
    child.addEventListener('wheel', activity, { capture: true, passive: true });
    if (reattach) input.attach_context();
    post({ type: 'statsOpen', open: true });
    post({ type: 'setUseBrowserCursors', value: true });
    post({ type: 'resetResolutionToWindow' });
    // The video sink can present its first frame before the one-second FPS sample.
    const video = child.document.getElementById('videoStream') as HTMLVideoElement | null;
    const firstFrame = video?.requestVideoFrameCallback?.(ready);
    const sample = () => {
      if (stopped) return;
      post({ type: 'getStats' });
      poll = setTimeout(sample, receivedFrames ? 2000 : 250);
    };
    sample();
    return () => {
      stopped = true; clearTimeout(poll);
      if (firstFrame !== undefined) video?.cancelVideoFrameCallback(firstFrame);
      post({ type: 'statsOpen', open: false });
      window.removeEventListener('message', receive);
      child.removeEventListener('message', receive);
      child.removeEventListener('keydown', keydown, true);
      child.removeEventListener('pointerdown', activity, true);
      child.removeEventListener('wheel', activity, true);
    };
  }, [loaded, url, attempt, validUrl]);

  useEffect(() => {
    if (loaded) frame.current?.contentWindow?.postMessage({ type: 'setMute', value: muted }, location.origin);
  }, [muted, loaded, url, attempt]);
  useEffect(() => {
    if (visible && playing && focusRequest && focusedRequest.current !== focusRequest) {
      focusedRequest.current = focusRequest;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return;
      const child = frame.current?.contentWindow;
      child?.focus(); child?.document.getElementById('overlayInput')?.focus({ preventScroll: true });
    }
  }, [focusRequest, visible, playing]);

  if (!validUrl) return <div className="lb-state"><h2>Stream address unavailable</h2><p>Reconnect your browser session.</p></div>;
  return <div className={`lb-stream ${visible ? '' : 'lb-stream-hidden'}`} aria-hidden={!visible}>
    <iframe key={`${url}:${attempt}`} ref={frame} src={url} title="Website content in remote Chromium" allow="autoplay; clipboard-write"
      referrerPolicy="no-referrer" onLoad={() => setLoaded(true)}/>
    {!playing && <div className="lb-stream-cover" role="status"><div className={timedOut ? 'lb-state' : 'lb-stream-loading'}>
      {timedOut ? <><h2>The browser stream isn’t responding</h2><p>Retry the connection or continue in your device’s browser.</p><div><Button onClick={() => setAttempt(v => v + 1)}>Reconnect stream</Button>{onOpenHost && <Button variant="ghost" onClick={onOpenHost}>Open on this device</Button>}</div></>
        : <><span className="lb-spinner"/><p>Connecting your browser…</p></>}
    </div></div>}
  </div>;
}
