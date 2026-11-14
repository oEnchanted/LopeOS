import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { WeatherData } from './provider';
import './atmosphere.css';

export type WeatherSky = 'day' | 'blue-hour' | 'night' | 'cloudy' | 'rain' | 'snow';
type Scene = { key: string; sky: WeatherSky; night: boolean; clouds: 'few' | 'scattered' | 'overcast' };
type Layer = { id: number; scene: Scene; phase: 'steady' | 'entering' | 'leaving' };
const CROSSFADE_MS = 950;

// All three timestamps are provider wall-clock times at the same location.
// A literal UTC suffix lets us compare them without the browser's local timezone.
function nearHorizon(data: WeatherData): boolean {
  const current = Date.parse(data.time + 'Z');
  if (!Number.isFinite(current)) return false;
  return [data.sunrise, data.sunset].some(time => time && Math.abs(current - Date.parse(time + 'Z')) <= 45 * 60_000);
}

export function skyFor(data: WeatherData | null): WeatherSky {
  if (!data) return 'day';
  if ((data.code >= 71 && data.code <= 77) || data.code === 85 || data.code === 86) return 'snow';
  if (data.code >= 51) return 'rain';
  if (data.code >= 3) return 'cloudy';
  if (nearHorizon(data)) return 'blue-hour';
  return data.isDay ? 'day' : 'night';
}

function sceneFor(data: WeatherData | null): Scene {
  const sky = skyFor(data);
  const night = data ? !data.isDay : false;
  const clouds = data && data.code >= 3 ? 'overcast' : data?.code === 2 ? 'scattered' : 'few';
  return { key: `${sky}-${night}-${clouds}`, sky, night, clouds };
}

/** Original, softly layered cloud artwork; the gradients themselves stay static. */
function CloudBank({ className }: { className: string }) {
  const id = useId().replace(/:/g, '');
  return <svg className={'weather-scene-cloud ' + className} viewBox="0 0 720 240" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={id + '-body'} x1="370" y1="22" x2="370" y2="225" gradientUnits="userSpaceOnUse">
        <stop stopColor="var(--cloud-light)" stopOpacity=".76"/><stop offset=".53" stopColor="var(--cloud-light)" stopOpacity=".4"/><stop offset="1" stopColor="var(--cloud-shade)" stopOpacity="0"/>
      </linearGradient>
      <linearGradient id={id + '-front'} x1="350" y1="93" x2="350" y2="238" gradientUnits="userSpaceOnUse">
        <stop stopColor="var(--cloud-light)" stopOpacity=".3"/><stop offset="1" stopColor="var(--cloud-shade)" stopOpacity="0"/>
      </linearGradient>
      <radialGradient id={id + '-haze'} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(354 164) scale(354 75)">
        <stop stopColor="var(--cloud-light)" stopOpacity=".25"/><stop offset="1" stopColor="var(--cloud-light)" stopOpacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="354" cy="164" rx="354" ry="75" fill={`url(#${id}-haze)`}/>
    <path d="M-14 174C26 152 56 164 91 148C104 117 133 104 164 115C178 78 218 60 253 79C272 38 310 23 346 43C370 56 380 77 384 99C415 80 450 91 465 116C499 99 530 117 543 139C579 123 613 140 624 158C665 146 704 159 736 182V240H-14Z" fill={`url(#${id}-body)`}/>
    <path d="M-19 198C35 178 85 195 125 175C154 154 181 162 207 175C223 146 258 139 282 155C307 119 355 117 382 149C410 139 444 155 453 175C483 154 517 165 531 185C589 173 638 192 744 203V240H-19Z" fill={`url(#${id}-front)`}/>
  </svg>;
}

const STAR_POSITIONS = [
  [8, 11, .9], [18, 25, .6], [30, 8, .85], [44, 18, .55], [56, 6, .7], [69, 29, .6],
  [83, 12, .8], [94, 35, .6], [13, 47, .5], [36, 37, .6], [58, 46, .45], [78, 50, .65],
  [23, 62, .4], [48, 60, .5], [92, 63, .45], [7, 76, .4], [65, 73, .4], [87, 82, .35],
];

function SkyScene({ layer }: { layer: Layer }) {
  const { scene } = layer;
  const precipitation = scene.sky === 'rain' ? 'rain' : scene.sky === 'snow' ? 'snow' : null;
  const particleCount = precipitation === 'rain' ? 16 : 14;
  return <div className="weather-scene" data-scene-id={layer.id} data-sky={scene.sky} data-night={scene.night} data-clouds={scene.clouds} data-phase={layer.phase}>
    <div className="weather-scene-horizon"/>
    {(scene.sky === 'night' || scene.sky === 'blue-hour') && <svg className="weather-scene-stars" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {[0, 1, 2].map(group => <g key={group} className={'weather-scene-star-group stars-' + group}>
        {STAR_POSITIONS.filter((_, index) => index % 3 === group).map(([x, y, opacity]) => <circle key={x + ',' + y} cx={x} cy={y} r=".1" fill="white" opacity={opacity}/>) }
      </g>)}
    </svg>}
    <div className="weather-scene-celestial"><div className="weather-scene-orb"/></div>
    <CloudBank className="weather-scene-cloud-far"/>
    <CloudBank className="weather-scene-cloud-near"/>
    {scene.clouds === 'overcast' && <CloudBank className="weather-scene-cloud-cover"/>}
    {precipitation && <div className={'weather-scene-precipitation weather-scene-' + precipitation}>
      {Array.from({ length: particleCount }, (_, index) => <i className="weather-scene-particle" key={index} style={{
        left: `${(index * 37 + 9) % 100}%`, top: `${(index * 23 + 6) % 100}%`,
        '--particle-delay': `${-(index * (precipitation === 'rain' ? .37 : 1.7))}s`,
        '--particle-duration': `${precipitation === 'rain' ? 2.8 + (index % 4) * .3 : 17 + (index % 5) * 2}s`,
        '--particle-size': `${1.5 + (index % 3) * .55}px`,
      } as CSSProperties}/>)}
    </div>}
    <div className="weather-scene-shade"/>
  </div>;
}

/** Keeps the last scene while a city loads, and never retains more than two layers. */
export function WeatherAtmosphere({ data, motion }: { data: WeatherData | null; motion: boolean }) {
  const latest = useRef(sceneFor(data));
  const nextId = useRef(0);
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, scene: latest.current, phase: 'steady' }]);
  useEffect(() => {
    const next = data ? sceneFor(data) : latest.current;
    if (next.key === latest.current.key) {
      if (!motion) setLayers(previous => previous.length > 1 ? [{ ...previous[previous.length - 1], phase: 'steady' }] : previous);
      return;
    }
    latest.current = next;
    const incoming: Layer = { id: ++nextId.current, scene: next, phase: motion ? 'entering' : 'steady' };
    setLayers(previous => motion ? [{ ...previous[previous.length - 1], phase: 'leaving' }, incoming] : [incoming]);
  }, [data, motion]);
  useEffect(() => {
    if (layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers(previous => [{ ...previous[previous.length - 1], phase: 'steady' }]), CROSSFADE_MS);
    return () => window.clearTimeout(timer);
  }, [layers]);
  return <div className="weather-atmosphere weather-atmosphere-scene" data-motion={motion} aria-hidden="true">
    {layers.map(layer => <SkyScene key={layer.id} layer={layer}/>)}
  </div>;
}
