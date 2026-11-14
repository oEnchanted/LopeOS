import { useId, useState, type MouseEvent, type PointerEvent } from 'react';
import { AlertTriangle, Server, Users } from 'lucide-react';
import { usePreferences } from '../../../../packages/sdk/src/preferences';
import { HISTORY_MS, useHostStatus, type HostSample } from './host-status';
import './host-widget.css';

const HIGH_LOAD = 90;
const gigabytes = (bytes: number) => bytes / 1024 ** 3;

/** A desktop widget showing the hosting server's load and how many people are online. */
export function HostWidget({ onContextMenu }: { onContextMenu: (event: MouseEvent) => void }) {
  const p = usePreferences(); const host = useHostStatus();
  const number = (value: number, digits = 0) => value.toLocaleString(p.region, { maximumFractionDigits: digits });
  const memoryPercent = host.memoryUsed !== null && host.memoryTotal ? host.memoryUsed / host.memoryTotal * 100 : null;
  const memoryDetail = host.memoryUsed !== null && host.memoryTotal ? `${number(gigabytes(host.memoryUsed), 1)} of ${number(gigabytes(host.memoryTotal), gigabytes(host.memoryTotal) < 10 ? 1 : 0)} GB` : 'Memory in use';
  const signedIn = host.signedIn ?? 0, guests = host.people === null ? 0 : Math.max(0, host.people - signedIn);
  const breakdown = [signedIn ? `${number(signedIn)} signed in` : '', guests ? `${number(guests)} ${guests === 1 ? 'guest' : 'guests'}` : ''].filter(Boolean).join(' · ');
  const stateLabel = host.state === 'live' ? 'Live' : host.state === 'connecting' ? 'Connecting' : 'Offline';
  return <aside className="host-widget glass" aria-label="Server status" data-state={host.state} onContextMenu={onContextMenu}>
    <header className="host-widget-header">
      <span className="host-widget-symbol" aria-hidden="true"><Server size={14}/></span>
      <strong>Server</strong>
      <span className="host-widget-state" title={host.state === 'unavailable' ? 'The server status couldn’t be reached. LopeOS will keep trying.' : undefined}><i aria-hidden="true"/>{stateLabel}</span>
    </header>
    <div className="host-widget-metrics">
      <Metric label="CPU" value={host.cpu} detail={host.cores ? `${number(host.cores)} ${host.cores === 1 ? 'core' : 'cores'}` : 'Processor load'} samples={host.history} pick={sample => sample.cpu}/>
      <Metric label="RAM" value={memoryPercent} detail={memoryDetail} samples={host.history} pick={sample => sample.memory}/>
    </div>
    <section className="host-widget-online glass-inset" aria-label="People online">
      <span className="host-widget-people" aria-hidden="true"><Users size={17}/></span>
      <span className="host-widget-online-copy">
        <strong>Online now</strong>
        <small>{host.people === null ? 'Counting…' : host.people === 1 ? 'Just you' : breakdown}</small>
      </span>
      <span className="host-widget-count">{host.people === null ? '–' : number(host.people)}</span>
    </section>
  </aside>;
}

function Metric({ label, value, detail, samples, pick }: { label: string; value: number | null; detail: string; samples: readonly HostSample[]; pick: (sample: HostSample) => number | null }) {
  const gradient = useId();
  const [hover, setHover] = useState<number | null>(null);
  const points = samples.flatMap(sample => { const v = pick(sample); return v === null ? [] : [{ at: sample.at, value: v }]; });
  const end = points.at(-1)?.at ?? 0, start = Math.max(points[0]?.at ?? end, end - HISTORY_MS), span = Math.max(1, end - start);
  // A lone first sample sits at the right edge, where new samples arrive.
  const x = (at: number) => points.length < 2 ? 100 : (at - start) / span * 100;
  const y = (v: number) => 35 - v / 100 * 31;
  const hovered = hover === null ? undefined : points.find(point => point.at === hover);
  const focus = hovered ?? points.at(-1);
  const shown = hovered ? hovered.value : value;
  const high = (shown ?? 0) >= HIGH_LOAD;
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.at).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  const area = points.length > 1 ? `${line} L${x(end).toFixed(2)},40 L${x(points[0].at).toFixed(2)},40 Z` : '';
  const values = points.map(point => point.value);
  const summary = value === null ? `${label}: not available yet` : `${label} ${Math.round(value)} percent, ${detail}.${values.length > 1 ? ` Last ${Math.round(span / 1000)} seconds: low ${Math.round(Math.min(...values))}, high ${Math.round(Math.max(...values))} percent.` : ''}`;
  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    if (points.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect(), at = start + (event.clientX - bounds.left) / bounds.width * span;
    let nearest = 0;
    points.forEach((point, index) => { if (Math.abs(point.at - at) < Math.abs(points[nearest].at - at)) nearest = index; });
    setHover(points[nearest].at);
  };
  const ago = hovered ? Math.round((end - hovered.at) / 1000) : 0;
  return <section className="host-metric glass-inset" data-level={high ? 'high' : 'normal'} aria-label={summary}>
    <div className="host-metric-label" aria-hidden="true">
      <span>{label}</span>
      {high && <span className="host-metric-alert"><AlertTriangle size={11}/>High</span>}
    </div>
    <div className="host-metric-value" aria-hidden="true">{shown === null ? '–' : Math.round(shown)}<span>%</span></div>
    <div className="host-metric-detail" aria-hidden="true">{hovered ? ago ? `${ago} s ago` : 'Now' : detail}</div>
    <div className="host-metric-chart" aria-hidden="true" onPointerMove={scrub} onPointerLeave={() => setHover(null)}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none">
        <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".32"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
        {area && <path d={area} fill={`url(#${gradient})`}/>}
        {points.length > 1 && <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>}
      </svg>
      {hovered && <i className="host-metric-hairline" style={{ left: `${x(hovered.at)}%` }}/>}
      {focus && <i className="host-metric-dot" style={{ left: `${x(focus.at)}%`, top: `${y(focus.value) / 40 * 100}%` }}/>}
    </div>
  </section>;
}
