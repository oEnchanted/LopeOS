import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface FileMenuItem { id: string; label: string; disabled?: boolean; shortcut?: string; checked?: boolean }
export function ActionMenu({ position, items, onAction, onClose }: {
  position: { x: number; y: number }; items: (FileMenuItem | null)[]; onAction: (id: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  const [point, setPoint] = useState(position);
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    setPoint({ x: Math.max(8, Math.min(position.x, innerWidth - rect.width - 8)), y: Math.max(8, Math.min(position.y, innerHeight - rect.height - 8)) });
  }, [position]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const resize = () => onClose();
    document.addEventListener('pointerdown', dismiss); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', resize); if (previous.current?.isConnected) previous.current.focus(); };
  }, [onClose]);
  return createPortal(<div ref={ref} className="files-action-menu glass" role="menu" aria-label="File actions" style={{ left: point.x, top: point.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }}>{items.map((item, index) => item ? <button type="button" key={item.id} role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} disabled={item.disabled} tabIndex={-1} onClick={() => { onClose(); onAction(item.id); }}><span>{item.checked ? '✓ ' : ''}{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button> : <div role="separator" key={index}/>)}</div>, document.querySelector('.desktop') ?? document.body);
}
