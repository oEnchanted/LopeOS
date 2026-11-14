import { useId } from 'react';

export function LopeMark({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 22.5 12 7h6l-7 15.5H5Z" fill="currentColor"/><path d="M14 22.5 21 7h6l-7 15.5h-6Z" fill="currentColor"/><path d="M5 26h15l3-5.5H8L5 26Z" fill="currentColor" opacity=".52"/></svg>;
}

// Shared account identity: the Lope mark on the account landing page's glass tile.
export function AccountIcon({ size = 32 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false" className="account-icon" style={{ flexShrink: 0, color: 'var(--system-icon-ink, var(--accent))' }}>
    <rect x="1" y="1" width="62" height="62" rx="19" fill="var(--system-icon-surface, var(--glass-icon-background))" stroke="var(--glass-border)"/>
    <g transform="translate(10 10) scale(1.375)" fill="currentColor">
      <path d="M5 22.5 12 7h6l-7 15.5H5Z M14 22.5 21 7h6l-7 15.5h-6Z"/>
      <path d="M5 26h15l3-5.5H8L5 26Z" opacity=".52"/>
    </g>
  </svg>;
}

// Original artwork on a 64px grid. Broad silhouettes survive small previews;
// one upper-left light source and a quiet rim tie the family together.
const palettes: Record<string, [string, string]> = {
  welcome: ['#49afe4', '#256acf'], browser: ['#48b7e7', '#257cce'],
  terminal: ['#344052', '#232e3f'], editor: ['#79d3bd', '#338c85'],
  writer: ['#81c9ed', '#4169bc'], weather: ['#48aff1', '#2e7edb'],
  calculator: ['#465166', '#303b4e'], settings: ['#dfeaf5', '#93a8c3'],
  apps: ['#a6b8f4', '#5f70be'], 'image-editor': ['#b49aee', '#7250b6'],
  lightroom: ['#62d5ca', '#247e9b'],
  'movie-maker': ['#a68de4', '#6150ad'],
  'video-editor': ['#719bd4', '#36568e'],
  'media-player': ['#f6a54b', '#d4502a'],
  preview: ['#7fcaf6', '#3466c8'],
  'image-generator': ['#e59ad6', '#7d4fc0'],
  sheets: ['#55bd8d', '#18734e'],
};

export function AppIcon({ name, size = 48 }: { name: string; size?: number }) {
  const rawKey = name.replace(/^lope\./, '');
  const key = rawKey === 'text-editor' ? 'editor' : rawKey === 'file-text' ? 'writer' : rawKey;
  const id = `app-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const paint = (part: string) => `url(#${id}-${part})`;
  const [top, bottom] = palettes[key] || palettes.welcome;
  const gradient = (part: string, from: string, to: string, x1 = 16, y1 = 8, x2 = 45, y2 = 58) => (
    <linearGradient id={`${id}-${part}`} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
      <stop stopColor={`var(--icon-${part}-top, ${from})`}/><stop offset="1" stopColor={`var(--icon-${part}-bottom, ${to})`}/>
    </linearGradient>
  );

  function artwork() {
    switch (key) {
      case 'image-generator': return <g strokeLinejoin="round">
        <rect x="10" y="15" width="40" height="36" rx="5" fill="var(--glass-icon-background)" stroke="var(--icon-light, #fbefff)" strokeWidth="2"/>
        <path d="m13 47 11-12 8 8 6-5 10 9" fill="var(--icon-ink, #5b3596)" fillOpacity=".55" stroke="var(--icon-light, #fbefff)" strokeWidth="2" strokeLinecap="round"/>
        <path d="m45 7 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="var(--icon-light, #fff)"/>
        <circle cx="22" cy="25" r="3" fill="var(--icon-accent, #ffd9f4)"/>
      </g>;
      case 'preview': return <g strokeLinejoin="round">
        <rect x="13" y="9" width="36" height="30" rx="4" transform="rotate(-9 31 24)" fill="var(--glass-icon-background)" stroke="var(--icon-light, #eaf6ff)" strokeOpacity=".7" strokeWidth="1.5"/>
        <rect x="15" y="20" width="38" height="32" rx="4" fill="var(--icon-light, #f7fbff)"/>
        <rect x="19" y="24" width="30" height="20" rx="2" fill="var(--icon-mid, #bfe3ff)"/>
        <path d="m19 44 9-10 6 6 4-3 11 7H19Z" fill="var(--icon-ink, #2d5fb8)"/>
        <circle cx="41" cy="30" r="3" fill="var(--icon-accent, #ffd66b)"/>
      </g>;
      case 'media-player': return <g strokeLinejoin="round">
        <circle cx="29" cy="32" r="18" fill="var(--icon-light, #fff4e8)"/>
        <path d="m24 23.5 14 8.5-14 8.5v-17Z" fill="var(--icon-ink, #c2461f)"/>
        <path d="M50 22a15 15 0 0 1 0 20M45 26.5a8.5 8.5 0 0 1 0 11" stroke="var(--icon-light, #fff4e8)" strokeWidth="3.2" strokeLinecap="round" fill="none"/>
      </g>;
      case 'video-editor': return <g strokeLinejoin="round">
        <rect x="9" y="11" width="46" height="31" rx="4" fill="#152b49" stroke="#d3e7ff" strokeWidth="2"/>
        <path d="m27 18 13 8-13 8V18Z" fill="#e7f2ff"/>
        <path d="M11 49h23m6 0h13M11 55h12m6 0h24" stroke="#daeaff" strokeWidth="4" strokeLinecap="round"/>
        <path d="M37 44v14" stroke="#f9cd89" strokeWidth="2"/>
      </g>;
      case 'movie-maker': return <g strokeLinejoin="round">
        <rect x="10" y="14" width="44" height="38" rx="4" fill="#f5f2ff"/>
        <path d="M10 24h44v24a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V24Z" fill="#34285c"/>
        <path d="m12 14 8 10m4-10 8 10m4-10 8 10m4-10 6 8" stroke="#4c3d7b" strokeWidth="5"/>
        <path d="m27 30 14 8-14 8V30Z" fill="#f7f4ff"/>
      </g>;
      case 'welcome': return <g>
        <path d="m13 43 13-28h11L24 43H13Z" fill={paint('porcelain')}/>
        <path d="m30 43 13-28h10L40 43H30Z" fill={paint('porcelain')}/>
        <path d="M13 49h27l3-6H16l-3 6Z" fill="var(--icon-mid, #b8ecff)"/>
      </g>;
      case 'downloads':
      case 'files': return <g>
        <path d="M6 17a5 5 0 0 1 5-5h13l7 7h21a6 6 0 0 1 6 6v27H6V17Z" fill={paint('folder-back')}/>
        <rect x="12" y="19" width="40" height="30" rx="3" fill={paint('porcelain')}/>
        <path d="M5 29a5 5 0 0 1 5-5h44a5 5 0 0 1 5 5l-2 22a6 6 0 0 1-6 6H13a6 6 0 0 1-6-6L5 29Z" fill={paint('folder')}/>
        <path d="M12 25h40" stroke="var(--icon-light, #e6f8ff)" strokeOpacity=".6" strokeLinecap="round"/>
        <path d="M13 49h15" stroke="var(--icon-light, #e6f8ff)" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round"/>
        {key === 'downloads' && <path d="M32 31v15m-6-6 6 6 6-6" stroke="var(--icon-light, #eaf8ff)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>}
      </g>;
      case 'trash':
      case 'trash-full': return <g>
        {key === 'trash-full' && <><path d="m18 20-3-12 20-2 3 15" fill={paint('paper')} stroke="var(--icon-mid, #b2c2d1)"/><path d="m30 20 3-15 18 6-5 15" fill="var(--icon-mid, #d9e8f1)" stroke="var(--icon-mid, #a8bccc)"/><path d="m22 11 8-1m-7 5 9-1m7-3 6 2" stroke="var(--icon-mid, #a1b5c6)"/></>}
        <path d="M14 20h36l-4 32c-.4 4-4 6-14 6s-13.6-2-14-6l-4-32Z" fill={paint('metal')} stroke="var(--icon-ink, #788d9c)"/>
        <ellipse cx="32" cy="20" rx="18" ry="4" fill="var(--icon-mid, #e5edf3)" stroke="var(--icon-mid, #93a6b5)"/><ellipse cx="32" cy="20" rx="14" ry="2" fill="var(--icon-ink, #5c7080)"/>
        {key === 'trash-full' && <path d="m21 21-1-10 12 3 4 9" fill={paint('paper')} stroke="var(--icon-mid, #b2c2d1)"/>}
        <path d="m24 29 2 20m12-20-2 20" stroke="var(--icon-ink, #6e8392)" strokeWidth="2.5" opacity=".5"/>
      </g>;
      case 'browser': return <g>
        <circle cx="32" cy="32" r="23" fill={paint('porcelain')} stroke="var(--icon-light, #e4f8ff)" strokeWidth="1"/>
        <circle cx="32" cy="32" r="18.5" fill={paint('ocean')}/>
        <path d="M32 16v3m0 26v3M16 32h3m26 0h3" stroke="var(--icon-light, #e4f8ff)" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="m43 19-7 17-17 9 9-17 15-9Z" fill="var(--icon-light, #f7fbff)"/>
        <path d="m43 19-7 17-8-8 15-9Z" fill="var(--icon-accent, #ff7d79)"/>
        <circle cx="32" cy="32" r="2.2" fill="var(--icon-light, #fff)"/>
      </g>;
      case 'terminal': return <g strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="12" width="46" height="40" rx="8" fill={paint('screen')} stroke="var(--icon-mid, #8195a8)" strokeWidth="1"/>
        <path d="M10 22h44" stroke="var(--icon-mid, #8195a8)" strokeOpacity=".5"/>
        <path d="M17 17h1m5 0h1m5 0h1" stroke="var(--icon-accent, #a6eed6)" strokeWidth="2"/>
        <path d="m18 29 8 7-8 7" stroke="var(--icon-accent, #a6eed6)" strokeWidth="3.2"/>
        <path d="M33 43h12" stroke="var(--icon-light, #f1f6fc)" strokeWidth="3.2"/>
      </g>;
      case 'editor': return <g strokeLinejoin="round">
        <path d="M19 9h20l11 11v31a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4V13a4 4 0 0 1 4-4Z" fill={paint('porcelain')}/>
        <path d="M39 9v8a3 3 0 0 0 3 3h8" fill="var(--icon-mid, #b7e6df)"/>
        <path d="M23 27h18M23 34h18M23 41h9" stroke="var(--icon-ink, #43877e)" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M39 39v10m-2-10h4m-4 10h4" stroke="var(--icon-ink, #237e71)" strokeWidth="2" strokeLinecap="round"/>
      </g>;
      case 'weather': return <g>
        <circle cx="25" cy="24" r="16" fill="var(--icon-accent, #ffdb75)" fillOpacity=".2"/>
        <circle cx="25" cy="24" r="11.5" fill={paint('sun')}/>
        <path d="M17 50a9 9 0 0 1-1-18 12 12 0 0 1 23-3h3a10.5 10.5 0 0 1 0 21H17Z" fill={paint('porcelain')} stroke="var(--icon-light, #f8fcff)" strokeWidth=".8"/>
        <path d="M19 46h23" stroke="var(--icon-mid, #b6d9ef)" strokeWidth="1.5" strokeLinecap="round"/>
      </g>;
      case 'calculator': return <g>
        <rect x="12" y="9" width="40" height="46" rx="8" fill={paint('screen')} stroke="var(--icon-mid, #8195a8)"/>
        <rect x="17" y="14" width="30" height="10" rx="3" fill="var(--icon-mid, #d8eee7)"/>
        <path d="M36 19h7" stroke="var(--icon-ink, #43877e)" strokeWidth="2" strokeLinecap="round"/>
        <rect x="17" y="29" width="13" height="10" rx="3" fill={paint('porcelain')}/>
        <rect x="17" y="42" width="13" height="8" rx="3" fill={paint('porcelain')}/>
        <rect x="34" y="29" width="13" height="21" rx="3" fill={paint('sun')}/>
        <path d="M21 34h5m-2.5-2.5v5M21 46h5M38 37h5m-5 5h5" stroke="var(--icon-ink, #364354)" strokeWidth="1.8" strokeLinecap="round"/>
      </g>;
      case 'settings': return <g>
        <circle cx="32" cy="32" r="24" fill={paint('porcelain')} stroke="var(--icon-light, #eff7ff)"/>
        <circle cx="32" cy="32" r="7" fill={paint('ocean')}/>
        <path d="M28.56 10.27h6.88l.67 5.24a17 17 0 0 1 4.65 1.92l4.17-3.23 4.87 4.87-3.23 4.17a17 17 0 0 1 1.92 4.65l5.24.67v6.88l-5.24.67a17 17 0 0 1-1.92 4.65l3.23 4.17-4.87 4.87-4.17-3.23a17 17 0 0 1-4.65 1.92l-.67 5.24h-6.88l-.67-5.24a17 17 0 0 1-4.65-1.92l-4.17 3.23-4.87-4.87 3.23-4.17a17 17 0 0 1-1.92-4.65l-5.24-.67v-6.88l5.24-.67a17 17 0 0 1 1.92-4.65l-3.23-4.17 4.87-4.87 4.17 3.23a17 17 0 0 1 4.65-1.92l.67-5.24ZM41 32a9 9 0 1 0-18 0 9 9 0 0 0 18 0Z" className="icon-neutral-ink" fill="var(--icon-ink, #536379)" fillRule="evenodd"/>
      </g>;
      case 'apps': return <g>
        {['#c2f3ed', '#ffe3ac', '#f1caff', '#d0e6ff'].map((color, i) =>
          <rect key={color} x={12 + i % 2 * 22} y={12 + Math.floor(i / 2) * 22} width="18" height="18" rx="5.5" fill={`var(--icon-accent, ${color})`} stroke="var(--glass-border)"/>
        )}
        <path d="M16 16h9m13 0h9M16 38h9m13 0h9" stroke="var(--icon-light, #fff)" strokeOpacity=".65" strokeLinecap="round"/>
      </g>;
      case 'writer': return <g strokeLinejoin="round">
        <path d="M17 49 22 28 43 12l10 10-16 21-20 6Z" fill={paint('facet')} stroke="var(--glass-border)" strokeWidth="1.2"/>
        <path d="m17 49 17-17 9-20-21 16-5 21Z" fill="var(--glass-icon-background)"/>
        <path d="m17 49 17-17" stroke="var(--icon-ink, #294f94)" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="34" cy="32" r="3" fill="var(--icon-ink, #294f94)"/>
        <path d="m22 28 21-16 10 10M16 54h30" stroke="var(--icon-light, #eefaff)" strokeWidth="2" strokeLinecap="round"/>
      </g>;
      case 'lightroom': return <g>
        <circle cx="32" cy="32" r="22" fill={paint('facet')} stroke="var(--glass-border)" strokeWidth="1.2"/>
        <path d="M32 10a22 22 0 0 0-19 33l19-11V10Z" fill="var(--glass-icon-background)"/>
        <path d="m32 32 19 11a22 22 0 0 0 0-22L32 32Z" fill="var(--icon-accent, #c1fff0)" fillOpacity=".5"/>
        <circle cx="32" cy="32" r="12" fill="var(--icon-ink, #206b85)"/>
        <circle cx="32" cy="32" r="8" fill={paint('facet')}/>
        <path d="M17 28a16 16 0 0 1 15-12" stroke="var(--icon-light, #efffff)" strokeWidth="2.2" strokeLinecap="round"/>
      </g>;
      case 'image-editor': return <g strokeLinejoin="round">
        <path d="m11 36 21-12 21 12-21 13-21-13Z" fill="var(--icon-ink, #614196)" stroke="var(--icon-mid, #d6c3ff)" strokeWidth="1.2"/>
        <path d="m11 28 21-12 21 12-21 13-21-13Z" fill={paint('facet')} stroke="var(--glass-border)" strokeWidth="1.2"/>
        <path d="m11 28 21-12v25L11 28Z" fill="var(--glass-icon-background)"/>
        <path d="m32 16 21 12-21 5V16Z" fill="var(--icon-accent, #f5dcff)" fillOpacity=".55"/>
        <path d="m11 28 21-12 21 12M11 44l21 13 21-13" stroke="var(--icon-light, #f3eaff)" strokeWidth="2" strokeLinecap="round"/>
      </g>;
      default: return <g fill="var(--icon-light, #f5faff)">
        <path d="m32 13 7 12 13 7-13 7-7 12-7-12-13-7 13-7 7-12Z"/><circle cx="47" cy="16" r="3" fill="var(--icon-accent, #c4eeff)"/>
      </g>;
    }
  }

  return <span aria-hidden="true" className={`app-icon app-icon--${key} app-art`} style={{ width: size, height: size, borderRadius: size * .23 }}>
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="app-artwork" focusable="false">
      <defs>
        {gradient('plate', top, bottom, 18, 2, 44, 62)}
        {gradient('porcelain', '#ffffff', '#cde1f0')}
        {gradient('ocean', '#6dc7ef', '#206cb5')}
        {gradient('screen', '#354c60', '#152b3e')}
        {gradient('sun', '#ffe7a2', '#f1af46')}
        {['writer', 'lightroom', 'image-editor'].includes(key) && gradient('facet', '#f4fcff', top, 14, 10, 48, 52)}
        <linearGradient id={`${id}-rim`} x1="25" y1="2" x2="40" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity=".32"/><stop offset=".5" stopColor="#fff" stopOpacity=".06"/><stop offset="1" stopColor="#091c3b" stopOpacity=".12"/>
        </linearGradient>
        <radialGradient id={`${id}-light`} cx=".25" cy="0" r="1"><stop stopColor="#fff" stopOpacity=".06"/><stop offset=".8" stopColor="#fff" stopOpacity="0"/></radialGradient>
        {(key === 'files' || key === 'downloads') && <>
          {gradient('folder-back', '#54bdf5', '#167dc4')}
          <linearGradient id={`${id}-folder`} x1="27" y1="23" x2="32" y2="57" gradientUnits="userSpaceOnUse"><stop className="icon-folder-light" stopColor="var(--icon-folder-top, #94e1ff)"/><stop offset=".22" className="icon-folder-middle" stopColor="var(--icon-folder-middle, #55bfff)"/><stop offset="1" className="icon-folder-dark" stopColor="var(--icon-folder-bottom, #1788db)"/></linearGradient>
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
