import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Aperture, LoaderCircle } from 'lucide-react';
import { clamp, cloneRecipe, type Point, type Recipe } from '../../../../../packages/photo-engine/src/model';
import { outputToSource, sourceToOutput } from '../../../../../packages/photo-engine/src/render';
import type { PreviewResult } from './worker-client';
export type PhotoTool='edit'|'crop'|'mask'|'retouch'|'info'|'presets'|'versions'|'history';
type Props={result?:PreviewResult;recipe:Recipe;tool:PhotoTool;busy:boolean;before:boolean;zoom:number;onZoom:(n:number)=>void;maskId:string;overlay:boolean;brushRadius:number;maskMode:'add'|'subtract'|'intersect';retouchType:'clone'|'heal';retouchSource:Point|null;onRetouchSource:(p:Point)=>void;sampler:boolean;onSample:(p:Point)=>void;onBegin:()=>void;onDraft:(r:Recipe)=>void;onCommit:()=>void;name:string;onImport:()=>void;onDemo:()=>void;hasAsset:boolean;};
export function PhotoViewport(props:Props){
  const {result,recipe,tool}=props,canvas=useRef<HTMLCanvasElement>(null),container=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:700,height:500}),[pan,setPan]=useState({x:0,y:0});
  const gesture=useRef<{start:Point;last:Point;recipe:Recipe;handle:string;pan:Point}|null>(null),latest=useRef(recipe);latest.current=recipe;
  const cropSpace={...recipe,crop:{x:0,y:0,width:1,height:1},values:{...recipe.values,straighten:0,vertical:0,horizontal:0,distortion:0}};
  const cropCorners=[{x:recipe.crop.x,y:recipe.crop.y},{x:recipe.crop.x+recipe.crop.width,y:recipe.crop.y+recipe.crop.height}].map(p=>sourceToOutput(p,cropSpace));
  const cropBox={x:Math.min(cropCorners[0].x,cropCorners[1].x),y:Math.min(cropCorners[0].y,cropCorners[1].y),width:Math.abs(cropCorners[0].x-cropCorners[1].x),height:Math.abs(cropCorners[0].y-cropCorners[1].y)};
  const handleInSource=(handle:string)=>{const x=handle.includes('w')?0:handle.includes('e')?1:.5,y=handle.includes('n')?0:handle.includes('s')?1:.5,p=outputToSource({x:cropBox.x+x*cropBox.width,y:cropBox.y+y*cropBox.height},cropSpace),c=recipe.crop;return (Math.abs(p.y-c.y)<.001?'n':Math.abs(p.y-c.y-c.height)<.001?'s':'')+(Math.abs(p.x-c.x)<.001?'w':Math.abs(p.x-c.x-c.width)<.001?'e':'');};
  useEffect(()=>{const el=container.current;if(!el)return;const ro=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));ro.observe(el);return()=>ro.disconnect();},[]);
  useEffect(()=>{setPan({x:0,y:0});},[props.name,props.zoom]);
  useEffect(()=>{if(!canvas.current||!result)return;canvas.current.width=result.width;canvas.current.height=result.height;canvas.current.getContext('2d')!.putImageData(new ImageData(result.pixels as Uint8ClampedArray<ArrayBuffer>,result.width,result.height),0,0);},[result]);
  const fit=result?Math.min(Math.max(30,size.width-72)/result.width,Math.max(30,size.height-62)/result.height):1,scale=props.zoom===0?fit:props.zoom,width=(result?.width||1)*scale,height=(result?.height||1)*scale;
  const point=(e:ReactPointerEvent<HTMLElement>):Point=>{const rect=e.currentTarget.getBoundingClientRect();return {x:clamp((e.clientX-rect.left)/rect.width),y:clamp((e.clientY-rect.top)/rect.height)};};
  const down=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!result||e.button!==0||props.before)return;
    const displayPoint=point(e),p=tool==='crop'?outputToSource(displayPoint,cropSpace):displayPoint,source=outputToSource(displayPoint,recipe);
    if(props.sampler){props.onSample(source);return;}
    e.currentTarget.setPointerCapture(e.pointerId);
    if(e.altKey&&tool==='retouch'){props.onRetouchSource(source);return;}
    const handle=(e.target as HTMLElement).getAttribute('data-crop-handle')||'';
    gesture.current={start:p,last:p,recipe:cloneRecipe(recipe),handle,pan};
    if(tool==='crop'){props.onBegin();if(!handle){const next=cloneRecipe(recipe);next.crop={x:p.x,y:p.y,width:.005,height:.005};props.onDraft(next);}}
    else if(tool==='mask'){
      const next=cloneRecipe(recipe),mask=next.masks.find(m=>m.id===props.maskId);if(!mask){gesture.current=null;return;}props.onBegin();
      let component=mask.components.at(-1);if(component?.type==='brush'){component={...component,id:crypto.randomUUID(),mode:props.maskMode,points:[source],radius:props.brushRadius};mask.components.push(component);}
      else if(component){component.start=source;component.end={x:clamp(source.x+.01),y:clamp(source.y+.01)};}props.onDraft(next);
    }else if(tool==='retouch'){
      if(!props.retouchSource){props.onRetouchSource(source);gesture.current=null;return;}props.onBegin();const next=cloneRecipe(recipe);next.retouch.push({id:crypto.randomUUID(),type:props.retouchType,target:source,source:props.retouchSource,radius:props.brushRadius,feather:.7});props.onDraft(next);
    }
  };
  const move=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const state=gesture.current;if(!state)return;const displayPoint=point(e),p=tool==='crop'?outputToSource(displayPoint,cropSpace):displayPoint;state.last=p;
    if(tool==='crop'){
      const next=cloneRecipe(latest.current),c=state.recipe.crop;
      if(!state.handle)next.crop={x:Math.min(state.start.x,p.x),y:Math.min(state.start.y,p.y),width:Math.max(.005,Math.abs(p.x-state.start.x)),height:Math.max(.005,Math.abs(p.y-state.start.y))};
      else if(state.handle==='move')next.crop={...c,x:clamp(c.x+p.x-state.start.x,0,1-c.width),y:clamp(c.y+p.y-state.start.y,0,1-c.height)};
      else{let x=c.x,y=c.y,x2=c.x+c.width,y2=c.y+c.height;if(state.handle.includes('w'))x=clamp(c.x+p.x-state.start.x,0,x2-.01);if(state.handle.includes('e'))x2=clamp(x2+p.x-state.start.x,x+.01,1);if(state.handle.includes('n'))y=clamp(c.y+p.y-state.start.y,0,y2-.01);if(state.handle.includes('s'))y2=clamp(y2+p.y-state.start.y,y+.01,1);next.crop={x,y,width:x2-x,height:y2-y};}
      next.crop.width=Math.min(next.crop.width,1-next.crop.x);next.crop.height=Math.min(next.crop.height,1-next.crop.y);props.onDraft(next);
    }else if(tool==='mask'){
      const next=cloneRecipe(latest.current),component=next.masks.find(m=>m.id===props.maskId)?.components.at(-1),source=outputToSource(p,recipe);if(component){if(component.type==='brush'){if(component.points.length<500&&Math.hypot(source.x-(component.points.at(-1)?.x||0),source.y-(component.points.at(-1)?.y||0))>.003)component.points.push(source);}else component.end=source;props.onDraft(next);}
    }else if(tool!=='retouch'){setPan({x:state.pan.x+(p.x-state.start.x)*width,y:state.pan.y+(p.y-state.start.y)*height});}
  };
  const finish=()=>{if(!gesture.current)return;gesture.current=null;if(['crop','mask','retouch'].includes(tool))props.onCommit();};
  const mask=recipe.masks.find(m=>m.id===props.maskId),component=mask?.components.at(-1);
  return <div ref={container} className={'ps-viewport'+(props.sampler?' sampling':'')+(tool==='mask'?' masking':'')+(tool==='retouch'?' retouching':'')} data-testid="photo-viewport" onWheel={e=>{if(props.zoom>0){setPan(p=>({x:p.x-e.deltaX,y:p.y-e.deltaY}));}}}>
    {!props.hasAsset?<div className="ps-empty"><span className="ps-empty-mark"><Aperture size={38}/></span><span className="ps-eyebrow">LIGHTROOM</span><h1>Photo library</h1><button className="ps-primary" onClick={props.onImport}>Add photos</button><button className="ps-text-button" onClick={props.onDemo}>Add sample photos</button></div>:<>
      {result&&<div className="ps-photo-frame" style={{width,height,transform:`translate(${pan.x}px,${pan.y}px)`}} onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onDoubleClick={()=>{if(tool==='edit'||tool==='info')props.onZoom(props.zoom===0?1:0);}}>
        <canvas ref={canvas} aria-label={props.name+' — '+(props.before?'original':'edited photo')} data-testid="photo-canvas" data-render-duration={result?.duration}/>
        {tool==='crop'&&<div className="ps-crop-box" data-crop-handle="move" style={{left:cropBox.x*100+'%',top:cropBox.y*100+'%',width:cropBox.width*100+'%',height:cropBox.height*100+'%'}}><div className="ps-crop-thirds"/>{['nw','n','ne','e','se','s','sw','w'].map(handle=><button key={handle} aria-label={`Crop ${handle} handle`} data-crop-handle={handleInSource(handle)} className={'ps-crop-handle '+handle}/>)}</div>}
        {tool==='mask'&&props.overlay&&component&&<svg className="ps-mask-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Mask component handles">{component.type==='linear'&&<line x1={sourceToOutput(component.start,recipe).x*100} y1={sourceToOutput(component.start,recipe).y*100} x2={sourceToOutput(component.end,recipe).x*100} y2={sourceToOutput(component.end,recipe).y*100} stroke="#ff6666" strokeWidth=".5"/>}{component.type==='radial'&&<ellipse cx={sourceToOutput(component.start,recipe).x*100} cy={sourceToOutput(component.start,recipe).y*100} rx={Math.max(1,Math.abs(component.end.x-component.start.x)/recipe.crop.width*100)} ry={Math.max(1,Math.abs(component.end.y-component.start.y)/recipe.crop.height*100)} fill="#f66" fillOpacity=".15" stroke="#ff8888" strokeWidth=".35"/>}{component.type==='brush'&&component.points.length>0&&<polyline points={component.points.map(p=>{const q=sourceToOutput(p,recipe);return `${q.x*100},${q.y*100}`;}).join(' ')} fill="none" stroke="#f66" strokeOpacity=".35" strokeWidth={component.radius*200} strokeLinecap="round" strokeLinejoin="round"/>}</svg>}
        {tool==='retouch'&&props.retouchSource&&<div className="ps-retouch-source" style={{left:sourceToOutput(props.retouchSource,recipe).x*100+'%',top:sourceToOutput(props.retouchSource,recipe).y*100+'%'}}>+</div>}
      </div>}
      {props.before&&<span className="ps-before-badge">ORIGINAL</span>}
      {props.busy&&<span className="ps-render-status" role="status"><LoaderCircle size={13}/> Developing preview</span>}
      <div className="ps-photo-caption"><span>{props.name}</span><span>{tool==='mask'?'Draw on the photo to place your mask':tool==='retouch'?'Alt-click to choose a source · click to retouch':tool==='crop'?'Drag handles or draw a crop · controls also available at right':props.sampler?'Click a neutral gray in the photograph':''}</span></div>
    </>}
  </div>;
}
