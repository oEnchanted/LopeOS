import { useEffect, useRef, type ReactNode, type PointerEvent } from 'react';
import { Minus, X, Maximize2, Minimize2 } from 'lucide-react';
import type { Bounds, WindowState } from '../../../../packages/contracts/src';
import { appById } from './registry';
import { preferences } from '../../../../packages/sdk/src/preferences';
import { interfaceScale, viewport, workArea } from './appearance';
import { constrainBounds, resizeBounds } from './window-geometry';
export function WindowFrame({ win, focused, fullscreen, onFocus, onClose, onMinimize, onMaximize, onFullscreen, onBounds, children }: { win: WindowState; focused: boolean; fullscreen: boolean; onFocus: () => void; onClose: () => void; onMinimize: () => void; onMaximize: () => void; onFullscreen: () => void; onBounds: (bounds: Bounds, snap?: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const cancelGesture = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelGesture.current?.(), []);
  const start = (e: PointerEvent<HTMLElement>, edge = '') => {
    if (e.button !== 0 || cancelGesture.current || viewport().width < 700 || fullscreen || win.state === 'maximized' || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault(); onFocus(); const el = ref.current!; const captureTarget = e.currentTarget;
    if (!edge) captureTarget.focus({ preventScroll: true });
    captureTarget.setPointerCapture(e.pointerId);
    const pointerId = e.pointerId;
    const scale = interfaceScale(); const area = workArea(); const origin = { x: e.clientX, y: e.clientY }, bounds = { ...win.bounds };
    let next = bounds; let frame = 0; let moved = false;
    const paint = (value: Bounds) => {
      el.style.transform = `translate3d(${value.x}px,${value.y}px,0)`;
      el.style.width = `${value.width}px`; el.style.height = `${value.height}px`;
    };
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (!moved && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 4) return;
      moved = true; el.classList.add('is-moving');
      const dx = (event.clientX - origin.x)/scale, dy = (event.clientY - origin.y)/scale;
      next = edge ? resizeBounds(bounds, edge, dx, dy, appById(win.appId)!.minSize)
        : constrainBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy });
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => paint(next));
    };
    const cleanup = () => {
      cancelAnimationFrame(frame); el.classList.remove('is-moving');
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', finish); el.removeEventListener('pointercancel', cancel);
      captureTarget.removeEventListener('lostpointercapture', cancel);
      cancelGesture.current = null;
      if (captureTarget.hasPointerCapture(pointerId)) captureTarget.releasePointerCapture(pointerId);
    };
    const cancel = () => { cleanup(); paint(bounds); };
    const finish = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      move(event); cleanup();
      if (!moved) return;
      if (!edge && event.clientY/scale <= 44) { paint(area); onMaximize(); }
      else if (!edge && (event.clientX/scale < 24 || event.clientX/scale > viewport().width - 24)) {
        const tiled = { x: event.clientX/scale < 24 ? area.x : area.x+area.width/2+4, y: area.y, width: area.width/2-4, height: area.height };
        paint(tiled); onBounds(tiled, true);
      } else {
        // React may see unchanged bounds after a drag returns to its origin.
        // Always paint the final position, including the last unpainted pointer event.
        paint(next); onBounds(next);
      }
    };
    cancelGesture.current = cancel;
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', finish); el.addEventListener('pointercancel', cancel);
    captureTarget.addEventListener('lostpointercapture', cancel);
  };
  const bounds = fullscreen ? { x: 0, y: 0, ...viewport() } : win.state === 'maximized' ? workArea() : win.bounds;
  return <section ref={ref} className={`os-window ${focused ? 'is-focused' : ''} ${win.state === 'maximized' ? 'is-maximized' : ''} ${fullscreen ? 'is-fullscreen' : ''}`} style={{ transform: `translate3d(${bounds.x}px,${bounds.y}px,0)`, width: bounds.width, height: bounds.height, zIndex: 100 + win.zIndex }} onPointerDown={onFocus} aria-label={win.title} data-window-id={win.id} data-app-id={win.appId}>
    <header className="window-titlebar" tabIndex={-1} onPointerDown={e => start(e)} onDoubleClick={e => { if (!fullscreen && !(e.target as HTMLElement).closest('button')) { const action=preferences.getSnapshot().titlebarDoubleClick;if(action==='maximize')onMaximize();else if(action==='minimize')onMinimize(); } }}>
      <div className="traffic-lights"><button className="close" aria-label={`Close ${win.title}`} onClick={onClose}><X size={9}/></button><button className="minimize" aria-label={`Minimize ${win.title}`} onClick={onMinimize}><Minus size={9}/></button><button className="maximize" aria-label={`${fullscreen ? 'Exit' : 'Enter'} full screen ${win.title}`} title={fullscreen ? 'Exit full screen (Esc)' : 'Enter full screen'} onClick={onFullscreen}>{fullscreen ? <Minimize2 size={7}/> : <Maximize2 size={7}/>}</button></div>
      <div className="window-title">{win.title}</div>
    </header>
    <div className="window-content">{children}</div>
    {['n','e','s','w','ne','nw','se','sw'].map(edge => <div key={edge} aria-hidden="true" className={`resize-handle resize-${edge}`} onPointerDown={e => start(e, edge)}/>)}
  </section>;
}
