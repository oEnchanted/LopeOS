import type { AppManifest } from '../../../../../packages/contracts/src';
export const videoEditorManifest:AppManifest={
  contractVersion:1,id:'lope.video-editor',name:'Video Editor',description:'Professional multitrack video editing, color, audio and local movie export.',icon:'video-editor',singleton:true,
  entry:()=>import('./index'),defaultSize:{width:1400,height:880},minSize:{width:760,height:520},fileAssociations:['.lopevideo','.lopevideopack','video/mp4','video/webm','.mp4','.mov','.webm','.mkv'],
  menus:[
    {label:'File',items:['video.new','video.open','video.import',{separator:true},'video.save','video.save-as','video.download','video.package',{separator:true},'video.export']},
    {label:'Edit',items:['video.undo','video.redo',{separator:true},'video.copy','video.paste','video.delete','video.ripple-delete',{separator:true},'video.preferences','video.shortcuts']},
    {label:'Clip',items:['video.split','video.speed','video.reverse','video.freeze','video.link','video.unlink','video.nest','video.multicam','video.transition','video.relink']},
    {label:'Sequence',items:['video.sequence-settings','video.add-video','video.add-audio','video.duplicate-sequence','video.remove-gaps','video.marker','video.lift','video.extract']},
    {label:'Window',items:['video.source','video.program','video.project','video.timeline','video.effects','video.effect-controls','video.graphics','video.color','video.scopes','video.audio','video.captions','video.history','video.save-workspace','video.reset-workspace']},
    {label:'Help',items:['video.about']}
  ]
};
