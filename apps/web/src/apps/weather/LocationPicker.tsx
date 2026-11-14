import { useEffect, useId, useRef, useState } from 'react';
import { Check, MapPin, Navigation, Search } from 'lucide-react';
import { Button, Input } from '../../../../../packages/ui/src';
import { errorMessage } from '../hooks';
import { capabilities } from '../../shell/system';
import { usePreferences } from '../../../../../packages/sdk/src/preferences';
import { weatherStore } from './store';
import type { WeatherLocation } from './provider';
import { weatherLocationKey } from './locations';

export function LocationPicker({ onSelect, openURL, savedLocations = [] }: { onSelect: (location: WeatherLocation) => void; openURL?: (url: string) => void; savedLocations?: WeatherLocation[] }) {
  const preferences = usePreferences();
  const locating = useRef(false);
  const queryId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WeatherLocation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; controller.current?.abort(); if(locating.current)capabilities.stop('location'); }, []);
  async function search() {
    controller.current?.abort(); controller.current = new AbortController();
    const id = ++requestId.current; setBusy(true); setError(''); setResults([]); setSearched(false);
    try { const matches = await weatherStore.search(query, controller.current.signal); if (id === requestId.current) { setResults(matches); setSearched(true); } }
    catch (cause) { if (id === requestId.current && !controller.current?.signal.aborted) setError(errorMessage(cause)); }
    finally { if (id === requestId.current) setBusy(false); }
  }
  function locate() {
    if (!navigator.geolocation) { setError('Your browser does not provide geolocation. Search for a city instead.'); return; }
    controller.current?.abort(); const id = ++requestId.current; setBusy(true); setError('');
    locating.current = true;
    capabilities.locate().then(position => { if (id === requestId.current) { setBusy(false); onSelect({ name:'Current location',latitude:position.coords.latitude,longitude:position.coords.longitude }); } },cause => { if (id === requestId.current) { setBusy(false); setError(cause instanceof Error ? cause.message : 'Location access was declined or unavailable. Search for a city instead.'); } }).finally(()=>{locating.current=false;});
  }
  return <div className="weather-location-picker"><form onSubmit={event => { event.preventDefault(); void search(); }}><label htmlFor={queryId}>City or postal code</label><div className="control-group"><Input id={queryId} aria-label="City or postal code" value={query} onChange={event => setQuery(event.target.value)} placeholder="Denver, Colorado" minLength={2} maxLength={120} required/><Button type="submit" disabled={busy || query.trim().length < 2}><Search size={15}/>Search</Button></div></form><Button disabled={busy||!preferences.locationAccess||!navigator.geolocation} onClick={locate}><Navigation size={15}/>Use my location</Button><p className="field-help">Searching sends the city name to Open-Meteo. Using your location shares coordinates with the forecast provider.</p>{busy && <p role="status">Finding your location…</p>}{error && <p className="application-error" role="alert">{error}</p>}{searched && !results.length && <p role="status">No locations found. Try a nearby city or include the region.</p>}{results.length > 0 && <ul className="location-results" aria-label="Matching locations">{results.map(location => <li key={`${location.latitude},${location.longitude}`}><Button onClick={() => onSelect(location)}><MapPin size={16}/><span><strong>{location.name}</strong><small>{location.country}</small></span>{savedLocations.some(saved => weatherLocationKey(saved) === weatherLocationKey(location)) && <span className="weather-location-saved"><Check size={13}/>Saved</span>}</Button></li>)}</ul>}<small className="field-help">Location search: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" onClick={event => { if (openURL) { event.preventDefault(); openURL('https://open-meteo.com/'); } }}>Open-Meteo</a> / <a href="https://www.geonames.org/" target="_blank" rel="noreferrer" onClick={event => { if (openURL) { event.preventDefault(); openURL('https://www.geonames.org/'); } }}>GeoNames</a></small></div>;
}
