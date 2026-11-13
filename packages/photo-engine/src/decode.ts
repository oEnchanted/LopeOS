import type { FloatImage, PhotoMetadata } from './model.ts';
import { extension, identifyFormat, rawExtensions } from './formats.ts';
import { checkDimensions, decodeTiff, srgbToLinear, tiffTags, type TiffValue } from './tiff.ts';
import { decodePng16 } from './png.ts';
export function exifTags(bytes:Uint8Array):Map<number,TiffValue> {
  try {
    if(bytes[0]===255&&bytes[1]===216){let p=2;while(p+4<bytes.length&&bytes[p]===255){const marker=bytes[p+1];if(marker===218||marker===217)break;const length=bytes[p+2]*256+bytes[p+3];if(length<2||p+length+2>bytes.length)break;if(marker===225&&String.fromCharCode(...bytes.subarray(p+4,p+10))==='Exif\0\0')return tiffTags(bytes,p+10);p+=length+2;}}
    if(bytes[0]===73||bytes[0]===77)return tiffTags(bytes);
  }catch{/* Invalid metadata does not replace valid decoded pixels. */}return new Map();
}
export function metadataFromTags(tags:Map<number,TiffValue>):Partial<PhotoMetadata> {
  const n=(k:number)=>{const v=tags.get(k);return Array.isArray(v)?v[0]:undefined;},s=(k:number)=>{const v=tags.get(k);return typeof v==='string'?v:undefined;};
  return {camera:[s(271),s(272)].filter(Boolean).join(' ')||undefined,lens:s(42036),iso:n(34855),shutter:n(33434),aperture:n(33437),focalLength:n(37386),captured:s(36867)||s(306),orientation:n(274)||1};
}
export async function decodePhoto(blob:Blob,name:string):Promise<{image:FloatImage;metadata:PhotoMetadata}> {
  if(blob.size>256*1024*1024)throw new Error('This photo exceeds the 256 MiB source-file limit.');
  const bytes=new Uint8Array(await blob.arrayBuffer()),format=identifyFormat(bytes,name),tags=exifTags(bytes),extra=metadataFromTags(tags);
  let image:FloatImage,bitDepth=8,decoder='Browser image decoder',raw=false;const warnings:string[]=[];
  if(rawExtensions.has(extension(name))||tags.has(50706)){
    const {default:LibRaw}=await import('libraw-wasm');const decoderInstance=new LibRaw();
    try {
      await decoderInstance.open(bytes,{outputBps:16,outputColor:1,gamm:[1,1],noAutoBright:true,useCameraWb:true,userQual:3,highlight:2});
      const meta=await decoderInstance.metadata(true);if(!meta)throw new Error('RAW metadata was not returned.');checkDimensions(meta.width,meta.height);const pixels=await decoderInstance.imageData();if(!pixels)throw new Error('RAW development returned no pixels.');checkDimensions(pixels.width,pixels.height);
      if(pixels.bits!==16||pixels.colors<3||!(pixels.data instanceof Uint16Array))throw new Error('The RAW decoder did not return full-precision developed RGB.');
      const data=new Float32Array(pixels.width*pixels.height*4);for(let p=0;p<pixels.width*pixels.height;p++){for(let c=0;c<3;c++)data[p*4+c]=pixels.data[p*pixels.colors+c]/65535;data[p*4+3]=1;}
      image={width:pixels.width,height:pixels.height,data};bitDepth=16;decoder='LibRaw WASM 1.6.0; 16-bit linear sensor development';raw=true;
      Object.assign(extra,{camera:[meta.camera_make,meta.camera_model].filter(Boolean).join(' '),lens:meta.lens?.Lens,iso:meta.iso_speed,shutter:meta.shutter,aperture:meta.aperture,focalLength:meta.focal_len,captured:meta.timestamp instanceof Date&&meta.timestamp.getTime()>0?meta.timestamp.toISOString():undefined});
      warnings.push('RAW rendering uses LibRaw. Results may differ from other photo editors; support varies by camera and compression format.');
    }finally{decoderInstance.dispose();}
  }else if(format==='lopeimage'){
    const {deserializeDocument}=await import('../../image-engine/src/native.ts'),{CanvasRenderer,context2d}=await import('../../image-engine/src/render.ts');
    const doc=deserializeDocument(new TextDecoder().decode(bytes));checkDimensions(doc.width,doc.height);const renderer=new CanvasRenderer();
    try{const canvas=renderer.render(doc),pixels=context2d(canvas).getImageData(0,0,doc.width,doc.height).data,data=new Float32Array(pixels.length);for(let i=0;i<data.length;i++)data[i]=i%4===3?pixels[i]/255:srgbToLinear(pixels[i]/255);image={width:doc.width,height:doc.height,data};}
    finally{renderer.dispose();}decoder='Shared Lope Image Editor native composite';warnings.push('RGB/8 layered project handoff. Layers are retained in original bytes; Lightroom develops the composite.');
  }else if(format==='tiff'){const result=decodeTiff(bytes);image=result.image;bitDepth=result.bitDepth;decoder='Lope TIFF 1.0';}
  else if(format==='png'&&bytes[24]===16){image=await decodePng16(bytes);bitDepth=16;decoder='Lope PNG16 1.0';}
  else if(format==='psb')throw new Error('PSB composite decoding is not available. Use a PSD with a compatible merged composite.');
  else if(format==='psd'){
    if(bytes.length<26)throw new Error('Truncated PSD header.');const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);checkDimensions(header.getUint32(18),header.getUint32(14));
    if(header.getUint16(22)!==8||header.getUint16(24)!==3)throw new Error('Only RGB/8 compatible PSD composites are supported. The source has not been converted.');
    const {readPsd,initializeCanvas}=await import('ag-psd');initializeCanvas((w,h)=>new OffscreenCanvas(w,h) as unknown as HTMLCanvasElement,(w,h)=>new ImageData(w,h));
    const psd=readPsd(bytes,{skipLayerImageData:true,skipThumbnail:true,useImageData:true,totalMemoryLimit:384*1024*1024});
    if((psd.bitsPerChannel||8)!==8)throw new Error('Only RGB/8 PSD composites are supported. The original layered source is preserved.');
    if(!psd.imageData)throw new Error('This PSD has no compatible merged composite. Save with Maximize Compatibility in the source application.');
    checkDimensions(psd.width,psd.height);const data=new Float32Array(psd.imageData.data.length);for(let i=0;i<data.length;i++)data[i]=i%4===3?psd.imageData.data[i]/255:srgbToLinear(psd.imageData.data[i]/255);image={width:psd.width,height:psd.height,data};decoder='ag-psd 31.0.3 merged composite';warnings.push('Merged composite only. Photoshop layers are preserved in original bytes and are not edited here.');
  }else{
    let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(blob,{imageOrientation:'from-image',colorSpaceConversion:'default',premultiplyAlpha:'none'});}catch{throw new Error(`This browser cannot fully decode ${format.toUpperCase()}. No embedded preview has been substituted.`);}
    try{checkDimensions(bitmap.width,bitmap.height);const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'})!;ctx.drawImage(bitmap,0,0);const rgba=ctx.getImageData(0,0,bitmap.width,bitmap.height).data,data=new Float32Array(rgba.length);for(let i=0;i<data.length;i++)data[i]=i%4===3?rgba[i]/255:srgbToLinear(rgba[i]/255);image={width:bitmap.width,height:bitmap.height,data};}
    finally{bitmap.close();}
    warnings.push('Working space: linear sRGB. Browser color conversion applies at decode; encoded metadata remains in the immutable original, not all rendered exports.');
    if(['avif','heif','jxl'].includes(format))warnings.push('Browser SDR raster path. High-bit-depth, wide-gamut and auxiliary HDR preservation are not claimed for developed output.');
  }
  return {image,metadata:{...extra,width:image.width,height:image.height,bitDepth,format,decoder,colorSpace:'linear sRGB',orientation:extra.orientation||1,warnings,raw}};
}
