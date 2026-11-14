import {chromium,expect} from '@playwright/test';
import {writerFilesystem} from './runtime.ts';
const base=process.env.WRITER_TEST_URL||'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await writerFilesystem(page);
 await page.addInitScript(()=>localStorage.setItem('test.writer.autosave','false'));
 await page.goto(`${base}/tests/writer/harness.html`);await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled({timeout:30000});
 const body=page.getByRole('textbox',{name:'Document content',exact:true});
 await body.click({position:{x:110,y:110}});await page.keyboard.type('A day on the coast');await page.keyboard.press('Enter');
 await page.keyboard.type('Field notes from our autumn visit. The final report brings together observations, photographs, and the next steps for the team.');await page.keyboard.press('Enter');await page.keyboard.press('Enter');
 const png=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=320;c.height=200;const x=c.getContext('2d');
  const sky=x.createLinearGradient(0,0,0,160);sky.addColorStop(0,'#80b6d0');sky.addColorStop(1,'#dae7e6');x.fillStyle=sky;x.fillRect(0,0,320,200);
  x.fillStyle='#f5e6b5';x.beginPath();x.arc(242,45,19,0,Math.PI*2);x.fill();
  x.fillStyle='#809e9a';x.beginPath();x.moveTo(0,145);x.lineTo(95,76);x.lineTo(170,142);x.lineTo(240,105);x.lineTo(320,147);x.fill();
  x.fillStyle='#3d707b';x.beginPath();x.moveTo(0,152);x.lineTo(160,134);x.lineTo(320,154);x.lineTo(320,200);x.lineTo(0,200);x.fill();
  x.fillStyle='#c4d5c3';x.beginPath();x.moveTo(0,200);x.lineTo(0,165);x.lineTo(85,142);x.lineTo(185,200);x.fill();
  x.strokeStyle='#ffffff44';x.lineWidth=2;for(let y=164;y<200;y+=13){x.beginPath();x.moveTo(185,y);x.lineTo(300,y);x.stroke();}
  return c.toDataURL().split(',')[1];
 });
 await page.evaluate(()=>window.testCommands.execute('writer.picture'));const dialog=page.getByRole('dialog',{name:'Insert Picture',exact:true});
 await dialog.getByLabel('Picture file',{exact:true}).setInputFiles({name:'Coast study.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await dialog.getByRole('button',{name:'Insert',exact:true}).click();await expect(dialog).toHaveCount(0);
 const image=page.locator('.writer-engine-mount img').and(page.getByAltText('Coast study.png',{exact:true}));await image.click();
 const shot=async name=>{await page.locator('.writer-app').evaluate(node=>Promise.all(node.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));await page.mouse.move(20,20);await page.screenshot({path:`docs/writer/screenshots/${name}.png`});};
 await shot('picture-selected');await page.getByRole('button',{name:'Layout Options',exact:true}).click();const layout=page.getByRole('dialog',{name:'Layout Options',exact:true});
 await layout.getByRole('button',{name:'Square',exact:true}).click();await expect(layout.getByRole('button',{name:'Square',exact:true})).toHaveAttribute('aria-pressed','true');await shot('picture-layout-options');
 await page.evaluate(()=>window.testSystemPreferences.set('theme','dark'));await shot('picture-layout-dark');await page.evaluate(()=>window.testSystemPreferences.set('theme','light'));
 await page.keyboard.press('Escape');await expect(layout).toHaveCount(0);await image.click();const rect=await image.boundingBox();
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+86,rect.y+rect.height/2+32,{steps:14});await expect(page.locator('.wr-picture-drag-preview')).toBeVisible();
 await page.screenshot({path:'docs/writer/screenshots/picture-drag-preview.png'});await page.mouse.up();await expect(page.locator('.wr-picture-drag-preview')).toHaveCount(0);
 await image.click();await page.getByRole('button',{name:'Crop',exact:true}).click();const handle=page.getByRole('button',{name:'Crop picture w',exact:true}),edge=await handle.boundingBox();
 await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();await page.mouse.move(edge.x+edge.width/2+52,edge.y+edge.height/2,{steps:10});await page.mouse.up();await shot('picture-crop-preview');
 await page.getByRole('toolbar',{name:'Crop picture',exact:true}).getByRole('button',{name:'Done',exact:true}).click();await expect(page.getByRole('toolbar',{name:'Crop picture',exact:true})).toHaveCount(0);
 await expect(page.locator('.writer-engine-mount [data-writer-image-presentation="crop"]')).toHaveCount(1);await shot('picture-cropped');
 expect(errors).toEqual([]);console.log(JSON.stringify({errors,captures:6,viewport:'1366x900'}));
}finally{await browser.close();}
