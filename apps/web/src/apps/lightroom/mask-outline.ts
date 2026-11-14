import type { MaskComponent, Point, Recipe } from '../../../../../packages/photo-engine/src/model';
import { sourceToOutput } from '../../../../../packages/photo-engine/src/render';

/** Project a source-space outline through the same crop/geometry as photo pixels. */
export function maskOutline(component:MaskComponent,recipe:Recipe):string {
  const polygon=(points:Point[])=>points.map((point,i)=>{const p=sourceToOutput(point,recipe);return `${i?'L':'M'}${p.x*100} ${p.y*100}`;}).join(' ')+'Z';
  const ellipse=(center:Point,rx:number,ry:number)=>polygon(Array.from({length:64},(_,i)=>{const angle=i*Math.PI/32;return {x:center.x+Math.cos(angle)*rx,y:center.y+Math.sin(angle)*ry};}));
  if(component.type==='radial')return ellipse(component.start,Math.max(.005,Math.abs(component.end.x-component.start.x)),Math.max(.005,Math.abs(component.end.y-component.start.y)));
  if(component.type!=='brush')return '';
  const radius=component.radius,paths:string[]=[];
  component.points.forEach((point,i)=>{
    paths.push(ellipse(point,radius,radius));
    const next=component.points[i+1];if(!next)return;
    const dx=next.x-point.x,dy=next.y-point.y,length=Math.hypot(dx,dy);if(!length)return;
    const nx=-dy/length*radius,ny=dx/length*radius;
    // Same winding as the circular caps: overlaps fill once rather than cancel.
    paths.push(polygon([{x:point.x+nx,y:point.y+ny},{x:point.x-nx,y:point.y-ny},{x:next.x-nx,y:next.y-ny},{x:next.x+nx,y:next.y+ny}]));
  });
  return paths.join(' ');
}
