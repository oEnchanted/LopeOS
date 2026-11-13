import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Binary, Calculator, Check, ChevronDown, ListOrdered, NotebookPen, Radical } from 'lucide-react';

export type CalculatorMode = 'basic' | 'scientific' | 'programmer' | 'notes';
const MODE_NAMES = { basic: 'Basic', scientific: 'Scientific', programmer: 'Programmer', notes: 'Math Notes' };

export function ModeMenu({ mode, onMode, convert, onConvert, rpn, onRpn }: {
  mode: CalculatorMode; onMode: (mode: CalculatorMode) => void;
  convert: boolean; onConvert: () => void; rpn: boolean; onRpn: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const canModify = mode === 'basic' || mode === 'scientific';
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    (menu.current?.querySelector<HTMLElement>('[aria-checked=true]') || menu.current?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  return <div className="calculator-mode-picker">
    <button ref={trigger} type="button" className="calculator-mode-trigger" aria-label="Calculator mode" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setOpen(true); }
    }}><span>{MODE_NAMES[mode]}</span>{rpn && <span className="calculator-mode-badge">RPN</span>}{mode === 'programmer' && <span className="calculator-mode-badge" title="64-bit signed integer">64-bit</span>}<ChevronDown size={12}/></button>
    {open && <div ref={menu} className="calculator-mode-menu" role="menu" aria-label="Calculator modes" onKeyDown={event => {
      event.stopPropagation();
      const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const active = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'Tab') { trigger.current?.focus(); setOpen(false); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      {([{ id: 'basic', Icon: Calculator }, { id: 'scientific', Icon: Radical }, { id: 'programmer', Icon: Binary }] as const).map(({ id, Icon }) => <button key={id} type="button" role="menuitemradio" aria-checked={mode === id} tabIndex={-1} onClick={() => { onMode(id); close(); }}><span className="calculator-menu-check">{mode === id && <Check size={14}/>}</span><Icon size={18} strokeWidth={1.6}/><span>{MODE_NAMES[id]}</span></button>)}
      <div role="separator"/>
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => { onMode('notes'); close(); }}><span className="calculator-menu-check">{mode === 'notes' && <Check size={14}/>}</span><NotebookPen size={18} strokeWidth={1.6}/><span>Math Notes…</span></button>
      <div role="separator"/>
      <button type="button" role="menuitemcheckbox" aria-checked={convert} disabled={!canModify} tabIndex={-1} onClick={() => { onConvert(); close(); }}><span className="calculator-menu-check">{convert && <Check size={14}/>}</span><ArrowRightLeft size={18} strokeWidth={1.6}/><span>Convert</span></button>
      <button type="button" role="menuitemcheckbox" aria-checked={rpn} disabled={!canModify} tabIndex={-1} onClick={() => { onRpn(); close(); }}><span className="calculator-menu-check">{rpn && <Check size={14}/>}</span><ListOrdered size={18} strokeWidth={1.6}/><span>RPN Mode</span></button>
    </div>}
  </div>;
}
