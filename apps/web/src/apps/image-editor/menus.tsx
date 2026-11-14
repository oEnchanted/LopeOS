import { AppIcon } from '../../shell/Icons';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Search, PanelsTopLeft } from 'lucide-react';
import type { Command } from '../../../../../packages/contracts/src';
import { internalMenus, type Item } from './menu-model';
import './menus.css';

const available = (command: Command) => typeof command.enabled === 'function' ? command.enabled() : command.enabled !== false;
const buttons = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLButtonElement>(':scope > .ie-menu-entry > button:not(:disabled)')];

function MenuPopup({items, commands, anchor, nested = false, focusFirst, onBack, run}: {
  items: Item[]; commands: Command[]; anchor: HTMLElement; nested?: boolean; focusFirst: boolean;
  onBack: () => void; run: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [child, setChild] = useState<{index: number; anchor: HTMLButtonElement; focus: boolean} | null>(null);
  const [position, setPosition] = useState({left: 0, top: 0});
  const host = anchor.closest<HTMLElement>('.lope-image-editor')!;
  useLayoutEffect(() => {
    const place = () => {
      const menu = ref.current; if (!menu) return;
      const a = anchor.getBoundingClientRect(), h = host.getBoundingClientRect();
      // Translate viewport CSS coordinates into the app's local coordinate system,
      // including browser zoom or a transformed LopeOS window.
      const sx = h.width / host.offsetWidth || 1, sy = h.height / host.offsetHeight || 1;
      const width = host.clientWidth, height = host.clientHeight;
      const right = (a.right - h.left) / sx, left = (a.left - h.left) / sx;
      let x = nested ? right - 2 : left;
      if (nested && x + menu.offsetWidth > width - 4) x = left - menu.offsetWidth + 2;
      const y = (nested ? a.top - h.top : a.bottom - h.top) / sy;
      setPosition({left: Math.max(4, Math.min(x, width - menu.offsetWidth - 4)), top: Math.max(4, Math.min(y, height - menu.offsetHeight - 4))});
    };
    place(); const observer = new ResizeObserver(place); observer.observe(host); observer.observe(ref.current!);
    window.addEventListener('resize', place); document.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [anchor, host, nested]);
  useEffect(() => { if (focusFirst && ref.current) buttons(ref.current)[0]?.focus(); }, [focusFirst]);
  const back = () => { onBack(); anchor.focus(); };
  return createPortal(<div ref={ref} role="menu" aria-label={anchor.textContent?.trim() + ' menu'} data-editor-menu className="ie-dropdown ie-audit-dropdown" style={position} onKeyDown={event => {
    event.stopPropagation();
    const entries = buttons(ref.current!), at = entries.indexOf(event.target as HTMLButtonElement);
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); setChild(null);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
      entries[next]?.focus();
    } else if (event.key === 'Escape' || event.key === 'ArrowLeft' && nested) { event.preventDefault(); back(); }
    else if (event.key === 'Tab') { onBack(); }
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !nested && !(event.target as HTMLElement).hasAttribute('aria-haspopup')) {
      event.preventDefault(); anchor.dispatchEvent(new KeyboardEvent('keydown',{key:event.key,bubbles:true}));
    }
  }}>{items.map((item,index) => {
    if (!item) return <hr key={index} role="separator"/>;
    const command = typeof item === 'string' ? commands.find(c => c.id === item) : undefined;
    const entry = typeof item === 'string' ? {label: command?.label || item, shortcut: command?.shortcut?.replace('Mod','Ctrl'), disabled: !command || !available(command) ? 'Unavailable for the active document or layer.' : undefined, items: undefined} : item;
    const checked = typeof command?.checked === 'function' ? command.checked() : command?.checked;
    return <div className="ie-menu-entry" key={index}><button role="menuitem" disabled={Boolean(entry.disabled)} title={entry.disabled} aria-haspopup={entry.items ? 'menu' : undefined} aria-expanded={entry.items ? child?.index === index : undefined}
      onMouseEnter={event => setChild(entry.items ? {index,anchor:event.currentTarget,focus:false} : null)}
      onClick={event => { if(typeof item === 'string') run(item); else if(entry.items) setChild({index,anchor:event.currentTarget,focus:true}); }}
      onKeyDown={event => { if(event.key === 'ArrowRight' && entry.items) { event.preventDefault(); event.stopPropagation(); setChild({index,anchor:event.currentTarget,focus:true}); } }}>
      <span className="ie-menu-check">{checked && <Check size={12}/>}</span><span>{entry.label}</span>{entry.items ? <ChevronRight size={11}/> : <kbd>{entry.shortcut}</kbd>}
    </button>{entry.items && child?.index === index && <MenuPopup items={entry.items} commands={commands} anchor={child.anchor} nested focusFirst={child.focus} onBack={()=>setChild(null)} run={run}/>}</div>;
  })}</div>, host);
}

