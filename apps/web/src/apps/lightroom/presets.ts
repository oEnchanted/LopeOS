import type { Adjustment, Recipe } from '../../../../../packages/photo-engine/src/model';
export type PhotoPreset={id:string;name:string;group:string;values:Partial<Record<Adjustment,number>>;profile?:Recipe['profile'];favorite?:boolean};
export const builtInPresets:PhotoPreset[]=[
  {id:'natural',name:'Natural',group:'Lope essentials',values:{contrast:8,highlights:-15,shadows:12,vibrance:12}},
  {id:'golden',name:'Golden hour',group:'Lope essentials',values:{temperature:22,tint:5,contrast:12,highlights:-22,shadows:12,vibrance:16}},
  {id:'cinema',name:'Quiet cinema',group:'Lope essentials',values:{temperature:-8,contrast:18,highlights:-30,blacks:14,saturation:-16,vignette:-18,grain:10}},
  {id:'landscape',name:'Open landscape',group:'Lope essentials',values:{contrast:15,highlights:-24,shadows:22,vibrance:22,clarity:16,dehaze:10}},
  {id:'soft',name:'Soft light',group:'Lope essentials',values:{exposure:.2,contrast:-14,highlights:-16,shadows:18,texture:-12,saturation:-8}},
  {id:'silver',name:'Silver monochrome',group:'Black & white',profile:'monochrome',values:{contrast:24,highlights:-18,shadows:12,blacks:-10,grain:18}},
  {id:'matte',name:'Matte monochrome',group:'Black & white',profile:'monochrome',values:{contrast:-8,highlights:-26,blacks:22,grain:25}},
];
export function applyPreset(recipe:Recipe,preset:PhotoPreset,amount=1):Recipe {
  const next=structuredClone(recipe);for(const [key,value] of Object.entries(preset.values))next.values[key as Adjustment]=value*amount;if(preset.profile)next.profile=preset.profile;return next;
}
