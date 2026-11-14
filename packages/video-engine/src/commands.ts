import { currentSequence, id, makeClip, makeTrack, sequenceEnd, sourceTick, valueAt, validateProject, type Clip, type MediaAsset, type Project, type Sequence, type Track } from './model.ts';
import { frameTicks, ticksToFrames } from './time.ts';

export class EditHistory {
  project:Project; past:{label:string;project:Project}[]=[]; future:{label:string;project:Project}[]=[];
  constructor(project:Project) { this.project=validateProject(structuredClone(project)); }
  transact(label:string,edit:(p:Project,s:Sequence)=>void) {
    const next=structuredClone(this.project); edit(next,currentSequence(next)); pruneTransitions(currentSequence(next)); validateProject(next);
    if(JSON.stringify(next)===JSON.stringify(this.project))return this.project;
    this.past.push({label,project:this.project});if(this.past.length>100)this.past.shift();this.future=[];
    next.modified=new Date().toISOString();this.project=next;return next;
  }
  undo() { const e=this.past.pop();if(e){this.future.push({label:e.label,project:this.project});this.project=e.project;}return this.project; }
  redo() { const e=this.future.pop();if(e){this.past.push({label:e.label,project:this.project});this.project=e.project;}return this.project; }
}
function track(s:Sequence,id:string) { const t=s.tracks.find(t=>t.id===id);if(!t)throw new Error('Track is missing.');return t; }
function editable(s:Sequence,c:Clip) { if(track(s,c.trackId).locked)throw new Error(`${track(s,c.trackId).name} is locked.`); }
function pruneTransitions(s:Sequence) { s.transitions=s.transitions.filter(t=>{const a=s.clips.find(c=>c.id===t.left),b=s.clips.find(c=>c.id===t.right);return a&&b&&a.trackId===b.trackId&&a.start+a.duration===b.start;}); }
export function linkedIds(s:Sequence,ids:string[],linked=true) {const links=new Set(s.clips.filter(c=>ids.includes(c.id)).map(c=>c.linkId).filter(Boolean));return s.clips.filter(c=>ids.includes(c.id)||(linked&&c.linkId&&links.has(c.linkId))).map(c=>c.id);}
/** Rebase all animated properties when a clip head is removed. */
function offsetClip(c:Clip,delta:number,s:Sequence) {
  c.sourceIn=sourceTick(c,delta,s.fps);
  const parameters=[c.gain,c.pan,...c.effects.flatMap(f=>Object.values(f.params))];
  for(const p of parameters) { if(p.keys.length){const value=valueAt(p,delta),before=p.keys.filter(k=>k.frame<=delta).at(-1);p.keys=p.keys.filter(k=>k.frame>delta).map(k=>({...k,frame:k.frame-delta}));p.keys.unshift({frame:0,value,interpolation:before?.interpolation||'linear'});} }
  if(c.remap.length)c.remap=[{frame:0,value:c.sourceIn,interpolation:'linear'},...c.remap.filter(k=>k.frame>delta).map(k=>({...k,frame:k.frame-delta}))];
}
export function splitClip(s:Sequence,clipId:string,at:number) {
  const c=s.clips.find(c=>c.id===clipId);if(!c||at<=c.start||at>=c.start+c.duration)return;
  editable(s,c);const right=structuredClone(c),delta=at-c.start;
  right.id=id('clip');right.start=at;right.duration-=delta;offsetClip(right,delta,s);c.duration=delta;s.clips.push(right);return right;
}
export function splitSelected(s:Sequence,ids:string[],at:number) { const groups=new Map<string,string>();for(const c of [...s.clips].filter(c=>ids.includes(c.id))){const r=splitClip(s,c.id,at);if(r?.linkId){if(!groups.has(r.linkId))groups.set(r.linkId,id('link'));r.linkId=groups.get(r.linkId);}} }
export function removeRange(s:Sequence,start:number,end:number,trackIds:string[],ripple=false) {
  if(start<0||end<=start)throw new Error('Set a valid In/Out range.');
  const affected=new Set(trackIds);
  for(const c of [...s.clips]) if(affected.has(c.trackId)&&c.start<end&&c.start+c.duration>start) {
    editable(s,c);const originalEnd=c.start+c.duration;
    if(c.start<start&&originalEnd>end) {const right=splitClip(s,c.id,end)!;c.duration=start-c.start;right.linkId=undefined;}
    else if(c.start<start)c.duration=start-c.start;
    else if(originalEnd>end){offsetClip(c,end-c.start,s);c.start=end;c.duration=originalEnd-end;}
    else s.clips=s.clips.filter(x=>x!==c);
  }
  if(ripple) rippleShift(s,end,start-end,affected);
}
function rippleShift(s:Sequence,from:number,delta:number,explicit:Set<string>=new Set(),exclude:Set<string>=new Set()) {
  for(const c of s.clips) {const t=track(s,c.trackId);if(exclude.has(c.id)||!(t.syncLock||explicit.has(t.id)))continue;
    if(c.start>=from){editable(s,c);c.start+=delta;if(c.start<0)throw new Error('Ripple would move a clip before sequence start.');}
    else if(c.start+c.duration>from&&delta!==0)throw new Error(`Ripple crosses ${c.name}. Split it at the edit or disable its sync lock.`);
  }
  s.markers=s.markers.map(m=>({...m,frame:m.frame>=from?Math.max(0,m.frame+delta):m.frame}));
  s.captions=s.captions.map(c=>c.start>=from?{...c,start:Math.max(0,c.start+delta),end:Math.max(1,c.end+delta)}:c);
}
export function addMedia(p:Project,s:Sequence,asset:MediaAsset,at:number,sourceIn:number,sourceOut:number,videoTrack:string|undefined,audioTrack:string|undefined,mode:'insert'|'overwrite') {
  const duration=ticksToFrames(sourceOut-sourceIn,s.fps,'floor');if(duration<1)throw new Error('The source range must contain at least one sequence frame.');
  const targetIds=[asset.kind!=='audio'?videoTrack:undefined,asset.audioCodec?audioTrack:undefined].filter(Boolean) as string[];
  if(!targetIds.length)throw new Error('Patch at least one available source stream to a track.');
  targetIds.forEach(t=>{if(track(s,t).locked)throw new Error('The patched track is locked.');});
  if(mode==='insert') {
    const sync=s.tracks.filter(t=>t.syncLock||targetIds.includes(t.id)).map(t=>t.id);
    splitSelected(s,s.clips.filter(c=>sync.includes(c.trackId)).map(c=>c.id),at);rippleShift(s,at,duration,new Set(targetIds));
  } else removeRange(s,at,at+duration,targetIds);
  const link=id('link');const created=targetIds.map(t=>{const c=makeClip(t,at,duration,asset);c.sourceIn=sourceIn;c.linkId=targetIds.length>1?link:undefined;if(track(s,t).kind==='audio')c.label='#5a9475';return c;});s.clips.push(...created);return created;
}
export function deleteClips(s:Sequence,ids:string[],ripple=false) {
  const clips=s.clips.filter(c=>ids.includes(c.id));clips.forEach(c=>editable(s,c));
  if(!ripple){s.clips=s.clips.filter(c=>!ids.includes(c.id));return;}
  const ranges=clips.map(c=>[c.start,c.start+c.duration]).sort((a,b)=>a[0]-b[0]);const merged:number[][]=[];
  for(const r of ranges){const last=merged.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push(r);}
  s.clips=s.clips.filter(c=>!ids.includes(c.id));
  for(const [start,end] of merged.reverse()) {
    if(s.clips.some(c=>track(s,c.trackId).syncLock&&c.start<end&&c.start+c.duration>start))throw new Error('Ripple delete would remove unselected media on a sync-locked track.');
    rippleShift(s,end,start-end);
  }
}
export function moveClips(s:Sequence,ids:string[],delta:number,targetTrack?:string,copy=false) {
  const clips=s.clips.filter(c=>ids.includes(c.id));const newLinks=new Map<string,string>();
  for(const c of clips){editable(s,c);const x=copy?structuredClone(c):c;if(copy){x.id=id('clip');if(x.linkId){if(!newLinks.has(x.linkId))newLinks.set(x.linkId,id('link'));x.linkId=newLinks.get(x.linkId);}}
    x.start+=delta;if(x.start<0)throw new Error('Cannot move before sequence start.');
    if(targetTrack&&clips.length===1){const t=track(s,targetTrack);if(t.locked||t.kind!==track(s,x.trackId).kind)throw new Error('Choose an unlocked track of the same type.');x.trackId=targetTrack;}
    if(copy)s.clips.push(x);
  }
}
export function trimClip(s:Sequence,clipId:string,edge:'in'|'out',delta:number,mode:'trim'|'ripple'|'roll'='trim') {
  const c=s.clips.find(c=>c.id===clipId);if(!c)return;editable(s,c);const oldEnd=c.start+c.duration;
  if(mode==='roll') {
    const other=s.clips.find(x=>x.trackId===c.trackId&&(edge==='out'?x.start===oldEnd:x.start+x.duration===c.start));
    if(!other)throw new Error('Rolling trim needs an adjacent clip.');
    trimClip(s,other.id,edge==='out'?'in':'out',delta,'trim');trimClip(s,c.id,edge,delta,'trim');return;
  }
  if(edge==='in'){offsetClip(c,delta,s);c.start+=delta;c.duration-=delta;}
  else c.duration+=delta;
  if(c.duration<1||c.start<0)throw new Error('A clip must retain at least one frame.');
  if(mode==='ripple') { if(edge==='in'){c.start-=delta;rippleShift(s,oldEnd,-delta,new Set([c.trackId]),new Set([c.id]));}else rippleShift(s,oldEnd,delta,new Set([c.trackId]),new Set([c.id])); }
}
/** A linked A/V ripple is one edit: downstream material moves exactly once. */
export function trimClips(s:Sequence,ids:string[],edge:'in'|'out',delta:number,mode:'trim'|'ripple'|'roll'='trim') {
  const clips=s.clips.filter(c=>ids.includes(c.id));if(!clips.length)return;
  if(mode!=='ripple'){for(const c of clips)trimClip(s,c.id,edge,delta,mode);return;}
  const end=clips[0].start+clips[0].duration;
  if(clips.some(c=>c.start+c.duration!==end))throw new Error('Ripple linked clips at a shared boundary, or disable linked selection for a J/L cut.');
  for(const c of clips){trimClip(s,c.id,edge,delta,'trim');if(edge==='in')c.start-=delta;}
  rippleShift(s,end,edge==='in'?-delta:delta,new Set(clips.map(c=>c.trackId)),new Set(ids));
}
export function slipClip(s:Sequence,ids:string[],delta:number) {for(const c of s.clips.filter(c=>ids.includes(c.id))){editable(s,c);c.sourceIn+=Math.round(frameTicks(delta,s.fps)*c.speed.num/c.speed.den);if(c.remap.length)c.remap=c.remap.map(k=>({...k,value:k.value+frameTicks(delta,s.fps)}));if(c.freeze!==undefined)c.freeze+=frameTicks(delta,s.fps);}}
export function slideClip(s:Sequence,clipId:string,delta:number) {
  const c=s.clips.find(c=>c.id===clipId);if(!c)return;editable(s,c);
  const left=s.clips.find(x=>x.trackId===c.trackId&&x.start+x.duration===c.start),right=s.clips.find(x=>x.trackId===c.trackId&&x.start===c.start+c.duration);
  if(!left||!right)throw new Error('Slide needs adjacent clips on both sides.');
  trimClip(s,left.id,'out',delta);trimClip(s,right.id,'in',delta);c.start+=delta;
}
export function stretchClip(s:Sequence,clipId:string,newDuration:number) { const c=s.clips.find(c=>c.id===clipId);if(!c)return;editable(s,c);if(newDuration<1)throw new Error('Duration must be positive.');if(c.remap.length)throw new Error('Remove time remapping before rate stretching.');c.speed={num:c.speed.num*c.duration,den:c.speed.den*newDuration};const gcd=(a:number,b:number):number=>b?gcd(b,a%b):Math.abs(a);const d=gcd(c.speed.num,c.speed.den);c.speed={num:c.speed.num/d,den:c.speed.den/d};c.duration=newDuration; }
export function removeGaps(s:Sequence) {const active=s.tracks.filter(t=>t.syncLock||t.kind==='video').map(t=>t.id),ranges=s.clips.filter(c=>active.includes(c.trackId)).map(c=>[c.start,c.start+c.duration]).sort((a,b)=>a[0]-b[0]);let end=0;const gaps:number[][]=[];for(const r of ranges){if(r[0]>end)gaps.push([end,r[0]]);end=Math.max(end,r[1]);}for(const [a,b]of gaps.reverse())rippleShift(s,b,a-b);}
export function addTrack(s:Sequence,kind:Track['kind']) {const t=makeTrack(kind,s.tracks.filter(t=>t.kind===kind).length+1);s.tracks.push(t);return t;}
export function addTransition(s:Sequence,leftId:string,duration:number) {const a=s.clips.find(c=>c.id===leftId);if(!a)return;editable(s,a);const b=s.clips.find(c=>c.trackId===a.trackId&&c.start===a.start+a.duration);if(!b)throw new Error('Select a clip followed by an adjacent clip.');s.transitions=s.transitions.filter(t=>t.left!==a.id);s.transitions.push({id:id('transition'),left:a.id,right:b.id,duration,type:track(s,a.trackId).kind==='audio'?'equal-power':'dissolve',handlePolicy:'require'});}
export function duplicateSequence(p:Project,sequenceId:string) {const s=structuredClone(p.sequences.find(s=>s.id===sequenceId)!);s.id=id('sequence');s.name+=' copy';const map=new Map<string,string>();for(const t of s.tracks){const old=t.id;t.id=id('track');map.set(old,t.id);}for(const c of s.clips){const old=c.id;c.id=id('clip');map.set(old,c.id);c.trackId=map.get(c.trackId)!;if(c.linkId){if(!map.has(c.linkId))map.set(c.linkId,id('link'));c.linkId=map.get(c.linkId);}}s.transitions=s.transitions.map(t=>({...t,id:id('transition'),left:map.get(t.left)!,right:map.get(t.right)!}));p.sequences.push(s);p.activeSequence=s.id;return s;}
export function nestClips(p:Project,s:Sequence,ids:string[]) {const chosen=s.clips.filter(c=>ids.includes(c.id));if(!chosen.length)throw new Error('Select clips to nest.');chosen.forEach(c=>editable(s,c));const start=Math.min(...chosen.map(c=>c.start)),end=Math.max(...chosen.map(c=>c.start+c.duration));const nested=structuredClone(s);nested.id=id('sequence');nested.name='Nested '+(p.sequences.length+1);nested.clips=structuredClone(chosen);nested.clips.forEach(c=>c.start-=start);nested.transitions=[];nested.markers=[];nested.captions=[];nested.inPoint=0;nested.outPoint=null;
  const mapping=new Map<string,string>();nested.tracks.forEach(t=>{const old=t.id;t.id=id('track');mapping.set(old,t.id);});nested.clips.forEach(c=>{c.id=id('clip');c.trackId=mapping.get(c.trackId)!;});
  deleteClips(s,ids);p.sequences.push(nested);const link=id('link');for(const kind of ['video','audio'] as const){const first=chosen.find(c=>track(s,c.trackId).kind===kind);if(first){const c=makeClip(first.trackId,start,end-start);c.kind='nested';c.name=nested.name;c.sequenceId=nested.id;c.linkId=link;s.clips.push(c);}}return nested;
}
export function snapFrame(s:Sequence,frame:number,threshold:number,exclude:string[]=[],extra:number[]=[]) {const candidates=[0,...extra,...s.markers.map(m=>m.frame),...s.clips.filter(c=>!exclude.includes(c.id)).flatMap(c=>[c.start,c.start+c.duration])];let result=frame,best=threshold+1;for(const n of candidates){const d=Math.abs(frame-n);if(d<best){best=d;result=n;}}return best<=threshold?result:frame;}
export { sequenceEnd };
