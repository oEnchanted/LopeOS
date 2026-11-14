/** Original procedural codec fixtures. */
import { deflateSync } from 'node:zlib';
import { crc32 } from '../../packages/photo-engine/src/png.ts';

function chunk(name:string,data:Uint8Array){
  const out=new Uint8Array(data.length+12),v=new DataView(out.buffer);v.setUint32(0,data.length);out.set(new TextEncoder().encode(name),4);out.set(data,8);v.setUint32(out.length-4,crc32(out.subarray(4,out.length-4)));return out;
}
export function png(color:number,samples:number[],extra:{name:string;data:Uint8Array}[]=[]){
  const channels=color===0?1:color===2?3:color===4?2:4,width=samples.length/channels;
  const header=new Uint8Array(13),h=new DataView(header.buffer);h.setUint32(0,width);h.setUint32(4,1);header[8]=16;header[9]=color;
  const raw=new Uint8Array(1+samples.length*2),v=new DataView(raw.buffer);samples.forEach((n,i)=>v.setUint16(1+i*2,n));
  return Uint8Array.from(Buffer.concat([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...extra.map(c=>chunk(c.name,c.data)),chunk('IDAT',deflateSync(raw)),chunk('IEND',new Uint8Array())]));
}
export const u16=(...values:number[])=>{const b=new Uint8Array(values.length*2),v=new DataView(b.buffer);values.forEach((n,i)=>v.setUint16(i*2,n));return b;};
export const u32=(...values:number[])=>{const b=new Uint8Array(values.length*4),v=new DataView(b.buffer);values.forEach((n,i)=>v.setUint32(i*4,n));return b;};
export function tiffRgba(alphaType:number,samples=[13107,6554,3277,32768]){
  const count=14,extra=8+2+count*12+4,pixels=extra+16,out=new Uint8Array(pixels+samples.length*2),v=new DataView(out.buffer);
  out.set([73,73,42,0,8,0,0,0]);v.setUint16(8,count,true);let i=0;
  const tag=(id:number,type:number,count:number,value:number)=>{const p=10+12*i++;v.setUint16(p,id,true);v.setUint16(p+2,type,true);v.setUint32(p+4,count,true);v.setUint32(p+8,value,true);};
  tag(256,4,1,samples.length/4);tag(257,4,1,1);tag(258,3,4,extra);tag(259,3,1,1);tag(262,3,1,2);tag(273,4,1,pixels);tag(274,3,1,1);tag(277,3,1,4);tag(278,4,1,1);tag(279,4,1,samples.length*2);tag(284,3,1,1);tag(296,3,1,1);tag(338,3,1,alphaType);tag(339,3,4,extra+8);
  for(let c=0;c<4;c++){v.setUint16(extra+c*2,16,true);v.setUint16(extra+8+c*2,1,true);}
  samples.forEach((n,i)=>v.setUint16(pixels+i*2,n,true));return out;
}