export function MenuBar({ commands, execute, onWorkspace }: { commands: Command[]; execute: (id: string) => void; onWorkspace: () => void }) {
  const [open, setOpen] = useState<number | null>(null); const ref = useRef<HTMLDivElement>(null);
  const triggers = useRef<(HTMLButtonElement|null)[]>([]); const [keyboardOpen,setKeyboardOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null); const [search, setSearch] = useState(false); const [query, setQuery] = useState('');
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target=event.target as HTMLElement, host=ref.current?.closest('.lope-image-editor');
      if (!ref.current?.contains(target) && !(host?.contains(target) && target.closest('[data-editor-menu]'))) { setOpen(null); setSearch(false); }
    };
    window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close);
  }, []);
  const run = (id: string) => { if(open !== null) triggers.current[open]?.focus(); else searchButton.current?.focus(); setOpen(null); setSearch(false); execute(id); };
  return <div className="ie-menubar" ref={ref} role="menubar" aria-label="Prism menus">
    <span className="ie-app-glyph" title="LopeOS Prism"><AppIcon name="image-editor" size={19}/></span>
    {internalMenus.map((menu,index) => <div className="ie-menu-root" key={menu.label}><button ref={node=>{triggers.current[index]=node;}} role="menuitem" aria-haspopup="menu" aria-expanded={open === index} className={open === index ? 'is-active' : ''}
      onClick={() => { setSearch(false); setKeyboardOpen(false); setOpen(open === index ? null : index); }}
      onMouseEnter={() => { if(open !== null) { setKeyboardOpen(false); setOpen(index); } }}
      onKeyDown={event => {
        if(event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSearch(false); setKeyboardOpen(true); setOpen(index); }
        else if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const next=event.key === 'Home' ? 0 : event.key === 'End' ? internalMenus.length-1 : (index+(event.key === 'ArrowRight'?1:-1)+internalMenus.length)%internalMenus.length; triggers.current[next]?.focus(); if(open !== null) {setKeyboardOpen(true);setOpen(next);} }
        else if(event.key === 'Escape') {event.preventDefault();setOpen(null);}
      }}>{menu.label}</button>{open === index && triggers.current[index] && <MenuPopup key={menu.label} items={menu.items} commands={commands} anchor={triggers.current[index]!} focusFirst={keyboardOpen} onBack={()=>setOpen(null)} run={run}/>}</div>)}
    <div className="ie-menubar-end"><button ref={searchButton} aria-label="Search editor commands" title="Search commands" onClick={()=>{setOpen(null);setSearch(!search);}}><Search size={16}/></button><button aria-label="Essentials workspace" title="Essentials workspace" onClick={onWorkspace}><PanelsTopLeft size={16}/><small>⌄</small></button></div>
    {search && <div className="ie-command-search" onKeyDown={event=>{if(event.key === 'Escape'){event.preventDefault();event.stopPropagation();setSearch(false);searchButton.current?.focus();}}}><input aria-label="Search image editor commands" autoFocus placeholder="Search commands…" value={query} onChange={e=>setQuery(e.target.value)}/><div>{commands.filter(c=>c.label.toLowerCase().includes(query.toLowerCase())).slice(0,12).map(command=><button key={command.id} onClick={()=>run(command.id)} disabled={!available(command)}>{command.label}<kbd>{command.shortcut?.replace('Mod','Ctrl')}</kbd></button>)}</div></div>}
  </div>;
}
