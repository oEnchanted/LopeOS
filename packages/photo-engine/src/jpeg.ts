import { srgbProfile } from './tiff.ts';
/** Replace encoder ICC segments instead of concatenating two incompatible profiles. */
export function tagJpegSrgb(jpeg:Uint8Array):Uint8Array {
  if(jpeg[0]!==255||jpeg[1]!==216)throw new Error('JPEG encoder returned an invalid container.');
  const profile=srgbProfile(),label=Uint8Array.from('ICC_PROFILE\0',c=>c.charCodeAt(0)),segment=new Uint8Array(18+profile.length),v=new DataView(segment.buffer);segment.set([255,226]);v.setUint16(2,16+profile.length);segment.set(label,4);segment[16]=1;segment[17]=1;segment.set(profile,18);
  const parts:Uint8Array[]=[jpeg.subarray(0,2),segment];let p=2;
  while(p+4<jpeg.length&&jpeg[p]===255){const marker=jpeg[p+1];if(marker===218||marker===217)break;const length=jpeg[p+2]*256+jpeg[p+3];if(length<2||p+2+length>jpeg.length)throw new Error('JPEG encoder returned a truncated marker.');const icc=marker===226&&label.every((n,i)=>jpeg[p+4+i]===n);if(!icc)parts.push(jpeg.subarray(p,p+length+2));p+=length+2;}
  parts.push(jpeg.subarray(p));const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;
}
