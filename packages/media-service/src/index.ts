import { Input, ALL_FORMATS, BlobSource, CanvasSink, AudioSampleSink, CanvasSource, AudioSampleSource, AudioSample, Output, BufferTarget, StreamTarget, Mp4OutputFormat, WebMOutputFormat, WavOutputFormat, canEncodeVideo, canEncodeAudio as nativeCanEncodeAudio, Conversion, type VideoCodec, type AudioCodec, type InputVideoTrack, type InputAudioTrack } from 'mediabunny';
import { ensureAudioDecoder } from './aac.ts';
export { Input, ALL_FORMATS, BlobSource, CanvasSink, CanvasSource, AudioSampleSource, AudioSample, Output, BufferTarget, StreamTarget, Mp4OutputFormat, WebMOutputFormat, WavOutputFormat, canEncodeVideo, Conversion };
export type { VideoCodec, AudioCodec };
export const MEDIA_BACKEND = 'mediabunny@1.66.0 / WebCodecs';
export interface MediaInfo { kind:'video'|'audio'|'image'; duration:number; startTime:number; width:number; height:number; rotation:number; fps:number|null; videoCodec:string|null; audioCodec:string|null; channels:number; sampleRate:number; color:{primaries:string;transfer:string;matrix:string;range:string;bitDepth:number|null;policy:'sdr'|'unverified'|'hdr-rejected'} }
export interface MediaService { probe(blob:Blob):Promise<MediaInfo>; frame(key:string,time:number,width?:number):Promise<CanvasImageSource|null>; audio(key:string,from:number,to:number):Promise<PCMWindow>; release():void; }
export interface PCMWindow { start:number; sampleRate:number; channels:Float32Array[] }
export async function hashBlob(blob:Blob) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''); }
export async function isStill(blob:Blob) {const b=new Uint8Array(await blob.slice(0,16).arrayBuffer());return b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71||b[0]===255&&b[1]===216||String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'||b[0]===66&&b[1]===77;}
export async function probe(blob:Blob):Promise<MediaInfo> {
  if(blob.size===0)throw new Error('The file is empty.');
  if(await isStill(blob)) {const image=await createImageBitmap(blob);const info:MediaInfo={kind:'image',duration:5,startTime:0,width:image.width,height:image.height,rotation:0,fps:null,videoCodec:null,audioCodec:null,channels:0,sampleRate:0,color:{primaries:'bt709',transfer:'iec61966-2-1',matrix:'rgb',range:'full',bitDepth:8,policy:'sdr'}};image.close();return info;}
  const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
  try {
    const [v,a]=await Promise.all([input.getPrimaryVideoTrack(),input.getPrimaryAudioTrack()]);
    await ensureAudioDecoder(a);
    if(!v&&!a)throw new Error('No recognized video or audio stream was found.');
    if(v&&!await v.canDecode())throw new Error(`This browser cannot decode ${await v.getCodec()||'this video codec'}. The original has not been changed.`);
    if(a&&!await a.canDecode())throw new Error(`This browser cannot decode ${await a.getCodec()||'this audio codec'}.`);
    if(v&&await v.hasHighDynamicRange())throw new Error('HDR media needs an explicit HDR-to-SDR transform. This editor currently accepts SDR media; create an SDR copy before importing.');
    // Negative audio timestamps are codec priming, not a lead-in before video.
    const startTime=Math.max(0,await input.getFirstTimestamp()),duration=(await input.computeDuration(v?[v]:undefined))-startTime;
    if(!Number.isFinite(duration)||duration<=0)throw new Error('The media has no valid duration.');
    const color=await v?.getColorSpace();
    const info:MediaInfo={kind:v?'video':'audio',duration,startTime,width:await v?.getDisplayWidth()||0,height:await v?.getDisplayHeight()||0,rotation:await v?.getRotation()||0,fps:v?(await v.computeFrameRateMetrics({targetPacketCount:120})).bestGuessFrameRate:null,videoCodec:await v?.getCodec()||null,audioCodec:await a?.getCodec()||null,channels:await a?.getNumberOfChannels()||0,sampleRate:await a?.getSampleRate()||0,color:{primaries:color?.primaries||'unspecified',transfer:color?.transfer||'unspecified',matrix:color?.matrix||'unspecified',range:color?.fullRange===true?'full':color?.fullRange===false?'limited':'unspecified',bitDepth:null,policy:color?.transfer?'sdr':'unverified'}};
    return info;
  } finally {input.dispose();}
}
type Wrapped={canvas:HTMLCanvasElement|OffscreenCanvas;timestamp:number;duration:number};
type Reader={iterator:AsyncGenerator<Wrapped,void,unknown>;current:Wrapped|null;next:Wrapped|null};
type Handle={input?:Input;image?:ImageBitmap;video?:InputVideoTrack|null;audio?:InputAudioTrack|null;sink?:CanvasSink;width?:number;start:number;readers:Map<string,Reader>};
/** Forward reads within this distance decode through instead of seeking to a keyframe. */
const SEQUENTIAL_REACH=3;
/** Per-renderer LRU. No URLs or network uploads; callers supply managed local Blobs. */
export class LocalMediaService implements MediaService {
  handles=new Map<string,Handle>(); pcm=new Map<string,PCMWindow>(); private pcmBytes=0;
  constructor(private readonly resolve:(key:string)=>Promise<Blob>,private readonly maxHandles=8){}
  probe=probe;
  private async open(key:string) {
    let h=this.handles.get(key);if(h){this.handles.delete(key);this.handles.set(key,h);return h;}
    const blob=await this.resolve(key);
    if(await isStill(blob))h={image:await createImageBitmap(blob),start:0,readers:new Map()};
    else {const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});try{h={input,video:await input.getPrimaryVideoTrack(),audio:await input.getPrimaryAudioTrack(),start:await input.getFirstTimestamp(),readers:new Map()};}catch(e){input.dispose();throw e;}}
    h.start=Math.max(0,h.start);
    await ensureAudioDecoder(h.audio);
    this.handles.set(key,h);
    while(this.handles.size>this.maxHandles){const [k,old]=this.handles.entries().next().value!;closeReaders(old);old.input?.dispose();old.image?.close();this.handles.delete(k);}
    return h;
  }
  /**
   * Frames are read through one decoder per `slot` (a timeline clip, a viewer).
   * Moving forward a little decodes only the frames in between, so playback
   * costs one decode per frame instead of a keyframe seek per frame.
   */
  async frame(key:string,time:number,width?:number,slot='default') {
    const h=await this.open(key);if(h.image)return h.image;if(!h.video)return null;
    if(!h.sink||h.width!==width){closeReaders(h);h.sink=new CanvasSink(h.video,{width,alpha:true});h.width=width;}
    const t=Math.max(0,time)+h.start;let r=h.readers.get(slot);
    if(r&&r.current&&t>=r.current.timestamp-1e-6&&t<r.current.timestamp+SEQUENTIAL_REACH){
      while(r.next&&r.next.timestamp<=t+1e-6){r.current=r.next;r.next=(await r.iterator.next()).value||null;}
      if(r.next||t<r.current.timestamp+r.current.duration+1e-6)return r.current.canvas;
    }
    if(r)void r.iterator.return();
    // Each reader owns a small canvas pool; sharing one would recycle another reader's frame.
    const iterator=new CanvasSink(h.video,{width,alpha:true,poolSize:4}).canvases(t) as AsyncGenerator<Wrapped,void,unknown>;
    const current=(await iterator.next()).value||null;
    if(!current){void iterator.return();h.readers.delete(slot);return (await h.sink.getCanvas(t))?.canvas||null;}
    r={iterator,current,next:(await iterator.next()).value||null};h.readers.set(slot,r);
    while(r.next&&r.next.timestamp<=t+1e-6){r.current=r.next;r.next=(await r.iterator.next()).value||null;}
    return r.current!.canvas;
  }
  async audio(key:string,from:number,to:number):Promise<PCMWindow> {
    const h=await this.open(key);if(!h.audio)return {start:0,sampleRate:48000,channels:[]};
    const sr=await h.audio.getSampleRate(),channels=await h.audio.getNumberOfChannels();
    // Two-second pages bound decode and cache memory even for long sequences.
    const page=Math.floor(Math.max(0,from)/2),endPage=Math.floor(Math.max(from,to)/2),cacheKey=`${key}:${page}:${endPage}`;
    const cached=this.pcm.get(cacheKey);if(cached){this.pcm.delete(cacheKey);this.pcm.set(cacheKey,cached);return cached;}
    const start=page*2,end=(endPage+1)*2;
    if(end-start>30)throw new Error('Time remapping spans more than 30 seconds in one audio block. Split the remap at the jump.');
    const planes=Array.from({length:channels},()=>new Float32Array(Math.ceil((end-start)*sr)+2));
    const sink=new AudioSampleSink(h.audio);
    for await (const sample of sink.samples(start+h.start,end+h.start)) {
      try {
        const offset=Math.round((sample.timestamp-h.start-start)*sr);
        for(let ch=0;ch<channels;ch++){const data=new Float32Array(sample.numberOfFrames);sample.copyTo(data,{planeIndex:ch,format:'f32-planar'});const src=Math.max(0,-offset),dst=Math.max(0,offset),count=Math.min(data.length-src,planes[ch].length-dst);if(count>0)planes[ch].set(data.subarray(src,src+count),dst);}
      } finally{sample.close();}
    }
    const result={start:Math.round(start*sr),sampleRate:sr,channels:planes};const bytes=planes.reduce((n,p)=>n+p.byteLength,0);
    while(this.pcmBytes+bytes>24*1024*1024&&this.pcm.size){const [k,v]=this.pcm.entries().next().value!;this.pcm.delete(k);this.pcmBytes-=v.channels.reduce((n,p)=>n+p.byteLength,0);}
    this.pcm.set(cacheKey,result);this.pcmBytes+=bytes;return result;
  }
  release(){for(const h of this.handles.values()){closeReaders(h);h.input?.dispose();h.image?.close();}this.handles.clear();this.pcm.clear();this.pcmBytes=0;}
}
function closeReaders(h:Handle){for(const r of h.readers.values())void r.iterator.return().catch(()=>{});h.readers.clear();}
export async function encoderCapabilities(width=1920,height=1080) {
  const video=await Promise.all((['avc','hevc','vp8','vp9','av1'] as VideoCodec[]).map(async codec=>({codec,supported:await canEncodeVideo(codec,{width,height}).catch(()=>false)})));
  const audio=await Promise.all((['aac','opus','pcm-s16'] as AudioCodec[]).map(async codec=>({codec,supported:await canEncodeAudio(codec,{sampleRate:48000,numberOfChannels:2}).catch(()=>false)})));
  return {backend:MEDIA_BACKEND,video,audio};
}

let aacEncoderLoading:Promise<void>|undefined;
export async function canEncodeAudio(codec:AudioCodec,options?:Parameters<typeof nativeCanEncodeAudio>[1]) {
  if(await nativeCanEncodeAudio(codec,options))return true;
  if(codec!=='aac')return false;
  await (aacEncoderLoading??=import('@mediabunny/aac-encoder').then(m=>{m.registerAacEncoder();}));
  return nativeCanEncodeAudio(codec,options);
}
