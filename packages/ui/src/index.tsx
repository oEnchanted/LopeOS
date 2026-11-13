import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ComponentPropsWithRef, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button className={`ui-button ui-button--${variant} ${className}`} {...props} />;
}
export function Input(props: ComponentPropsWithRef<'input'>) { return <input {...props} className={`ui-input ${props.className ?? ''}`} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`ui-input ${props.className ?? ''}`}/>; }
export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { return <div className="ui-empty-state"><strong>{title}</strong>{description && <p>{description}</p>}{children}</div>; }
export function Dialog({ title, children, onClose, dismissible = true }: { title: string; children: ReactNode; onClose: () => void; dismissible?: boolean }) {
  const label = useId(); const ref = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; const frame = requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>('input:not([hidden]):not(:disabled),button:not(:disabled),select,textarea,[tabindex="0"]') ?? ref.current)?.focus()); return () => { cancelAnimationFrame(frame); if (previous?.isConnected) previous.focus(); }; }, []);
  return createPortal(<div className="ui-dialog-backdrop" onMouseDown={e => { if (dismissible && e.target === e.currentTarget) onClose(); }} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (dismissible) onClose(); }
    if (e.key === 'Tab') { const nodes = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([hidden]),select,textarea,[tabindex="0"]')]; const first = nodes[0], last = nodes.at(-1); if (!first) { e.preventDefault(); ref.current?.focus(); } else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
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
