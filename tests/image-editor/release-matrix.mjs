import {chromium,webkit,firefox,expect} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const base=process.env.IMAGE_EDITOR_TEST_URL||'http://127.0.0.1:5189',out='docs/image-editor/release-audit/evidence';
await mkdir(out,{recursive:true});
const manifest=JSON.parse(await readFile('docs/image-editor/release-audit/build-manifest.json','utf8'));
const results=[];
for(const [name,type,options] of [['chromium',chromium,{}],['chrome',chromium,{channel:'chrome'}],['webkit',webkit,{}],['firefox',firefox,{}]]){
 let browser;
 try{browser=await type.launch({headless:true,timeout:30000,...options});}catch(error){results.push({browser:name,result:'UNVERIFIED',reason:String(error).split('\n').slice(0,4).join('\n')});continue;}
 const sizes=name==='chromium'?[[1440,900],[1920,1080],[740,500],[1152,720],[720,450]]:[[1440,900]];
 for(const [width,height] of sizes){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});const errors=[],failedRequests=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))external.push({url:r.url(),method:r.method()});});
  const record={browser:name,version:browser.version(),viewport:{width,height},scale:1,browserZoom:100,zoomQualification:width===1152?'Effective viewport of 1440x900 at 125%; browser zoom itself UNVERIFIED':width===720?'Effective viewport of 1440x900 at 200%; below supported app minimum; browser zoom itself UNVERIFIED':'Matched CSS viewport, browser zoom 100%',checks:[],errors,failedRequests,external};
  try{
   await page.goto(base+'/tests/image-editor/release.html');const app=page.getByTestId('image-editor-app');await expect(app).toHaveAttribute('data-session-ready','true',{timeout:30000});await expect(page.getByTestId('image-composite')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
   const cmd=async id=>{await page.evaluate(id=>window.__imageTest.commands.execute(id),id);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
   const count=await app.locator('[data-layer-id]').count();await cmd('image.new-layer');await expect(app.locator('[data-layer-id]')).toHaveCount(count+1);await cmd('image.undo');await expect(app.locator('[data-layer-id]')).toHaveCount(count);record.checks.push('Bundled worker renders; New Layer and Undo retain real structure');
   await app.screenshot({path:`${out}/${name}-${width}x${height}-workspace.png`});
   record.anchors=await app.evaluate(root=>Object.fromEntries(['.ie-menubar','.ie-options','.ie-toolbar','.ie-document-tabs','.ie-canvas-area','.ie-panels','.ie-status'].map(selector=>{const el=root.querySelector(selector);if(!el)return [selector,null];const r=el.getBoundingClientRect(),s=getComputedStyle(el);return [selector,{x:r.x,y:r.y,width:r.width,height:r.height,font:s.font,fontSize:s.fontSize,color:s.color,background:s.backgroundColor}];})));
   const menuRecords=[];
   for(const documentState of ['document','no-document']){
    if(documentState==='no-document')await cmd('image.close-all');
    for(const label of ['File','Edit','Image','Layer','Type','Select','Filter','View','Plugins','Window','Help']){
     await app.getByRole('menubar').getByRole('menuitem',{name:label,exact:true}).click();
     const menu=app.getByRole('menu',{name:label+' menu',exact:true});await expect(menu).toBeVisible();
     const box=await menu.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);expect(box.y+box.height).toBeLessThanOrEqual(height+1);
     menuRecords.push({label,documentState,rect:box,items:await menu.getByRole('menuitem').evaluateAll(nodes=>nodes.map(n=>({label:n.textContent,disabled:n.disabled,submenu:n.getAttribute('aria-haspopup')})))});
     for(const branch of await menu.locator(':scope > .ie-menu-entry > button[aria-haspopup=menu]').all()){
      await branch.scrollIntoViewIfNeeded();await branch.hover();const popups=app.locator('.ie-audit-dropdown');await expect(popups).toHaveCount(2);const sub=await popups.last().boundingBox();expect(sub.x).toBeGreaterThanOrEqual(0);expect(sub.y).toBeGreaterThanOrEqual(0);expect(sub.x+sub.width).toBeLessThanOrEqual(width+1);expect(sub.y+sub.height).toBeLessThanOrEqual(height+1);
      menuRecords.push({label:await branch.innerText(),documentState,rect:sub,items:await popups.last().getByRole('menuitem').evaluateAll(nodes=>nodes.map(n=>({label:n.textContent,disabled:n.disabled})))});
     }
     await app.getByRole('menubar').getByRole('menuitem',{name:label,exact:true}).click();
    }
   }
   record.menus=menuRecords;record.checks.push('All top-level menus and direct submenus inspected in document/no-document states; popup bounds fit client area');
   await cmd('image.new');const dialog=app.getByRole('dialog',{name:'New Document',exact:true});await expect(dialog).toBeVisible();const d=await dialog.boundingBox();expect(d.x).toBeGreaterThanOrEqual(0);expect(d.y).toBeGreaterThanOrEqual(0);expect(d.x+d.width).toBeLessThanOrEqual(width+1);expect(d.y+d.height).toBeLessThanOrEqual(height+1);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);record.checks.push('New Document dialog fits and Escape dismisses');
   expect(errors).toEqual([]);expect(failedRequests).toEqual([]);expect(external).toEqual([]);record.result='PASS';
  }catch(error){record.result='FAIL';record.failure=String(error);await page.screenshot({path:`${out}/${name}-${width}x${height}-failure.png`});}
  results.push(record);console.log(JSON.stringify({browser:name,width,height,result:record.result,failure:record.failure}));await page.close();
 }
 await browser.close();
}
await writeFile(`${out}/production-matrix.json`,JSON.stringify({buildId:manifest.buildId,base,results},null,2)+'\n');
if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
