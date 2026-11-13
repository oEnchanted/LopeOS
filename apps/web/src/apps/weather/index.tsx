import { useRef, useState, type ReactNode } from 'react';
import { ArrowDown, CalendarDays, ChevronLeft, ChevronRight, Clock3, Droplets, Eye, MapPin, RefreshCw, Search, Sun, Sunrise, Sunset, Thermometer, Wind } from 'lucide-react';
import { Button, Dialog } from '../../../../../packages/ui/src';
import type { AppContext } from '../../../../../packages/contracts/src';
import { useAppCommands } from '../hooks';
import { LocationPicker } from './LocationPicker';
import { ConditionIcon } from './ConditionIcon';
import { WEATHER_ATTRIBUTION, weatherDescription, type WeatherData, type WeatherLocation } from './provider';
import { weatherStore } from './store';
import { useWeather } from './useWeather';
import '../application.css';
import './weather.css';

export { WeatherStatusBridge } from './WeatherStatusBridge';

function skyFor(data: WeatherData | null) {
  if (!data) return 'day';
  if (!data.isDay) return 'night';
  if ((data.code >= 71 && data.code <= 77) || data.code === 85 || data.code === 86) return 'snow';
  if (data.code >= 51) return 'rain';
  if (data.code >= 3) return 'cloudy';
  return 'day';
}

// Provider timestamps are wall-clock times at the forecast location, not the browser's timezone.
function localTime(value: string, hourOnly = false) {
  const match = /T(\d{2}):(\d{2})/.exec(value);
  if (!match) return '—';
  return new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2]))).toLocaleTimeString(undefined, {
    hour: 'numeric', ...(hourOnly ? {} : { minute: '2-digit' as const }), timeZone: 'UTC',
  });
}

function Metric({ title, icon, children, className = '' }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return <section className={'weather-glass weather-metric ' + className} aria-label={title}>
    <h2 className="weather-panel-heading">{icon}{title}</h2>{children}
  </section>;
}

