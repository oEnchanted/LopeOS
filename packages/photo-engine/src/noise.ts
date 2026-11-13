import { clamp, type FloatImage } from './model.ts';

const neighbors=Array.from({length:25},(_,i)=>({x:i%5-2,y:Math.floor(i/5)-2,weight:Math.exp(-((i%5-2)**2+(Math.floor(i/5)-2)**2)/4)}));
const luma=(r:number,g:number,b:number)=>.2126*r+.7152*g+.0722*b;

/** Classical bilateral noise reduction. Luminance and chroma are filtered separately;
 * no learned weights, model download or network service is involved. */
export function reduceNoise(image:FloatImage,luminance:number,color:number):FloatImage{
  const amount=clamp(luminance,0,100)/100,chroma=clamp(color,0,100)/100;
  if(!amount&&!chroma)return image;
  const {width,height,data:source}=image,data=source.slice(),range=.018+.16*amount,crange=.025+.24*chroma;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;if(source[i+3]<=0)continue;
    const center=luma(source[i],source[i+1],source[i+2]),red=source[i]-center,blue=source[i+2]-center;
    let sum=0,sumL=0,sumC=0,sumR=0,sumB=0;
    for(const n of neighbors){
      const sx=Math.max(0,Math.min(width-1,x+n.x)),sy=Math.max(0,Math.min(height-1,y+n.y)),j=(sy*width+sx)*4,alpha=source[j+3];if(alpha<=0)continue;
      const lum=luma(source[j],source[j+1],source[j+2]),r=source[j]-lum,b=source[j+2]-lum,delta=lum-center,spatial=n.weight*alpha;
      if(amount){const d=1+delta*delta/(range*range),weight=spatial/(d*d);sum+=weight;sumL+=lum*weight;}
      if(chroma){const dr=r-red,db=b-blue,d=1+delta*delta/(.12*.12)+(dr*dr+db*db)/(crange*crange),weight=spatial/(d*d);sumC+=weight;sumR+=r*weight;sumB+=b*weight;}
    }
    const lum=center+(amount&&sum?(sumL/sum-center)*amount:0),r=red+(chroma&&sumC?(sumR/sumC-red)*chroma:0),b=blue+(chroma&&sumC?(sumB/sumC-blue)*chroma:0);
    data[i]=lum+r;data[i+2]=lum+b;data[i+1]=(lum-.2126*data[i]-.0722*data[i+2])/.7152;
  }
  return {width,height,data};
}
