import { LocalMediaService } from '../../media-service/src/index.ts';
import { sourceTick, valueAt, type Clip, type Effect, type Project, type Sequence, type Track } from './model.ts';
import { TIME_BASE, frameSeconds, rateValue } from './time.ts';
type Canvas=OffscreenCanvas;
const canvas=(w:number,h:number)=>new OffscreenCanvas(w,h);
// Pixel readback is only needed for color, LUT and mask passes. Everything else
// stays on accelerated canvases, which is what keeps full-resolution playback real time.
const ctx=(c:Canvas,readback=false)=>{const v=c.getContext('2d',{willReadFrequently:readback,colorSpace:'srgb'});if(!v)throw new Error('A 2D drawing context is unavailable.');return v;};
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const linear=(x:number)=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
const srgb=(x:number)=>x<=.0031308?x*12.92:1.055*Math.max(0,x)**(1/2.4)-.055;
function parameters(effect:Effect,frame:number){return Object.fromEntries(Object.entries(effect.params).map(([k,v])=>[k,valueAt(v,frame)]));}
function lutRGB(rgb:number[],lut:NonNullable<Effect['lut']>) {const n=lut.size,coord=rgb.map(v=>clamp(v)*(n-1)),lo=coord.map(Math.floor),hi=lo.map(v=>Math.min(n-1,v+1)),f=coord.map((v,i)=>v-lo[i]);const out=[0,0,0];for(let b=0;b<2;b++)for(let g=0;g<2;g++)for(let r=0;r<2;r++){const w=(r?f[0]:1-f[0])*(g?f[1]:1-f[1])*(b?f[2]:1-f[2]),i=(((b?hi[2]:lo[2])*n+(g?hi[1]:lo[1]))*n+(r?hi[0]:lo[0]))*3;for(let k=0;k<3;k++)out[k]+=lut.data[i+k]*w;}return out;}
/** SDR display-referred sRGB processing, explicit linear-light exposure; not an HDR grading engine. */
export function colorPixels(data:Uint8ClampedArray,effect:Effect,frame:number) {
  const p=parameters(effect,frame),exposure=2**(p.exposure||0),contrast=1+(p.contrast||0)/100,saturation=1+(p.saturation||0)/100,temp=(p.temperature||0)/100,tint=(p.tint||0)/100,gamma=2**(-(p.gamma||0));
  for(let i=0;i<data.length;i+=4) {
    let rgb=[data[i]/255,data[i+1]/255,data[i+2]/255];
    if(effect.type==='lut'&&effect.lut)rgb=lutRGB(rgb,effect.lut);
    else {
      rgb=rgb.map((v,k)=>srgb(linear(v)*exposure*(k===0?1+temp*.2:k===2?1-temp*.2:1+tint*.15)));
      const l=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
      rgb=rgb.map((v,k)=>{const contrastValue=(v-.5)*contrast+.5,sh=(1-clamp(l))**2,hi=clamp(l)**2;let out=clamp(contrastValue+(p.shadows||0)/300*sh+(p.highlights||0)/300*hi);out=out**gamma;out+=(p[['liftR','liftG','liftB'][k]]||0)/100*sh+(p[['gainR','gainG','gainB'][k]]||0)/100*hi;return l+(out-l)*saturation;});
      // A selective warm-color correction and a three-point luminance curve.
      const warm=clamp((rgb[0]-rgb[2])*3);rgb[0]+=(p.selectiveWarm||0)/200*warm;rgb[2]-=(p.selectiveWarm||0)/200*warm;
      const curve=(v:number)=>{const x=clamp(v),y0=(p.curveShadows||0)/100,y1=.5+(p.curveMid||0)/100,y2=1+(p.curveHighlights||0)/100;return x<=.5?y0+(y1-y0)*x*2:y1+(y2-y1)*(x-.5)*2;};rgb=rgb.map(curve);
    }
    for(let k=0;k<3;k++)data[i+k]=Math.round(clamp(rgb[k])*255);
  }
}
export function transitionClips(s:Sequence,t:Track,frame:number) {
  const clips=s.clips.filter(c=>c.trackId===t.id&&c.enabled);const result:{clip:Clip;weight:number}[]=[];
  const transition=s.transitions.find(x=>{const a=clips.find(c=>c.id===x.left);return a&&frame>=a.start+a.duration-x.duration/2&&frame<a.start+a.duration+x.duration/2;});
  if(transition){const a=clips.find(c=>c.id===transition.left)!,b=clips.find(c=>c.id===transition.right)!;const f=clamp((frame-(b.start-transition.duration/2))/transition.duration);return [{clip:a,weight:transition.type==='equal-power'?Math.cos(f*Math.PI/2):1-f},{clip:b,weight:transition.type==='equal-power'?Math.sin(f*Math.PI/2):f}];}
  for(const c of clips)if(frame>=c.start&&frame<c.start+c.duration)result.push({clip:c,weight:1});return result;
}
export class SequenceRenderer {
  readonly media:LocalMediaService; private scratch:Canvas[]=[];
  constructor(resolve:(key:string)=>Promise<Blob>,readonly proxies=false){this.media=new LocalMediaService(resolve);}
  async frame(project:Project,sequence:Sequence,frame:number,width=sequence.width,burnCaptions=false,depth=0):Promise<Canvas> {
    if(depth>12)throw new Error('Nested sequence depth exceeds the renderer limit (12).');
    const height=Math.max(1,Math.round(width*sequence.height/sequence.width)),out=canvas(width,height),g=ctx(out);g.fillStyle=sequence.background;g.fillRect(0,0,width,height);
    for(const t of sequence.tracks.filter(t=>t.kind==='video'&&t.visible)) {
      const layers=transitionClips(sequence,t,frame);
      if(layers.length===2){const merged=canvas(width,height),m=ctx(merged);for(const item of layers){const layer=await this.layer(project,sequence,item.clip,frame,width,height,depth);m.globalCompositeOperation='lighter';m.globalAlpha=item.weight;m.drawImage(layer,0,0);}g.drawImage(merged,0,0);}
      else for(const {clip,weight} of layers){let layer:Canvas;if(clip.kind==='adjustment'){layer=canvas(width,height);ctx(layer).drawImage(out,0,0);layer=this.effects(layer,clip,frame-clip.start,sequence);g.clearRect(0,0,width,height);}else layer=await this.layer(project,sequence,clip,frame,width,height,depth);g.globalAlpha=weight;g.globalCompositeOperation=clip.blend;g.drawImage(layer,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';}
    }
    if(burnCaptions)for(const caption of sequence.captions.filter(c=>frame>=c.start&&frame<c.end)){g.font=`${Math.round(height*.042)}px Arial`;g.textAlign='center';g.textBaseline='bottom';const lines=caption.text.split('\n');for(let i=0;i<lines.length;i++){const y=height*.92-(lines.length-1-i)*height*.052,w=g.measureText(lines[i]).width;g.fillStyle='rgba(0,0,0,0.75)';g.fillRect((width-w)/2-height*.012,y-height*.05,w+height*.024,height*.06);g.fillStyle='#fff';g.fillText(lines[i],width/2,y);}}
    return out;
  }
  private async layer(p:Project,s:Sequence,c:Clip,frame:number,w:number,h:number,depth:number) {
    let out=canvas(w,h);const g=ctx(out),local=frame-c.start;
    if(c.kind==='media') {
      const angle=c.multicam?.angles[c.multicam.active],a=p.assets.find(a=>a.id===(angle?.assetId||c.assetId));
      if(!a||a.missing)throw new Error(`Media offline: ${c.name}. Use Link Media.`);
      const source=await this.media.frame(this.proxies&&a.proxyKey?a.proxyKey:a.blobKey,sourceTick(c,local,s.fps)/TIME_BASE+(angle?.offset||0)/TIME_BASE,Math.min(w,a.width)||w,`${s.id}/${c.id}/${c.multicam?.active??0}`);
      if(source){const sw='width'in source?Number(source.width):a.width,sh='height'in source?Number(source.height):a.height,scale=Math.min(w/sw,h/sh);g.drawImage(source,(w-sw*scale)/2,(h-sh*scale)/2,sw*scale,sh*scale);}
    } else if(c.kind==='nested') {
      const n=p.sequences.find(n=>n.id===c.sequenceId)!;const nf=sourceTick(c,local,s.fps)/TIME_BASE*rateValue(n.fps);const source=await this.frame(p,n,nf,w,false,depth+1);g.drawImage(source,0,0,w,h);
    } else if(c.graphic) {
      const v=c.graphic,scale=w/s.width,x=v.x*scale,y=v.y*scale,gw=v.width*scale,gh=v.height*scale;
      if(v.type==='text'){g.font=`${v.weight} ${v.size*scale}px ${JSON.stringify(v.font)}`;g.textAlign=v.align;g.textBaseline='top';const lines=v.text.split('\n');if(v.background!=='transparent'){g.fillStyle=v.background;g.fillRect(x,y,gw,Math.max(gh,lines.length*v.size*scale*1.2));}g.fillStyle=v.color;lines.forEach((l,i)=>g.fillText(l,x+(v.align==='center'?gw/2:v.align==='right'?gw:0),y+i*v.size*scale*1.2,gw));}
      else {g.fillStyle=v.color;if(v.type==='ellipse'){g.beginPath();g.ellipse(x+gw/2,y+gh/2,gw/2,gh/2,0,0,Math.PI*2);g.fill();}else g.fillRect(x,y,gw,gh);}
    }
    out=this.effects(out,c,local,s);
    if(c.mask){const m=c.mask,g=ctx(out,true),pixels=g.getImageData(0,0,w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const nx=x/w,ny=y/h,dx=Math.abs(nx-m.x-m.width/2),dy=Math.abs(ny-m.y-m.height/2);const d=m.kind==='ellipse'?(1-Math.sqrt((dx/(m.width/2))**2+(dy/(m.height/2))**2))*Math.min(m.width,m.height)/2:Math.min(m.width/2-dx,m.height/2-dy);const alpha=m.feather?clamp(d/(m.feather/100)+.5):(d>=0?1:0);pixels.data[(y*w+x)*4+3]*=m.invert?1-alpha:alpha;}g.putImageData(pixels,0,0);}
    return out;
  }
  private effects(input:Canvas,c:Clip,frame:number,s:Sequence) {
    let out=input;const w=out.width,h=out.height;
    for(const fx of c.effects.filter(f=>f.enabled)) {
      const p=parameters(fx,frame);
      if(fx.type==='color'||fx.type==='lut'){const g=ctx(out,true),image=g.getImageData(0,0,w,h);colorPixels(image.data,fx,frame);g.putImageData(image,0,0);continue;}
      if(fx.type==='transform'&&!p.x&&!p.y&&(p.scale??100)===100&&!p.rotation)continue;
      if(fx.type==='opacity'&&(p.opacity??100)>=100)continue;
      if(fx.type==='crop'&&!p.left&&!p.top&&!p.right&&!p.bottom)continue;
      if(fx.type==='blur'&&!(p.radius>0))continue;
      const next=canvas(w,h),g=ctx(next);
      if(fx.type==='transform'){const ax=w*(p.anchorX??50)/100,ay=h*(p.anchorY??50)/100;g.translate(ax+(p.x||0)*w/s.width,ay+(p.y||0)*h/s.height);g.rotate((p.rotation||0)*Math.PI/180);g.scale((p.scale??100)/100,(p.scale??100)/100);g.translate(-ax,-ay);}
      if(fx.type==='opacity')g.globalAlpha=clamp((p.opacity??100)/100);
      if(fx.type==='crop'){const left=clamp((p.left||0)/100)*w,top=clamp((p.top||0)/100)*h,right=clamp((p.right||0)/100)*w,bottom=clamp((p.bottom||0)/100)*h;g.beginPath();g.rect(left,top,Math.max(0,w-left-right),Math.max(0,h-top-bottom));g.clip();}
      if(fx.type==='blur')g.filter=`blur(${Math.max(0,p.radius||0)*w/s.width}px)`;
      g.drawImage(out,0,0);out=next;
    }
    return out;
  }
  release(){this.media.release();this.scratch=[];}
}

/** Stateful DSP survives successive blocks. Audio uses an absolute integer sample clock. */
export class AudioMixer {
  private state=new Map<string,{z:number[][];envelope:number}>();
  constructor(readonly media:LocalMediaService){}
  reset(){this.state.clear();}
  async block(p:Project,s:Sequence,startSample:number,count:number,rate=s.sampleRate,channels=2,depth=0,path=s.id):Promise<Float32Array[]> {
    if(depth>12)throw new Error('Audio nesting is too deep.');
    const output=Array.from({length:channels},()=>new Float32Array(count)),fps=rateValue(s.fps),startFrame=startSample/rate*fps,endFrame=(startSample+count)/rate*fps,solo=s.tracks.some(t=>t.kind==='audio'&&t.solo);
    for(const t of s.tracks.filter(t=>t.kind==='audio'&&!t.muted&&(!solo||t.solo))) {
      const bus=Array.from({length:channels},()=>new Float32Array(count));
      const candidates=s.clips.filter(c=>c.trackId===t.id&&c.enabled&&c.start+c.duration+(s.transitions.find(tr=>tr.left===c.id)?.duration||0)/2>startFrame&&c.start-(s.transitions.find(tr=>tr.right===c.id)?.duration||0)/2<endFrame);
      for(const c of candidates) {
        const inTransition=s.transitions.some(tr=>tr.left===c.id||tr.right===c.id);
        // A held picture is silent; repeating one audio sample would introduce DC.
        if(c.freeze!==undefined)continue;
        if(c.kind==='nested'){
          const n=p.sequences.find(n=>n.id===c.sequenceId)!;
          if(c.speed.num!==c.speed.den||c.remap.length)throw new Error('Nested audio rate changes require rendering the nested sequence to media first.');
          const offset=Math.round(frameSeconds(c.start,s.fps)*rate-c.sourceIn/TIME_BASE*rate),first=Math.max(0,Math.ceil(frameSeconds(c.start,s.fps)*rate-startSample)),last=Math.min(count,Math.ceil(frameSeconds(c.start+c.duration,s.fps)*rate-startSample));
          if(last>first){const sub=await this.block(p,n,startSample+first-offset,last-first,rate,channels,depth+1,`${path}/${c.id}`);for(let i=first;i<last;i++){const local=(startSample+i)/rate*fps-c.start,fade=Math.min(1,c.fadeIn?local/c.fadeIn:1,c.fadeOut?(c.duration-local)/c.fadeOut:1),gain=10**(valueAt(c.gain,local)/20)*fade,pan=clamp(valueAt(c.pan,local)+t.pan,-1,1);for(let ch=0;ch<channels;ch++)bus[ch][i]+=sub[ch][i-first]*gain*(channels===1?1:ch===0?Math.min(1,1-pan):Math.min(1,1+pan));}}
          continue;
        }
        const a=p.assets.find(a=>a.id===c.assetId);if(!a?.audioCodec)continue;if(a.missing)throw new Error(`Audio offline: ${a.name}.`);
        const source=(f:number)=>c.freeze!==undefined?c.freeze/TIME_BASE:c.remap.length?valueAt({value:c.sourceIn,keys:c.remap},f-c.start)/TIME_BASE:c.sourceIn/TIME_BASE+(f-c.start)/fps*c.speed.num/c.speed.den;
        const minF=Math.max(startFrame,c.start-(s.transitions.find(tr=>tr.right===c.id)?.duration||0)/2),maxF=Math.min(endFrame,c.start+c.duration+(s.transitions.find(tr=>tr.left===c.id)?.duration||0)/2);
        const times=[source(minF),source(maxF),...c.remap.filter(k=>k.frame+c.start>minF&&k.frame+c.start<maxF).map(k=>k.value/TIME_BASE)];const pcm=await this.media.audio(a.blobKey,Math.max(0,Math.min(...times)),Math.max(...times));
        for(let i=0;i<count;i++) {
          const f=(startSample+i)/rate*fps,active=inTransition?transitionClips(s,t,f).find(x=>x.clip.id===c.id):f>=c.start&&f<c.start+c.duration?{weight:1}:undefined;if(!active)continue;
          const local=f-c.start,pos=source(f)*pcm.sampleRate-pcm.start,j=Math.floor(pos),mix=pos-j;
          const fade=Math.min(1,c.fadeIn?Math.max(0,local)/c.fadeIn:1,c.fadeOut?Math.max(0,c.duration-local)/c.fadeOut:1),gain=10**(valueAt(c.gain,local)/20)*fade*active.weight,pan=clamp(valueAt(c.pan,local)+t.pan,-1,1);
          for(let ch=0;ch<channels;ch++){const index=t.channels[ch]??Math.min(ch,pcm.channels.length-1),plane=pcm.channels[index];if(!plane)continue;const v=(plane[j]||0)*(1-mix)+(plane[j+1]||0)*mix;bus[ch][i]+=v*gain*(channels===1?1:ch===0?Math.min(1,1-pan):Math.min(1,1+pan));}
        }
      }
      this.processTrack(bus,t,rate,`${path}:${t.id}`);
      for(let ch=0;ch<channels;ch++)for(let i=0;i<count;i++)output[ch][i]+=bus[ch][i];
    }
    return output;
  }
  private processTrack(bus:Float32Array[],t:Track,rate:number,key:string) {
    let state=this.state.get(key);if(!state){state={z:Array.from({length:bus.length*3},()=>[0,0]),envelope:0};this.state.set(key,state);}
    const frequencies=[120,1000,8000],gains=[t.eq.low,t.eq.mid,t.eq.high];
    for(let band=0;band<3;band++){const A=10**(gains[band]/40),w=2*Math.PI*frequencies[band]/rate,alpha=Math.sin(w)/2,cos=Math.cos(w),a0=1+alpha/A,b0=(1+alpha*A)/a0,b1=-2*cos/a0,b2=(1-alpha*A)/a0,a1=b1,a2=(1-alpha/A)/a0;if(!gains[band])continue;for(let ch=0;ch<bus.length;ch++){const z=state.z[ch*3+band];for(let i=0;i<bus[ch].length;i++){const x=bus[ch][i],y=b0*x+z[0];z[0]=b1*x-a1*y+z[1];z[1]=b2*x-a2*y;bus[ch][i]=y;}}}
    const volume=10**(t.volume/20),attack=Math.exp(-1/(.005*rate)),release=Math.exp(-1/(.1*rate));
    for(let i=0;i<bus[0].length;i++){let peak=0;for(const c of bus)peak=Math.max(peak,Math.abs(c[i]));const coefficient=peak>state.envelope?attack:release;state.envelope=coefficient*state.envelope+(1-coefficient)*peak;let reduction=1;if(t.compressor.enabled){const db=20*Math.log10(state.envelope+1e-9),over=Math.max(0,db-t.compressor.threshold);reduction=10**(-(over-over/t.compressor.ratio)/20);}for(const c of bus){const v=c[i]*volume*reduction;c[i]=t.limiter?clamp(v,-1,1):v;}}
  }
}
export function calculateScopes(image:ImageData) {const histogram=Array.from({length:3},()=>new Array<number>(256).fill(0)),wave=new Uint32Array(256*128),vectors=new Uint32Array(128*128);for(let y=0;y<image.height;y+=2)for(let x=0;x<image.width;x+=2){const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],b=image.data[i+2],l=.2126*r+.7152*g+.0722*b;histogram[0][r]++;histogram[1][g]++;histogram[2][b]++;wave[Math.round((255-l)/255*127)*256+Math.floor(x/image.width*256)]++;const cb=clamp(.5+(-.1146*r-.3854*g+.5*b)/255),cr=clamp(.5+(.5*r-.4542*g-.0458*b)/255);vectors[Math.round(cr*127)*128+Math.round(cb*127)]++;}return {histogram,wave,vectors};}