function Forecast({ data }: { data: WeatherData }) {
  const low = Math.min(...data.forecast.map(day => day.low));
  const high = Math.max(...data.forecast.map(day => day.high));
  const span = Math.max(high - low, 1);
  const color = (temperature: number) => {
    const celsius = data.units === 'fahrenheit' ? (temperature - 32) * 5 / 9 : temperature;
    return 'hsl(' + Math.max(15, Math.min(220, 220 - (celsius + 5) * 5.5)) + ' 78% 69%)';
  };
  return <section className="weather-glass weather-forecast" aria-label={data.forecast.length + '-day forecast'}>
    <h2 className="weather-panel-heading"><CalendarDays size={14}/>{data.forecast.length}-day forecast</h2>
    <ol>{data.forecast.map((day, index) => {
      const left = Math.min((day.low - low) / span * 100, 98);
      const width = Math.max((day.high - day.low) / span * 100, 2);
      return <li key={day.date}>
        <time dateTime={day.date}>{index === 0 ? 'Today' : new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</time>
        <span className="weather-day-condition" role="img" aria-label={weatherDescription(day.code) + ', ' + day.precipitation + '% chance of precipitation'}>
          <ConditionIcon code={day.code} size={27}/>{day.precipitation >= 20 && <small>{day.precipitation}%</small>}
        </span>
        <span className="weather-day-low" aria-label={'Low ' + Math.round(day.low) + ' degrees'}>{Math.round(day.low)}°</span>
        <span className="forecast-range" aria-hidden="true">
          <span className="forecast-range-fill" style={{ left: left + '%', width: Math.min(width, 100 - left) + '%', background: 'linear-gradient(90deg, ' + color(day.low) + ', ' + color(day.high) + ')' }}/>
          {index === 0 && <i style={{ left: Math.max(1, Math.min(99, (data.temperature - low) / span * 100)) + '%' }}/>}
        </span>
        <span className="weather-day-high" aria-label={'High ' + Math.round(day.high) + ' degrees'}>{Math.round(day.high)}°</span>
      </li>;
    })}</ol>
  </section>;
}

export default function Weather({ context }: { context: AppContext }) {
  const state = useWeather(context.services.settings);
  const [locationOpen, setLocationOpen] = useState(false);
  const hourly = useRef<HTMLDivElement>(null);
  const unit = state.units === 'celsius' ? 'C' : 'F';
  const data = state.data;
  const today = data?.forecast[0];
  const changeUnits = (units: 'celsius' | 'fahrenheit') => context.services.settings.set('weather.units', units);
  useAppCommands(context, [
    { id: 'weather.location' as const, label: 'Change Location…', execute: () => setLocationOpen(true) },
    { id: 'weather.refresh' as const, label: 'Refresh Weather', shortcut: 'Mod+R', enabled: !state.refreshing, execute: () => weatherStore.refresh(true) },
    { id: 'weather.celsius' as const, label: 'Celsius', checked: state.units === 'celsius', execute: () => changeUnits('celsius') },
    { id: 'weather.fahrenheit' as const, label: 'Fahrenheit', checked: state.units === 'fahrenheit', execute: () => changeUnits('fahrenheit') },
  ]);
  function chooseLocation(location: WeatherLocation) { context.services.settings.set('weather.location', location); setLocationOpen(false); }
  const nextSunrise = Boolean(data?.sunrise && data.time < data.sunrise);
  const sunTime = nextSunrise ? data?.sunrise : data?.sunset;
  const direction = data?.windDirection === undefined ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(data.windDirection / 45) % 8];
  const uv = data?.uvIndex === undefined ? undefined : Math.max(0, Math.round(data.uvIndex));
  const uvLevel = uv === undefined ? '' : uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very high' : 'Extreme';

  return <div className="lope-app weather-view sky-weather" data-testid="weather-app" data-sky={skyFor(data)} data-glass-tone="dark">
    <div className="weather-atmosphere" aria-hidden="true"><div className="weather-sun"/><div className="weather-cloud weather-cloud-one"/><div className="weather-cloud weather-cloud-two"/><div className="weather-stars"/></div>
    <div className="weather-navigation" role="toolbar" aria-label="Weather controls">
      <button className="weather-location-control" type="button" onClick={() => setLocationOpen(true)} title="Search for a location"><Search size={16}/><span className="weather-location-name">{state.location.name}</span></button>
      <div className="weather-navigation-actions">
        <div className="weather-unit-control" role="group" aria-label="Temperature unit"><button type="button" aria-label="Use Celsius" aria-pressed={unit === 'C'} onClick={() => changeUnits('celsius')}>°C</button><button type="button" aria-label="Use Fahrenheit" aria-pressed={unit === 'F'} onClick={() => changeUnits('fahrenheit')}>°F</button></div>
        <button className="weather-refresh" type="button" aria-label="Refresh weather" title="Refresh weather" disabled={state.refreshing} onClick={() => { void weatherStore.refresh(true); }}><RefreshCw size={15}/></button>
      </div>
    </div>
    <div className="weather-scroll">
      <div className="weather-dashboard">
        {(state.notice || state.refreshing) && <p className="weather-status-note" role="status">{state.refreshing ? 'Updating conditions…' : state.notice}</p>}
        {state.error && <div className="weather-error" role="alert"><strong>{state.status === 'offline' ? 'You’re offline' : 'Weather is unavailable'}</strong><span>{state.error}</span>{data && <span>Showing cached conditions from {new Date(data.fetchedAt).toLocaleString()}.</span>}<Button disabled={state.refreshing || state.status === 'offline'} onClick={() => { void weatherStore.refresh(true); }}>Try again</Button></div>}
        {data ? <>
          <header className="weather-hero">
            <p className="weather-place">{state.location.name}</p>
            <h1 className="weather-temperature" aria-label={Math.round(data.temperature) + '°' + unit}>{Math.round(data.temperature)}<span>°</span></h1>
            <p className="weather-condition">{weatherDescription(data.code)}</p>
            {today && <p className="weather-extremes">H:{Math.round(today.high)}° <span>L:{Math.round(today.low)}°</span></p>}
          </header>
          <section className="weather-glass weather-hourly" aria-label="Hourly forecast">
            <div className="weather-hourly-intro">
              <p>{today ? weatherDescription(today.code) + ' today. High ' + Math.round(today.high) + '°, low ' + Math.round(today.low) + '°.' : 'Current conditions and hourly forecast.'}</p>
              {!!data.hourly?.length && <div className="weather-hourly-controls"><button type="button" aria-label="Previous hours" onClick={() => hourly.current?.scrollBy({ left: -280 })}><ChevronLeft size={15}/></button><button type="button" aria-label="Next hours" onClick={() => hourly.current?.scrollBy({ left: 280 })}><ChevronRight size={15}/></button></div>}
            </div>
            {data.hourly?.length ? <div ref={hourly} className="weather-hours" tabIndex={0} role="region" aria-label="Hourly temperatures; scroll for more hours"><ol>{data.hourly.map(hour => {
              const isCurrentHour = hour.time.slice(0, 13) === data.time.slice(0, 13);
              return <li key={hour.time}>
              <time dateTime={hour.time}>{isCurrentHour ? 'Now' : localTime(hour.time, true)}</time>
              <span role="img" aria-label={weatherDescription(isCurrentHour ? data.code : hour.code)}><ConditionIcon code={isCurrentHour ? data.code : hour.code} isDay={isCurrentHour ? data.isDay : hour.isDay} size={31}/></span>
              <strong>{Math.round(isCurrentHour ? data.temperature : hour.temperature)}°</strong>
              {hour.precipitation !== undefined && hour.precipitation >= 20 && <small>{hour.precipitation}%</small>}
            </li>;
            })}</ol></div> : <p className="weather-hourly-unavailable"><Clock3 size={16}/>Hourly forecast is currently unavailable.</p>}
          </section>
          <div className="weather-forecast-grid">
            {!!data.forecast.length && <Forecast data={data}/>}
            <div className="weather-metrics">
              {uv !== undefined && <Metric title="UV index" icon={<Sun size={14}/>}><p className="weather-metric-value">{Math.round(uv)}</p><p className="weather-metric-subtitle">{uvLevel}</p><div className="weather-uv-scale" aria-hidden="true"><i style={{ left: Math.min(97, uv / 12 * 100) + '%' }}/></div><p className="weather-metric-note">Current UV level</p></Metric>}
              <Metric title="Feels like" icon={<Thermometer size={14}/>}><p className="weather-metric-value">{Math.round(data.feelsLike)}°</p><p className="weather-feels-actual">Actual: {Math.round(data.temperature)}°</p><p className="weather-metric-note">{Math.abs(data.feelsLike - data.temperature) < 2 ? 'Similar to the actual temperature.' : data.feelsLike < data.temperature ? 'Feels cooler than the actual temperature.' : 'Feels warmer than the actual temperature.'}</p></Metric>
              <Metric title="Wind" icon={<Wind size={14}/>} className="weather-wind-card"><div className="weather-wind-reading"><p className="weather-metric-value">{Math.round(data.wind)}<small>{unit === 'F' ? 'mph' : 'km/h'}</small></p><div className="weather-compass" aria-hidden="true"><span>N</span><span>E</span><span>S</span><span>W</span><ArrowDown size={34} style={{ transform: 'rotate(' + (data.windDirection ?? 0) + 'deg)' }}/></div></div><p className="weather-metric-note">{direction ? 'From ' + direction : 'Wind speed'}{data.windGusts !== undefined && ' · Gusts ' + Math.round(data.windGusts) + ' ' + (unit === 'F' ? 'mph' : 'km/h')}</p></Metric>
              {sunTime && <Metric title={nextSunrise ? 'Sunrise' : 'Sunset'} icon={nextSunrise ? <Sunrise size={14}/> : <Sunset size={14}/>}><p className="weather-metric-value weather-sun-time">{localTime(sunTime)}</p><svg className="weather-sun-arc" viewBox="0 0 180 54" fill="none" aria-hidden="true"><path d="M4 46h172" stroke="currentColor" opacity=".3"/><path d="M4 51C47 51 42 8 90 8s43 43 86 43" stroke="currentColor" strokeWidth="2" opacity=".65"/><circle cx={nextSunrise ? 42 : 138} cy="31" r="5" fill="#ffdb91"/></svg>{data.sunrise && data.sunset && <p className="weather-metric-note">{nextSunrise ? 'Sunset: ' + localTime(data.sunset) : 'Sunrise: ' + localTime(data.sunrise)}</p>}</Metric>}
              <Metric title="Humidity" icon={<Droplets size={14}/>}><p className="weather-metric-value">{Math.round(data.humidity)}<span>%</span></p><div className="weather-humidity-scale" aria-hidden="true"><span style={{ width: Math.max(0, Math.min(100, data.humidity)) + '%' }}/></div><p className="weather-metric-note">Relative humidity</p></Metric>
              {data.visibility !== undefined && <Metric title="Visibility" icon={<Eye size={14}/>}><p className="weather-metric-value">{Math.round(data.visibility / (unit === 'F' ? 1609.344 : 1000))}<small>{unit === 'F' ? 'mi' : 'km'}</small></p><div className="weather-visibility-lines" aria-hidden="true"><i/><i/><i/></div><p className="weather-metric-note">{data.visibility >= 10000 ? 'Clear view of the horizon.' : data.visibility >= 1000 ? 'Reduced visibility.' : 'Low visibility.'}</p></Metric>}
            </div>
          </div>
        </> : !state.error && <div className="weather-empty" role="status"><ConditionIcon code={2} size={64}/><h1>{state.location.name}</h1><p>Loading the latest weather…</p><div className="weather-loading-line"/></div>}
        <footer className="weather-source">
          {data && <p><MapPin size={11}/>{state.location.name}{state.location.country && ' · ' + state.location.country}</p>}
          <p><a href={WEATHER_ATTRIBUTION.url} target="_blank" rel="noreferrer" onClick={event => { event.preventDefault(); context.services.openURL(WEATHER_ATTRIBUTION.url); }}>{WEATHER_ATTRIBUTION.label}</a><span>·</span><a href={WEATHER_ATTRIBUTION.license} target="_blank" rel="noreferrer" onClick={event => { event.preventDefault(); context.services.openURL(WEATHER_ATTRIBUTION.license); }}>CC BY 4.0</a></p>
          {data && <time dateTime={new Date(data.fetchedAt).toISOString()}>Updated {new Date(data.fetchedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · Modelled conditions</time>}
        </footer>
      </div>
    </div>
    {locationOpen && <Dialog title="Choose a location" onClose={() => setLocationOpen(false)}><LocationPicker onSelect={chooseLocation} openURL={context.services.openURL}/></Dialog>}
  </div>;
}
