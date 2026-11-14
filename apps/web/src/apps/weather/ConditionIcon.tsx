import { useId } from 'react';

/** Filled weather symbols keep forecast rows legible at a glance. */
export function ConditionIcon({ code, isDay = true, size = 30 }: { code: number; isDay?: boolean; size?: number }) {
  const id = useId().replace(/:/g, '');
  const clear = code < 2, partial = code === 2, fog = code === 45 || code === 48;
  const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const storm = code >= 95, rain = !snow && !storm && code >= 51;
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className="weather-condition-icon">
    <defs>
      <linearGradient id={id + '-cloud'} x1="20" y1="13" x2="20" y2="31" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset="1" stopColor="#d5e7f5"/></linearGradient>
      <linearGradient id={id + '-sun'} x1="15" y1="6" x2="23" y2="28" gradientUnits="userSpaceOnUse"><stop stopColor="#ffe496"/><stop offset="1" stopColor="#ffb845"/></linearGradient>
    </defs>
    {(clear || partial) && (isDay ? <g transform={partial ? 'translate(-4 -4) scale(.9)' : undefined}>
      <g stroke="#ffd779" strokeWidth="2" strokeLinecap="round"><path d="M20 4v3M20 33v3M4 20h3M33 20h3M8.7 8.7l2.2 2.2M29.1 29.1l2.2 2.2M8.7 31.3l2.2-2.2M29.1 10.9l2.2-2.2"/></g>
      <circle cx="20" cy="20" r="9" fill={'url(#' + id + '-sun)'}/>
    </g> : <path d={partial ? 'M24 5a13 13 0 0 1-14 18A12 12 0 0 0 24 5Z' : 'M25 5A15 15 0 0 1 8 27 15 15 0 1 0 25 5Z'} fill="#fff2cf"/>)}
    {!clear && !fog && <path d="M11 29a7 7 0 1 1 1.2-13.9A9 9 0 0 1 29.5 17a6 6 0 0 1 .5 12H11Z" fill={'url(#' + id + '-cloud)'} stroke="var(--glass-muted, #fff)" strokeOpacity=".4" strokeWidth=".7"/>}
    {rain && <path d="m13 32-2 4m10-4-2 4m10-4-2 4" stroke="#8ed3ff" strokeWidth="2.3" strokeLinecap="round"/>}
    {snow && <g fill="#d9f4ff"><circle cx="12" cy="34" r="1.6"/><circle cx="21" cy="36" r="1.6"/><circle cx="29" cy="33" r="1.6"/></g>}
    {storm && <path d="m22 25-6 8h5l-2 6 9-10h-6l3-4Z" fill="#ffdc78"/>}
    {fog && <g stroke="#dceaf4" strokeWidth="2.6" strokeLinecap="round"><path d="M8 13h23M5 20h30M9 27h22"/><path d="M13 33h14" opacity=".6"/></g>}
  </svg>;
}
