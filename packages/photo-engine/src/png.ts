import { clamp, type FloatImage } from './model.ts';
import { checkDimensions, linearToSrgb, srgbToLinear } from './tiff.ts';
const magic=new Uint8Array([137,80,78,71,13,10,26,10]);
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(data: Uint8Array){let n=0xffffffff;for(const b of data)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function chunk(name:string,data:Uint8Array){const out=new Uint8Array(data.length+12),v=new DataView(out.buffer);v.setUint32(0,data.length);out.set(Uint8Array.from(name,c=>c.charCodeAt(0)),4);out.set(data,8);v.setUint32(data.length+8,crc32(out.subarray(4,data.length+8)));return out;}
async function zlib(bytes:Uint8Array,inflate=false){const stream=new Blob([bytes as BlobPart]).stream().pipeThrough(inflate?new DecompressionStream('deflate'):new CompressionStream('deflate'));return new Uint8Array(await new Response(stream).arrayBuffer());}
export async function decodePng16(bytes:Uint8Array):Promise<FloatImage>{
  if(bytes.length<magic.length||magic.some((n,i)=>bytes[i]!==n))throw new Error('Invalid PNG signature.');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width=0,height=0,color=0;const idat:Uint8Array[]=[];let total=0,seenEnd=false;
  let transparent:number[]|undefined,cicp:Uint8Array|undefined,hasIcc=false,hasSrgb=false,gamma:number|undefined,chromaticities:number[]|undefined;
  for(let p=8;p+12<=bytes.length;){const length=v.getUint32(p),name=String.fromCharCode(...bytes.subarray(p+4,p+8));if(length>bytes.length-p-12)throw new Error('Truncated PNG chunk.');const data=bytes.subarray(p+8,p+8+length);if(crc32(bytes.subarray(p+4,p+8+length))!==v.getUint32(p+8+length))throw new Error('PNG checksum failed.');
    if(name==='IHDR'){if(p!==8||length!==13||width)throw new Error('Invalid PNG image header.');width=v.getUint32(p+8);height=v.getUint32(p+12);checkDimensions(width,height);color=data[9];if(data[8]!==16||![0,2,4,6].includes(color)||data[10]||data[11]||data[12])throw new Error('16-bit PNG supports non-interlaced gray/RGB(A) only.');}
    if(!width)throw new Error('PNG image header is missing.');
    if(name==='tRNS'){
      if(transparent||idat.length||!(color===0&&length===2||color===2&&length===6))throw new Error('Invalid PNG transparency samples.');
      transparent=Array.from({length:length/2},(_,i)=>v.getUint16(p+8+i*2));
    }
    if(name==='iCCP')hasIcc=true;
    if(name==='cICP'){if(length!==4)throw new Error('Invalid PNG color characteristics.');cicp=data;}
    if(name==='sRGB'){if(length!==1||data[0]>3)throw new Error('Invalid PNG sRGB declaration.');hasSrgb=true;}
    if(name==='gAMA'){if(length!==4)throw new Error('Invalid PNG gamma.');gamma=v.getUint32(p+8);}
    if(name==='cHRM'){if(length!==32)throw new Error('Invalid PNG chromaticities.');chromaticities=Array.from({length:8},(_,i)=>v.getUint32(p+8+i*4));}
    if(name==='IDAT'){idat.push(data);total+=length;}if(name==='IEND'){if(length)throw new Error('Invalid PNG image trailer.');seenEnd=true;break;}p+=length+12;
  }
  if(!width||!height||!seenEnd)throw new Error('Incomplete PNG.');
  // cICP has the highest color-description precedence. Primaries alone do not
  // establish sRGB: transfer, matrix and range must agree as well.
  if(cicp){if(cicp[0]!==1||cicp[1]!==13||cicp[2]!==0||cicp[3]!==1)throw new Error('PNG color characteristics require an additional color transform; only full-range sRGB is supported.');}
  else if(hasIcc)throw new Error('16-bit PNG with an ICC profile requires an additional color transform. The original remains unchanged.');
  else if(!hasSrgb){
    if(gamma!==undefined&&gamma!==45455)throw new Error('Non-sRGB PNG gamma requires an additional color transform.');
    const srgb=[31270,32900,64000,33000,30000,60000,15000,6000];
    if(chromaticities&&chromaticities.some((n,i)=>Math.abs(n-srgb[i])>1))throw new Error('Non-sRGB PNG chromaticities require an additional color transform.');
  }
  const compressed=new Uint8Array(total);let offset=0;for(const part of idat){compressed.set(part,offset);offset+=part.length;}
  const channels=color===0?1:color===2?3:color===4?2:4,bpp=channels*2,stride=width*bpp,raw=await zlib(compressed,true);if(raw.length!==(stride+1)*height)throw new Error('Invalid PNG scanline size.');
  const result=new Float32Array(width*height*4);let previous=new Uint8Array(stride),line=new Uint8Array(stride);
  const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const p=y*(stride+1),filter=raw[p];if(filter>4)throw new Error('Invalid PNG filter.');for(let x=0;x<stride;x++){const a=x>=bpp?line[x-bpp]:0,b=previous[x],c=x>=bpp?previous[x-bpp]:0;line[x]=(raw[p+1+x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?(a+b)>>1:paeth(a,b,c)))&255;}
    for(let x=0;x<width;x++){
      const i=(y*width+x)*4;for(let c=0;c<3;c++){const at=x*bpp+(channels<3?0:c)*2;result[i+c]=srgbToLinear((line[at]*256+line[at+1])/65535);}
      const at=x*bpp+(channels-1)*2;
      const isTransparent=transparent?.every((n,c)=>{const at=x*bpp+c*2;return line[at]*256+line[at+1]===n;});
      result[i+3]=channels===2||channels===4?(line[at]*256+line[at+1])/65535:isTransparent?0:1;
    }[previous,line]=[line,previous];}
  return {width,height,data:result};
}
export async function encodePng(image:FloatImage,depth:8|16=8):Promise<Uint8Array>{
  checkDimensions(image.width,image.height);const size=depth/8,stride=image.width*4*size,raw=new Uint8Array((stride+1)*image.height),v=new DataView(raw.buffer);
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)for(let c=0;c<4;c++){const n=image.data[(y*image.width+x)*4+c],value=clamp(c===3?n:linearToSrgb(n)),p=y*(stride+1)+1+(x*4+c)*size;if(depth===16)v.setUint16(p,Math.round(value*65535));else raw[p]=Math.round(value*255);}
  const header=new Uint8Array(13),h=new DataView(header.buffer);h.setUint32(0,image.width);h.setUint32(4,image.height);header[8]=depth;header[9]=6;
  const chunks=[magic,chunk('IHDR',header),chunk('sRGB',new Uint8Array([0])),chunk('IDAT',await zlib(raw)),chunk('IEND',new Uint8Array())];const out=new Uint8Array(chunks.reduce((s,c)=>s+c.length,0));let p=0;for(const c of chunks){out.set(c,p);p+=c.length;}return out;
}
