import { useEffect, useRef, type ReactNode } from 'react';
/** Shared focus behavior for Writer's file-safety prompts. */
export function Prompt({ title, onCancel, busy = false, children }: { title: string; onCancel: () => void; busy?: boolean; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const latest = useRef({ onCancel, busy }); latest.current = { onCancel, busy };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = root.current!;
    const controls = () => [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea')];
    controls()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !latest.current.busy) { event.preventDefault(); event.stopPropagation(); latest.current.onCancel(); }
      if (event.key === 'Tab') {
        const items = controls(), index = items.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && index === items.length-1) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    node.addEventListener('keydown', handle);
    return () => { node.removeEventListener('keydown', handle); previous?.focus(); };
  }, []);
  return <div className="writer-modal-backdrop"><section ref={root} className="writer-dialog writer-small-dialog" role="dialog" aria-modal="true" aria-label={title}>{children}</section></div>;
}
