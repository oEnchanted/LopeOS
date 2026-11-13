import { defaultRecipe, validateRecipe, type FloatImage, type Recipe } from './model.ts';
import { decodePhoto } from './decode.ts';
import { analyzePhoto, autoValues, displayPixels, histogram, renderPhoto, resizeFloat, sharpenOutput } from './render.ts';
import { encodeTiff } from './tiff.ts';
import { tagJpegSrgb } from './jpeg.ts';
import { encodePng } from './png.ts';
let cached:{id:string;image:FloatImage}|undefined;
const imageBlob=async(image:FloatImage,type='image/jpeg',quality=.85)=>{const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d')!;ctx.putImageData(new ImageData(displayPixels(image) as Uint8ClampedArray<ArrayBuffer>,image.width,image.height),0,0);return canvas.convertToBlob({type,quality});};
async function source(payload:{assetId:string;blob:Blob;name:string}){if(cached?.id!==payload.assetId){const decoded=await decodePhoto(payload.blob,payload.name);cached={id:payload.assetId,image:decoded.image};}return cached.image;}
// One worker owns one decoded original. Requests are serialized, bounding decode allocations.
let tail=Promise.resolve();
self.onmessage=({data:message})=>{tail=tail.then(async()=>{
  try{
    const p=message.payload;let result:unknown;
    if(message.action==='inspect'){
      const decoded=await decodePhoto(p.blob,p.name),scale=Math.min(1,420/Math.max(decoded.image.width,decoded.image.height)),small=resizeFloat(decoded.image,Math.max(1,Math.round(decoded.image.width*scale)),Math.max(1,Math.round(decoded.image.height*scale)));
      result={metadata:decoded.metadata,thumbnail:await imageBlob(small),analysis:analyzePhoto(small)};cached=undefined;
    }else if(message.action==='render'){
      const rendered=renderPhoto(await source(p),validateRecipe(p.recipe),p.maxEdge||1400);const pixels=displayPixels(rendered,!!p.clipping);result={width:rendered.width,height:rendered.height,pixels,histogram:histogram(rendered),duration:0};
      self.postMessage({id:message.id,result},[pixels.buffer]);return;
    }else if(message.action==='handoff'){
      const rendered=renderPhoto(await source(p),validateRecipe(p.recipe),65535),{newDocument,layer}=await import('../../image-engine/src/model.ts'),{fromPixels}=await import('../../image-engine/src/pixels.ts'),{serializeDocument}=await import('../../image-engine/src/native.ts');
      const doc=newDocument(rendered.width,rendered.height,p.documentName||'Lightroom edit',[0,0,0,0]),pixels=fromPixels(rendered.width,rendered.height,displayPixels(rendered)),photo={...layer('Developed photo'),pixels};doc.layers=[photo];doc.activeIds=[photo.id];
      result={blob:new Blob([serializeDocument(doc)],{type:'application/x-lopeimage'})};
    }else if(message.action==='auto'){result=autoValues(await source(p));}
    else if(message.action==='white-balance'){
      const image=await source(p),x=Math.max(0,Math.min(image.width-1,Math.floor(p.point.x*image.width))),y=Math.max(0,Math.min(image.height-1,Math.floor(p.point.y*image.height))),i=(y*image.width+x)*4,r=Math.max(.001,image.data[i]),g=Math.max(.001,image.data[i+1]),b=Math.max(.001,image.data[i+2]);result={temperature:Math.max(-100,Math.min(100,Math.log(b/r)*175)),tint:Math.max(-100,Math.min(100,Math.log(g/Math.sqrt(r*b))*250))};
    }else if(message.action==='export'){
      const original=await source(p),recipe:Recipe=validateRecipe(p.recipe);let rendered=renderPhoto(original,recipe,65535);
      if(p.longEdge>0&&Math.max(rendered.width,rendered.height)>p.longEdge){const ratio=p.longEdge/Math.max(rendered.width,rendered.height);rendered=resizeFloat(rendered,Math.max(1,Math.round(rendered.width*ratio)),Math.max(1,Math.round(rendered.height*ratio)));}
      rendered=sharpenOutput(rendered,Number(p.outputSharpening)||0);
      if(p.watermark){const canvas=new OffscreenCanvas(rendered.width,rendered.height),ctx=canvas.getContext('2d')!;const size=Math.max(10,Math.round(rendered.width/55));ctx.font=`${size}px sans-serif`;ctx.textAlign='right';ctx.fillStyle='rgba(255,255,255,.8)';ctx.shadowColor='rgba(0,0,0,.65)';ctx.shadowBlur=3;ctx.fillText(String(p.watermark).slice(0,120),rendered.width-size,rendered.height-size);const pixels=ctx.getImageData(0,0,rendered.width,rendered.height).data;const {srgbToLinear}=await import('./tiff.ts');for(let i=0;i<rendered.data.length;i+=4){const alpha=pixels[i+3]/255;if(!alpha)continue;for(let c=0;c<3;c++)rendered.data[i+c]=rendered.data[i+c]*(1-alpha)+srgbToLinear(pixels[i+c]/255)*alpha;rendered.data[i+3]=rendered.data[i+3]+alpha*(1-rendered.data[i+3]);}}
      let blob:Blob;
      if(p.format==='tiff')blob=new Blob([encodeTiff(rendered,p.depth===32?32:p.depth===8?8:16) as BlobPart],{type:'image/tiff'});
      else if(p.format==='png')blob=new Blob([await encodePng(rendered,p.depth===16?16:8) as BlobPart],{type:'image/png'});
      else {
        const jpeg=new Uint8Array(await (await imageBlob(rendered,'image/jpeg',p.quality||.9)).arrayBuffer());blob=new Blob([tagJpegSrgb(jpeg) as BlobPart],{type:'image/jpeg'});
      }
      result={blob,width:rendered.width,height:rendered.height};
    }else if(message.action==='clear'){cached=undefined;result=true;}
    else throw new Error('Unknown photo worker action.');
    self.postMessage({id:message.id,result});
  }catch(cause){self.postMessage({id:message.id,error:cause instanceof Error?cause.message:'Photo processing failed.'});}
});};
