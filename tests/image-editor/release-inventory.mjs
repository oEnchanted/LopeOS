// Source inventory only. This does not execute controls or certify Adobe parity.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire, stripTypeScriptTypes } from 'node:module';
const require=createRequire(import.meta.url);
const {parse}=require(require.resolve('@babel/parser',{paths:[require.resolve('@vitejs/plugin-react')]}));
const parseSource=(text)=>parse(text,{sourceType:'module',plugins:['typescript','jsx']});
const visitNodes=(node,visitor,parent)=>{if(!node||typeof node!=='object')return;if(typeof node.type==='string')visitor(node,parent);for(const [key,value] of Object.entries(node)){if(['loc','tokens','comments'].includes(key))continue;if(Array.isArray(value))value.forEach(v=>visitNodes(v,visitor,node));else if(value&&typeof value==='object')visitNodes(value,visitor,node);}};

const out='docs/image-editor/release-audit';
fs.mkdirSync(out,{recursive:true});
const app='apps/web/src/apps/image-editor';
const reference='https://help.adobe.com/archive/en/photoshop/cs6/photoshop_reference.pdf';
const old=JSON.parse(fs.readFileSync('docs/image-editor/parity-inventory.json','utf8'));
const features=JSON.parse(fs.readFileSync('docs/image-editor/cs6-inventory.json','utf8'));
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const source=rel=>fs.readFileSync(rel,'utf8');
const sources={};
const read=rel=>{sources[rel]=crypto.createHash('sha256').update(source(rel)).digest('hex');return source(rel);};
const model=`${app}/menu-model.ts`;
const module={exports:{}};
vm.runInNewContext(stripTypeScriptTypes(read(model)).replace('export const internalMenus','const internalMenus')+'\nmodule.exports={internalMenus};',{module});
const menus=module.exports.internalMenus;
const commands=new Map(old.commands.map(c=>[c.id,{...c,enabledCondition:'See current command definition; previous captured boolean is not current evidence.'}]));
const index=`${app}/index.tsx`, indexText=read(index);
const tree=parseSource(indexText);
visitNodes(tree,node=>{
  if(node.type==='CallExpression'&&node.callee.name==='command'&&node.arguments[0]?.type==='StringLiteral'){
    const [id,label,,shortcut,enabled]=node.arguments;
    const text=n=>n?indexText.slice(n.start,n.end):undefined;
    commands.set(id.value,{...(commands.get(id.value)||{}),id:id.value,label:label?.type==='StringLiteral'?label.value:commands.get(id.value)?.label||text(label),shortcut:text(shortcut),enabledCondition:`Session restored AND (${text(enabled)||'true'})`,sourceLine:node.loc.start.line});
  }
});
for(const c of commands.values()){
  if(c.id.startsWith('image.adjust-'))c.enabledCondition='Session restored; document open; no active operation (editable)';
  if(c.id.startsWith('image.filter-'))c.enabledCondition='Session restored; idle document; unlocked active raster/embedded layer or mask';
  if(c.id.startsWith('image.smart-'))c.enabledCondition='Session restored; idle document; unlocked active embedded layer';
}
const rows=[];
const conditions='CS6 Standard / Windows / English / dark / reset Essentials; exact build, UI scaling, DPR, preferences and matched Adobe fixture UNVERIFIED';
function add(id,surface,state,route,expected,actual,evidence,{result='UNVERIFIED',severity='P2',source=reference,enabled='Applicable document/target; exact Adobe enabled conditions require reference observation',owner='Agent 2 — Photoshop',fix='None in this source inventory; correlate with issues.csv',retest='NOT RUN against matched Adobe reference'}={}){
  rows.push({audit_id:id,surface,state,source_reference:source,reference_conditions:conditions,route_action_sequence:route,expected_placement_appearance:'Match pinned Adobe client-area control bounds, typography, colors and states within 1 CSS pixel; matched capture unavailable',expected_behavior:expected,enabled_conditions:enabled,current_result:result,actual_result:actual,evidence_path:evidence,severity,owner,fix,retest_status:retest});
}
function menuEntries(items,trail){
  items.forEach((item,i)=>{
    if(!item){add(`PS-MENU-${slug(trail.join('-'))}-separator-${i}`,trail.join(' > ')+' separator','default',trail.join(' > '),'Separator at reference position and grouping','Separator exists in current menu-model; baseline order unmeasured',model);return;}
    const c=typeof item==='string'?commands.get(item):null;
    const label=c?.label||item.label||item;
    const route=[...trail,label].join(' > ');
    const key=typeof item==='string'?item:label;
    add(`PS-MENU-${slug([...trail,key].join('-'))}`,route,item.items?'default; hover; focus; expanded; keyboard navigation':'default; hover; focus; pressed; disabled',route,item.items?'Open child menu with keyboard/pointer; keep inside app; Escape/Left restores parent':`Execute ${label}; preserve target and reflect availability/check state`,typeof item==='string'?`Registered ${item}; runtime availability and full baseline label/order/shortcut not certified`:item.disabled?`Permanently disabled: ${item.disabled}`:'Submenu wrapper exists in source',`${model}; ${index}`,{enabled:c?.enabledCondition||item.disabled||'Parent menu available',fix:item.disabled?'Missing feature remains a parity gap; disabling is not a parity waiver':undefined});
    if(item.items)menuEntries(item.items,[...trail,label]);
  });
}
for(const menu of menus){
  add(`PS-MENUBAR-${slug(menu.label)}`,`${menu.label} top-level menu`,'default; hover; focus; expanded; Escape; window edges',menu.label,'Reach every menu through keyboard and pointer; focus returns to trigger','Current menu source enumerated; exact Adobe geometry/order unverified',`${model}; ${app}/menus.tsx`);
  menuEntries(menu.items,[menu.label]);
}
for(const c of commands.values())for(const state of ['no-document','applicable-document','unavailable-target']){
  add(`PS-CMD-${slug(c.id)}-${state}`,c.label,state,`Command registry ${c.id}; internal menu and LopeOS active-app menu`,`Run ${c.label} on correct document/target when enabled; otherwise disable with no mutation`,`Source handler present; source enabled expression recorded; this row is not an executed workflow`,`${index}${c.sourceLine?':'+c.sourceLine:''}`,{enabled:c.enabledCondition,owner:'Agent 2 — Photoshop; Agent 1 owns shared menu routing'});
}
const toolText=read(`${app}/tool-model.ts`);
const tools=[...toolText.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*key:\s*'([^']*)'/g)].map(([,id,label,key])=>({id,label,key}));
for(const tool of tools)for(const state of ['tool-selection-flyout-shortcut','options-and-target-switching','cursor-gesture-cancel-focus-loss']){
  add(`PS-TOOL-${tool.id}-${state}`,tool.label,state,`Tools > ${tool.label}; ${tool.key?tool.key+' / Shift+'+tool.key:'pointer or group flyout'}; fit and 100% zoom`,state==='tool-selection-flyout-shortcut'?'Select/cycle correct tool and retain last group choice':state==='options-and-target-switching'?'Show this tool’s reference controls and preserve relevant settings across switching':'Cursor/hotspot aligns to document coordinates; canceled gestures leave source/history unchanged',`Current tool-model declares ${tool.id}; implementation and exact reference state need execution`,`${app}/tool-model.ts; ${app}/tools.tsx; ${app}/CanvasView.tsx`);
}
for(const panel of ['Color','Swatches','Properties','Adjustments','History','Layers','Channels','Paths'])for(const state of ['default','empty-or-inapplicable','tab-focus','dock-regroup','floating-edge-resize','collapse-hide-show','persist-reload-reset']){
  add(`PS-PANEL-${slug(panel)}-${state}`,`${panel} panel`,state,`Panel tab ${panel}; panel menu; Window; workspace save/reload/reset`,`Reference ${panel} controls remain reachable; state persists appropriately and reset restores pinned workspace`,'Declared panel present in panel-model; every control/state is not runtime certified',`${app}/panel-model.ts; ${app}/panels.tsx`);
}
for(const panel of ['Navigator','Brush Presets','Brush / Brush Settings','Character','Paragraph','Info','Histogram','Actions','Layer Comps','Styles']){
  const partial=['Character','Paragraph'].includes(panel);
  add(`PS-PANEL-GAP-${slug(panel)}`,`${panel} panel`,'available panel and menu',`Window > ${panel}`,`Provide CS6 ${panel} panel and reference behavior`,partial?'Only a combined Character and Paragraph dialog is implemented; independent dockable panels are absent':'Not declared in current PanelId; required panel is absent',`${app}/panel-model.ts; ${app}/panels.tsx; ${app}/dialogs.tsx`,{result:'FAIL',fix:'Implement missing panel semantics and audit matched reference; no exception approved'});
}
const dialogNames=['New Document','Color Picker (Foreground Color)','Color Picker (Background Color)','Image Size','Canvas Size','Character and Paragraph','Layer Style','Export As','Save a Copy — Photoshop PSD','Color Range','New Workspace','Transform','Feather Selection','Expand Selection','Contract Selection','Border Selection','Smooth Selection','About Prism','Keyboard Shortcuts','Format Compatibility','Save changes before closing?','Recover interrupted session','Local AI'];
for(const dialog of dialogNames)for(const state of ['default-and-values','keyboard-focus-containment-return','validation-empty-failed','apply-enter-success','cancel-escape']){
  add(`PS-DIALOG-${slug(dialog)}-${state}`,dialog,state,`Open ${dialog}; ${state}`,`Dialog actions/values affect intended target; cancellation preserves document/history; focus remains contained and returns`,dialog==='Local AI'?'Shipped extension beyond CS6; real service/model checks required separately':'Dialog or mapped modal implemented; full pinned-reference comparison unavailable',`${app}/dialogs.tsx; ${index}; ${app}/ai/LocalAiDialog.tsx`,{severity:state==='cancel-escape'?'P1':'P2'});
}
const controlFiles=['tools.tsx','panels.tsx','dialogs.tsx','InlineType.tsx','CanvasView.tsx','index.tsx','ai/LocalAiDialog.tsx'];
let jsxCount=0;
for(const file of controlFiles){
  const rel=`${app}/${file}`, text=read(rel), sf=parseSource(text);
  const seen=new Map();
  visitNodes(sf,(node,parent)=>{
    if(node.type==='JSXOpeningElement'){
      const tag=node.name.name;
      if(['button','input','select','textarea','NumberField','Modal'].includes(tag)){
        const attrs=node.attributes.filter(a=>a.type==='JSXAttribute');
        const name=attrs.find(a=>['aria-label','label','title'].includes(a.name.name))||attrs.find(a=>a.name.name==='role');
        let label=name?.value?text.slice(name.value.start,name.value.end).replace(/^['"]|['"]$/g,''):undefined;
        if(!label&&parent?.type==='JSXElement')label=parent.children.filter(c=>c.type==='JSXText').map(c=>c.value.trim()).filter(Boolean).join(' ');
        if(label){
          const base=slug(label), occurrence=(seen.get(base)||0)+1;seen.set(base,occurrence);
          const line=node.loc.start.line, disabled=attrs.find(a=>a.name.name==='disabled')?.value;
          add(`PS-CONTROL-${slug(file)}-${base}-${occurrence}`,`${file}: ${label}`,'default; hover; focus; pressed/selected; disabled; keyboard',`Open containing tool/panel/dialog; focus ${label}`,`Provide correct label/value/target, input validation and keyboard access; match reference appearance`,'JSX control declaration inspected; dynamic expressions are retained literally, not asserted as labels observed in a browser',`${rel}:${line}`,{enabled:disabled?text.slice(disabled.start,disabled.end):'No local disabled attribute; containing context may constrain availability'});
          jsxCount++;
        }
      }
    }
  });
}
for(const f of features.features){
  const excluded=f.scope==='CS6 Extended'||f.status==='outside-baseline';
  add(`PS-FEATURE-${f.id}`,f.feature,'declared feature scope',`${f.category} > ${f.feature}`,`Provide reference capability described on manual printed page ${f.manualPage??'not applicable'}`,`${f.status}: ${f.implementation}`,f.evidence.join('; '),{source:f.manualPage?`${reference}#page=${f.pdfPage}`:reference,result:excluded?'NOT_APPLICABLE':['missing','partial'].includes(f.status)?'FAIL':'UNVERIFIED',severity:excluded?'':f.category==='History and files'||f.category==='Color and production'?'P1':'P2',fix:excluded?`Outside retained CS6 Standard target (${f.scope}); shipped modern extensions remain separately inventoried`:f.status==='implemented'?'Current release retest and matched Adobe comparison required':'Known gap retained; code-level implementation status does not waive parity',retest:excluded?'Scope determination only':'Not a current-build pass; historical implementation evidence is cited'});
}
const required=[
 ['A','application-frame','menu/options/toolbar/tabs/viewport/status/panel dock','Measure anchors; no document; multiple docs; long names; missing/corrupt files'],
 ['A','document-state-isolation','independent tab state','Deselect/reselect, view, active layer/target and dirty state must remain per document'],
 ['A','home-and-recent','Home / recent states','Empty recent list, missing recent file and new-document preset state'],
 ['B','toolbar-customization','all CS6 toolbar slots and overflow','Single/double columns; full group coverage; customization/reset; masks/screen modes'],
 ['C','all-options','every tool-family option','Numeric entry/scrub/modifier precision; defaults; reset; tool-specific state'],
 ['D','workspace-reload','panel docking and workspace persistence','Dock/undock/stack/regroup/resize/hide/show/reload/restore/reset'],
 ['E','complex-layer-fixture','all layer types and row identities','Nested groups, text/shapes, masks/clipping, effects and embedded sources'],
 ['E','layer-lock-and-order','layer operations','Multi-selection, reorder, merge/flatten cancellation, lock/visibility, insertion prediction'],
 ['E','mask-content-target','thumbnail target switching','Mask target border, link/disable, brush isolation, undo/reload'],
 ['F','selection-modes','selection geometry and masks','Replace/add/subtract/intersect, constraints, snapping/guides, conversion and saved alpha'],
 ['F','transform-cancel-bounds','transform / warp / paths','Off-canvas transparent bounds, handles/reference point, numeric input, commit/cancel'],
 ['G','unicode-type','editable typography','Multiline Unicode, mixed styles, point/paragraph text, missing fonts, overflow'],
 ['G','adjust-filter-preview','adjustment/filter dialogs','Open no mutation; preview/cancel/apply/undo; source/history integrity'],
 ['H','contextual-task-bar','shipped contextual extension','Selection/text/type/layer state, anchor, drag/pin/hide persistence; outside CS6 visual baseline'],
 ['H','generation','real local generative service','Actual configured engine, prompts/results/variations, unavailable/cancel/failure; no fabricated inference'],
 ['H','28-features','Relight / Quick Compare / Generative restyle / Remove','28.0 not adopted; retain as explicitly outside pinned historical target'],
 ['I','menus-and-accessibility','all menu branches and keyboard paths','Arrows/Home/End/Escape/Enter, disabled/checked/ellipsis/shortcut, corners, focus return'],
 ['I','shortcut-focus','text/numeric input versus document shortcuts','No single-letter hijack; Windows Ctrl scheme; browser reserved keys and menu alternatives'],
 ['I','pointer-devices','pointer capture, zoom, touch/stylus','Move/resize window during gesture; fit/1:1; pressure devices where claimed'],
 ['J','formats-independent-reader','real formats and round trips','Native editable file, layered PSD, PSB, raster outputs, dimensions/alpha/profiles and independent reader'],
 ['J','save-failure-recovery','failure handling','Canceled picker, permission/quota/offline/conflict/failure, reload/crash/GPU loss, interrupted operation'],
 ['J','handoff','Lightroom to Photoshop to Lightroom','Same final build, both audit owners, identity/checksums/linkage and menu focus'],
 ['ALL','reference-pixel-comparison','matched reference captures','Same fixture/view/tool/panels/viewport/DPR; original immutable; side-by-side/50% overlay/diff; <=1 CSS px'],
 ['ALL','browser-matrix','1440x900 / 1920x1080 / 740x500 and 100/125/200%','Current stable claimed browsers; real effective viewport/zoom/DPR; no scaling to conceal mismatches'],
];
for(const [section,id,surface,expected] of required){
  add(`PS-REQ-${section}-${id}`,surface,'mandatory scenario matrix',`Audit section ${section}: ${surface}`,expected,id==='28-features'?'Baseline is CS6 Standard; 28.0 is not adopted':'Full required state matrix has not been observed; narrower functional tests do not complete this row','reference-manifest.json; workflow-results.json; ../remaining-gaps.md',{result:id==='28-features'?'NOT_APPLICABLE':'UNVERIFIED',severity:['handoff','formats-independent-reader','save-failure-recovery','document-state-isolation'].includes(id)?'P1':'P2',owner:id==='handoff'?'Agent 1 + Agent 2 final integrated build':'Agent 2 — Photoshop'});
}
// Functional observations are a separate column: a passing invariant cannot turn
// an unmeasured Adobe appearance/state row into a parity PASS.
const jsonIf=rel=>fs.existsSync(rel)?JSON.parse(fs.readFileSync(rel,'utf8')):null;
const build=jsonIf(`${out}/build-manifest.json`);
for(const row of rows)Object.assign(row,{functional_observation_status:'NOT_OBSERVED_FOR_THIS_ROW',functional_observation:'',functional_evidence_path:'',functional_build_id:''});
function observe(ids,description,evidence,buildId='UNRECORDED_IN_RESULT',status='PASS_FOR_STATED_SUBSET'){
  for(const row of rows.filter(r=>ids.includes(r.audit_id))){
    row.functional_observation_status=status;
    row.functional_observation=[row.functional_observation,description+' Adobe identity and all other row states remain unverified.'].filter(Boolean).join(' | ');
    row.functional_evidence_path=[row.functional_evidence_path,evidence].filter(Boolean).join('; ');
    row.functional_build_id=buildId;
  }
}
const ui=jsonIf(`${out}/evidence/ui-after-results.json`);
if(ui?.checks?.every(c=>c.status==='PASS')){
  const id=ui.build?.buildId;
  observe(['PS-CONTROL-tools-tsx-label-1','PS-DIALOG-new-document-validation-empty-failed','PS-DIALOG-transform-validation-empty-failed'],'Empty numeric drafts, negative integers/decimals and blank-on-blur restoration passed.',`${out}/evidence/ui-after-results.json`,id);
  observe(['PS-TOOL-brush-tool-selection-flyout-shortcut','PS-TOOL-pencil-tool-selection-flyout-shortcut','PS-FEATURE-workspace-tool-groups-and-flyouts'],'Shift+B selected Pencil and group retained Pencil after switching to Move.',`${out}/evidence/ui-after-results.json`,id);
  observe(['PS-TOOL-move-cursor-gesture-cancel-focus-loss','PS-TOOL-pencil-cursor-gesture-cancel-focus-loss'],'Window blur canceled Move and Pencil gestures with identical serialized document afterward.',`${out}/evidence/ui-after-results.json`,id);
}
const color=jsonIf(`${out}/evidence/ui-color-after-results.json`);
if(color?.checks?.every(c=>c.status==='PASS')){
  observe(['PS-PANEL-color-default','PS-CONTROL-panels-tsx-color-hue-1'],'Green foreground reported hue 120 and marker 100%/0%; hue 240 retained saturation/value; keyboard saturation changed to rgb(3,255,3); background chip matched #123456.',`${out}/evidence/ui-color-after-results.json`,color.build?.buildId);
}
const session=jsonIf(`${out}/evidence/session-menus-result.json`);
if(session?.result==='PASS'){
  const id=session.build?.buildId||session.buildId;
  observe(['PS-CMD-image-reselect-applicable-document','PS-CMD-image-deselect-applicable-document','PS-REQ-A-document-state-isolation','PS-FEATURE-selections-all--deselect--reselect-and-inverse'],'Reselect remained unavailable in untouched second document; each tab restored its own dimensions/selection; state survived recovery.',`${out}/evidence/session-menus-result.json`,id);
  observe(['PS-MENUBAR-file','PS-MENUBAR-edit','PS-MENU-edit-preferences'],'Escape restored top-level trigger; arrows/End and nested Escape preserved correct File/Edit/Preferences focus.',`${out}/evidence/session-menus-result.json`,id);
}
const engine=jsonIf(`${out}/evidence/engine-run-metadata.json`);
if(engine?.after==='7 passed / 0 failed'){
  const matched=build&&Object.entries(engine.sourceSha256).every(([rel,hash])=>build.sources?.[rel]===hash);
  const id=matched?build.buildId:'UNIT_SOURCE_HASHES_IN_ENGINE_METADATA';
  observe(['PS-TOOL-fill-cursor-gesture-cancel-focus-loss'],'Engine test rejects out-of-layer Paint Bucket coordinates without wrapping pixels.',`${out}/evidence/engine-after.tap`,id);
  observe(['PS-FEATURE-layers-raster-layer-masks','PS-REQ-E-mask-content-target'],'Engine tests cover downscaled-source Reveal All mask extent, transformed selection-mask pixel centers, and deleted-mask painting retarget/undo.',`${out}/evidence/engine-after.tap`,id);
  observe(['PS-FEATURE-layers-layer-alignment-and-distribution'],'Engine test moves selected group descendant exactly once.',`${out}/evidence/engine-after.tap`,id);
  observe(['PS-FEATURE-history-and-files-native-editable-project-save'],'Engine parser rejects tested corrupt geometry/collections/filter data. This is not a full format interoperability pass.',`${out}/evidence/engine-after.tap`,id);
  observe(['PS-FEATURE-selections-copy--cut--paste-and-layer-via-copy'],'Engine clipboard test retains feathered coverage outside marching-ants boundary.',`${out}/evidence/engine-after.tap`,id);
}
const headers=Object.keys(rows[0]);
const csvCell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
fs.writeFileSync(`${out}/ui-inventory.csv`,[headers,...rows.map(r=>headers.map(h=>r[h]))].map(r=>r.map(csvCell).join(',')).join('\n')+'\n');
const counts=rows.reduce((a,r)=>(a[r.current_result]=(a[r.current_result]||0)+1,a),{});
const summary={kind:'SOURCE_INVENTORY_NOT_RUNTIME_CERTIFICATION',generatedDate:'2026-11-13',uniqueCommands:commands.size,toolCount:tools.length,topLevelMenus:menus.length,staticOrExpressionLabelControls:jsxCount,featureFamilies:features.features.length,rows:rows.length,counts,functionalObservationRows:rows.filter(r=>r.functional_observation_status!=='NOT_OBSERVED_FOR_THIS_ROW').length,sourceHashes:sources,limitations:['A row is not a checklist pass. All source-declared controls remain UNVERIFIED until actual required states are exercised.','Functional observation columns state only the exercised subset and evidence build; they do not change parity status.','FAIL feature rows preserve known incomplete/missing implementation; only user/product owner can authorize deliberate differences.','Exact Adobe visual identity remains UNVERIFIED for every applicable row without matched licensed reference captures.','NOT_APPLICABLE rows are CS6 Extended or post-CS6 baseline scope determinations; separately shipped extensions still require functional verification.','The 125-family historical matrix is not an exhaustive enumeration of the missing Adobe interface. Missing authorized reference prevents claiming a complete Adobe state denominator.']};
summary.countsAreInventoryRowsNotUniqueDefects=true;
summary.retainedCs6StandardFeatureStatus=features.features.filter(f=>f.scope!=='CS6 Extended'&&f.status!=='outside-baseline').reduce((a,f)=>(a[f.status]=(a[f.status]||0)+1,a),{});
summary.knownGapRows={missingOrPartialCs6Families:84,missingOrPartialPanels:10,note:'Panel rows overlap capability families; do not report as 94 distinct defects.'};
fs.writeFileSync(`${out}/inventory-summary.json`,JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(`${out}/capability-gaps.json`,JSON.stringify({baseline:'CS6 Standard Windows',source:'docs/image-editor/cs6-inventory.json',classification:'Known implementation gaps retained from source matrix and remaining-gaps.md; not current Adobe comparison results',families:features.features.filter(f=>f.scope!=='CS6 Extended'&&['missing','partial'].includes(f.status)).map(f=>({id:`PS-FEATURE-${f.id}`,category:f.category,feature:f.feature,status:f.status,implementation:f.implementation,source:`${reference}#page=${f.pdfPage}`,evidence:f.evidence}))},null,2)+'\n');
console.log(JSON.stringify({rows:rows.length,counts,commands:commands.size,tools:tools.length,jsxControls:jsxCount},null,2));
