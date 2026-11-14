import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { syntheticDng } from './fixtures.ts';
import { readLibrary } from './library-storage.mjs';

const base=process.env.LOPE_PHOTO_BASE||'http://127.0.0.1:5193';
const phase=process.env.LOPE_AUDIT_PHASE||'production';
const out=`docs/lightroom/release-audit/evidence/handoff-${phase}`;
await mkdir(out,{recursive:true});
const fixture=Buffer.from(syntheticDng()),sourceHash=createHash('sha256').update(fixture).digest('hex');
await writeFile(`${out}/handoff-bayer.dng`,fixture);
const browser=await chromium.launch({headless:true}),checks=[],errors=[],consoleErrors=[],failedRequests=[],failedResponses=[],requests=[];
const context=await browser.newContext({viewport:{width:1700,height:1100},deviceScaleFactor:1,acceptDownloads:true,locale:'en-US'});
const page=await context.newPage();page.setDefaultTimeout(15000);
page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});
page.on('requestfailed',r=>failedRequests.push({url:r.url(),method:r.method(),error:r.failure()?.errorText}));
page.on('response',r=>{if(r.status()>=400)failedResponses.push({url:r.url(),status:r.status()});});
page.on('request',r=>requests.push({url:r.url(),method:r.method(),bodyBytes:r.postDataBuffer()?.length||0}));
await page.addInitScript(()=>localStorage.setItem('lope.setup.complete.v1','1'));
const app=page.getByTestId('photo-studio'),editor=page.getByTestId('image-editor-app');
let initial,returned,driveBefore,driveAfter,exported,error;
async function storedProject(){return page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lope.drive.v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{
    const entries=await new Promise((resolve,reject)=>{const r=db.transaction('entries').objectStore('entries').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const entry=entries.find(e=>e.path==='/LopeDrive/handoff-return.lopeimage');if(!entry?.data)return null;
    const bytes=await entry.data.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join(''),parsed=JSON.parse(new TextDecoder().decode(bytes));
    return {path:entry.path,hash,size:bytes.byteLength,version:entry.version,format:parsed.format,formatVersion:parsed.version,document:{width:parsed.document.width,height:parsed.document.height,mode:parsed.document.mode,depth:parsed.document.depth,layers:parsed.document.layers.map(l=>({id:l.id,name:l.name,kind:l.kind,base:l.pixels?.base,tiles:l.pixels?Object.keys(l.pixels.tiles).length:0}))}};
  }finally{db.close();}
});}
async function prismCommand(menuName,label){
  const bar=editor.getByRole('menubar',{name:'Prism menus'});await bar.getByRole('menuitem',{name:menuName,exact:true}).click();
  const menu=bar.getByRole('menu',{name:`${menuName} menu`,exact:true});
  await menu.getByRole('menuitem').filter({has:page.locator('span').filter({hasText:new RegExp(`^${label}$`)})}).click();
}
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Open Luma',exact:true}).click();await expect(app).toBeVisible();
  await app.locator('input[type=file]').first().setInputFiles({name:'handoff-bayer.dng',mimeType:'image/x-adobe-dng',buffer:fixture});
  const review=page.getByRole('dialog',{name:'Add photos',exact:true});await expect(review.getByRole('button',{name:'Add 1 photo',exact:true})).toBeEnabled({timeout:45000});await review.getByRole('button',{name:'Add 1 photo',exact:true}).click();
  await expect(app.getByTestId('photo-canvas')).toBeVisible({timeout:45000});await expect(app.getByText('Developing preview',{exact:true})).toBeHidden({timeout:30000});
  await app.getByLabel('Exposure value',{exact:true}).fill('.5');await app.getByRole('heading',{name:'Edit',exact:true}).click();await expect(app.getByText('Saved locally',{exact:true})).toBeVisible();
  initial=(await readLibrary(page,true)).assets[0];expect(initial.hash).toBe(sourceHash);expect(initial.originalHash).toBe(sourceHash);expect(initial.recipe.values.exposure).toBe(.5);
  await app.screenshot({path:`${out}/01-source-raw.png`});checks.push({id:'LR-07-IMPORT',result:'PASSED',detail:'Sensor-only DNG imported through real production UI and edited to +0.5 EV; stored original hash matches fixture.'});
  await page.getByRole('menubar',{name:'Application menu'}).getByRole('menuitem',{name:'Photo',exact:true}).click();
  await page.getByRole('menu',{name:'Photo',exact:true}).getByRole('menuitem',{name:'Edit a copy in Prism…',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'Save As',exact:true});await expect(picker).toBeVisible();
  await picker.getByRole('button',{name:'LopeDrive',exact:true}).click();await picker.getByLabel('File name',{exact:true}).fill('handoff-return.lopeimage');
  await expect(picker.getByRole('button',{name:'Save',exact:true})).toBeEnabled();await picker.screenshot({path:`${out}/02-shared-save-dialog.png`});await picker.getByRole('button',{name:'Save',exact:true}).click();
  await expect(editor).toBeVisible({timeout:45000});await expect(editor.getByTestId('image-composite')).toBeVisible({timeout:45000});
  await expect.poll(storedProject,{timeout:30000}).not.toBeNull();driveBefore=await storedProject();expect(driveBefore.document).toMatchObject({width:initial.metadata.width,height:initial.metadata.height,mode:'RGB',depth:8});expect(driveBefore.document.layers.length).toBe(1);
  await editor.screenshot({path:`${out}/03-prism-native-project.png`});checks.push({id:'LR-07-HANDOFF',result:'PASSED',detail:'Shared file dialog saved a real native RGB/8 layered project into durable local LopeDrive and Prism opened it.'});
  const menuBar=editor.getByRole('menubar',{name:'Prism menus'});await menuBar.getByRole('menuitem',{name:'Layer',exact:true}).click();
  const layerMenu=menuBar.getByRole('menu',{name:'Layer menu',exact:true});await layerMenu.getByRole('menuitem',{name:'New',exact:true}).hover();
  await layerMenu.getByRole('menuitem').filter({has:page.locator('span').filter({hasText:/^New Layer…$/})}).click();
  await editor.getByRole('button',{name:'Default foreground and background colors',exact:true}).click();
  await prismCommand('Edit','Fill with Foreground');
  await expect.poll(()=>editor.getByTestId('image-composite').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return {width:c.width,height:c.height,unique:new Set(d).size};}),{timeout:30000}).toMatchObject({unique:2});
  await prismCommand('File','Save');await expect.poll(async()=>{const current=await storedProject();return current?.hash;},{timeout:30000}).not.toBe(driveBefore.hash);driveAfter=await storedProject();
  expect(driveAfter.document.layers.length).toBe(2);expect(driveAfter.document).toMatchObject({width:initial.metadata.width,height:initial.metadata.height,mode:'RGB',depth:8});
  await editor.screenshot({path:`${out}/04-prism-edited-saved.png`});checks.push({id:'LR-07-EDIT-SAVE',result:'PASSED',detail:'Real Prism Layer > New Layer, Edit > Fill with Foreground, and File > Save changed LopeDrive native bytes and retained two layers.'});
  await expect.poll(async()=> (await readLibrary(page)).assets.length,{timeout:45000}).toBe(2);
  returned=await readLibrary(page,true);const source=returned.assets.find(a=>a.id===initial.id),child=returned.assets.find(a=>a.parentId===initial.id);
  expect(source.hash).toBe(sourceHash);expect(source.originalHash).toBe(sourceHash);expect(source.recipe).toEqual(initial.recipe);
  expect(child.hash).toBe(driveAfter.hash);expect(child.originalHash).toBe(driveAfter.hash);expect(child.metadata).toMatchObject({width:initial.metadata.width,height:initial.metadata.height,bitDepth:8,format:'lopeimage',colorSpace:'linear sRGB'});
  await page.getByRole('button',{name:'Open Luma',exact:true}).click();await expect(app).toBeVisible();await app.getByRole('button',{name:'Select handoff-return.lopeimage',exact:true}).click();
  await expect(app.getByTestId('photo-canvas')).toBeVisible();await expect(app.getByText('Developing preview',{exact:true})).toBeHidden({timeout:30000});
  const returnedPixels=await app.getByTestId('photo-canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return {width:c.width,height:c.height,unique:[...new Set(d)],first:[...d.slice(0,4)]};});
  expect(returnedPixels.width).toBe(initial.metadata.width);expect(returnedPixels.height).toBe(initial.metadata.height);expect(returnedPixels.first).toEqual([0,0,0,255]);
  await app.screenshot({path:`${out}/05-returned-derivative.png`});checks.push({id:'LR-07-RETURN',result:'PASSED',detail:'Changed native project returned as a separate managed derivative with source parentId, exact saved-project hash and visible filled pixels; RAW source and +0.5 EV recipe unchanged.',returnedPixels});
  await app.getByRole('button',{name:'Export',exact:true}).click();const exportDialog=page.getByRole('dialog',{name:'Export photos',exact:true});await exportDialog.getByLabel('Export format').selectOption('png');await exportDialog.getByLabel('Export bit depth').selectOption('16');
  const pending=page.waitForEvent('download');await exportDialog.getByRole('button',{name:'Export 1 photo',exact:true}).click();const download=await pending,bytes=await readFile(await download.path());await writeFile(`${out}/returned-derivative.png`,bytes);
  expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(bytes[24]).toBe(16);expect(bytes.readUInt32BE(16)).toBe(initial.metadata.width);expect(bytes.readUInt32BE(20)).toBe(initial.metadata.height);exported={path:`${out}/returned-derivative.png`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),depth:bytes[24]};
  checks.push({id:'LR-07-EXPORT',result:'PASSED',detail:'Returned composite exported through real Luma UI as a PNG16 at original dimensions. RGB/8 handoff precision is accurately retained as an explicit limit.'});
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Open Luma',exact:true}).click();await expect(app).toBeVisible();await expect.poll(async()=> (await readLibrary(page)).assets.length,{timeout:30000}).toBe(2);
  const reopened=await readLibrary(page,true);expect(reopened.assets.find(a=>a.id===initial.id).originalHash).toBe(sourceHash);expect(reopened.assets.find(a=>a.parentId===initial.id).originalHash).toBe(driveAfter.hash);expect((await storedProject()).hash).toBe(driveAfter.hash);
  await app.screenshot({path:`${out}/06-reloaded-library.png`});checks.push({id:'LR-07-RELOAD',result:'PASSED',detail:'Fresh page session reopens the durable library and LopeDrive with exact original and derivative hashes.'});
  expect(errors).toEqual([]);
}catch(cause){error=String(cause.stack||cause);checks.push({id:'LR-07-FAILURE',result:'FAILED',error});try{await page.screenshot({path:`${out}/failure.png`});}catch{}console.error(error);process.exitCode=1;}
finally{
  const cleanAsset=a=>a?({...a,thumbnail:undefined}):a;
  const report={date:'2026-11-13',base,phase,browser:browser.version(),os:process.platform,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),setup:'Fresh guest context; only setup completion is seeded. No source-module imports, runtime mocks, injected app state or command execution. State inspections are read-only IndexedDB reads.',fixture:{name:'handoff-bayer.dng',sha256:sourceHash,bytes:fixture.length},checks,error,initial:cleanAsset(initial),returned:returned?.assets.map(cleanAsset),driveBefore,driveAfter,exported,errors,consoleErrors,failedRequests,failedResponses,requests,limits:['LopeOS Prism is the shipped Photoshop-style app; the interchange is native .lopeimage RGB/8, not Photoshop PSD16 or full Adobe interoperability.','Handoff renderer uses browser sRGB; the native JSON does not provide arbitrary ICC color management.','LopeDrive is local durable IndexedDB in this guest session. Remote authenticated runtime and cloud sync are not exercised.','Adobe reference captures and licensed application comparison are unavailable.']};
  await writeFile(`${out}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({phase,checks:checks.map(c=>({id:c.id,result:c.result})),errors,consoleErrors,failedRequests,failedResponses},null,2));await browser.close();
}
