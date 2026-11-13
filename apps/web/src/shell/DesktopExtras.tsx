import {useEffect,useState} from 'react';
import {usePreferences} from '../../../../packages/sdk/src/preferences';
import {interfaceScale,viewport} from './appearance';
export function HoverReader() {
 const p=usePreferences();const [item,setItem]=useState<{text:string;x:number;y:number}|null>(null);
 useEffect(()=>{if(!p.hoverText){setItem(null);return;}let timer:ReturnType<typeof setTimeout>;const show=(event:Event)=>{clearTimeout(timer);const el=(event.target as HTMLElement).closest<HTMLElement>('button,label,[role=menuitem],.settings-row-label,.window-title');if(!el||el.closest('.hover-reader')){setItem(null);return;}timer=setTimeout(()=>{const bounds=el.getBoundingClientRect();const scale=interfaceScale();const text=el.getAttribute('aria-label')||el.textContent||'';if(text.trim())setItem({text:text.trim().slice(0,160),x:Math.max(8,Math.min(bounds.left/scale,viewport().width-330)),y:Math.max(40,Math.min(bounds.bottom/scale+10,viewport().height-100))});},450);};const clear=()=>{clearTimeout(timer);setItem(null);};document.addEventListener('pointerover',show);document.addEventListener('focusin',show);document.addEventListener('pointerdown',clear);document.addEventListener('keydown',clear);return()=>{clearTimeout(timer);document.removeEventListener('pointerover',show);document.removeEventListener('focusin',show);document.removeEventListener('pointerdown',clear);document.removeEventListener('keydown',clear);};},[p.hoverText]);
 return item?<div className="hover-reader" role="tooltip" style={{left:item.x,top:item.y}}>{item.text}</div>:null;
}
