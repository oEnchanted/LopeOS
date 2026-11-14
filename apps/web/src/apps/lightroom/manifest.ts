import type { AppManifest } from '../../../../../packages/contracts/src';
import { photoExtensions } from '../../../../../packages/photo-engine/src/formats';
export const lightroomManifest:AppManifest={
  contractVersion:1,id:'lope.lightroom',name:'Luma',description:'Organize, edit, and export photos.',icon:'lightroom',singleton:true,
  entry:()=>import('./index'),defaultSize:{width:1360,height:860},minSize:{width:680,height:460},
  fileAssociations:photoExtensions,
  menus:[
    {label:'File',items:['photo.import','photo.folder','photo.workspace',{separator:true},'photo.export','photo.original','photo.account']},
    {label:'Edit',items:['photo.undo','photo.redo',{separator:true},'photo.copy','photo.paste','photo.select-all']},
    {label:'Photo',items:['photo.auto','photo.ai-denoise','photo.reset','photo.rotate-left','photo.rotate-right','photo.version','photo.stack','photo.edit-in',{separator:true},'photo.trash','photo.restore']},
    {label:'View',items:['photo.grid','photo.square','photo.detail','photo.compare','photo.survey','photo.filmstrip','photo.before','photo.sidebar','photo.histogram']},
    {label:'Help',items:['photo.help','photo.capabilities']},
  ],
};
