import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Slider, ToneCurve } from '../../apps/web/src/apps/lightroom/controls';
import { PhotoViewport, type PhotoTool } from '../../apps/web/src/apps/lightroom/viewport';
import { cloneRecipe, defaultRecipe, newMask, validateRecipe, type Recipe } from '../../packages/photo-engine/src/model';
import '../../apps/web/src/apps/lightroom/lightroom.css';

function Harness(){
  const [recipe,setRecipe]=useState(defaultRecipe),[tool,setTool]=useState<PhotoTool>('edit'),[zoom,setZoom]=useState(1),[commits,setCommits]=useState(0),[maskId,setMaskId]=useState(''),[before,setBefore]=useState(false),[assetId,setAssetId]=useState('fixture-a');
  const latest=useRef(recipe);latest.current=recipe;
  const draft=(next:Recipe)=>{latest.current=next;setRecipe(next);};
  const commit=()=>{validateRecipe(latest.current);setCommits(n=>n+1);};
  Object.assign(window,{__controls:{recipe,commits,setRecipe:(next:Recipe)=>draft(next),reset:()=>{draft(defaultRecipe());setCommits(0);setTool('edit');setZoom(1);setBefore(false);},setTool,setZoom,setBefore,setAssetId,mask:(type:'radial'|'brush')=>{const next=cloneRecipe(latest.current),mask=newMask(type);next.masks=[mask];draft(next);setMaskId(mask.id);setTool('mask');}}});
  const pixels=new Uint8ClampedArray(400*300*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=i/4%400/400*255;pixels[i+1]=Math.floor(i/4/400)/300*255;pixels[i+2]=96;pixels[i+3]=255;}
  return <div className="photo-studio"><div style={{width:280,padding:16}}><Slider id="exposure" value={recipe.values.exposure} onBegin={()=>{}} onChange={value=>draft({...latest.current,values:{...latest.current.values,exposure:value}})} onCommit={commit} onReset={()=>draft(defaultRecipe())}/><ToneCurve points={recipe.curve} onBegin={()=>{}} onChange={curve=>draft({...latest.current,curve})} onCommit={commit}/><button type="button">Blur control</button></div><PhotoViewport result={{width:400,height:300,pixels,bins:[],duration:0} as any} recipe={recipe} tool={tool} busy={false} before={before} zoom={zoom} onZoom={setZoom} maskId={maskId} overlay brushRadius={.04} maskMode="add" retouchType="clone" retouchSource={null} onRetouchSource={()=>{}} sampler={false} onSample={()=>{}} onBegin={()=>{}} onDraft={draft} onCommit={commit} assetId={assetId} name="Original procedural color ramp" onImport={()=>{}} onDemo={()=>{}} hasAsset/></div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
