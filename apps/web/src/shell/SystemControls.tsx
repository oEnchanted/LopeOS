import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Bell, Search, Moon, Volume2, VolumeX, Cloud, CloudOff, SlidersHorizontal, Shield, Camera, Mic, MonitorUp, MapPin, X, Sun, ChevronRight, Eye, EyeOff, Monitor, Maximize, Minimize } from 'lucide-react';
import { usePreferences } from '../../../../packages/sdk/src/preferences';
import { preferences } from '../../../../packages/sdk/src/preferences';
import type { SharedServices, StatusItem } from '../../../../packages/contracts/src';
import { capabilities, useCapabilities, shellAction, type CaptureKind } from './system';
import { LopeMark } from './Icons';
const captureIcons = { camera: Camera, microphone: Mic, screen: MonitorUp, location: MapPin };
export function useRuntimeStatus() {
  const [state, setState] = useState<'checking'|'connected'|'unavailable'>('checking');
  useEffect(() => { let active = true; const check = async () => { if (document.hidden) return; try { const r = await fetch('/api/health', { signal: AbortSignal.timeout(5000), cache: 'no-store' }); if (active) setState(r.ok ? 'connected' : 'unavailable'); } catch { if (active) setState('unavailable'); } }; void check(); const timer = setInterval(check, 30000); document.addEventListener('visibilitychange', check); return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', check); }; }, []);
  return state;
}
export function formatClock(date: Date, datePart = false) {
  const p = preferences.getSnapshot();
  return datePart ? new Intl.DateTimeFormat(p.region, { month: p.dateStyle === 'short' ? 'numeric' : p.dateStyle === 'long' ? 'long' : 'short', day: 'numeric', ...(p.clockWeekday ? { weekday: 'short' as const } : {}) }).format(date) : new Intl.DateTimeFormat(p.region, { hour: 'numeric', minute: '2-digit', ...(p.clockSeconds ? { second: '2-digit' as const } : {}), hour12: !p.clock24 }).format(date);
}
export function SystemStatus({ services, items, clock, setPopover, showSearch, hasNotifications, activePopover }: { services: SharedServices; items: StatusItem[]; clock: Date; setPopover: (name: string) => void; showSearch: () => void; hasNotifications: boolean; activePopover: string | null }) {
  const p = usePreferences(); const state = useRuntimeStatus(); const capture = useCapabilities();
  const [browserFullscreen, setBrowserFullscreen] = useState(!!document.fullscreenElement);
  const [fullscreenPending, setFullscreenPending] = useState(false);
  useEffect(() => {
    const changed = () => setBrowserFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const toggleBrowserFullscreen = async () => {
    setFullscreenPending(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      services.notify({ title: 'Couldn’t change browser full screen', message: error instanceof Error ? error.message : 'Full screen is unavailable in this browser.', tone: 'error' });
    } finally { setFullscreenPending(false); }
  };
  const fullscreenLabel = browserFullscreen ? 'Exit browser full screen' : 'Enter browser full screen';
  const labels: Record<string, React.ReactNode> = {
    weather: items.find(i => i.id === 'lope.weather') ? <button key="weather" className="weather-status" onClick={() => services.launch('lope.weather')}>{items.find(i => i.id === 'lope.weather')!.label}</button> : null,
    search: <button key="search" aria-label="Search applications" onClick={showSearch}><Search size={15}/></button>,
    notifications: <button key="notifications" aria-label="Notifications" aria-expanded={activePopover === 'notifications'} onClick={() => setPopover('notifications')}><Bell size={15}/>{hasNotifications && p.notificationBadges && <i className="notification-dot"/>}</button>,
    focus: <button key="focus" aria-label={p.dnd ? 'Turn off Do Not Disturb' : 'Turn on Do Not Disturb'} title="LopeOS Focus" className={p.dnd ? 'status-on' : ''} aria-pressed={p.dnd} onClick={() => preferences.set('dnd', !p.dnd)}><Moon size={15}/></button>,
    sound: <button key="sound" aria-label={p.soundMuted ? 'Unmute LopeOS' : 'Mute LopeOS'} aria-pressed={p.soundMuted} onClick={() => preferences.set('soundMuted', !p.soundMuted)}>{p.soundMuted ? <VolumeX size={16}/> : <Volume2 size={16}/>}</button>,
    runtime: <button key="runtime" aria-label={'Workspace connection: ' + state} title={'Workspace ' + state + ' · managed by the runtime service'} onClick={() => services.launch('lope.settings', { page: 'privacy', anchor: 'connected-services' })}>{state === 'connected' ? <Cloud size={16}/> : <CloudOff size={16}/>}</button>,
    clock: <button key="clock" className="clock-button" onClick={() => setPopover('calendar')} aria-label="Open calendar" aria-expanded={activePopover === 'calendar'}>{p.clockDate && <span className="clock-date">{formatClock(clock, true)}</span>}<span>{formatClock(clock)}</span></button>,
  };
  return <div className="system-status">{capture.captures.map(c => { const Icon = captureIcons[c.kind]; return <button className="capture-indicator" key={c.kind} aria-label={'Stop ' + c.kind} title={c.kind + ' active · click to stop'} onClick={() => capabilities.stop(c.kind)}><Icon size={15}/><span className="capture-label">Stop</span></button>; })}{p.statusOrder.filter(id => p.statusItems.includes(id)).map(id => labels[id])}<button aria-label={fullscreenLabel} title={!document.fullscreenEnabled && !browserFullscreen ? 'Browser full screen is unavailable' : fullscreenLabel} aria-pressed={browserFullscreen} disabled={fullscreenPending || !document.fullscreenEnabled && !browserFullscreen} onClick={() => void toggleBrowserFullscreen()}>{browserFullscreen ? <Minimize size={16}/> : <Maximize size={16}/>}</button><button aria-label="Quick settings" aria-expanded={activePopover === 'settings'} onClick={() => setPopover('settings')}><SlidersHorizontal size={17}/></button></div>;
}
export function QuickSettings({ services }: { services: SharedServices }) {
  const p = usePreferences(); const status = useRuntimeStatus();
  return <section className="quick-settings system-popover glass" aria-label="Quick settings">
    <header className="cc-heading">
      <strong>Control Center</strong>
      <button className="cc-settings-button" aria-label="Open full settings" title="Open Settings" onClick={() => services.launch('lope.settings')}><SlidersHorizontal size={17}/></button>
    </header>

    <div className="cc-controls">
      <button className="cc-glass cc-workspace" onClick={() => services.launch('lope.settings', { page: 'privacy', anchor: 'connected-services' })}>
        <span className="cc-symbol cc-symbol--workspace">{status === 'connected' ? <Cloud size={24}/> : <CloudOff size={24}/>}</span>
        <span className="cc-copy"><strong>Workspace</strong><small>{status === 'connected' ? 'Connected' : status === 'checking' ? 'Checking…' : 'Service unavailable'}</small></span>
        <span className={'cc-connection-dot cc-connection-dot--' + status} aria-hidden="true"/>
        <ChevronRight className="cc-chevron" size={15}/>
      </button>

      <div className="cc-pair">
        <button className="cc-glass cc-toggle cc-focus" aria-pressed={p.dnd} onClick={() => preferences.set('dnd', !p.dnd)}>
          <span className="cc-symbol"><Moon size={23}/></span>
          <span className="cc-copy"><strong>Focus</strong><small>{p.dnd ? 'Do Not Disturb' : 'Off'}</small></span>
        </button>
        <button className="cc-glass cc-toggle cc-previews" aria-label="Hide notification previews" aria-pressed={p.presentationMode} onClick={() => preferences.set('presentationMode', !p.presentationMode)}>
          <span className="cc-symbol">{p.presentationMode ? <EyeOff size={22}/> : <Eye size={22}/>}</span>
          <span className="cc-copy"><strong>Previews</strong><small>{p.presentationMode ? 'Hidden' : 'Default'}</small></span>
        </button>
      </div>

      <div className="cc-glass cc-appearance" role="group" aria-label="Appearance">
        <div className="cc-module-heading"><strong>Appearance</strong><span>{p.theme === 'system' ? 'Automatic' : p.theme === 'dark' ? 'Dark' : 'Light'}</span></div>
        <div className="cc-theme-options">
          <button aria-pressed={p.theme === 'light'} onClick={() => preferences.set('theme', 'light')}><Sun size={19}/><span>Light</span></button>
          <button aria-pressed={p.theme === 'dark'} onClick={() => preferences.set('theme', 'dark')}><Moon size={18}/><span>Dark</span></button>
          <button aria-pressed={p.theme === 'system'} onClick={() => preferences.set('theme', 'system')}><Monitor size={19}/><span>Auto</span></button>
        </div>
      </div>

      <div className="cc-glass cc-sound" role="group" aria-label="Sound">
        <div className="cc-module-heading"><strong>Sound</strong><span>{p.soundMuted ? 'Muted' : p.soundVolume + '%'}</span></div>
        <div className="cc-volume-control" data-muted={p.soundMuted}>
          <button className="cc-mute" aria-label={p.soundMuted ? 'Unmute LopeOS' : 'Mute LopeOS'} aria-pressed={p.soundMuted} onClick={() => preferences.set('soundMuted', !p.soundMuted)}>{p.soundMuted || p.soundVolume === 0 ? <VolumeX size={22}/> : <Volume2 size={22}/>}</button>
          <input aria-label="LopeOS volume" aria-valuetext={p.soundVolume + '%' + (p.soundMuted ? ', muted' : '')} type="range" min="0" max="100" value={p.soundVolume} style={{ '--cc-volume': p.soundVolume + '%' } as CSSProperties} onChange={e => preferences.set('soundVolume', Number(e.target.value))}/>
        </div>
      </div>

      <button className="cc-glass cc-privacy" aria-label="Show privacy screen" onClick={() => shellAction('privacy')}>
        <span className="cc-symbol"><Shield size={21}/></span>
        <span className="cc-copy"><strong>Privacy screen</strong><small>Hide workspace</small></span>
        <ChevronRight className="cc-chevron" size={16}/>
      </button>
    </div>
  </section>;
}
export function PrivacyScreen({ reveal }: { reveal: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    capabilities.stopAll();
    const previous = document.activeElement as HTMLElement; const others = [...document.querySelector('.desktop')!.children].filter(el => !el.classList.contains('privacy-screen')) as HTMLElement[];
    others.forEach(el => { el.inert = true; }); button.current?.focus();
    return () => { others.forEach(el => { el.inert = false; }); previous?.isConnected && previous.focus(); };
  }, []);
  return <div className="privacy-screen" role="dialog" aria-modal="true" aria-label="Privacy screen" onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); button.current?.focus(); } }}><LopeMark size={50}/><h1>Workspace hidden</h1><p>Your workspace is hidden from view.<br/>This screen does not lock your account or protect stored files.</p><button ref={button} onClick={reveal}><Eye size={16}/> Return to workspace</button><small>Remote sessions may continue while this screen is visible.</small></div>;
}
export function CapturePreview({ kind }: { kind: CaptureKind }) {
  const { captures } = useCapabilities(); const capture = captures.find(c => c.kind === kind); const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (video.current && capture?.stream) { video.current.srcObject = capture.stream; void video.current.play().catch(() => {}); } return () => { if (video.current) video.current.srcObject = null; }; }, [capture]);
  if (!capture) return null;
  return <div className="capture-preview">{kind !== 'microphone' && kind !== 'location' && <video data-capture-preview ref={video} muted playsInline/>}<div><span className="activity-dot"/><strong>{kind === 'screen' ? 'Screen capture preview' : kind + ' active'}</strong><button onClick={() => capabilities.stop(kind)}><X size={14}/> Stop</button></div><p>{kind === 'location' ? 'Waiting for the browser location service.' : 'Preview only. This tool does not record or upload the capture.'}</p></div>;
}
