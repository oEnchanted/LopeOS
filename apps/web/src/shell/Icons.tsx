import { useId } from 'react';

export function LopeMark({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 22.5 12 7h6l-7 15.5H5Z" fill="currentColor"/><path d="M14 22.5 21 7h6l-7 15.5h-6Z" fill="currentColor"/><path d="M5 26h15l3-5.5H8L5 26Z" fill="currentColor" opacity=".52"/></svg>;
}

// Original artwork on a 64px grid. Broad silhouettes survive small previews;
// one upper-left light source and a quiet rim tie the family together.
const palettes: Record<string, [string, string]> = {
  welcome: ['#49afe4', '#256acf'], browser: ['#48b7e7', '#257cce'],
  terminal: ['#344052', '#232e3f'], editor: ['#58ad9d', '#358f81'],
  writer: ['#538cdb', '#3267bd'], weather: ['#48aff1', '#2e7edb'],
  calculator: ['#465166', '#303b4e'], settings: ['#e2e8f0', '#c0ccdb'],
  apps: ['#f0f3f8', '#d7e0ec'], 'image-editor': ['#9382ce', '#7161b2'],
  lightroom: ['#4a8296', '#2c6079'],
};

export function AppIcon({ name, size = 48 }: { name: string; size?: number }) {
  const rawKey = name.replace(/^lope\./, '');
  const key = rawKey === 'text-editor' ? 'editor' : rawKey === 'file-text' ? 'writer' : rawKey;
  const id = `app-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const paint = (part: string) => `url(#${id}-${part})`;
  const [top, bottom] = palettes[key] || palettes.welcome;
  const gradient = (part: string, from: string, to: string, x1 = 16, y1 = 8, x2 = 45, y2 = 58) => (
    <linearGradient id={`${id}-${part}`} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
      <stop stopColor={from}/><stop offset="1" stopColor={to}/>
    </linearGradient>
  );

  function artwork() {
    switch (key) {
      case 'welcome': return <g>
        <path d="m13 43 13-28h11L24 43H13Z" fill="#f5faff"/>
        <path d="m30 43 13-28h10L40 43H30Z" fill="#f5faff"/>
        <path d="M13 49h27l3-6H16l-3 6Z" fill="#b8ecff"/>
      </g>;
      case 'downloads':
      case 'files': return <g>
        <path d="M6 17a5 5 0 0 1 5-5h13l7 7h21a6 6 0 0 1 6 6v27H6V17Z" fill={paint('folder-back')}/>
        <path d="M12 22h40v26H12z" fill="#e8f7ff"/>
        <path d="M5 29a5 5 0 0 1 5-5h44a5 5 0 0 1 5 5l-2 22a6 6 0 0 1-6 6H13a6 6 0 0 1-6-6L5 29Z" fill={paint('folder')}/>
        <path d="M10 25h44" stroke="#e6f8ff" strokeOpacity=".6" strokeLinecap="round"/>
        {key === 'downloads' && <path d="M32 31v15m-6-6 6 6 6-6" stroke="#eaf8ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>}
      </g>;
      case 'trash':
      case 'trash-full': return <g>
        {key === 'trash-full' && <><path d="m18 20-3-12 20-2 3 15" fill={paint('paper')} stroke="#b2c2d1"/><path d="m30 20 3-15 18 6-5 15" fill="#d9e8f1" stroke="#a8bccc"/><path d="m22 11 8-1m-7 5 9-1m7-3 6 2" stroke="#a1b5c6"/></>}
        <path d="M14 20h36l-4 34c-.3 3-3 4-14 4s-13.7-1-14-4l-4-34Z" fill={paint('metal')} stroke="#788d9c"/>
        <ellipse cx="32" cy="20" rx="18" ry="4" fill="#e5edf3" stroke="#93a6b5"/><ellipse cx="32" cy="20" rx="14" ry="2" fill="#5c7080"/>
        {key === 'trash-full' && <path d="m21 21-1-10 12 3 4 9" fill={paint('paper')} stroke="#b2c2d1"/>}
        <path d="m23 28 2 24m7-24v25m9-25-2 24" stroke="#6e8392" strokeWidth="2" opacity=".6"/>
      </g>;
      case 'browser': return <g>
        <circle cx="32" cy="32" r="22" stroke="#f4fbff" strokeWidth="3"/>
        <path d="M32 13v3m0 32v3M13 32h3m32 0h3" stroke="#e4f8ff" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="m44 17-7.5 19.5L20 47l7.5-19.5L44 17Z" fill="#f7fbff"/>
        <path d="m44 17-7.5 19.5-9-9L44 17Z" fill="#ff7d79"/>
      </g>;
      case 'terminal': return <g strokeLinecap="round" strokeLinejoin="round">
        <path d="m16 22 12 10-12 10" stroke="#a6eed6" strokeWidth="4"/>
        <path d="M34 43h14" stroke="#f1f6fc" strokeWidth="4"/>
      </g>;
      case 'editor': return <g>
        <rect x="15" y="10" width="34" height="44" rx="4" fill="#fafcfb"/>
        <path d="M22 21h20M22 28h20M22 35h14" stroke="#678c89" strokeWidth="2.4" strokeLinecap="round"/>
        <path d="M22 43h9" stroke="#678c89" strokeWidth="2.4" strokeLinecap="round"/>
        <path d="M36 39v8m-2-8h4m-4 8h4" stroke="#237e71" strokeWidth="1.8" strokeLinecap="round"/>
      </g>;
      case 'weather': return <g>
        <circle cx="24" cy="24" r="12" fill="#ffdb75"/>
        <path d="M18 49a9 9 0 0 1-1-18 12 12 0 0 1 23-3h2a10.5 10.5 0 0 1 0 21H18Z" fill="#f8fcff"/>
      </g>;
      case 'calculator': return <g>
        <rect x="10" y="10" width="20" height="20" rx="4.5" fill="#e5eaf0"/>
        <rect x="34" y="10" width="20" height="20" rx="4.5" fill="#e5eaf0"/>
        <rect x="10" y="34" width="20" height="20" rx="4.5" fill="#e5eaf0"/>
        <rect x="34" y="34" width="20" height="20" rx="4.5" fill="#f8b65a"/>
        <g stroke="#364354" strokeWidth="2.6" strokeLinecap="round">
          <path d="M15.5 20h9m-4.5-4.5v9M39.5 20h9M16.5 40.5l7 7m0-7-7 7M39.5 41.5h9m-9 5h9"/>
        </g>
      </g>;
      case 'settings': return <g>
        <path d="M28.56 10.27h6.88l.67 5.24a17 17 0 0 1 4.65 1.92l4.17-3.23 4.87 4.87-3.23 4.17a17 17 0 0 1 1.92 4.65l5.24.67v6.88l-5.24.67a17 17 0 0 1-1.92 4.65l3.23 4.17-4.87 4.87-4.17-3.23a17 17 0 0 1-4.65 1.92l-.67 5.24h-6.88l-.67-5.24a17 17 0 0 1-4.65-1.92l-4.17 3.23-4.87-4.87 3.23-4.17a17 17 0 0 1-1.92-4.65l-5.24-.67v-6.88l5.24-.67a17 17 0 0 1 1.92-4.65l-3.23-4.17 4.87-4.87 4.17 3.23a17 17 0 0 1 4.65-1.92l.67-5.24ZM41 32a9 9 0 1 0-18 0 9 9 0 0 0 18 0Z" className="icon-neutral-ink" fill="#536379" fillRule="evenodd"/>
      </g>;
      case 'apps': return <g>
        {['#e5828f', '#e9b663', '#76b5dc', '#6db6a7', '#918acf', '#66b5c7', '#739ac7', '#bf8eae', '#8c9aaf'].map((color, i) =>
          <rect key={color} x={12 + i % 3 * 14} y={12 + Math.floor(i / 3) * 14} width="12" height="12" rx="3.4" fill={color}/>
        )}
      </g>;
      case 'writer': return <g>
        <rect x="15" y="10" width="34" height="44" rx="4" fill="#fafcff"/>
        <path d="m21 21 3.5 15h3L32 25l4.5 11h3L43 21" stroke="#356fc1" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M23 44h18" stroke="#9ab9dd" strokeWidth="2" strokeLinecap="round"/>
      </g>;
      case 'lightroom': return <g>
        <circle cx="32" cy="32" r="22" fill="#e0edf2"/>
        <circle cx="32" cy="32" r="18" fill="#1c3e55"/>
        <circle cx="32" cy="32" r="13" fill="#438fa6"/>
        <circle cx="32" cy="32" r="8" fill="#173449"/>
        <path d="M22.5 27a11 11 0 0 1 11-6" stroke="#a7dce3" strokeWidth="2.5" strokeLinecap="round"/>
      </g>;
      case 'image-editor': return <g>
        <rect x="12" y="12" width="40" height="40" rx="5" fill="#f4f0ff"/>
        <path d="m17 43 10-13 8 10 6-7 6 10v4H17v-4Z" fill="#8c83c9"/>
        <circle cx="40" cy="23" r="4" fill="#edbd73"/>
        <path d="m37 39 12-21a3 3 0 0 1 5 3L42 42l-5-3Z" fill="#3e376e"/>
        <path d="m37 39 5 3c-1 6-5 8-10 7 3-2 1-7 5-10Z" fill="#e78491"/>
      </g>;
      default: return <g fill="#f5faff">
        <path d="m32 13 7 12 13 7-13 7-7 12-7-12-13-7 13-7 7-12Z"/><circle cx="47" cy="16" r="3" fill="#c4eeff"/>
      </g>;
    }
  }

  return <span aria-hidden="true" className={`app-icon app-icon--${key} app-art`} style={{ width: size, height: size, borderRadius: size * .23 }}>
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="app-artwork" focusable="false">
      <defs>
        {gradient('plate', top, bottom, 18, 2, 44, 62)}
        <linearGradient id={`${id}-rim`} x1="25" y1="2" x2="40" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity=".32"/><stop offset=".5" stopColor="#fff" stopOpacity=".06"/><stop offset="1" stopColor="#091c3b" stopOpacity=".12"/>
        </linearGradient>
        <radialGradient id={`${id}-light`} cx=".25" cy="0" r="1"><stop stopColor="#fff" stopOpacity=".06"/><stop offset=".8" stopColor="#fff" stopOpacity="0"/></radialGradient>
        {(key === 'files' || key === 'downloads') && <>
          {gradient('folder-back', '#54bdf5', '#167dc4')}
          <linearGradient id={`${id}-folder`} x1="27" y1="23" x2="32" y2="57" gradientUnits="userSpaceOnUse"><stop className="icon-folder-light" stopColor="#94e1ff"/><stop offset=".22" className="icon-folder-middle" stopColor="#55bfff"/><stop offset="1" className="icon-folder-dark" stopColor="#1788db"/></linearGradient>
        </>}
        {(key === 'trash' || key === 'trash-full') && <>{gradient('metal', '#eef3f8', '#b2c0d0')}{gradient('paper', '#fff', '#eaf0f3')}</>}
      </defs>
      {!['files', 'downloads', 'trash', 'trash-full'].includes(key) && <>
        <rect className="icon-plate" x="2" y="2" width="60" height="60" rx="14" fill={paint('plate')}/>
        <rect className="icon-lighting" x="2" y="2" width="60" height="60" rx="14" fill={paint('light')}/>
        <rect x="2.5" y="2.5" width="59" height="59" rx="13.5" stroke={paint('rim')}/>
      </>}
      {artwork()}
    </svg>
  </span>;
}
