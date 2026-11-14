import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const base=process.env.LOPE_PHOTO_BASE||'http://127.0.0.1:5191';
const phase=process.env.LOPE_AUDIT_PHASE||'after';
const only=process.env.LOPE_AUDIT_ONLY;
const out='docs/lightroom/release-audit/evidence';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1000,height:800},deviceScaleFactor:1});
const errors=[],checks=[];page.on('pageerror',error=>errors.push(error.message));
const check=async(id,run)=>{if(only&&only!==id)return;try{const observed=await run();checks.push({id,result:'PASS',observed});}catch(error){checks.push({id,result:'FAIL',error:error.message});}await page.screenshot({path:`${out}/${id}-${phase}.png`});};
try{
 await page.goto(base+'/tests/lightroom/controls-harness.html');
 const input=page.getByRole('spinbutton',{name:'Exposure value'});
 await check('LR-CTRL-001',async()=>{
  await input.focus();await input.press('ControlOrMeta+a');await input.pressSequentially('-0.75');
  await expect(input).toHaveValue('-0.75');await input.press('Enter');
  expect(await page.evaluate(()=>window.__controls.recipe.values.exposure)).toBe(-.75);
  return {value:await input.inputValue(),commits:await page.evaluate(()=>window.__controls.commits)};
 });
 await check('LR-CTRL-002',async()=>{
  await input.fill('1.25');await input.press('Enter');await input.fill('3.4');await input.press('Escape');
  await expect(input).toHaveValue('1.25');
  return {value:await input.inputValue()};
 });
 await check('LR-CTRL-003',async()=>{
  await input.fill('18');await input.press('Enter');await expect(input).toHaveValue('5');
  await input.fill('');await input.press('Enter');await expect(input).toHaveValue('5');
  await input.fill('0.123');await input.press('Enter');await expect(input).toHaveValue('0.123');
  return {clampedMaximum:5,emptyEditPreservesValue:true,finePrecision:await input.inputValue()};
 });
 await page.evaluate(()=>window.__controls.reset());
 await check('LR-VIEW-001',async()=>{
  const frame=page.locator('.ps-photo-frame'),box=await frame.boundingBox();
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.4+80,box.y+box.height*.4+35,{steps:12});await page.mouse.up();
  const after=await frame.boundingBox(),delta={x:after.x-box.x,y:after.y-box.y};
  expect(Math.abs(delta.x-80)).toBeLessThanOrEqual(1);expect(Math.abs(delta.y-35)).toBeLessThanOrEqual(1);
  return delta;
 });
 await check('LR-VIEW-002',async()=>{
  await page.evaluate(()=>{window.__controls.mask('brush');window.__controls.setBefore(true);});
  await expect(page.locator('.ps-before-badge')).toBeVisible();
  const recipe=await page.evaluate(()=>window.__controls.recipe),frame=page.locator('.ps-photo-frame'),box=await frame.boundingBox();
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.4-40,box.y+box.height*.4+15,{steps:6});await page.mouse.up();
  const after=await frame.boundingBox(),delta={x:after.x-box.x,y:after.y-box.y};
  expect(Math.abs(delta.x+40)).toBeLessThanOrEqual(1);expect(Math.abs(delta.y-15)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>window.__controls.recipe)).toEqual(recipe);
  await expect(page.locator('.ps-mask-overlay')).toBeHidden();
  return {delta,originalRemainsReadOnly:true};
 });
 await check('LR-VIEW-003',async()=>{
  await page.evaluate(()=>window.__controls.setAssetId('same-name-different-id'));
  await expect(page.locator('.ps-photo-frame')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
  return {sameNamedAssetResetsPan:true};
 });
 await page.evaluate(()=>{window.__controls.reset();window.__controls.mask('radial');});
 await expect.poll(()=>page.evaluate(()=>window.__controls.recipe.masks.length)).toBe(1);
 await check('LR-MASK-001',async()=>{
  await page.evaluate(()=>{const c=window.__controls,r=structuredClone(c.recipe);r.crop={x:.1,y:.1,width:.5,height:.8};r.rotation=90;r.masks[0].components[0].start={x:.3,y:.4};r.masks[0].components[0].end={x:.4,y:.6};c.setRecipe(r);});
  const overlay=page.locator('.ps-mask-overlay');await expect(overlay).toBeVisible();
  const bounds=await overlay.locator('[data-mask-outline],ellipse').evaluate(el=>{const r=el.getBBox();return{x:r.x,y:r.y,width:r.width,height:r.height};});
  expect(Math.abs(bounds.width-50)).toBeLessThan(0.1);expect(Math.abs(bounds.height-40)).toBeLessThan(0.1);
  return bounds;
 });
 await check('LR-MASK-002',async()=>{
  await page.evaluate(()=>{const c=window.__controls,r=structuredClone(c.recipe),m=r.masks[0].components[0];m.type='brush';m.points=[{x:.3,y:.4}];m.radius=.04;c.setRecipe(r);});
  const outline=page.locator('.ps-mask-overlay [data-mask-outline],.ps-mask-overlay polyline');
  const bounds=await outline.evaluate(el=>{const r=el.getBBox();return{width:r.width,height:r.height};});
  expect(Math.abs(bounds.width-10)).toBeLessThan(.1);expect(Math.abs(bounds.height-16)).toBeLessThan(.1);
  return bounds;
 });
 await check('LR-MASK-003',async()=>{
  await page.evaluate(()=>{const c=window.__controls,r=structuredClone(c.recipe);r.crop={x:0,y:0,width:1,height:1};r.rotation=0;r.values.straighten=45;r.masks[0].components[0].points=[];c.setRecipe(r);});
  await page.locator('.ps-photo-frame').click({position:{x:2,y:2}});
  expect(await page.evaluate(()=>window.__controls.recipe.masks[0].components.every(c=>c.points.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)))).toBe(true);
  return {outsideSourceClickLeavesRecipeValid:true};
 });
 await page.evaluate(()=>window.__controls.reset());
 await expect.poll(()=>page.evaluate(()=>window.__controls.recipe.rotation)).toBe(0);
 await check('LR-CROP-001',async()=>{
  await page.evaluate(()=>window.__controls.setTool('crop'));
  const handle=page.getByRole('button',{name:'Crop se handle'}),box=await handle.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x-60,box.y-40,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();
  expect(await page.evaluate(()=>window.__controls.recipe.crop)).toEqual({x:0,y:0,width:1,height:1});
  return {escapeRestoresCrop:true};
 });
 await page.evaluate(()=>window.__controls.reset());
 await check('LR-CROP-002',async()=>{
  await page.evaluate(()=>window.__controls.setTool('crop'));
  const handle=page.getByRole('button',{name:'Crop se handle'});await handle.focus();await handle.press('ArrowLeft');await handle.press('Shift+ArrowUp');
  const crop=await page.evaluate(()=>window.__controls.recipe.crop);
  expect(crop.width).toBeCloseTo(399/400,8);expect(crop.height).toBeCloseTo(290/300,8);
  return {crop,keyboardStep:'1 preview pixel; Shift 10 preview pixels; native granularity unverified'};
 });
 await page.evaluate(()=>window.__controls.reset());
 await check('LR-CURVE-001',async()=>{
  await page.evaluate(()=>{const c=window.__controls,r=structuredClone(c.recipe);r.curve=[{x:0,y:0},{x:.5,y:.5},{x:1,y:1}];c.setRecipe(r);});
  const circle=page.getByRole('slider',{name:'Curve point 2'}),box=await circle.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+35,box.y-25,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();
  expect(await page.evaluate(()=>window.__controls.recipe.curve[1])).toEqual({x:.5,y:.5});
  return {escapeRestoresCurvePoint:true};
 });
 await check('LR-CURVE-002',async()=>{
  const circle=page.getByRole('slider',{name:'Curve point 2'});await circle.focus();await circle.press('Delete');
  await expect(page.locator('.ps-curve circle')).toHaveCount(2);
  return {keyboardDeletionRetainsEndpoints:true};
 });
 await page.screenshot({path:`${out}/controls-${phase}.png`});
 const report={phase,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:browser.version(),viewport:{width:1000,height:800},deviceScaleFactor:1,checks,errors};
 await writeFile(`docs/lightroom/release-audit/controls-${phase}${only?'-'+only:''}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 if(phase!=='before'&&(checks.some(c=>c.result==='FAIL')||errors.length))process.exitCode=1;
}finally{await browser.close();}
