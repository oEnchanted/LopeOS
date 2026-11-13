import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ComponentPropsWithRef, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button className={`ui-button ui-button--${variant} ${className}`} {...props} />;
}
export function Input(props: ComponentPropsWithRef<'input'>) { return <input {...props} className={`ui-input ${props.className ?? ''}`} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`ui-input ${props.className ?? ''}`}/>; }
export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { return <div className="ui-empty-state"><strong>{title}</strong>{description && <p>{description}</p>}{children}</div>; }
function dialogTabStops(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]')]
    .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[hidden],[inert]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden')
    .sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
}
export function Dialog({ title, children, onClose, dismissible = true }: { title: string; children: ReactNode; onClose: () => void; dismissible?: boolean }) {
  const label = useId(); const ref = useRef<HTMLElement>(null);
  // Capture the trigger before a child's autoFocus runs during the DOM commit.
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const previous = previousFocus.current;
    const frame = requestAnimationFrame(() => {
      const dialog = ref.current;
      if (dialog && !dialog.contains(document.activeElement)) (dialogTabStops(dialog)[0] ?? dialog).focus();
    });
    return () => { cancelAnimationFrame(frame); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="ui-dialog-backdrop" onMouseDown={e => { if (dismissible && e.target === e.currentTarget) onClose(); }} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (dismissible) onClose(); }
    if (e.key === 'Tab' && ref.current) {
      e.preventDefault(); e.stopPropagation();
      const nodes = dialogTabStops(ref.current), index = nodes.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? (e.shiftKey ? nodes.length - 1 : 0) : (index + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      (nodes[next] ?? ref.current).focus();
    }
  }}><section ref={ref} className="ui-dialog glass" role="dialog" aria-modal="true" aria-labelledby={label} tabIndex={-1}><header><h2 id={label}>{title}</h2>{dismissible && <button type="button" aria-label="Close dialog" onClick={onClose}>×</button>}</header>{children}</section></div>, document.querySelector('.desktop') ?? document.body);
}
export function Toolbar({ children }: { children: ReactNode }) { return <div className="ui-toolbar" role="toolbar">{children}</div>; }
export function Sidebar({ children }: { children: ReactNode }) { return <aside className="ui-sidebar">{children}</aside>; }
export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (value: string) => void }) {
  return <div className="ui-tabs" role="tablist">{tabs.map(tab => <button key={tab} role="tab" aria-selected={value === tab} onClick={() => onChange(tab)}>{tab}</button>)}</div>;
}
export function ListRow({ children, selected, onClick }: { children: ReactNode; selected?: boolean; onClick?: () => void }) { return <button className={`ui-list-row ${selected ? 'is-selected' : ''}`} onClick={onClick}>{children}</button>; }
export function Tooltip({ children, label }: { children: ReactNode; label: string }) { return <span className="ui-tooltip" data-tooltip={label}>{children}</span>; }
export function Popover({ children, label }: { children: ReactNode; label: string }) { return <section className="ui-popover glass" aria-label={label}>{children}</section>; }
