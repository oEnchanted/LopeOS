import { useCallback, useEffect, useState } from 'react';
import type { SettingsService } from '../../../../../packages/contracts/src';
import { createSheet, createWorkbook, type Workbook, type CellStyle } from '../../../../../packages/spreadsheet-engine/src/model.ts';

export interface SheetPreferences {
  appearance: 'system'|'light'|'dark'|'colorful';
  defaultFont: string; defaultFontSize:number; newSheetCount:number; defaultZoom:number;
  showStartScreen:boolean; measurementUnit:'inches'|'centimeters';
  userName:string;showExtensions:boolean;eventSounds:boolean;confirmExternalLinks:boolean;
  formulaBar:boolean;statusBar:boolean;sheetTabs:boolean;headings:boolean;gridlines:boolean;gridlineColor:string;
  showZeroValues:boolean;showFormulas:boolean;horizontalScrollBar:boolean;verticalScrollBar:boolean;
  notes:'none'|'indicators'|'always';objects:'all'|'placeholders'|'none';
  collapsed:boolean;showGroupTitles:boolean;hiddenRibbonTabs:string[];quickAccess:string[];
  moveAfterEnter:boolean;enterDirection:'down'|'right'|'up'|'left';enableFillHandle:boolean;
  autocomplete:boolean;autocompleteFunctions:boolean;autocompleteMinLetters:number;
  autoCorrect:boolean;autoHyperlinks:boolean;capitalizeDays:boolean;correctInitialCapitals:boolean;capitalizeSentences:boolean;
  replacements:{from:string;to:string}[];
  chartLegend:boolean;chartLabels:boolean;chartType:'column'|'bar'|'line'|'area'|'scatter'|'pie'|'doughnut';chartElementTips:boolean;chartValueTips:boolean;
  largerControls:boolean;reduceMotion:boolean;announceCellChanges:boolean;accessibilityStatus:boolean;
  recoveryEnabled:boolean;recoveryInterval:number;defaultFormat:'lopebook'|'xlsx';alwaysRecalculateBeforeSave:boolean;warnBeforeCsvExport:boolean;
  backgroundErrorChecking:boolean;checkFormulaErrors:boolean;checkNumbersAsText:boolean;checkEmptyReferences:boolean;errorIndicatorColor:string;
  customLists:string[][];pride:'none'|'rainbow'|'trans'|'nonbinary';locale:string;
}
export const PREFERENCES_KEY='sheets.preferences.v1';
export const RIBBON_TABS=['Home','Insert','Page Layout','Formulas','Data','Review','View','Help'];
export const QUICK_COMMANDS=[{id:'save',label:'Save'},{id:'undo',label:'Undo'},{id:'redo',label:'Redo'},{id:'open',label:'Open'},{id:'print',label:'Print Preview'},{id:'recalculate',label:'Calculate Now'}];
export const defaultPreferences:SheetPreferences={
 appearance:'system',defaultFont:'Aptos',defaultFontSize:11,newSheetCount:1,defaultZoom:100,showStartScreen:false,measurementUnit:'inches',userName:'LopeOS User',showExtensions:true,eventSounds:false,confirmExternalLinks:true,
 formulaBar:true,statusBar:true,sheetTabs:true,headings:true,gridlines:true,gridlineColor:'#e1e5e2',showZeroValues:true,showFormulas:false,horizontalScrollBar:true,verticalScrollBar:true,notes:'indicators',objects:'all',
 collapsed:false,showGroupTitles:true,hiddenRibbonTabs:[],quickAccess:['save','undo','redo'],moveAfterEnter:true,enterDirection:'down',enableFillHandle:true,autocomplete:true,autocompleteFunctions:true,autocompleteMinLetters:1,
 autoCorrect:false,autoHyperlinks:true,capitalizeDays:false,correctInitialCapitals:false,capitalizeSentences:false,replacements:[{from:'(c)',to:'©'},{from:'(r)',to:'®'},{from:'(tm)',to:'™'},{from:'...',to:'…'},{from:'teh',to:'the'}],
 chartLegend:true,chartLabels:false,chartType:'column',chartElementTips:true,chartValueTips:true,largerControls:false,reduceMotion:false,announceCellChanges:true,accessibilityStatus:false,
 recoveryEnabled:true,recoveryInterval:.6,defaultFormat:'lopebook',alwaysRecalculateBeforeSave:false,warnBeforeCsvExport:true,
 backgroundErrorChecking:true,checkFormulaErrors:true,checkNumbersAsText:false,checkEmptyReferences:false,errorIndicatorColor:'#217346',
 customLists:[['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],['January','February','March','April','May','June','July','August','September','October','November','December']],pride:'none',locale:'en-US',
};
const enums:Partial<Record<keyof SheetPreferences,string[]>>={appearance:['system','light','dark','colorful'],measurementUnit:['inches','centimeters'],notes:['none','indicators','always'],objects:['all','placeholders','none'],enterDirection:['down','right','up','left'],chartType:['column','bar','line','area','scatter','pie','doughnut'],defaultFormat:['lopebook','xlsx'],pride:['none','rainbow','trans','nonbinary']};
const numeric:Partial<Record<keyof SheetPreferences,[number,number,boolean?]>>={defaultFontSize:[6,96],newSheetCount:[1,32,true],defaultZoom:[25,200,true],autocompleteMinLetters:[1,10,true],recoveryInterval:[.5,600]};
export function normalizePreferences(raw:unknown):SheetPreferences{
 const result=structuredClone(defaultPreferences);if(!raw||typeof raw!=='object'||Array.isArray(raw))return result;
 const source=raw as Record<string,unknown>;
 for(const key of Object.keys(result)as(keyof SheetPreferences)[]){const value=source[key],fallback=result[key];if(typeof fallback==='boolean'&&typeof value==='boolean')(result as unknown as Record<string,unknown>)[key]=value;else if(typeof fallback==='string'&&typeof value==='string'&&value.length<=200&&(enums[key]?.includes(value)??true))(result as unknown as Record<string,unknown>)[key]=value;else if(typeof fallback==='number'&&typeof value==='number'&&Number.isFinite(value)){const bound=numeric[key];if(bound&&(value>=bound[0]&&value<=bound[1])&&(!bound[2]||Number.isInteger(value)))(result as unknown as Record<string,unknown>)[key]=value;}}
 for(const key of ['gridlineColor','errorIndicatorColor']as const)if(!/^#[a-f0-9]{6}$/i.test(result[key]))result[key]=defaultPreferences[key];
 if(!result.defaultFont.trim())result.defaultFont=defaultPreferences.defaultFont;
 try{new Intl.NumberFormat(result.locale);}catch{result.locale='en-US';}
 if(Array.isArray(source.hiddenRibbonTabs))result.hiddenRibbonTabs=[...new Set(source.hiddenRibbonTabs.filter((t):t is string=>typeof t==='string'&&RIBBON_TABS.includes(t)&&t!=='Home'))];
 if(Array.isArray(source.quickAccess))result.quickAccess=[...new Set(source.quickAccess.filter((id):id is string=>QUICK_COMMANDS.some(c=>c.id===id)))];
 if(Array.isArray(source.replacements))result.replacements=source.replacements.filter((r):r is {from:string;to:string}=>!!r&&typeof r==='object'&&typeof r.from==='string'&&typeof r.to==='string'&&r.from.length>0&&r.from.length<=64&&r.to.length<=256).slice(0,200).map(r=>({from:r.from,to:r.to}));
 if(Array.isArray(source.customLists))result.customLists=source.customLists.filter((list):list is string[]=>Array.isArray(list)&&list.length>0&&list.length<=366&&list.every(x=>typeof x==='string'&&x.length>0&&x.length<=100)).slice(0,100).map(list=>[...list]);
 return result;
}
export function readPreferences(settings:SettingsService):SheetPreferences{return normalizePreferences(settings.get(PREFERENCES_KEY,{}));}
export function useSheetPreferences(settings:SettingsService){
 const [preferences,setPreferences]=useState(()=>readPreferences(settings));
 useEffect(()=>settings.subscribe(()=>setPreferences(previous=>{const next=readPreferences(settings);return JSON.stringify(previous)===JSON.stringify(next)?previous:next;})),[settings]);
 const update=useCallback(<K extends keyof SheetPreferences>(key:K,value:SheetPreferences[K])=>{const next=normalizePreferences({...readPreferences(settings),[key]:value});settings.set(PREFERENCES_KEY,next);setPreferences(next);},[settings]);
 return [preferences,update]as const;
}
export function workbookWithPreferences(p:SheetPreferences,name='Book1'):Workbook{
 const book=createWorkbook(name);for(let i=1;i<p.newSheetCount;i++)book.sheets.push(createSheet(`Sheet${i+1}`));for(const sheet of book.sheets)sheet.showGridlines=p.gridlines;
 book.metadata={author:p.userName,defaultCellStyle:{fontFamily:p.defaultFont,fontSize:p.defaultFontSize},createdWith:'LopeOS Sheets'};return book;
}
export function workbookCellStyle(book:Workbook):CellStyle{const style=book.metadata?.defaultCellStyle as CellStyle|undefined;return style&&typeof style==='object'?{fontFamily:typeof style.fontFamily==='string'?style.fontFamily:'Aptos',fontSize:typeof style.fontSize==='number'?style.fontSize:11}:{fontFamily:'Aptos',fontSize:11};}
/** Only typed plain text is corrected. Formulas, identifiers, URLs and pasted/imported data are unchanged. */
export function correctTypedText(input:string,p:SheetPreferences):string{
 if(!input||/^[='+\-\d]|^https?:\/\/|^mailto:/i.test(input))return input;let text=input;
 if(p.autoCorrect){for(const rule of p.replacements){const escaped=rule.from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');text=text.replace(new RegExp(`(^|[\\s([{])${escaped}(?=$|[\\s.,!?;:)\\]}])`,'g'),(_,prefix:string)=>prefix+rule.to);}}
 if(p.capitalizeDays)text=text.replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi,value=>value[0].toUpperCase()+value.slice(1).toLowerCase());
 if(p.correctInitialCapitals)text=text.replace(/\b([A-Z])([A-Z])([a-z]+)\b/g,(_,a:string,b:string,rest:string)=>a+b.toLowerCase()+rest);
 if(p.capitalizeSentences)text=text.replace(/(^|[.!?]\s+)(\p{Ll})/gu,(_,prefix:string,letter:string)=>prefix+letter.toLocaleUpperCase(p.locale));return text;
}
export function typedHyperlink(input:string,p:SheetPreferences):string|undefined{if(!p.autoHyperlinks)return;try{const url=new URL(input);if(url.protocol==='http:'||url.protocol==='https:')return url.href;}catch{}if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input))return`mailto:${input}`;}
export function listFillValue(input:string,offset:number,p:SheetPreferences):string|undefined{for(const list of p.customLists){const start=list.findIndex(item=>item.toLocaleLowerCase(p.locale)===input.toLocaleLowerCase(p.locale));if(start>=0)return list[((start+offset)%list.length+list.length)%list.length];}}
let audio:AudioContext|undefined;
export function playSheetSound(enabled:boolean){if(!enabled)return;try{audio??=new AudioContext();void audio.resume().then(()=>{const oscillator=audio!.createOscillator(),gain=audio!.createGain(),now=audio!.currentTime;oscillator.frequency.setValueAtTime(590,now);gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.02,now+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+.1);oscillator.connect(gain);gain.connect(audio!.destination);oscillator.start(now);oscillator.stop(now+.11);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};}).catch(()=>{});}catch{}}
