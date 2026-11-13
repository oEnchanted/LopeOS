/** Original procedural fixtures. No private photographs or third-party samples. */
export function syntheticDng(width=128,height=96):Uint8Array {
  type Tag={id:number;type:number;values:number[]|string};
  const tags:Tag[]=[
    {id:256,type:4,values:[width]},{id:257,type:4,values:[height]},{id:258,type:3,values:[16]},{id:259,type:3,values:[1]},{id:262,type:3,values:[32803]},
    {id:271,type:2,values:'LopeOS\0'},{id:272,type:2,values:'Synthetic Bayer\0'}, {id:273,type:4,values:[0]},{id:274,type:3,values:[1]},{id:277,type:3,values:[1]},{id:278,type:4,values:[height]},{id:279,type:4,values:[width*height*2]},{id:284,type:3,values:[1]},
    {id:33421,type:3,values:[2,2]},{id:33422,type:1,values:[0,1,1,2]},
    {id:50706,type:1,values:[1,4,0,0]},{id:50707,type:1,values:[1,1,0,0]},{id:50708,type:2,values:'LopeOS Synthetic Bayer Test Camera\0'},
    {id:50710,type:1,values:[0,1,2]},{id:50711,type:3,values:[1]},{id:50713,type:3,values:[1,1]},{id:50714,type:4,values:[64]},{id:50717,type:4,values:[65535]},
    {id:50718,type:5,values:[1,1]},{id:50719,type:4,values:[0,0]},{id:50720,type:4,values:[width,height]},
    {id:50721,type:10,values:[3.2404542,-1.5371385,-.4985314,-.969266,1.8760108,.041556,.0556434,-.2040259,1.0572252]},
    {id:50727,type:5,values:[1,1,1]},{id:50728,type:5,values:[1,1,1]},{id:50778,type:3,values:[21]},{id:50829,type:4,values:[0,0,height,width]},
  ].sort((a,b)=>a.id-b.id);
  const bytesFor=(tag:Tag)=>typeof tag.values==='string'?tag.values.length:tag.values.length*({1:1,3:2,4:4,5:8,10:8} as Record<number,number>)[tag.type];
  let offset=8+2+tags.length*12+4;for(const tag of tags)if(bytesFor(tag)>4)offset=(offset+bytesFor(tag)+1)&~1;const pixelOffset=offset;const out=new Uint8Array(pixelOffset+width*height*2),view=new DataView(out.buffer);out.set([73,73,42,0,8,0,0,0]);view.setUint16(8,tags.length,true);offset=8+2+tags.length*12+4;
  tags.forEach((tag,index)=>{if(tag.id===273)tag.values=[pixelOffset];const p=10+index*12,length=typeof tag.values==='string'?tag.values.length:tag.values.length,size=bytesFor(tag);view.setUint16(p,tag.id,true);view.setUint16(p+2,tag.type,true);view.setUint32(p+4,length,true);let at=p+8;if(size>4){view.setUint32(at,offset,true);at=offset;offset=(offset+size+1)&~1;}
    if(typeof tag.values==='string'){out.set(Uint8Array.from(tag.values,c=>c.charCodeAt(0)),at);return;}
    tag.values.forEach((n,i)=>{if(tag.type===1)out[at+i]=n;else if(tag.type===3)view.setUint16(at+i*2,n,true);else if(tag.type===4)view.setUint32(at+i*4,n,true);else {view.setInt32(at+i*8,Math.round(n*1000000),true);view.setInt32(at+i*8+4,1000000,true);}});
  });
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const channel=y%2?x%2?2:1:x%2?1:0,checker=(Math.floor(x/8)+Math.floor(y/8))%2?.12:0,value=channel===0?.07+x/width*.55+checker:channel===1?.08+y/height*.5+checker:.08+(x+y)/(width+height)*.45+checker;view.setUint16(pixelOffset+(y*width+x)*2,Math.round(64+value*60000),true);}return out;
}
