import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Cloud, CloudOff, Plus, Search, Trash2, X } from 'lucide-react';
import { useCloudAccount } from '../../accounts/service';
import { usePreferenceStatus } from '../../../../../packages/sdk/src/preferences';
import { ConditionIcon } from './ConditionIcon';
import { weatherDescription, type WeatherLocation, type WeatherUnits } from './provider';
import { weatherLocationKey, MAX_WEATHER_LOCATIONS } from './locations';
import { useCityWeather } from './useCityWeather';
import { weatherStore } from './store';
import { useCityReorderMotion } from './useCityReorderMotion';

interface CitySidebarProps {
  id: string;
  open: boolean;
  motion: boolean;
  locations: WeatherLocation[];
  selected: WeatherLocation;
  units: WeatherUnits;
  autoRefresh: boolean;
  compact: boolean;
  onSelect: (location: WeatherLocation) => void;
  onAdd: () => void;
  onClose: () => void;
  onRemove: (location: WeatherLocation) => void;
  onMove: (location: WeatherLocation, offset: number) => void;
  onAccount: () => void;
}

function CityCard({ location, selected, units, editing, first, last, only, onSelect, onRemove, onMove }: {
  location: WeatherLocation; selected: boolean; units: WeatherUnits; editing: boolean; first: boolean; last: boolean; only: boolean;
  onSelect: () => void; onRemove: () => void; onMove: (offset: number) => void;
}) {
  const state = useCityWeather(location, units);
  const descriptionId = useId();
  const data = state.data;
  const today = data?.forecast[0];
  let time = location.country || 'Saved city';
  if (location.timezone) {
    try { time = new Intl.DateTimeFormat(undefined, { timeZone: location.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date()); } catch { /* Keep country for unsupported timezones. */ }
  }
  return <li className="weather-city-row" data-city-key={weatherLocationKey(location)}>
    <button type="button" className="glass-inset weather-city-card" aria-current={selected ? 'location' : undefined} aria-label={'Show weather for ' + location.name} aria-describedby={descriptionId} onClick={onSelect}>
      {data && <span className="weather-city-art" aria-hidden="true"><ConditionIcon code={data.code} isDay={data.isDay} size={96}/></span>}
      <span className="weather-announcement" id={descriptionId}>{data ? `${Math.round(data.temperature)} degrees ${units}, ${weatherDescription(data.code)}.${today ? ` High ${Math.round(today.high)}, low ${Math.round(today.low)}.` : ''}${state.error ? ' Saved forecast; update unavailable.' : ''}` : state.error ? 'Weather unavailable.' : state.refreshing ? 'Loading weather.' : 'No forecast yet.'}</span>
      <span className="weather-city-heading"><span><strong>{location.name}</strong><small>{time}</small></span><span className="weather-city-temperature">{data ? Math.round(data.temperature) + '°' : '—'}</span></span>
      <span className="weather-city-conditions"><span>{data && <ConditionIcon code={data.code} isDay={data.isDay} size={21}/>}<span>{data ? weatherDescription(data.code) : state.error ? 'Weather unavailable' : state.refreshing || state.status === 'loading' ? 'Loading…' : 'No forecast yet'}</span></span>{today && <small>H:{Math.round(today.high)}° L:{Math.round(today.low)}°</small>}</span>
      {data && state.error && <span className="weather-city-cached">Saved forecast · {state.status === 'offline' ? 'Offline' : 'Update unavailable'}</span>}
    </button>
    {editing && <div className="weather-city-edit" role="group" aria-label={'Manage ' + location.name}>
      <button type="button" aria-label={'Move ' + location.name + ' up'} title="Move up" disabled={first} onClick={() => onMove(-1)}><ArrowUp size={14}/></button>
      <button type="button" aria-label={'Move ' + location.name + ' down'} title="Move down" disabled={last} onClick={() => onMove(1)}><ArrowDown size={14}/></button>
      <button type="button" className="weather-city-remove" aria-label={'Remove ' + location.name} title={only ? 'Keep at least one city in your list' : 'Remove city'} disabled={only} onClick={onRemove}><Trash2 size={14}/><span>Remove</span></button>
    </div>}
  </li>;
}

export function CitySidebar({ id, open, motion, locations, selected, units, autoRefresh, compact, onSelect, onAdd, onClose, onRemove, onMove, onAccount }: CitySidebarProps) {
  const [editing, setEditing] = useState(false);
  const [present, setPresent] = useState(open);
  const list = useRef<HTMLOListElement>(null);
  useCityReorderMotion(list, locations.map(weatherLocationKey), motion && open);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    if (!motion) { setPresent(false); return; }
    const timer = setTimeout(() => setPresent(false), 220);
    return () => clearTimeout(timer);
  }, [open, motion]);
  const account = useCloudAccount();
  const storage = usePreferenceStatus();
  useEffect(() => {
    if (!autoRefresh || !open) return;
    const refresh = () => { if (!document.hidden) for (const location of locations) void weatherStore.refreshCity(location, units); };
    const timer = setInterval(refresh, 15 * 60_000);
    window.addEventListener('online', refresh);
    return () => { clearInterval(timer); window.removeEventListener('online', refresh); };
  }, [locations, units, autoRefresh, open]);
  const syncProblem = !storage.persistent || account.status === 'offline' || account.status === 'error' || account.encryption === 'locked';
  const syncLabel = !storage.persistent ? 'Could not save on this device' : !account.account ? 'Saved on this device' : syncProblem ? 'Waiting for account sync' : account.status === 'syncing' || account.pendingChanges ? 'Syncing with your account…' : 'Account sync is on';
  if (!open && !present) return null;
  return <aside className="glass weather-city-sidebar" id={id} aria-label="Saved cities" aria-hidden={!open} inert={!open} data-open={open} onKeyDown={event => { if (compact && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="weather-city-toolbar"><h2>Cities</h2><button type="button" aria-pressed={editing} onClick={() => setEditing(value => !value)}>{editing ? 'Done' : 'Edit'}</button>{compact && <button type="button" className="weather-city-close" aria-label="Close cities" onClick={onClose}><X size={17}/></button>}</div>
    <button type="button" className="glass-inset weather-city-add" onClick={onAdd} disabled={locations.length >= MAX_WEATHER_LOCATIONS}><Search size={15}/><span>{locations.length >= MAX_WEATHER_LOCATIONS ? 'City list is full' : 'Add a city'}</span><Plus size={15}/></button>
    <ol ref={list} className="weather-city-list" aria-label="Your cities">{locations.map((location, index) => <CityCard key={weatherLocationKey(location)} location={location} selected={weatherLocationKey(selected) === weatherLocationKey(location)} units={units} editing={editing} first={index === 0} last={index === locations.length - 1} only={locations.length === 1} onSelect={() => onSelect(location)} onRemove={() => onRemove(location)} onMove={offset => onMove(location, offset)}/>)}</ol>
    <footer className="weather-city-footer"><span>{locations.length} {locations.length === 1 ? 'city' : 'cities'}</span><button type="button" onClick={onAccount} title={storage.persistent ? 'Open LopeOS Account settings' : storage.message}>{syncProblem ? <CloudOff size={13}/> : <Cloud size={13}/>}<span>{syncLabel}</span></button>{!storage.persistent && <span role="alert">Keep LopeOS open until your changes are saved.</span>}</footer>
  </aside>;
}
