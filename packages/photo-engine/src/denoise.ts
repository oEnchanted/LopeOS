import { clamp, type FloatImage } from './model.ts';
import { checkDimensions, linearToSrgb, srgbToLinear } from './tiff.ts';

export const DENOISE_TILE=160;
export const DENOISE_HALO=32;
export const DENOISE_CORE=DENOISE_TILE-2*DENOISE_HALO;
export type DenoiseParameters={sigma:number;amount:number};
export type DenoiseRegion={x:number;y:number;width:number;height:number};
export type DenoiseProgress={phase:'loading'|'decoding'|'processing'|'encoding';completed:number;total:number};
export type TileInference=(rgb:Float32Array,sigma:number)=>Promise<Float32Array>;
export type DenoiseProvenance={
  type:'ai-denoise';modelId:string;modelSha256:string;runtime:string;backend:'wasm';engineVersion:string;sourceDecoder:string;
  sourceAssetId:string;sourceHash:string;sigma:number;amount:number;created:string;
  processingDomain:'developed-srgb';tileSize:number;halo:number;durationMs:number;
};
export function validateDenoiseParameters(input:DenoiseParameters):DenoiseParameters{
  if(!input||!Number.isFinite(input.sigma)||input.sigma<1||input.sigma>75||!Number.isFinite(input.amount)||input.amount<0||input.amount>100)throw new Error('Choose a noise level from 1 to 75 and an amount from 0 to 100.');
  return {sigma:input.sigma,amount:input.amount};
}
export function checkDenoiseEligibility(image:FloatImage){
  checkDimensions(image.width,image.height);
  for(let i=0;i<image.data.length;i+=4){
    if(image.data[i+3]<.9999)throw new Error('AI Denoise currently supports opaque photos. Transparent originals are preserved; use an opaque copy for denoising.');
    for(let c=0;c<3;c++)if(!Number.isFinite(image.data[i+c])||image.data[i+c]<-1e-6||image.data[i+c]>1.000001)throw new Error('This local model supports SDR color values. HDR or out-of-range originals have not been clipped or changed.');
  }
}
export function previewRegion(image:Pick<FloatImage,'width'|'height'>,focus:{x:number;y:number},edge=192):DenoiseRegion{
  const width=Math.min(edge,image.width),height=Math.min(edge,image.height);
  return {x:clamp(Math.round(clamp(focus.x)*image.width-width/2),0,image.width-width),y:clamp(Math.round(clamp(focus.y)*image.height-height/2),0,image.height-height),width,height};
}
export function extractRegion(image:FloatImage,region:DenoiseRegion):FloatImage{
  const data=new Float32Array(region.width*region.height*4);
  for(let y=0;y<region.height;y++)data.set(image.data.subarray(((region.y+y)*image.width+region.x)*4,((region.y+y)*image.width+region.x+region.width)*4),y*region.width*4);
  return {width:region.width,height:region.height,data};
}
export function denoiseTiles(image:Pick<FloatImage,'width'|'height'>,region:DenoiseRegion){
  const tiles:{x:number;y:number}[]=[];
  for(let y=Math.floor(region.y/DENOISE_CORE)*DENOISE_CORE;y<region.y+region.height;y+=DENOISE_CORE)
    for(let x=Math.floor(region.x/DENOISE_CORE)*DENOISE_CORE;x<region.x+region.width;x+=DENOISE_CORE)tiles.push({x,y});
  return tiles;
}
/** Every preview and full result uses the same global tile grid, halo and source coordinates. */
export async function denoiseImage(image:FloatImage,parameters:DenoiseParameters,infer:TileInference,region:DenoiseRegion={x:0,y:0,width:image.width,height:image.height},progress?:(done:number,total:number)=>void):Promise<FloatImage>{
  const params=validateDenoiseParameters(parameters);checkDenoiseEligibility(image);
  if(!Number.isInteger(region.x)||!Number.isInteger(region.y)||!Number.isInteger(region.width)||!Number.isInteger(region.height)||region.x<0||region.y<0||region.width<1||region.height<1||region.x+region.width>image.width||region.y+region.height>image.height)throw new Error('Invalid denoise preview region.');
  const result=extractRegion(image,region);if(params.amount===0)return result;
  const tiles=denoiseTiles(image,region),plane=DENOISE_TILE*DENOISE_TILE,amount=params.amount/100;
  for(let index=0;index<tiles.length;index++){
    const tile=tiles[index],input=new Float32Array(3*plane);
    for(let y=0;y<DENOISE_TILE;y++)for(let x=0;x<DENOISE_TILE;x++){
      const sx=clamp(tile.x+x-DENOISE_HALO,0,image.width-1),sy=clamp(tile.y+y-DENOISE_HALO,0,image.height-1),i=(sy*image.width+sx)*4;
      for(let c=0;c<3;c++)input[c*plane+y*DENOISE_TILE+x]=clamp(linearToSrgb(image.data[i+c]));
    }
    const output=await infer(input,params.sigma/255);if(!(output instanceof Float32Array)||output.length!==input.length)throw new Error('The denoise model returned an unexpected tensor.');
    const x0=Math.max(region.x,tile.x),y0=Math.max(region.y,tile.y),x1=Math.min(region.x+region.width,tile.x+DENOISE_CORE),y1=Math.min(region.y+region.height,tile.y+DENOISE_CORE);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const at=((y-region.y)*region.width+x-region.x)*4,t=(y-tile.y+DENOISE_HALO)*DENOISE_TILE+(x-tile.x+DENOISE_HALO),source=(y*image.width+x)*4;
      for(let c=0;c<3;c++){const value=output[c*plane+t];if(!Number.isFinite(value))throw new Error('The denoise model returned nonfinite pixels.');result.data[at+c]=image.data[source+c]+(srgbToLinear(clamp(value))-image.data[source+c])*amount;}
    }
    progress?.(index+1,tiles.length);
  }
  return result;
}
