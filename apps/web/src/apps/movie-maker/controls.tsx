import { useEffect, useState, useRef, type ReactNode, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { LucideProps } from 'lucide-react';

export function RibbonButton({ icon: Icon, children, onClick, disabled, active, compact, title }: {
  icon?: ComponentType<LucideProps>; children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; compact?: boolean; title?: string;
}) {
  return <button type="button" className={`mm-action ${compact ? 'mm-action-small' : ''}`} title={title || (typeof children === 'string' ? children : undefined)} disabled={disabled} aria-pressed={active} onClick={onClick}>
    {Icon && <Icon size={compact ? 16 : 27} strokeWidth={1.6}/>}<span>{children}</span>
  </button>;
}
export function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return <section className="mm-ribbon-group" aria-label={label}><div className="mm-ribbon-group-body">{children}</div><span className="mm-group-label">{label}</span></section>;
}
export function NumberField({ label, value, onChange, min = 0, max = 100000, step = .1, suffix = '', disabled = false }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  useEffect(() => setDraft(String(Number(value.toFixed(3)))), [value]);
  function commit() { const next = Number(draft); if (draft.trim() && Number.isFinite(next) && next >= min && next <= max) { if (Math.abs(next - value) > .00001) onChange(next); } else setDraft(String(Number(value.toFixed(3)))); }
  return <label className="mm-field"><span>{label}</span><span><input type="number" aria-label={label} disabled={disabled} value={draft} min={min} max={max} step={step} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { commit(); event.currentTarget.blur(); } }}/>{suffix}</span></label>;
}
export function Choice({ label, value, onChange, options, disabled = false }: { label: string; value: string | number; onChange: (value: string) => void; options: readonly (string | readonly [string, string])[]; disabled?: boolean }) {
  return <label className="mm-field"><span>{label}</span><select aria-label={label} disabled={disabled} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => { const [key, text] = typeof option === 'string' ? [option, option] : option; return <option key={key} value={key}>{text}</option>; })}</select></label>;
}
export function Waveform({ values, label = 'Audio waveform' }: { values?: number[]; label?: string }) {
  if (!values?.length) return null;
  return <svg className="mm-waveform" viewBox="0 0 200 24" preserveAspectRatio="none" role="img" aria-label={label}>{values.slice(0, 100).map((value, index, all) => <path key={index} d={`M${index * 200 / all.length} ${12 - Math.max(1, value * 11)}v${Math.max(2, value * 22)}`} stroke="currentColor" strokeWidth="1.5"/>)}</svg>;
}

export interface GalleryItem { id: string; label: string; group: string }
export function RibbonGallery({ label, items, value, onChange, render, disabled, count = 4 }: { label: string; items: readonly GalleryItem[]; value?: string; onChange: (id: string) => void; render?: (item: GalleryItem) => ReactNode; disabled?: boolean; count?: number }) {
  const [open, setOpen] = useState(false); const [position, setPosition] = useState({ left: 0, top: 0 }); const trigger = useRef<HTMLButtonElement>(null); const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const close = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); }; window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close); }, [open]);
  function choose(id: string) { onChange(id); setOpen(false); trigger.current?.focus(); }
  function tile(item: GalleryItem) { return <button key={item.id} disabled={disabled} title={item.label} aria-pressed={value === item.id} onClick={() => choose(item.id)}><span className={`mm-gallery-art preset-${item.id}`}>{render ? render(item) : item.id === 'none' ? '—' : item.label.includes('left') ? '←' : item.label.includes('right') ? '→' : item.label.includes('up') ? '↑' : item.label.includes('down') ? '↓' : '◈'}</span><span>{item.label}</span></button>; }
  const selected = items.findIndex(item => item.id === value); const first = selected >= count ? Math.floor(selected / count) * count : 0;
  return <div className="mm-ribbon-gallery"><div className="mm-gallery" aria-label={label}>{items.slice(first, first + count).map(tile)}</div><button className="mm-gallery-more" ref={trigger} disabled={disabled} aria-label={`More ${label.toLowerCase()}`} aria-expanded={open} onClick={() => { const rect = trigger.current!.getBoundingClientRect(); setPosition({ left: Math.max(8, Math.min(innerWidth - 450, rect.right - 440)), top: Math.min(innerHeight - 330, rect.bottom + 5) }); setOpen(!open); }}><ChevronDown size={13}/></button>
    {open && createPortal(<div ref={panel} className="mm-gallery-popup glass" role="dialog" aria-label={label} style={position} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}><strong>{label}</strong>{[...new Set(items.map(item => item.group))].map(group => <section key={group}><h4>{group}</h4><div className="mm-gallery">{items.filter(item => item.group === group).map(tile)}</div></section>)}</div>, document.querySelector('.desktop') || document.body)}
  </div>;
}
