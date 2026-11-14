import { id, parseProject, type Caption, type Project, type Sequence } from './model.ts';
import { frameSeconds, timecode, type Rational, rateValue } from './time.ts';
const stamp=(seconds:number)=>{const ms=Math.round(seconds*1000),s=Math.floor(ms/1000);return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
export function parseCaptions(text:string,fps:Rational):Caption[] {
  const rows=text.replace(/^\uFEFF/,'').replace(/\r/g,'').replace(/^WEBVTT[^\n]*\n/,'').trim().split(/\n\s*\n/);const result:Caption[]=[];
  function parse(t:string){const match=/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/.exec(t);if(!match||+match[2]>59||+match[3]>59)throw new Error('Invalid caption timestamp.');return Math.round(((+(match[1]||0)*3600)+(+match[2]*60)+(+match[3])+(+match[4]/1000))*rateValue(fps));}
  for(const row of rows){if(/^NOTE\b/.test(row))continue;const lines=row.split('\n'),i=lines.findIndex(l=>l.includes('-->'));if(i<0)continue;const m=/^(\S+)\s+-->\s+(\S+)/.exec(lines[i]);if(!m)throw new Error('Invalid caption timing.');const start=parse(m[1]),end=parse(m[2]);if(end<=start)throw new Error('Caption end must follow its start.');const content=lines.slice(i+1).join('\n').replace(/<[^>]*>/g,'');if(content)result.push({id:id('caption'),start,end,text:content});}
  result.sort((a,b)=>a.start-b.start);if(!result.length)throw new Error('No SRT or WebVTT captions were found.');return result;
}
export function exportSrt(captions:Caption[],fps:Rational){return captions.map((c,i)=>`${i+1}\n${stamp(frameSeconds(c.start,fps))} --> ${stamp(frameSeconds(c.end,fps))}\n${c.text}\n`).join('\n');}
export function exportEdl(s:Sequence) {
  const t=s.tracks.find(t=>t.kind==='video'),clips=s.clips.filter(c=>c.trackId===t?.id).sort((a,b)=>a.start-b.start);const loss=['CMX 3600: only first video track, straight cuts, source names and sequence placements. Audio, effects, captions, other tracks, nesting, variable speed and transitions are omitted.'];
  const text=`TITLE: ${s.name}\nFCM: ${s.dropFrame?'DROP FRAME':'NON-DROP FRAME'}\n\n`+clips.map((c,i)=>`${String(i+1).padStart(3,'0')}  AX       V     C        ${timecode(Math.round(c.sourceIn/705600000*rateValue(s.fps)),s.fps,s.dropFrame)} ${timecode(Math.round(c.sourceIn/705600000*rateValue(s.fps))+c.duration,s.fps,s.dropFrame)} ${timecode(c.start,s.fps,s.dropFrame)} ${timecode(c.start+c.duration,s.fps,s.dropFrame)}\n* FROM CLIP NAME: ${c.name.replace(/[\r\n]/g,' ')}\n`).join('\n');return {text,loss};
}
const MAGIC=new TextEncoder().encode('LOPEVIDEOPACK2\n');
export async function packageProject(p:Project,blob:(key:string)=>Promise<Blob>) {
  const keys=[...new Set(p.assets.map(a=>a.blobKey))],blobs=await Promise.all(keys.map(blob));const header=new TextEncoder().encode(JSON.stringify({project:p,files:keys.map((key,i)=>({key,size:blobs[i].size,type:blobs[i].type}))}));const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,header.length,true);return new Blob([MAGIC,length,header,...blobs],{type:'application/x-lope-video-package'});
}
export async function unpackProject(blob:Blob,put:(key:string,b:Blob)=>Promise<void>) {
  const prefix=new Uint8Array(await blob.slice(0,MAGIC.length+4).arrayBuffer());if(prefix.length!==MAGIC.length+4||!MAGIC.every((n,i)=>n===prefix[i]))throw new Error('Not a LopeOS video package.');
  const length=new DataView(prefix.buffer).getUint32(MAGIC.length,true);if(length>32*1024*1024||length>blob.size-prefix.length)throw new Error('Invalid package header.');let offset=prefix.length+length;
  const header=JSON.parse(await blob.slice(prefix.length,offset).text()),project=parseProject(JSON.stringify(header.project));
  const entries:{key:string;size:number;type:string}[]=header.files;const seen=new Set<string>();for(const file of entries){if(!Number.isSafeInteger(file.size)||file.size<0||offset+file.size>blob.size||seen.has(file.key))throw new Error('Invalid package media size or duplicate entry.');seen.add(file.key);offset+=file.size;}
  if(offset!==blob.size||project.assets.some(a=>!seen.has(a.blobKey)))throw new Error('Incomplete project package.');
  offset=prefix.length+length;for(const file of entries){await put(file.key,blob.slice(offset,offset+file.size,file.type));offset+=file.size;}return project;
}
export function parseCube(text:string,name:string) {let size=0;const data:number[]=[];for(const raw of text.split(/\r?\n/)){const l=raw.trim();if(!l||l.startsWith('#')||l.startsWith('TITLE'))continue;if(l.startsWith('LUT_3D_SIZE')){size=Number(l.split(/\s+/)[1]);continue;}if(l.startsWith('DOMAIN_')){const values=l.split(/\s+/).slice(1).map(Number);if(!values.every(v=>v===(l.startsWith('DOMAIN_MIN')?0:1)))throw new Error('Only normalized 0–1 LUT domains are supported.');continue;}if(l.startsWith('LUT_1D'))throw new Error('Choose a 3D .cube LUT.');const values=l.split(/\s+/).map(Number);if(values.length===3&&values.every(Number.isFinite))data.push(...values);else throw new Error('Invalid LUT row.');}if(!Number.isInteger(size)||size<2||size>65||data.length!==size**3*3)throw new Error('LUT size does not match the RGB table.');return {size,data,name};}
