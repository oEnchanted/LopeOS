import {useEffect,useRef} from 'react';
import {matrixOf,type Point,type Transform} from '../../../../../packages/image-engine/src';
import type {PendingType} from './session';
export type InlineTypeState=PendingType&{transform:Transform};
export function InlineType({edit,zoom,origin,onChange,onFinish}:{edit:InlineTypeState;zoom:number;origin:Point;onChange:(text:string)=>void;onFinish:(commit:boolean)=>void}){
  const input=useRef<HTMLTextAreaElement>(null);useEffect(()=>{input.current?.focus();input.current?.select();},[]);
  const text=edit.text,lines=text.content.split('\n');const width=Math.max(text.size*3,Math.max(...lines.map(line=>line.length))*text.size*.75+30),height=Math.max(text.size*text.leading*2,lines.length*text.size*text.leading+15);const m=matrixOf(edit.transform);const left=text.align==='center'?-width/2:text.align==='right'?-width:0;
  return <div className="ie-inline-type" style={{left:origin.x,top:origin.y,transformOrigin:'0 0',transform:`matrix(${m[0]*zoom},${m[1]*zoom},${m[2]*zoom},${m[3]*zoom},${m[4]*zoom},${m[5]*zoom})`}} onPointerDown={e=>e.stopPropagation()}>
    <textarea ref={input} aria-label="Edit text on canvas" spellCheck={false} value={text.content}
      onChange={e=>onChange(e.target.value)} onBlur={()=>onFinish(true)}
      onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();onFinish(false);}else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();onFinish(true);}}}
      style={{left,width,height,fontFamily:text.font,fontSize:text.size,lineHeight:text.leading,fontWeight:text.bold?'bold':'normal',fontStyle:text.italic?'italic':'normal',color:text.color,letterSpacing:text.tracking,textAlign:text.align}}/>
    <div className="ie-inline-type-actions">
      <button aria-label="Commit type" onPointerDown={e=>e.preventDefault()} onClick={()=>onFinish(true)}>✓</button>
      <button aria-label="Cancel type" onPointerDown={e=>e.preventDefault()} onClick={()=>onFinish(false)}>×</button>
    </div>
  </div>;
}
