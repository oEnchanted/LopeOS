import { AudioSample, AudioSampleSource, CanvasSource, Output, BufferTarget, StreamTarget, Mp4OutputFormat, WebMOutputFormat, WavOutputFormat, canEncodeVideo, canEncodeAudio, type VideoCodec, type AudioCodec } from '../../media-service/src/index.ts';
import { SequenceRenderer, AudioMixer } from './render.ts';
import { sequenceEnd, validateProject, type Project, type Sequence } from './model.ts';
import { frameSeconds, sampleAtFrame, type Rational, rateValue } from './time.ts';
export interface ExportSettings { format:'mp4'|'webm'|'wav'; videoCodec:VideoCodec; audioCodec:AudioCodec; width:number; height:number; fps:Rational; bitrate:number; audioBitrate:number; sampleRate:number; channels:number; start:number; end:number; captions:'none'|'burn'; audio:boolean }
export function defaultExport(s:Sequence):ExportSettings {return {format:'webm',videoCodec:'vp9',audioCodec:'opus',width:s.width,height:s.height,fps:s.fps,bitrate:8_000_000,audioBitrate:192_000,sampleRate:48000,channels:2,start:0,end:sequenceEnd(s),captions:'none',audio:true};}
export interface ExportProgress { phase:string; completed:number; total:number; elapsedMs:number }
export async function exportSequence(p:Project,s:Sequence,options:ExportSettings,resolve:(key:string)=>Promise<Blob>,signal:AbortSignal,progress:(value:ExportProgress)=>void):Promise<{blob:Blob;frames:number;samples:number;elapsedMs:number;opfsName?:string}> {
  validateProject(p);const o=options;
  if(o.end<=o.start||o.start<0||o.end>sequenceEnd(s))throw new Error('Export range must contain media within the sequence.');
  if(o.width<16||o.height<16||o.width>8192||o.height>8192||o.width%2||o.height%2)throw new Error('Use even export dimensions from 16 to 8192 pixels.');
  if(o.format==='mp4'&&!['avc','hevc','av1'].includes(o.videoCodec)||o.format==='webm'&&!['vp8','vp9','av1'].includes(o.videoCodec))throw new Error('Choose a codec supported by the selected container.');
  if(o.format!=='wav'&&!await canEncodeVideo(o.videoCodec,{width:o.width,height:o.height,bitrate:o.bitrate}))throw new Error(`${o.videoCodec} encoding is unavailable in this browser. Choose another local codec.`);
  const audioCodec=o.format==='wav'?'pcm-s16':o.audioCodec;
  if(o.audio&&!await canEncodeAudio(audioCodec,{sampleRate:o.sampleRate,numberOfChannels:o.channels}))throw new Error(`${audioCodec} encoding is unavailable in this browser.`);
  const duration=frameSeconds(o.end-o.start,s.fps),frames=Math.ceil(duration*rateValue(o.fps)-1e-9),samples=sampleAtFrame(frames,o.fps,o.sampleRate),started=performance.now();
  let writer:FileSystemWritableFileStream|undefined,handle:FileSystemFileHandle|undefined,opfsName:string|undefined;
  const check=()=>{if(signal.aborted)throw new DOMException('Export cancelled. Your project is unchanged.','AbortError');};check();
  let target:BufferTarget|StreamTarget;
  if(navigator.storage?.getDirectory){const dir=await navigator.storage.getDirectory();opfsName=`lope-video-export-${crypto.randomUUID()}.${o.format}`;handle=await dir.getFileHandle(opfsName,{create:true});writer=await handle.createWritable();const dest=writer;target=new StreamTarget(new WritableStream({write:async chunk=>{check();await dest.write({type:'write',position:chunk.position,data:chunk.data});}}),{chunked:true,chunkSize:1024*1024});}
  else {if(duration*(o.bitrate+o.audioBitrate)/8>512*1024*1024)throw new Error('This browser lacks streamed local storage; choose an export estimated below 512 MB.');target=new BufferTarget();}
  const format=o.format==='mp4'?new Mp4OutputFormat({fastStart:'fragmented'}):o.format==='webm'?new WebMOutputFormat():new WavOutputFormat();
  const output=new Output({format,target});const render=new SequenceRenderer(resolve,false),mixer=new AudioMixer(render.media);const canvas=new OffscreenCanvas(o.width,o.height),g=canvas.getContext('2d')!;
  const video=o.format==='wav'?undefined:new CanvasSource(canvas,{codec:o.videoCodec,bitrate:o.bitrate,keyFrameInterval:2});const audio=o.audio||o.format==='wav'?new AudioSampleSource({codec:audioCodec,bitrate:o.audioBitrate}):undefined;
  if(video)output.addVideoTrack(video,{frameRate:rateValue(o.fps)});if(audio)output.addAudioTrack(audio);let audioPosition=0;
  try {
    await output.start();
    for(let f=0;f<frames;f++) {
      check();const timestamp=frameSeconds(f,o.fps),nextTimestamp=frameSeconds(f+1,o.fps),sequenceFrame=o.start+timestamp*rateValue(s.fps);
      if(video){const rendered=await render.frame(p,s,sequenceFrame,o.width,o.captions==='burn'),scale=Math.min(o.width/rendered.width,o.height/rendered.height),w=rendered.width*scale,h=rendered.height*scale;g.fillStyle='#000';g.fillRect(0,0,o.width,o.height);g.drawImage(rendered,(o.width-w)/2,(o.height-h)/2,w,h);await video.add(timestamp,nextTimestamp-timestamp);}
      const nextAudio=Math.min(samples,sampleAtFrame(f+1,o.fps,o.sampleRate));
      while(audio&&audioPosition<nextAudio){check();const count=Math.min(4096,nextAudio-audioPosition),planes=await mixer.block(p,s,sampleAtFrame(o.start,s.fps,o.sampleRate)+audioPosition,count,o.sampleRate,o.channels),data=new Float32Array(count*o.channels);planes.forEach((plane,i)=>data.set(plane,i*count));const sample=new AudioSample({format:'f32-planar',data,numberOfChannels:o.channels,sampleRate:o.sampleRate,timestamp:audioPosition/o.sampleRate});try{await audio.add(sample);}finally{sample.close();}audioPosition+=count;}
      if(f%5===0||f===frames-1)progress({phase:'Rendering and encoding',completed:f+1,total:frames,elapsedMs:performance.now()-started});
    }
    video?.close();audio?.close();check();progress({phase:'Finalizing file',completed:frames,total:frames,elapsedMs:performance.now()-started});await output.finalize();await writer?.close();writer=undefined;
    const blob=handle?await handle.getFile():new Blob([(target as BufferTarget).buffer!],{type:format.mimeType});
    return {blob,frames,samples:audio?audioPosition:0,elapsedMs:performance.now()-started,opfsName};
  }catch(error){await output.cancel().catch(()=>{});await writer?.abort().catch(()=>{});if(opfsName)await (await navigator.storage.getDirectory()).removeEntry(opfsName).catch(()=>{});throw error;}
  finally{render.release();}
}
