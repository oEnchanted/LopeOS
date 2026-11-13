import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return reduced;
}
/** Keep an existing surface mounted through its short closing transition. */
export function useExitPresence<T>(value: T | null, enabled: boolean) {
  const [retained, setRetained] = useState(value);
  useEffect(() => {
    if (value !== null || !enabled) { setRetained(value); return; }
    const timer = setTimeout(() => setRetained(null), 150);
    return () => clearTimeout(timer);
  }, [value, enabled]);
  return { value: value ?? (enabled ? retained : null), exiting: enabled && value === null && retained !== null };
}
/** Dialogs commit their close only after the animation; pending document work stays mounted. */
export function useAnimatedDismiss(close: () => void, root: RefObject<HTMLElement | null>) {
  const [closing, setClosing] = useState(false);
  const latest = useRef(close); latest.current = close;
  const request = useCallback(() => {
    const surface = root.current, owner = surface?.closest<HTMLElement>('.writer-app');
    const motion = owner?.dataset.motion !== 'off' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The visual closing transition must not swallow the user's next keystroke.
    if (surface?.contains(document.activeElement)) owner?.querySelector<HTMLElement>('[role="textbox"][aria-label="Document content"]')?.focus({ preventScroll: true });
    if (motion) setClosing(true); else latest.current();
  }, [root]);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => latest.current(), 140);
    return () => clearTimeout(timer);
  }, [closing]);
  return { closing, close: request };
}
