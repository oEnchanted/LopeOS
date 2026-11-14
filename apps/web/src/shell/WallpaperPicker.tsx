import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { Wallpaper } from '../../../../packages/contracts/src';
import './wallpaper-picker.css';

const PAGE_SIZE = 6;
type Tone = 'all' | Wallpaper['kind'];

/** Shared by setup and Settings so large collections stay equally browsable. */
export function WallpaperPicker({ wallpapers, selected, onSelect }: {
  wallpapers: Wallpaper[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const gridId = useId();
  const grid = useRef<HTMLDivElement>(null);
  const revealSelected = useRef(false);
  const [query, setQuery] = useState('');
  const [tone, setTone] = useState<Tone>('all');
  const [page, setPage] = useState(() => Math.floor(Math.max(0, wallpapers.findIndex(w => w.id === selected)) / PAGE_SIZE));
  const words = query.trim().toLowerCase().split(/\s+/);
  const matches = wallpapers.filter(w => (tone === 'all' || w.kind === tone) && words.every(word => `${w.name} ${w.creator}`.toLowerCase().includes(word)));
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const active = wallpapers.find(w => w.id === selected);
  const selectedVisible = visible.some(w => w.id === selected);
  // Warm only nearby thumbnails; browsing must not download full-size wallpapers.
  const nearbyPreviews = matches.slice(Math.max(0, currentPage - 1) * PAGE_SIZE, (currentPage + 2) * PAGE_SIZE).flatMap(w => w.thumbnail ? [w.thumbnail] : []).join('\n');
  useEffect(() => {
    nearbyPreviews.split('\n').filter(Boolean).forEach(src => { const image = new Image(); image.src = src; });
  }, [nearbyPreviews]);
  useEffect(() => {
    if (revealSelected.current) {
      revealSelected.current = false;
      grid.current?.querySelector<HTMLButtonElement>('[aria-pressed=true]')?.focus({ preventScroll: true });
    }
  }, [currentPage, query, tone]);
  function showSelected() {
    revealSelected.current = true;
    setQuery(''); setTone('all');
    setPage(Math.floor(Math.max(0, wallpapers.findIndex(w => w.id === selected)) / PAGE_SIZE));
  }
  function turnPage(next: number) {
    if (next >= 0 && next < pages) setPage(next);
  }
  return <div className="wallpaper-picker" role="group" aria-label="Wallpaper collection">
    <div className="wallpaper-picker-current"><span title={active?.name}>{active ? `Current: ${active.name}` : 'Choose a wallpaper'}</span><button type="button" style={{ visibility: active && !selectedVisible ? 'visible' : 'hidden' }} onClick={showSelected}>Show selected wallpaper</button></div>
    <div className="wallpaper-picker-tools">
      <label className="wallpaper-picker-search glass-inset"><Search size={15} aria-hidden="true"/><input type="search" aria-label="Search wallpapers" placeholder="Search wallpapers" value={query} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} onChange={event => { setQuery(event.target.value); setPage(0); }}/></label>
      <div className="wallpaper-picker-tones glass-inset" role="group" aria-label="Wallpaper appearance">{(['all', 'light', 'dark'] as const).map(value => <button key={value} type="button" aria-label={value === 'all' ? 'All wallpapers' : `${value === 'light' ? 'Light' : 'Dark'} wallpapers`} aria-pressed={tone === value} aria-controls={gridId} onClick={() => { setTone(value); setPage(0); }}>{value === 'all' ? 'All' : value === 'light' ? 'Light' : 'Dark'}</button>)}</div>
    </div>
    <nav className="wallpaper-picker-pages" aria-label="Wallpaper pages"><span role="status">{matches.length ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, matches.length)} of ${matches.length} wallpapers` : '0 wallpapers'}</span><div><button className="glass-inset" type="button" aria-label="Previous wallpapers" aria-controls={gridId} aria-disabled={currentPage === 0} onClick={() => turnPage(currentPage - 1)}><ChevronLeft size={17}/></button><span>Page {currentPage + 1} of {pages}</span><button className="glass-inset" type="button" aria-label="Next wallpapers" aria-controls={gridId} aria-disabled={currentPage === pages - 1} onClick={() => turnPage(currentPage + 1)}><ChevronRight size={17}/></button></div></nav>
    <div id={gridId} ref={grid} key={`${tone}:${query}:${currentPage}`} className="wallpaper-picker-grid" role="group" aria-label="Wallpaper choices">{visible.map(wallpaper => <button key={wallpaper.id} type="button" className="wallpaper-picker-card glass-inset" aria-label={wallpaper.name} aria-pressed={selected === wallpaper.id} onClick={() => onSelect(wallpaper.id)}>
      <img className={'wallpaper-picker-image' + (wallpaper.id === 'night' ? ' wallpaper-picker-image--night' : '')} src={wallpaper.thumbnail || wallpaper.asset} alt="" width={640} height={360} decoding="async"/>
      <span className="wallpaper-picker-caption"><span><strong>{wallpaper.name}</strong><small>By {wallpaper.creator}</small></span><span className="wallpaper-picker-check" aria-hidden="true">{selected === wallpaper.id && <Check size={13}/>}</span></span>
    </button>)}</div>
    {matches.length === 0 && <div className="wallpaper-picker-empty"><p>No wallpapers match your search.</p><button type="button" onClick={() => { setQuery(''); setTone('all'); setPage(0); }}>Clear filters</button></div>}
  </div>;
}
