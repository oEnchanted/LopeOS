import {findLayer,type ImageDocument} from '../model.ts';
import {SceneEncoder} from '../preview.ts';
import {inferenceDimensions} from './matte.ts';

/** Transfer renderable tile copies, never a PSD's original bytes or unrelated layers. */
export function portraitScene(document:ImageDocument,layerId?:string){
  const active=layerId?findLayer(document,layerId):undefined;
  if(layerId&&!active)throw new Error('The selected portrait layer is no longer available.');
  const input=active?{...document,layers:[{...active,visible:true,opacity:1,blend:'normal' as const,clipping:false}]}:document;
  const dimensions=inferenceDimensions(document.width,document.height);
  const viewport={x:0,y:0,width:document.width,height:document.height,scale:Math.min(dimensions.width/document.width,dimensions.height/document.height)};
  return new SceneEncoder().pack(input,viewport);
}
