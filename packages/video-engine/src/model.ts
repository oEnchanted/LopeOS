import { TIME_BASE, frameTicks, rateValue, type Rational } from './time.ts';
export type ID = string;
export const id = (prefix='id') => `${prefix}-${crypto.randomUUID()}`;
export interface ColorMetadata { primaries: string; transfer: string; matrix: string; range: string; bitDepth: number|null; policy: 'sdr'|'unverified'|'hdr-rejected' }
export interface MediaAsset {
  id: ID; name: string; blobKey: string; bytes: number; mime: string; hash: string; duration: number;
  width: number; height: number; rotation: number; frameRate: Rational|null;
  videoCodec: string|null; audioCodec: string|null; channels: number; sampleRate: number;
  color: ColorMetadata; binId: ID|null; label: string; path?: string;
  proxyKey?: string; proxyWidth?: number; missing?: boolean; waveform?: number[];
  kind: 'video'|'audio'|'image';
}
export interface Keyframe { frame: number; value: number; interpolation: 'linear'|'hold'|'smooth' }
export interface Parameter { value: number; keys: Keyframe[] }
export const param = (value: number): Parameter => ({value,keys:[]});
export interface Effect { id: ID; type: 'transform'|'opacity'|'crop'|'color'|'blur'|'lut'; enabled: boolean; params: Record<string,Parameter>; lut?: { size: number; data: number[]; name: string } }
export interface Mask { kind:'ellipse'|'rectangle'; x:number; y:number; width:number; height:number; feather:number; invert:boolean }
export interface Graphic { type:'text'|'rectangle'|'ellipse'; text:string; font:string; size:number; weight:number; color:string; background:string; align:'left'|'center'|'right'; x:number; y:number; width:number; height:number }
export interface Clip {
  id:ID; name:string; trackId:ID; assetId?:ID; sequenceId?:ID; kind:'media'|'title'|'shape'|'adjustment'|'nested';
  start:number; duration:number; sourceIn:number; speed:Rational; remap:Keyframe[]; linkId?:ID; label:string;
  effects:Effect[]; gain:Parameter; pan:Parameter; fadeIn:number; fadeOut:number; enabled:boolean;
  blend:GlobalCompositeOperation; mask?:Mask; graphic?:Graphic; freeze?:number;
  multicam?: { angles:{ assetId:ID; offset:number }[]; active:number };
}
export interface Track { id:ID; name:string; kind:'video'|'audio'; locked:boolean; visible:boolean; muted:boolean; solo:boolean; syncLock:boolean; volume:number; pan:number; height:number; channels:number[]; eq:{ low:number; mid:number; high:number }; compressor:{ enabled:boolean; threshold:number; ratio:number }; limiter:boolean }
export interface Marker { id:ID; frame:number; name:string; color:string }
export interface Caption { id:ID; start:number; end:number; text:string }
export interface Transition { id:ID; left:ID; right:ID; duration:number; type:'dissolve'|'equal-power'; handlePolicy:'require' }
export interface Sequence {
  id:ID; name:string; width:number; height:number; fps:Rational; dropFrame:boolean; sampleRate:number;
  tracks:Track[]; clips:Clip[]; transitions:Transition[]; markers:Marker[]; captions:Caption[];
  inPoint:number; outPoint:number|null; background:string;
}
export interface Project { format:'lope-video'; version:2; id:ID; name:string; created:string; modified:string; assets:MediaAsset[]; bins:{id:ID;name:string;parentId:ID|null}[]; sequences:Sequence[]; activeSequence:ID; settings:{ colorPolicy:'SDR-sRGB'; autosave:boolean }; }
export function makeTrack(kind:Track['kind'],n:number):Track { return {id:id('track'),name:`${kind==='video'?'V':'A'}${n}`,kind,locked:false,visible:true,muted:false,solo:false,syncLock:true,volume:0,pan:0,height:kind==='video'?54:48,channels:[0,1],eq:{low:0,mid:0,high:0},compressor:{enabled:false,threshold:-18,ratio:4},limiter:true}; }
export function makeSequence(name='Sequence 01',fps:Rational={num:30000,den:1001},width=1920,height=1080):Sequence { return {id:id('sequence'),name,width,height,fps,dropFrame:fps.den===1001&&fps.num!==24000,sampleRate:48000,tracks:[makeTrack('video',1),makeTrack('video',2),makeTrack('video',3),makeTrack('audio',1),makeTrack('audio',2),makeTrack('audio',3)],clips:[],transitions:[],markers:[],captions:[],inPoint:0,outPoint:null,background:'#000000'}; }
export function createProject(name='Untitled project'):Project { const s=makeSequence(); return {format:'lope-video',version:2,id:id('project'),name,created:new Date().toISOString(),modified:new Date().toISOString(),assets:[],bins:[],sequences:[s],activeSequence:s.id,settings:{colorPolicy:'SDR-sRGB',autosave:true}}; }
export function currentSequence(p:Project) { return p.sequences.find(s=>s.id===p.activeSequence)!; }
export function sequenceEnd(s:Sequence) { return Math.max(0,...s.clips.map(c=>c.start+c.duration),...s.captions.map(c=>c.end)); }
export function defaultEffects():Effect[] { return [
  {id:id('fx'),type:'transform',enabled:true,params:{x:param(0),y:param(0),scale:param(100),rotation:param(0),anchorX:param(50),anchorY:param(50)}},
  {id:id('fx'),type:'opacity',enabled:true,params:{opacity:param(100)}},
]; }
export function makeClip(trackId:ID,start:number,duration:number,asset?:MediaAsset):Clip { return {id:id('clip'),name:asset?.name||'Graphic',trackId,assetId:asset?.id,kind:asset?'media':'title',start,duration,sourceIn:0,speed:{num:1,den:1},remap:[],label:asset?.label||'#8b7bb8',effects:defaultEffects(),gain:param(0),pan:param(0),fadeIn:0,fadeOut:0,enabled:true,blend:'source-over'}; }
export function valueAt(p:Parameter|undefined,frame:number,fallback=0) {
  if(!p) return fallback;
  const keys=p.keys; if(!keys.length) return p.value;
  if(frame<=keys[0].frame) return keys[0].value;
  for(let i=1;i<keys.length;i++) if(frame<keys[i].frame) { const a=keys[i-1],b=keys[i]; let t=(frame-a.frame)/(b.frame-a.frame); if(a.interpolation==='hold') t=0; if(a.interpolation==='smooth') t=t*t*(3-2*t); return a.value+(b.value-a.value)*t; }
  return keys[keys.length-1].value;
}
export function sourceTick(clip:Clip,localFrame:number,fps:Rational) {
  if(clip.freeze!==undefined) return clip.freeze;
  if(clip.remap.length) return Math.round(valueAt({value:clip.sourceIn,keys:clip.remap},localFrame));
  return clip.sourceIn+Math.round(frameTicks(localFrame,fps)*clip.speed.num/clip.speed.den);
}
export function validateProject(p:Project) {
  if(p.format!=='lope-video'||p.version!==2||!p.sequences?.length) throw new Error('Not a supported LopeOS video project.');
  if(!p.sequences.some(s=>s.id===p.activeSequence)) throw new Error('Active sequence is missing.');
  const ids=new Set<string>(); const unique=(value:string)=>{if(!value||ids.has(value))throw new Error('Duplicate or missing project ID.');ids.add(value);};
  const integer=(v:number)=>Number.isSafeInteger(v);
  for(const a of p.assets) {unique(a.id);if(!integer(a.duration)||a.duration<0||!a.blobKey)throw new Error('Invalid media reference.');}
  for(const s of p.sequences) {
    unique(s.id);
    if(!integer(s.fps.num)||!integer(s.fps.den)||s.fps.num<=0||s.fps.den<=0||rateValue(s.fps)>240||rateValue(s.fps)<1)throw new Error('Invalid sequence frame rate.');
    if(!integer(s.width)||!integer(s.height)||s.width<16||s.height<16||s.width>8192||s.height>8192)throw new Error('Sequence dimensions must be 16–8192 pixels.');
    if(![44100,48000,96000].includes(s.sampleRate))throw new Error('Unsupported sample rate.');
    for(const t of s.tracks) unique(t.id);
    for(const c of s.clips) {
      unique(c.id);
      if(!s.tracks.some(t=>t.id===c.trackId)||!integer(c.start)||c.start<0||!integer(c.duration)||c.duration<1||!integer(c.sourceIn)||c.sourceIn<0||!integer(c.speed.num)||!integer(c.speed.den)||c.speed.den<=0||!c.speed.num) throw new Error(`Invalid placement for ${c.name}.`);
      const asset=p.assets.find(a=>a.id===c.assetId);
      if(c.kind==='media'&&!asset)throw new Error(`Missing asset record for ${c.name}.`);
      if(asset&&asset.kind!=='image') {
        const ticks=[sourceTick(c,0,s.fps),sourceTick(c,c.duration-1,s.fps),...c.remap.map(k=>k.value)];
        if(ticks.some(t=>t<0||t>=asset.duration))throw new Error(`Insufficient source handles for ${c.name}.`);
      }
      if(c.kind==='nested'&&!p.sequences.some(n=>n.id===c.sequenceId))throw new Error('Nested sequence is missing.');
      if(c.multicam){
        if(!integer(c.multicam.active)||c.multicam.active<0||c.multicam.active>=c.multicam.angles.length)throw new Error('Invalid multicam angle.');
        for(const angle of c.multicam.angles){const camera=p.assets.find(a=>a.id===angle.assetId);if(!camera||camera.kind!=='video'||!integer(angle.offset))throw new Error('Multicam requires valid video sources and offsets.');const points=[sourceTick(c,0,s.fps),sourceTick(c,c.duration-1,s.fps),...c.remap.map(k=>k.value)];if(points.some(t=>t+angle.offset<0||t+angle.offset>=camera.duration))throw new Error('Camera offset exceeds its source handles. Trim the multicam clip before changing this offset.');}
      }
      for(const fx of c.effects) for(const v of Object.values(fx.params)) if(!Number.isFinite(v.value)||v.keys.some((k,i)=>!Number.isFinite(k.value)||!integer(k.frame)||k.frame<0||(i>0&&k.frame<=v.keys[i-1].frame)))throw new Error('Invalid keyframe data.');
    }
    for(const t of s.tracks) {
      const sorted=s.clips.filter(c=>c.trackId===t.id).sort((a,b)=>a.start-b.start);
      if(sorted.some((c,i)=>i>0&&c.start<sorted[i-1].start+sorted[i-1].duration))throw new Error(`Clips overlap on ${t.name}; use overwrite or another track.`);
    }
    for(const c of s.captions) if(!integer(c.start)||!integer(c.end)||c.start<0||c.end<=c.start)throw new Error('Caption end must follow its start.');
    for(const tr of s.transitions) {
      const a=s.clips.find(c=>c.id===tr.left),b=s.clips.find(c=>c.id===tr.right);
      if(!a||!b||a.trackId!==b.trackId||a.start+a.duration!==b.start||!integer(tr.duration)||tr.duration<2||tr.duration>Math.min(a.duration,b.duration)*2)throw new Error('Invalid transition boundary.');
      const half=Math.ceil(tr.duration/2);
      for(const [c,local] of [[a,a.duration+half-1],[b,-half]] as [Clip,number][]) {const asset=p.assets.find(x=>x.id===c.assetId);if(asset&&asset.kind!=='image'&&(sourceTick(c,local,s.fps)<0||sourceTick(c,local,s.fps)>=asset.duration))throw new Error(`Insufficient transition handles for ${c.name}. Trim the source first.`);}
    }
  }
  function visit(s:Sequence,path:Set<string>) { if(path.has(s.id))throw new Error('Nested sequences cannot contain a cycle.');const next=new Set(path).add(s.id);for(const c of s.clips)if(c.sequenceId)visit(p.sequences.find(x=>x.id===c.sequenceId)!,next); }
  p.sequences.forEach(s=>visit(s,new Set()));
  return p;
}
export function parseProject(raw:string):Project {
  const p=JSON.parse(raw);
  if(p.format!=='lope-video')throw new Error('Choose a .lopevideo project; Adobe .prproj files are not supported.');
  if(p.version===1) { p.version=2;p.settings={colorPolicy:'SDR-sRGB',autosave:true};for(const s of p.sequences){s.transitions??=[];for(const c of s.clips){c.remap??=[];c.blend??='source-over';}} }
  return validateProject(p);
}
export { TIME_BASE };
