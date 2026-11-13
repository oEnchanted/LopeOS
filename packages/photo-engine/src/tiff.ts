import { clamp, type FloatImage } from './model.ts';
export const srgbToLinear = (n: number) => n <= .04045 ? n / 12.92 : Math.pow((n + .055) / 1.055, 2.4);
export const linearToSrgb = (n: number) => n <= .0031308 ? n * 12.92 : 1.055 * Math.pow(Math.max(0,n), 1/2.4) - .055;
export const MAX_PIXELS = 24_000_000;
export function checkDimensions(width: number, height: number) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>65535||height>65535||width*height>MAX_PIXELS) throw new Error('Image exceeds the local engine limit of 24 megapixels or has invalid dimensions. The original is unchanged.');
}
export type TiffValue = number[] | string;
export function tiffTags(bytes: Uint8Array, base = 0): Map<number,TiffValue> {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); const result = new Map<number,TiffValue>();
  const requireBytes=(p:number,n:number)=>{if(p<0||p+n>bytes.length)throw new Error('Truncated TIFF metadata.');};
  requireBytes(base,8); const little = view.getUint16(base)===0x4949;
  if(!little&&view.getUint16(base)!==0x4d4d||view.getUint16(base+2,little)!==42)throw new Error('Unsupported TIFF header (BigTIFF is not implemented).');
  const visited=new Set<number>();
  const read=(offset:number,depth=0)=>{
    if(depth>4||visited.has(offset))return;visited.add(offset);requireBytes(offset,2);const count=view.getUint16(offset,little);if(count>2048)throw new Error('Excessive TIFF tag count.');requireBytes(offset+2,count*12);
    for(let i=0;i<count;i++){
      const p=offset+2+i*12,tag=view.getUint16(p,little),type=view.getUint16(p+2,little),length=view.getUint32(p+4,little);
      const size=({1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8,11:4,12:8} as Record<number,number>)[type];
      if(!size||length>1_000_000)continue;const at=length*size<=4?p+8:base+view.getUint32(p+8,little);requireBytes(at,length*size);
      if(type===2){result.set(tag,new TextDecoder().decode(bytes.subarray(at,at+Math.min(length,4096))).replace(/\0.*$/s,''));continue;}
      const values:number[]=[];
      for(let j=0;j<length;j++){const q=at+j*size;values.push(type===3?view.getUint16(q,little):type===4?view.getUint32(q,little):type===9?view.getInt32(q,little):type===5?view.getUint32(q,little)/Math.max(1,view.getUint32(q+4,little)):type===10?view.getInt32(q,little)/Math.max(1,view.getInt32(q+4,little)):type===11?view.getFloat32(q,little):type===12?view.getFloat64(q,little):bytes[q]);}
      result.set(tag,values);if(tag===34665&&values[0])read(base+values[0],depth+1);
    }
  };
  read(base+view.getUint32(base+4,little));return result;
}
export function decodeTiff(bytes: Uint8Array): { image: FloatImage; bitDepth: number; tags: Map<number,TiffValue> } {
  const tags=tiffTags(bytes);const get=(tag:number,fallback:number[]=[]):number[]=>{const v=tags.get(tag);return Array.isArray(v)?v:fallback;};
  if(tags.has(50706))throw new Error('DNG sensor data requires the RAW decoder.');
  const width=get(256)[0],height=get(257)[0];checkDimensions(width,height);
  const bits=get(258,[8]),depth=bits[0],compression=get(259,[1])[0],photo=get(262,[2])[0],samples=get(277,[1])[0],sampleFormat=get(339,[1])[0];
  if(compression!==1||get(284,[1])[0]!==1||![1,2].includes(photo)||![1,2,3,4].includes(samples)||![8,16,32].includes(depth)||bits.some(v=>v!==depth)||depth===32&&sampleFormat!==3||depth!==32&&sampleFormat!==1||tags.has(322))throw new Error('This TIFF variant needs another decoder. Supported: uncompressed striped grayscale/RGB(A), 8/16-bit unsigned or 32-bit float.');
  if(tags.has(34675)){
    const profile=get(34675),known=srgbProfile(depth===32);
    if(profile.length!==known.length||profile.some((n,i)=>n!==known[i]))throw new Error('This TIFF ICC profile requires an additional color transform. LopeOS sRGB TIFFs can be reopened directly.');
  }
  const offsets=get(273),counts=get(279),rows=get(278,[height])[0];if(!offsets.length||rows<1)throw new Error('TIFF strip data is missing.');
  const little=bytes[0]===73,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),data=new Float32Array(width*height*4),size=depth/8;
  for(let y=0;y<height;y++){
    const strip=Math.floor(y/rows),at=offsets[strip]+(y%rows)*width*samples*size;
    if(!Number.isFinite(at)||at<0||at+width*samples*size>bytes.length||(y%rows+1)*width*samples*size>counts[strip])throw new Error('Truncated TIFF pixel strip.');
    for(let x=0;x<width;x++){
      const read=(c:number)=>{const p=at+(x*samples+c)*size;const n=depth===32?view.getFloat32(p,little):depth===16?view.getUint16(p,little)/65535:bytes[p]/255;return Number.isFinite(n)?n:0;};
      const i=(y*width+x)*4;for(let c=0;c<3;c++){const n=read(photo===1?0:c);data[i+c]=depth===32?n:srgbToLinear(n);}data[i+3]=(photo===1&&samples===2||photo===2&&samples===4)?clamp(read(samples-1)):1;
    }
  }
  return {image:orientImage({width,height,data},get(274,[1])[0]),bitDepth:depth,tags};
}
export function orientImage(image: FloatImage, orientation: number): FloatImage {
  if(orientation===1||orientation<1||orientation>8)return image;
  const swap=orientation>=5,width=swap?image.height:image.width,height=swap?image.width:image.height,data=new Float32Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let sx=x,sy=y;
    if(orientation===2)sx=image.width-1-x;
    if(orientation===3){sx=image.width-1-x;sy=image.height-1-y;}
    if(orientation===4)sy=image.height-1-y;
    if(orientation===5){sx=y;sy=x;}
    if(orientation===6){sx=y;sy=image.height-1-x;}
    if(orientation===7){sx=image.width-1-y;sy=image.height-1-x;}
    if(orientation===8){sx=image.width-1-y;sy=x;}
    data.set(image.data.subarray((sy*image.width+sx)*4,(sy*image.width+sx)*4+4),(y*width+x)*4);
  }
  return {width,height,data};
}
/** Independently generated ICC v4 matrix/TRC profile, using published sRGB/D50 constants. */
export function srgbProfile(linear=false): Uint8Array {
  const chunks:{tag:string;data:Uint8Array}[]=[];const str=(s:string)=>Uint8Array.from(s,c=>c.charCodeAt(0));
  const fixed=(v:DataView,p:number,n:number)=>v.setInt32(p,Math.round(n*65536));
  for(const [tag,xyz] of [['wtpt',[.9642,1,.8249]],['rXYZ',[.4360747,.2225045,.0139322]],['gXYZ',[.3850649,.7168786,.0971045]],['bXYZ',[.1430804,.0606169,.7141733]]] as [string,number[]][]){const data=new Uint8Array(20);data.set(str('XYZ '));const v=new DataView(data.buffer);xyz.forEach((n,i)=>fixed(v,8+i*4,n));chunks.push({tag,data});}
  for(const tag of ['rTRC','gTRC','bTRC']){const data=new Uint8Array(linear?16:32),v=new DataView(data.buffer);data.set(str('para'));v.setUint16(8,linear?0:3);(linear?[1]:[2.4,1/1.055,.055/1.055,1/12.92,.04045]).forEach((n,i)=>fixed(v,12+i*4,n));chunks.push({tag,data});}
  for(const [tag,text] of [['desc',linear?'LopeOS Linear sRGB':'LopeOS sRGB'],['cprt','Public domain; generated by LopeOS']]){const data=new Uint8Array(Math.ceil((28+text.length*2)/4)*4),v=new DataView(data.buffer);data.set(str('mluc'));v.setUint32(8,1);v.setUint32(12,12);data.set(str('enUS'),16);v.setUint32(20,text.length*2);v.setUint32(24,28);for(let i=0;i<text.length;i++)v.setUint16(28+i*2,text.charCodeAt(i));chunks.push({tag,data});}
  const start=132+chunks.length*12,total=start+chunks.reduce((s,c)=>s+c.data.length,0),out=new Uint8Array(total),v=new DataView(out.buffer);v.setUint32(0,total);out.set(str('Lope'),4);v.setUint32(8,0x04300000);out.set(str('mntrRGB XYZ '),12);v.setUint16(24,2026);v.setUint16(26,11);v.setUint16(28,12);out.set(str('acsp'),36);out.set(str('APPL'),40);fixed(v,68,.9642);fixed(v,72,1);fixed(v,76,.8249);out.set(str('Lope'),80);v.setUint32(128,chunks.length);let offset=start;
  chunks.forEach((c,i)=>{const p=132+i*12;out.set(str(c.tag),p);v.setUint32(p+4,offset);v.setUint32(p+8,c.data.length);out.set(c.data,offset);offset+=c.data.length;});return out;
}
export function encodeTiff(image: FloatImage, depth: 8|16|32 = 16): Uint8Array {
  checkDimensions(image.width,image.height);const profile=srgbProfile(depth===32),entries=15,extras=8+2+entries*12+4,bitsOffset=extras,formatOffset=extras+6,profileOffset=extras+12,pixelOffset=(profileOffset+profile.length+3)&~3,byteCount=image.width*image.height*3*(depth/8),out=new Uint8Array(pixelOffset+byteCount),v=new DataView(out.buffer);
  out.set([73,73,42,0,8,0,0,0]);v.setUint16(8,entries,true);let entry=0;
  const tag=(id:number,type:number,count:number,value:number)=>{const p=10+entry++*12;v.setUint16(p,id,true);v.setUint16(p+2,type,true);v.setUint32(p+4,count,true);if(type===3&&count===1)v.setUint16(p+8,value,true);else v.setUint32(p+8,value,true);};
  tag(256,4,1,image.width);tag(257,4,1,image.height);tag(258,3,3,bitsOffset);tag(259,3,1,1);tag(262,3,1,2);tag(273,4,1,pixelOffset);tag(274,3,1,1);tag(277,3,1,3);tag(278,4,1,image.height);tag(279,4,1,byteCount);tag(284,3,1,1);tag(296,3,1,1);tag(339,3,3,formatOffset);tag(34675,7,profile.length,profileOffset);tag(305,2,4,0x65706f4c);
  for(let i=0;i<3;i++){v.setUint16(bitsOffset+i*2,depth,true);v.setUint16(formatOffset+i*2,depth===32?3:1,true);}out.set(profile,profileOffset);
  let p=pixelOffset;for(let i=0;i<image.data.length;i+=4)for(let c=0;c<3;c++){const n=image.data[i+c];if(depth===32)v.setFloat32(p,n,true);else if(depth===16)v.setUint16(p,Math.round(clamp(linearToSrgb(n))*65535),true);else out[p]=Math.round(clamp(linearToSrgb(n))*255);p+=depth/8;}
  return out;
}
