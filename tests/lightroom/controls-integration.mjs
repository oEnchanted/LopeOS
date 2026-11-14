import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const base=process.env.LOPE_PHOTO_BASE||'http://127.0.0.1:5191',phase=process.env.LOPE_AUDIT_PHASE||'development';
const out=`docs/lightroom/release-audit/evidence/controls-integration-${phase}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
await page.addInitScript(()=>localStorage.setItem('lope.setup.complete.v1','1'));
const app=page.getByTestId('photo-studio');
const settled=async()=>{await expect(app.getByText('Developing preview',{exact:true})).toBeHidden({timeout:30000});await expect(app.getByText('Saved locally',{exact:true})).toBeVisible();};
async function check(id,run){try{const observed=await run();checks.push({id,result:'PASS',observed});}catch(e){checks.push({id,result:'FAIL',error:e.message});}await app.screenshot({path:`${out}/${id}.png`});}
try{
 await page.goto(base);await page.getByRole('button',{name:'Open Luma',exact:true}).click();await expect(app).toBeVisible();
 await app.locator('input[type=file]').first().setInputFiles(['public/photos/yosemite.jpg','public/photos/forest.jpg']);
 const add=page.getByRole('dialog',{name:'Add photos',exact:true});await expect(add.getByRole('button',{name:'Add 2 photos',exact:true})).toBeEnabled({timeout:30000});await add.getByRole('button',{name:'Add 2 photos',exact:true}).click();await expect(add).toBeHidden();await settled();
 await check('LR-INTEGRATION-MASK-TARGET',async()=>{
  await app.getByRole('button',{name:'Select yosemite.jpg',exact:true}).click();await app.getByRole('button',{name:'Masking',exact:true}).click();await app.getByRole('button',{name:'radial',exact:true}).click();await app.getByLabel('Mask name',{exact:true}).fill('Yosemite mask');
  await app.getByRole('button',{name:'Select forest.jpg',exact:true}).click();await app.getByRole('button',{name:'brush',exact:true}).click();await app.getByLabel('Mask name',{exact:true}).fill('Forest mask');await settled();
  await app.getByRole('button',{name:'Select yosemite.jpg',exact:true}).click({modifiers:['Meta']});await app.getByRole('button',{name:'Select yosemite.jpg',exact:true}).click({modifiers:['Meta']});
  await expect(app.getByRole('button',{name:'Select forest.jpg',exact:true})).toHaveAttribute('aria-pressed','true');await expect(app.getByLabel('Mask name',{exact:true})).toHaveValue('Forest mask');return{activePhoto:'forest.jpg',activeMask:'Forest mask'};
 });
 await check('LR-INTEGRATION-SELECT-ALL-AFTER-DESELECT',async()=>{
  const forest=app.getByRole('button',{name:'Select forest.jpg',exact:true});await forest.click();await forest.click({modifiers:['Meta']});await expect(app.getByRole('button',{name:'Export',exact:true})).toBeDisabled();await app.locator('.ps-collection-bar h2').click();await page.keyboard.press('ControlOrMeta+a');await expect(app.getByRole('button',{name:'Export',exact:true})).toBeEnabled();await expect(app.locator('.ps-filmstrip button.selected')).toHaveCount(2);return{selected:2,exportEnabled:true};
 });
 await app.getByRole('button',{name:'Select forest.jpg',exact:true}).click();
 await check('LR-INTEGRATION-RESIZER',async()=>{
  const panel=app.locator('.ps-edit-panel'),before=await panel.boundingBox(),resizer=app.getByRole('separator',{name:'Resize editing panel'});await resizer.focus();await resizer.press('ArrowRight');const after=await panel.boundingBox();
  await expect(app.getByRole('button',{name:'Select forest.jpg',exact:true})).toHaveAttribute('aria-pressed','true');expect(after.width).toBe(before.width-8);return{before:before.width,after:after.width,activePhotoPreserved:true};
 });
 await app.getByRole('button',{name:'Select forest.jpg',exact:true}).click();
 await check('LR-INTEGRATION-CROP-KEYBOARD',async()=>{
  await app.getByRole('button',{name:'Crop & Rotate (C)',exact:true}).click();await settled();const handle=app.getByRole('button',{name:'Crop se handle'});await handle.focus();await handle.press('ArrowLeft');await handle.press('Shift+ArrowUp');await settled();
  await expect(app.getByRole('button',{name:'Select forest.jpg',exact:true})).toHaveAttribute('aria-pressed','true');const width=Number(await app.getByLabel('Crop width',{exact:true}).inputValue()),height=Number(await app.getByLabel('Crop height',{exact:true}).inputValue());expect(width).toBeLessThan(100);expect(height).toBeLessThan(100);return{width,height,activePhotoPreserved:true};
 });
 await check('LR-INTEGRATION-NUMERIC-PERSISTENCE',async()=>{
  await app.getByRole('button',{name:'Edit (E)',exact:true}).click();const field=app.getByLabel('Exposure value',{exact:true});await field.focus();await field.press('ControlOrMeta+a');await field.pressSequentially('-0.75');await field.press('Enter');await settled();await expect(field).toHaveValue('-0.75');
  await field.fill('2.5');await field.press('Escape');await settled();await expect(field).toHaveValue('-0.75');await page.reload();await expect(app.getByTestId('photo-canvas')).toBeVisible({timeout:30000});await settled();await expect(field).toHaveValue('-0.75');return{value:-.75,escapeRestored:true,reloadPersisted:true};
 });
 await check('LR-INTEGRATION-BEFORE-PAN',async()=>{
  await app.getByRole('button',{name:'Masking',exact:true}).click();await app.getByRole('button',{name:'Forest mask',exact:true}).click();await app.getByRole('button',{name:'100%',exact:true}).click();await app.getByRole('button',{name:'Show original (backslash)',exact:true}).click();await settled();const frame=app.locator('.ps-photo-frame'),before=await frame.boundingBox();
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();await page.mouse.move(before.x+before.width/2+70,before.y+before.height/2+20,{steps:8});await page.mouse.up();const after=await frame.boundingBox();expect(Math.abs(after.x-before.x-70)).toBeLessThanOrEqual(1);expect(Math.abs(after.y-before.y-20)).toBeLessThanOrEqual(1);await expect(app.locator('.ps-mask-overlay')).toBeHidden();await app.getByRole('button',{name:'Show original (backslash)',exact:true}).click();await settled();await expect(app.getByLabel('Mask name',{exact:true})).toHaveValue('Forest mask');return{pan:{x:after.x-before.x,y:after.y-before.y},originalReadOnly:true};
 });
}catch(error){checks.push({id:'SETUP',result:'FAIL',error:error.message});}
finally{
 const result={date:'2026-11-13',phase,base,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:browser.version(),viewport:{width:1600,height:1000},deviceScaleFactor:1,setup:'Fresh guest context; real shell, real sample-file imports, no source-module imports or services mocks.',checks,errors};await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await browser.close();if(checks.some(c=>c.result==='FAIL')||errors.length)process.exitCode=1;
}
