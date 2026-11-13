import { useState } from 'react';
import { ArrowUpRight, ArrowRight, Home, Keyboard, Palette, Info, Command } from 'lucide-react';
import { Button } from '../../../../packages/ui/src';
import type { AppContext } from '../../../../packages/contracts/src';
import { AppIcon, LopeMark } from './Icons';
import { buildInfo } from './system';

export default function Welcome({ context }: { context: AppContext }) {
  const [section, setSection] = useState('Overview');
  const launch = context.services.launch;
  return <div className="welcome-app">
    <aside className="welcome-sidebar"><div className="welcome-brand"><LopeMark size={32}/><div>Lope<span>OS</span><small>Web workspace</small></div></div>
      {[['Overview', Home], ['Appearance', Palette], ['Keyboard shortcuts', Keyboard], ['About LopeOS', Info]].map(([label, Icon]) => { const I = Icon as typeof Home; return <button key={String(label)} className={section === label ? 'selected' : ''} onClick={() => setSection(String(label))}><I size={16}/>{String(label)}</button>; })}
      <div className="welcome-sidebar-bottom">LopeOS {buildInfo.version}<small>Developer preview</small></div>
    </aside>
    <main className="welcome-main">
    {section === 'Overview' ? <>
      <div className="welcome-emblem"><AppIcon name="welcome" size={72}/></div>
      <h1>Welcome to LopeOS</h1>
      <div className="welcome-actions"><Button variant="primary" onClick={() => launch('lope.files')}>Open workspace <ArrowRight size={14}/></Button><Button onClick={() => launch('lope.settings')}>Settings…</Button></div>
      <div className="welcome-divider"/><div className="welcome-section-title"><h2>Applications</h2><button onClick={() => window.dispatchEvent(new Event('lope:search'))}>Show all <ArrowRight size={12}/></button></div>
      <div className="essentials-grid">{[['writer','Writer','Word documents'],['image-editor','Image Editor','Photos and design'],['browser','Lope Browser','Browse the web'],['files','Files','Manage your files']].map(([id,name,description]) => <button className="essential-card" key={id} onClick={() => launch(`lope.${id}`)}><AppIcon name={id} size={41}/><div><strong>{name}</strong><small>{description}</small></div><ArrowUpRight size={12}/></button>)}</div>
      <div className="welcome-tip"><Command size={14}/><span>Press <kbd>⌘ / Ctrl K</kbd> to find apps, files, and commands.</span></div>
    </> : section === 'Appearance' ? <><h1>Appearance</h1><div className="appearance-preview"><div className="mini-glass"><LopeMark size={36}/><span>LopeOS</span></div></div><Button variant="primary" onClick={() => launch('lope.settings')}>Open appearance settings <Palette size={15}/></Button></> : section === 'Keyboard shortcuts' ? <><h1>Keyboard shortcuts</h1><div className="shortcut-list">{[['Find applications and files','⌘ / Ctrl + K'],['Close a window','⌘ / Ctrl + W'],['Open system menu','Alt + F10'],['Move a window','Alt + Arrow'],['Resize a window','Alt + Shift + Arrow'],['Dismiss menus','Esc']].map(([label,keys]) => <div key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}</div><p className="welcome-note">Window actions are also available in the Window menu. Browser-reserved shortcuts have menu alternatives.</p></> : <><div className="welcome-emblem"><AppIcon name="welcome" size={80}/></div><h1>LopeOS</h1><p className="welcome-lede">Version {buildInfo.version} · Developer preview</p><p className="welcome-note">LopeOS runs in your browser. Workspace files and remote browser sessions use connected services.</p><p className="welcome-note">Wallpapers by <a href="https://perfecthue.com/wallpapers/" target="_blank" rel="noreferrer">Perfect Hue</a>. Included with permission.<br/>Tidal wallpaper and application icon artwork by LopeOS.</p><Button onClick={() => launch('lope.settings', {page:'privacy'})}>Privacy &amp; Security <ArrowRight size={14}/></Button></>}
    </main>
  </div>;
}
