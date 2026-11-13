import { clamp, type Culling, type FloatImage, type PhotoMask, type Point, type Recipe } from './model.ts';
import { checkDimensions, linearToSrgb, srgbToLinear } from './tiff.ts';
import { reduceNoise } from './noise.ts';
const luminance=(r:number,g:number,b:number)=>.2126*r+.7152*g+.0722*b;
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a||1e-9));return t*t*(3-2*t);};
function sample(image:FloatImage,x:number,y:number,c:number):number {
  if(x<-.5||y<-.5||x>image.width-.5||y>image.height-.5)return 0;
  const fx=clamp(x,0,image.width-1),fy=clamp(y,0,image.height-1),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(image.width-1,x0+1),y1=Math.min(image.height-1,y0+1),tx=fx-x0,ty=fy-y0,d=image.data;
  return (d[(y0*image.width+x0)*4+c]*(1-tx)+d[(y0*image.width+x1)*4+c]*tx)*(1-ty)+(d[(y1*image.width+x0)*4+c]*(1-tx)+d[(y1*image.width+x1)*4+c]*tx)*ty;
}
export function resizeFloat(image:FloatImage,width:number,height:number):FloatImage {
  checkDimensions(width,height);if(width===image.width&&height===image.height)return image;
  const data=new Float32Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++)data[(y*width+x)*4+c]=sample(image,(x+.5)*image.width/width-.5,(y+.5)*image.height/height-.5,c);return {width,height,data};
}
export function outputToSource(p:Point,recipe:Recipe):Point {
  let u=p.x,v=p.y;
  if(recipe.rotation===90){u=p.y;v=1-p.x;}if(recipe.rotation===180){u=1-p.x;v=1-p.y;}if(recipe.rotation===270){u=1-p.y;v=p.x;}
  if(recipe.flipX)u=1-u;if(recipe.flipY)v=1-v;
  u=recipe.crop.x+u*recipe.crop.width;v=recipe.crop.y+v*recipe.crop.height;
  const angle=-recipe.values.straighten*Math.PI/180,x=u-.5,y=v-.5;
  u=.5+x*Math.cos(angle)-y*Math.sin(angle);v=.5+x*Math.sin(angle)+y*Math.cos(angle);
  u=.5+(u-.5)*(1+recipe.values.vertical/140*(v-.5));v=.5+(v-.5)*(1+recipe.values.horizontal/140*(u-.5));
  const dx=u-.5,dy=v-.5,radial=1+recipe.values.distortion/100*(dx*dx+dy*dy);return {x:.5+dx*radial,y:.5+dy*radial};
}
export function sourceToOutput(p:Point,recipe:Recipe):Point {
  // Invert the same geometry used by rendering, including distortion/perspective.
  let q={x:.5,y:.5};for(let k=0;k<10;k++){const a=outputToSource(q,recipe),dx=outputToSource({x:q.x+.0001,y:q.y},recipe),dy=outputToSource({x:q.x,y:q.y+.0001},recipe),ax=(dx.x-a.x)/.0001,ay=(dx.y-a.y)/.0001,bx=(dy.x-a.x)/.0001,by=(dy.y-a.y)/.0001,det=ax*by-ay*bx;if(Math.abs(det)<1e-8)break;const ex=p.x-a.x,ey=p.y-a.y;q={x:q.x+(ex*by-ey*bx)/det,y:q.y+(ey*ax-ex*ay)/det};}return q;
}
export function maskValue(mask:PhotoMask,p:Point,rgb:[number,number,number]):number {
  let amount=0;
  for(const c of mask.components){let value=0;
    if(c.type==='linear'){const dx=c.end.x-c.start.x,dy=c.end.y-c.start.y;value=1-clamp(((p.x-c.start.x)*dx+(p.y-c.start.y)*dy)/(dx*dx+dy*dy||1e-9));}
    if(c.type==='radial'){const rx=Math.max(.005,Math.abs(c.end.x-c.start.x)),ry=Math.max(.005,Math.abs(c.end.y-c.start.y)),distance=Math.hypot((p.x-c.start.x)/rx,(p.y-c.start.y)/ry);value=1-smooth(1-c.feather,1,distance);}
    if(c.type==='brush'){let distance=Infinity;for(let i=0;i<c.points.length;i++){const a=c.points[i],b=c.points[i+1]||a,dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1e-9));distance=Math.min(distance,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));}value=1-smooth(c.radius*(1-c.feather),c.radius,distance);}
    if(c.type==='luminance'){const n=linearToSrgb(luminance(...rgb)),f=Math.max(.001,c.feather*.12);value=smooth(c.range[0]-f,c.range[0]+f,n)*(1-smooth(c.range[1]-f,c.range[1]+f,n));}
    if(c.type==='color'){const distance=Math.hypot(...rgb.map((n,i)=>linearToSrgb(n)-c.color[i]));value=1-smooth(c.radius*(1-c.feather),c.radius,distance);}
    value*=c.density;amount=c.mode==='subtract'?amount*(1-value):c.mode==='intersect'?amount*value:Math.max(amount,value);
  }
  return mask.enabled?(mask.inverted?1-amount:amount):0;
}
function boxBlur(image:FloatImage,radius:number):FloatImage {
  const {width:w,height:h}=image,r=Math.max(1,Math.round(radius)),tmp=new Float32Array(image.data.length),out=new Float32Array(image.data.length);
  for(let y=0;y<h;y++)for(let c=0;c<4;c++){let sum=0;for(let k=-r;k<=r;k++)sum+=image.data[(y*w+clamp(k,0,w-1))*4+c];for(let x=0;x<w;x++){tmp[(y*w+x)*4+c]=sum/(2*r+1);sum+=image.data[(y*w+clamp(x+r+1,0,w-1))*4+c]-image.data[(y*w+clamp(x-r,0,w-1))*4+c];}}
  for(let x=0;x<w;x++)for(let c=0;c<4;c++){let sum=0;for(let k=-r;k<=r;k++)sum+=tmp[(clamp(k,0,h-1)*w+x)*4+c];for(let y=0;y<h;y++){out[(y*w+x)*4+c]=sum/(2*r+1);sum+=tmp[(clamp(y+r+1,0,h-1)*w+x)*4+c]-tmp[(clamp(y-r,0,h-1)*w+x)*4+c];}}return {width:w,height:h,data:out};
}
function hsl(r:number,g:number,b:number):[number,number,number] {
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;let h=0;if(d)h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)/6;return [h,d?d/(1-Math.abs(2*l-1)||1):0,l];
}
function rgb(h:number,s:number,l:number):[number,number,number] {
  h=((h%1)+1)%1;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h*6%2-1)),m=l-c/2;const a=h<1/6?[c,x,0]:h<2/6?[x,c,0]:h<3/6?[0,c,x]:h<4/6?[0,x,c]:h<5/6?[x,0,c]:[c,0,x];return a.map(n=>n+m) as [number,number,number];
}
export function renderPhoto(source:FloatImage,recipe:Recipe,maxEdge=1600):FloatImage {
  let base=source;const ratio=Math.min(1,maxEdge/Math.max(source.width,source.height));if(ratio<1)base=resizeFloat(source,Math.max(1,Math.round(source.width*ratio)),Math.max(1,Math.round(source.height*ratio)));
  const v=recipe.values;
  if(recipe.retouch.length){const original=base;base={...base,data:base.data.slice()};for(const op of recipe.retouch){const radius=op.radius*Math.min(base.width,base.height),tx=op.target.x*base.width,ty=op.target.y*base.height,dx=(op.source.x-op.target.x)*base.width,dy=(op.source.y-op.target.y)*base.height;for(let y=Math.max(0,Math.floor(ty-radius));y<Math.min(base.height,ty+radius);y++)for(let x=Math.max(0,Math.floor(tx-radius));x<Math.min(base.width,tx+radius);x++){const d=Math.hypot(x-tx,y-ty)/radius,alpha=1-smooth(1-op.feather,1,d);if(!alpha)continue;for(let c=0;c<3;c++){const p=(y*base.width+x)*4+c,s=sample(original,x+dx,y+dy,c),difference=op.type==='heal'?sample(original,tx,ty,c)-sample(original,tx+dx,ty+dy,c):0;base.data[p]=base.data[p]*(1-alpha)+(s+difference)*alpha;}}}}
  base=reduceNoise(base,v.noise,v.colorNoise);
  const needsFine=v.sharpening||v.texture,needsWide=v.clarity;const fine=needsFine?boxBlur(base,Math.max(1,base.width/750)):undefined,wide=needsWide?boxBlur(base,Math.max(2,base.width/100)):undefined;
  const quarter=recipe.rotation===90||recipe.rotation===270,cw=Math.max(1,Math.round(base.width*recipe.crop.width)),ch=Math.max(1,Math.round(base.height*recipe.crop.height)),width=quarter?ch:cw,height=quarter?cw:ch,data=new Float32Array(width*height*4);
  const exposure=Math.pow(2,v.exposure),temp=v.temperature/350,tint=v.tint/500,contrast=1+v.contrast/110,curve=recipe.curve,hasCurve=curve.length!==2||curve[0].y!==0||curve[1].y!==1,hasMixer=recipe.mixer.some(m=>m.hue||m.saturation||m.luminance);
  const redGain=exposure*Math.exp(temp+tint),greenGain=exposure*Math.exp(-tint),blueGain=exposure*Math.exp(-temp+tint),hasTone=!!(v.highlights||v.shadows||v.whites||v.blacks),hasSaturation=!!(v.saturation||v.vibrance),hasGrading=Object.values(recipe.grading).some(g=>g[1]),identityGeometry=!recipe.rotation&&!recipe.flipX&&!recipe.flipY&&!v.straighten&&!v.vertical&&!v.horizontal&&!v.distortion&&recipe.crop.x===0&&recipe.crop.y===0&&recipe.crop.width===1&&recipe.crop.height===1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=identityGeometry?{x:(x+.5)/width,y:(y+.5)/height}:outputToSource({x:(x+.5)/width,y:(y+.5)/height},recipe),sx=p.x*base.width-.5,sy=p.y*base.height-.5,i=(y*width+x)*4;
    let r=identityGeometry?base.data[i]:sample(base,sx,sy,0),g=identityGeometry?base.data[i+1]:sample(base,sx,sy,1),b=identityGeometry?base.data[i+2]:sample(base,sx,sy,2);const alpha=identityGeometry?base.data[i+3]:sample(base,sx,sy,3),sourceRgb:[number,number,number]=[r,g,b];
    if(fine){const fr=sample(fine,sx,sy,0),fg=sample(fine,sx,sy,1),fb=sample(fine,sx,sy,2),detail=v.sharpening/70+v.texture/150;r+=(r-fr)*detail;g+=(g-fg)*detail;b+=(b-fb)*detail;}
    if(wide){const l=luminance(r,g,b),blur=luminance(sample(wide,sx,sy,0),sample(wide,sx,sy,1),sample(wide,sx,sy,2)),amount=(l-blur)*v.clarity/85;r+=amount;g+=amount;b+=amount;}
    if(recipe.profile==='neutral'){r*=.98;g*=1.005;b*=1.015;}
    if(recipe.profile==='monochrome'){r=g=b=luminance(r,g,b);}
    r*=redGain;g*=greenGain;b*=blueGain;
    if(hasTone){const l=Math.max(.00001,luminance(r,g,b)),sh=(1-smooth(.02,.5,l)),hi=smooth(.18,1.2,l),gain=Math.pow(2,(v.shadows/100*sh+v.highlights/100*hi)*.8+v.whites/200*smooth(.4,1,l)),offset=v.blacks/1600*(1-smooth(.02,.25,l));r=r*gain+offset;g=g*gain+offset;b=b*gain+offset;}
    for(let c=0;c<3;c++){let n=c===0?r:c===1?g:b;n=.18+(n-.18)*contrast;if(v.dehaze)n=(n-v.dehaze/1800)/(1-v.dehaze/250);if(hasCurve){let t=linearToSrgb(n);if(t>=0&&t<=1){let k=1;while(k<curve.length-1&&curve[k].x<t)k++;const a=curve[k-1],z=curve[k];t=a.y+(z.y-a.y)*clamp((t-a.x)/(z.x-a.x||1e-8));n=srgbToLinear(t);}}if(c===0)r=n;else if(c===1)g=n;else b=n;}
    let lum=luminance(r,g,b);if(hasSaturation){const sat=(1+v.saturation/100)*(1+v.vibrance/100*(1-clamp((Math.max(r,g,b)-Math.min(r,g,b))/(Math.max(r,g,b)||1))));r=lum+(r-lum)*sat;g=lum+(g-lum)*sat;b=lum+(b-lum)*sat;}
    if(hasMixer){let [h,s,light]=hsl(linearToSrgb(r),linearToSrgb(g),linearToSrgb(b));let dh=0,ds=0,dl=0;const centers=[0,1/12,1/6,1/3,.5,2/3,.78,.92];recipe.mixer.forEach((m,k)=>{let d=Math.abs(h-centers[k]);d=Math.min(d,1-d);const weight=Math.max(0,1-d/.14);dh+=m.hue/600*weight;ds+=m.saturation/100*weight;dl+=m.luminance/300*weight;});[r,g,b]=rgb(h+dh,clamp(s*(1+ds)),light+dl).map(srgbToLinear) as [number,number,number];}
    if(hasGrading)for(const [key,w] of [['shadows',1-smooth(.02,.35,lum)],['midtones',Math.max(0,1-Math.abs(lum-.35)/.35)],['highlights',smooth(.3,.9,lum)]] as const){const [h,s]=recipe.grading[key];if(s){const color=rgb(h/360,.8,.5),amount=s/100*w*.12;r+=(color[0]-.5)*amount;g+=(color[1]-.5)*amount;b+=(color[2]-.5)*amount;}}
    for(const mask of recipe.masks){const a=maskValue(mask,p,sourceRgb);if(!a)continue;const e=Math.pow(2,mask.exposure*a),t=mask.temperature/350*a,s=1+mask.saturation/100*a;r*=e*Math.exp(t);g*=e;b*=e*Math.exp(-t);lum=luminance(r,g,b);r=lum+(r-lum)*s;g=lum+(g-lum)*s;b=lum+(b-lum)*s;}
    if(v.vignette){const distance=Math.hypot((x/width-.5)*1.4,(y/height-.5)*1.4),vig=1+v.vignette/100*smooth(.15,.8,distance);r*=vig;g*=vig;b*=vig;}
    if(v.fringing){const shift=v.fringing/3000;r+=(sample(base,(sx-base.width/2)*(1+shift)+base.width/2,sy,0)-sourceRgb[0])*exposure;b+=(sample(base,(sx-base.width/2)*(1-shift)+base.width/2,sy,2)-sourceRgb[2])*exposure;}
    if(v.grain){const seed=(Math.floor(p.x*source.width)*374761393+Math.floor(p.y*source.height)*668265263)|0;let hash=Math.imul(seed^(seed>>>13),1274126177);hash^=hash>>>16;const grain=((hash>>>0)/4294967295-.5)*v.grain/1200;r+=grain;g+=grain;b+=grain;}
    data[i]=Number.isFinite(r)?r:0;data[i+1]=Number.isFinite(g)?g:0;data[i+2]=Number.isFinite(b)?b:0;data[i+3]=alpha;
  }
  return {width,height,data};
}
export function displayPixels(image:FloatImage,clipping=false):Uint8ClampedArray {
  const out=new Uint8ClampedArray(image.data.length);for(let i=0;i<out.length;i+=4){let black=true,white=false;for(let c=0;c<3;c++){const n=image.data[i+c];out[i+c]=clamp(linearToSrgb(n))*255;if(n>.0001)black=false;if(n>=1)white=true;}out[i+3]=clamp(image.data[i+3])*255;if(clipping&&white){out[i]=255;out[i+1]=30;out[i+2]=30;}else if(clipping&&black){out[i]=30;out[i+1]=70;out[i+2]=255;}}return out;
}
export function sharpenOutput(image:FloatImage,amount:number):FloatImage {
  if(amount<=0)return image;const blur=boxBlur(image,1),data=image.data.slice();
  for(let i=0;i<data.length;i+=4){const detail=(luminance(image.data[i],image.data[i+1],image.data[i+2])-luminance(blur.data[i],blur.data[i+1],blur.data[i+2]))*clamp(amount,0,100)/100;for(let c=0;c<3;c++)data[i+c]+=detail;}
  return {...image,data};
}
export function histogram(image:FloatImage):number[][] {
  const bins=Array.from({length:3},()=>new Array(256).fill(0));for(let i=0;i<image.data.length;i+=4){if(image.data[i+3]<.5)continue;for(let c=0;c<3;c++)bins[c][Math.round(clamp(linearToSrgb(image.data[i+c]))*255)]++;}return bins;
}
export function analyzePhoto(image:FloatImage):Culling {
  let edges=0,n=0,mean=0,clipped=0;const l=(x:number,y:number)=>luminance(...[0,1,2].map(c=>image.data[(y*image.width+x)*4+c]) as [number,number,number]);
  for(let y=1;y<image.height-1;y+=2)for(let x=1;x<image.width-1;x+=2){const value=l(x,y);edges+=Math.abs(4*value-l(x-1,y)-l(x+1,y)-l(x,y-1)-l(x,y+1));mean+=linearToSrgb(value);if(value<.001||value>=.98)clipped++;n++;}
  const sharpness=clamp(edges/Math.max(n,1)*700,0,100),exposure=clamp(100-Math.abs(mean/Math.max(n,1)-.45)*120-clipped/Math.max(n,1)*100,0,100);return {sharpness,exposure,score:sharpness*.5+exposure*.5,clipped:clipped/Math.max(n,1),method:'edge-energy-and-luminance-v1'};
}
export function autoValues(image:FloatImage):{exposure:number;highlights:number;shadows:number;whites:number;blacks:number} {
  const values:number[]=[];for(let i=0;i<image.data.length;i+=Math.max(4,Math.floor(image.data.length/40000/4)*4))values.push(luminance(image.data[i],image.data[i+1],image.data[i+2]));values.sort((a,b)=>a-b);const at=(p:number)=>values[Math.floor((values.length-1)*p)]||.001;return {exposure:Math.round(clamp(Math.log2(.18/Math.max(.001,at(.5))),-3,3)*100)/100,highlights:at(.98)>.85?-35:0,shadows:at(.1)<.025?25:0,whites:at(.99)<.6?12:0,blacks:at(.01)>.015?-10:0};
}
