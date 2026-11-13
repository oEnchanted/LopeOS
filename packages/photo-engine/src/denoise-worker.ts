import type * as Ort from 'onnxruntime-web/wasm';
import { DENOISE_PACKAGE } from './denoise-manifest.ts';
import { verifyDenoiseFile, type DenoiseInstallation } from './denoise-cache.ts';
import { denoiseImage, extractRegion, previewRegion, validateDenoiseParameters, type DenoiseProgress } from './denoise.ts';
import { decodePhoto } from './decode.ts';
import { analyzePhoto, displayPixels, renderPhoto, resizeFloat } from './render.ts';
import { ENGINE_VERSION, defaultRecipe, validateRecipe, type FloatImage } from './model.ts';
import { encodeTiff } from './tiff.ts';
let runtime:typeof Ort|undefined,session:Ort.InferenceSession|undefined,decoded:{id:string;image:FloatImage;decoder:string}|undefined;
function url(blob:Blob){const result=URL.createObjectURL(blob);self.postMessage({resourceUrl:result});return result;}
async function initialize(installation:DenoiseInstallation){
  if(session&&runtime)return;
  if(installation?.id!==DENOISE_PACKAGE.id)throw new Error('Download the local AI-denoise model before processing.');
  for(const file of DENOISE_PACKAGE.files)await verifyDenoiseFile(installation.files[file.id],file.id);
  const bundleUrl=url(installation.files.runtime);
  runtime=await import(/* @vite-ignore */bundleUrl) as typeof Ort;
  runtime.env.wasm.numThreads=1;runtime.env.wasm.proxy=false;runtime.env.wasm.initTimeout=60000;
  runtime.env.wasm.wasmPaths={mjs:url(installation.files.loader),wasm:url(installation.files.wasm)};
  session=await runtime.InferenceSession.create(new Uint8Array(await installation.files.model.arrayBuffer()),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  if(!session.inputNames.includes('image')||!session.inputNames.includes('sigma')||!session.outputNames.includes('denoised'))throw new Error('The installed denoise model has unexpected inputs or outputs.');
}
async function image(payload:{assetId:string;blob:Blob;name:string}){if(decoded?.id!==payload.assetId){const result=await decodePhoto(payload.blob,payload.name);decoded={id:payload.assetId,image:result.image,decoder:result.metadata.decoder};}return decoded.image;}
async function infer(rgb:Float32Array,sigma:number){
  const feeds={image:new runtime!.Tensor('float32',rgb,[1,3,160,160]),sigma:new runtime!.Tensor('float32',new Float32Array([sigma]),[1,1,1,1])};
  let output:Awaited<ReturnType<Ort.InferenceSession['run']>>|undefined;
  try{output=await session!.run(feeds);const tensor=output.denoised;if(!(tensor.data instanceof Float32Array))throw new Error('AI denoise returned an invalid result.');return tensor.data.slice();}
  finally{feeds.image.dispose();feeds.sigma.dispose();if(output)for(const tensor of Object.values(output))tensor.dispose();}
}
let tail=Promise.resolve();
self.onmessage=({data:message})=>{tail=tail.then(async()=>{
  const {id,action,payload:p}=message;const progress=(value:DenoiseProgress)=>self.postMessage({id,progress:value});
  try{
    progress({phase:'loading',completed:0,total:1});await initialize(p.installation);progress({phase:'loading',completed:1,total:1});
    if(action==='initialize'){self.postMessage({id,result:{model:DENOISE_PACKAGE.id,backend:'wasm'}});return;}
    const started=performance.now();progress({phase:'decoding',completed:0,total:1});const original=await image(p);progress({phase:'decoding',completed:1,total:1});
    const parameters=validateDenoiseParameters(p.parameters),region=action==='preview'?previewRegion(original,p.focus||{x:.5,y:.5}):{x:0,y:0,width:original.width,height:original.height};
    const result=await denoiseImage(original,parameters,infer,region,(completed,total)=>progress({phase:'processing',completed,total}));
    if(action==='preview'){
      const sourceRegion=extractRegion(original,region),before=displayPixels(sourceRegion),after=displayPixels(result),scale=Math.min(1,240/Math.max(original.width,original.height)),nav=resizeFloat(original,Math.max(1,Math.round(original.width*scale)),Math.max(1,Math.round(original.height*scale))),canvas=new OffscreenCanvas(nav.width,nav.height);canvas.getContext('2d')!.putImageData(new ImageData(displayPixels(nav) as Uint8ClampedArray<ArrayBuffer>,nav.width,nav.height),0,0);const navigator=await canvas.convertToBlob({type:'image/jpeg',quality:.85});self.postMessage({id,result:{width:region.width,height:region.height,region,before,after,originalPixels:sourceRegion.data,denoisedPixels:result.data,navigator,durationMs:performance.now()-started}},[before.buffer,after.buffer,sourceRegion.data.buffer,result.data.buffer]);return;
    }
    if(action!=='denoise')throw new Error('Unknown AI denoise action.');
    progress({phase:'encoding',completed:0,total:1});const blob=new Blob([encodeTiff(result,16) as BlobPart],{type:'image/tiff'});
    const recipe=validateRecipe(p.recipe||defaultRecipe()),rendered=renderPhoto(result,recipe,420),canvas=new OffscreenCanvas(rendered.width,rendered.height),ctx=canvas.getContext('2d')!;ctx.putImageData(new ImageData(displayPixels(rendered) as Uint8ClampedArray<ArrayBuffer>,rendered.width,rendered.height),0,0);
    const thumbnail=await canvas.convertToBlob({type:'image/jpeg',quality:.88}),ratio=Math.min(1,420/Math.max(result.width,result.height)),small=resizeFloat(result,Math.max(1,Math.round(result.width*ratio)),Math.max(1,Math.round(result.height*ratio)));
    progress({phase:'encoding',completed:1,total:1});self.postMessage({id,result:{blob,thumbnail,analysis:analyzePhoto(small),width:result.width,height:result.height,provenance:{type:'ai-denoise',modelId:DENOISE_PACKAGE.id,modelSha256:DENOISE_PACKAGE.files[0].sha256,runtime:DENOISE_PACKAGE.runtime,backend:'wasm',engineVersion:ENGINE_VERSION,sourceDecoder:decoded!.decoder,sourceAssetId:p.assetId,sourceHash:p.sourceHash,sigma:parameters.sigma,amount:parameters.amount,created:new Date().toISOString(),processingDomain:'developed-srgb',tileSize:160,halo:32,durationMs:performance.now()-started}}});
  }catch(cause){self.postMessage({id,error:cause instanceof Error?cause.message:'Local AI denoise failed.'});}
});};
