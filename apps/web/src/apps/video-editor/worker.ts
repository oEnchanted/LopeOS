/// <reference lib="webworker" />
import { MediaStore } from '../../../../../packages/media-service/src/storage.ts';
import { LocalMediaService, probe, hashBlob, CanvasSource, AudioSample, AudioSampleSource, Output, BufferTarget, WebMOutputFormat, Conversion, Input, ALL_FORMATS, BlobSource } from '../../../../../packages/media-service/src/index.ts';
import { SequenceRenderer, AudioMixer, calculateScopes } from '../../../../../packages/video-engine/src/render.ts';
import { exportSequence } from '../../../../../packages/video-engine/src/export.ts';
import { frameSeconds, rateValue, timecode } from '../../../../../packages/video-engine/src/time.ts';
import type { Project, Sequence } from '../../../../../packages/video-engine/src/model.ts';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let store=new MediaStore(),renderer=new SequenceRenderer(k=>store.blob(k),true),mixer=new AudioMixer(renderer.media),exportAbort:AbortController|undefined;
let queue=Promise.resolve();
scope.onmessage=event=>{
  const message=event.data;
  if(message.type==='cancel'){exportAbort?.abort();return;}
  queue=queue.then(async()=>{
    const {id,type,data}=message;
    try {
      let result:unknown;let transfers:Transferable[]=[];
      if(type==='scope'){renderer.release();store=new MediaStore(data);renderer=new SequenceRenderer(k=>store.blob(k),true);mixer=new AudioMixer(renderer.media);result=true;}
      if(type==='invalidate'){renderer.release();mixer.reset();result=true;}
      if(type==='probe'){result={info:await probe(data.blob),hash:await hashBlob(data.blob)};}
      if(type==='frame'){const {project,sequence,frame,width,burn}=data as {project:Project;sequence:Sequence;frame:number;width:number;burn:boolean};const canvas=await renderer.frame(project,sequence,frame,width,burn);const bitmap=canvas.transferToImageBitmap();transfers=[bitmap];result={bitmap};}
      if(type==='source'){const source=await renderer.media.frame(data.key,data.seconds,data.width),c=new OffscreenCanvas(data.width,Math.max(1,Math.round(data.width*data.height/data.sourceWidth))),g=c.getContext('2d')!;g.fillStyle='#000';g.fillRect(0,0,c.width,c.height);if(source)g.drawImage(source,0,0,c.width,c.height);const bitmap=c.transferToImageBitmap();transfers=[bitmap];result={bitmap};}
      if(type==='scopes'){const c=await renderer.frame(data.project,data.sequence,data.frame,512,false);result=calculateScopes(c.getContext('2d')!.getImageData(0,0,c.width,c.height));}
      if(type==='audio'){if(data.reset)mixer.reset();const channels=await mixer.block(data.project,data.sequence,data.start,data.count,data.rate,2);result=channels;transfers=channels.map(c=>c.buffer);}
      if(type==='thumbnail'){const source=await renderer.media.frame(data.key,0,240),c=new OffscreenCanvas(240,135),g=c.getContext('2d')!;if(source)g.drawImage(source,0,0,240,135);result=await c.convertToBlob({type:'image/jpeg',quality:.7});}
      if(type==='waveform'){const count=240,values=new Array<number>(count).fill(0),service=new LocalMediaService(k=>store.blob(k));try{const max=data.duration;for(let at=0;at<max;at+=2){const pcm=await service.audio(data.key,at,Math.min(at+2,max));for(let i=0;i<pcm.channels[0]?.length;i+=64){const time=(pcm.start+i)/pcm.sampleRate,bin=Math.floor(time/data.duration*count);if(bin<count)for(const channel of pcm.channels)values[bin]=Math.max(values[bin],Math.abs(channel[i]));}}result=values;}finally{service.release();}}
      if(type==='proxy'){const blob=await store.blob(data.key),input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)}),output=new Output({format:new WebMOutputFormat(),target:new BufferTarget()});try{const conversion=await Conversion.init({input,output,video:{codec:'vp8',width:640},audio:{discard:true}});if(!conversion.isValid)throw new Error('A local proxy encoder is unavailable.');await conversion.execute();result=new Blob([output.target.buffer!],{type:'video/webm'});}finally{input.dispose();}}
      if(type==='export'){exportAbort=new AbortController();try{result=await exportSequence(data.project,data.sequence,data.options,k=>store.blob(k),exportAbort.signal,value=>scope.postMessage({id,progress:value}));}finally{exportAbort=undefined;}}
      if(type==='fixture'){result=await fixture(data);}
      scope.postMessage({id,result},transfers);
    }catch(error){scope.postMessage({id,error:error instanceof Error?error.message:String(error)});}
  });
};
/** Reproducible local media: encoded timecode, changing frame ID, exact flash/beep markers. */
async function fixture(options:{seconds:number;width:number;height:number;fps:{num:number;den:number};silent?:boolean}) {
  const {seconds,width,height,fps}=options,c=new OffscreenCanvas(width,height),g=c.getContext('2d')!,target=new BufferTarget(),output=new Output({format:new WebMOutputFormat(),target}),video=new CanvasSource(c,{codec:'vp8',bitrate:2_000_000,keyFrameInterval:2}),audio=options.silent?undefined:new AudioSampleSource({codec:'opus',bitrate:128000});output.addVideoTrack(video,{frameRate:rateValue(fps)});if(audio)output.addAudioTrack(audio);await output.start();const frames=Math.round(seconds*rateValue(fps));let sample=0;
  for(let f=0;f<frames;f++) {
    const at=frameSeconds(f,fps),next=frameSeconds(f+1,fps),flash=f%Math.round(rateValue(fps))===0;
    g.fillStyle=flash?'#f5f5f5':'#122131';g.fillRect(0,0,width,height);const colors=['#eee','#e7c864','#65d4d1','#73b584','#bc7ec0','#5c8bc0','#bd6165'];colors.forEach((color,i)=>{g.fillStyle=color;g.fillRect(i*width/7,height*.12,width/7+1,height*.47);});g.fillStyle='#101820';g.fillRect(0,height*.67,width,height*.33);g.fillStyle='#fff';g.textAlign='center';g.font=`${height*.075}px monospace`;g.fillText(timecode(f,fps),width/2,height*.79);g.font=`${height*.04}px sans-serif`;g.fillText(`LopeOS · SYNC TEST · Frame ${f}`,width/2,height*.9);g.fillStyle='#f3a755';g.fillRect(f/frames*width,height*.61,Math.max(5,width*.02),height*.035);await video.add(at,next-at);
    const end=Math.round(next*48000);if(audio&&end>sample){const data=new Float32Array((end-sample)*2);for(let i=0;i<end-sample;i++){const t=(sample+i)/48000,beep=t%1<.04;const v=beep?Math.sin(2*Math.PI*1000*t)*.5:0;data[i]=v;data[end-sample+i]=v;}const a=new AudioSample({data,format:'f32-planar',numberOfChannels:2,sampleRate:48000,timestamp:sample/48000});await audio.add(a);a.close();sample=end;}
  }
  video.close();audio?.close();await output.finalize();return new Blob([target.buffer!],{type:'video/webm'});
}
