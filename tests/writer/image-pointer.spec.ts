import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { writerFilesystem } from './runtime';

const { unzipSync, strFromU8 } = createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');

async function open(page: Page) {
  const fs = await writerFilesystem(page);
  await page.addInitScript(() => localStorage.setItem('test.writer.autosave','false'));
  await page.goto('/tests/writer/harness.html');
  await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled({timeout:30000});
  return fs;
}

async function insertPicture(page: Page, name: string, width: number, height: number) {
  await page.evaluate(() => (window as any).testCommands.execute('writer.picture'));
  const dialog = page.getByRole('dialog',{name:'Insert Picture',exact:true});
  const png=await page.evaluate(({width,height})=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d')!;context.fillStyle='#185abd';context.fillRect(0,0,width,height);
    return canvas.toDataURL('image/png').split(',')[1];
  },{width,height});
  await dialog.getByLabel('Picture file',{exact:true}).setInputFiles({name,mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await dialog.getByLabel('Alt text:',{exact:true}).fill(name);
  await dialog.getByLabel('Width (px):',{exact:true}).fill(String(width));
  await dialog.getByLabel('Height (px):',{exact:true}).fill(String(height));
  await dialog.getByRole('button',{name:'Insert',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  return page.locator('.writer-engine-mount .superdoc-page img').and(page.getByAltText(name,{exact:true}));
}

async function saveXml(page: Page, fs: Awaited<ReturnType<typeof writerFilesystem>>, path: string) {
  await page.evaluate(path => { (window as any).savePath=path; },path);
  await page.evaluate(() => (window as any).testCommands.execute('writer.save-as'));
  await expect.poll(() => fs.files.has(path)).toBe(true);
  await expect(page.locator('.writer-title')).toContainText('Saved');
  return strFromU8(unzipSync(fs.files.get(path)!.data)['word/document.xml']) as string;
}

async function square(page: Page, image: ReturnType<Page['locator']>) {
  await image.click();await page.getByRole('button',{name:'Layout Options',exact:true}).click();
  const options=page.getByRole('dialog',{name:'Layout Options',exact:true});
  await options.getByRole('button',{name:'Square',exact:true}).click();
  await expect(options.getByRole('button',{name:'Square',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');await expect(options).toHaveCount(0);
}

async function setZoom(page: Page, zoom: number) {
  if(zoom===100)return;
  await page.locator('.writer-statusbar').getByRole('button',{name:'100%',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Zoom',exact:true});await dialog.getByLabel('Percent:',{exact:true}).fill(String(zoom));
  await dialog.getByRole('button',{name:'OK',exact:true}).click();await expect(dialog).toHaveCount(0);
}

async function frameGeometry(image: ReturnType<Page['locator']>) {
  return image.evaluate(node=>{
    const frame=node.closest<HTMLElement>('[data-sd-image-id]')||node as HTMLElement;
    const page=frame.closest<HTMLElement>('.superdoc-page')!;
    return {frame:frame.getBoundingClientRect().toJSON(),page:page.getBoundingClientRect().toJSON()};
  });
}

function offsets(xml: string) {
  const horizontal=xml.match(/<wp:positionH\b[^>]*relativeFrom="page"[^>]*>[\s\S]*?<wp:posOffset>(-?\d+)<\/wp:posOffset>/);
  const vertical=xml.match(/<wp:positionV\b[^>]*relativeFrom="page"[^>]*>[\s\S]*?<wp:posOffset>(-?\d+)<\/wp:posOffset>/);
  expect(horizontal).toBeTruthy();expect(vertical).toBeTruthy();
  return {left:Number(horizontal![1])/9525,top:Number(vertical![1])/9525};
}

for (const floating of [false,true]) for (const zoom of [100,150]) test(`native corner resize remains usable for ${floating?'floating':'inline'} pictures at ${zoom}% and preserves DOCX history`,async({page})=>{
  const fs=await open(page),image=await insertPicture(page,'Resize target.png',240,130);
  if(floating){
    await image.click();await page.getByRole('button',{name:'Layout Options',exact:true}).click();
    await page.getByRole('dialog',{name:'Layout Options',exact:true}).getByRole('button',{name:'Square',exact:true}).click();
    await page.keyboard.press('Escape');
  }
  if(zoom!==100){
    await page.locator('.writer-statusbar').getByRole('button',{name:'100%',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Zoom',exact:true});await dialog.getByLabel('Percent:',{exact:true}).fill(String(zoom));
    await dialog.getByRole('button',{name:'OK',exact:true}).click();await expect(dialog).toHaveCount(0);
  }
  await expect.poll(()=>image.boundingBox().then(rect=>Math.round(rect!.width))).toBe(240*zoom/100);
  await image.click();
  const handle=page.locator('.v2-image-resize-handle--se').first();await expect(handle).toBeVisible();
  const corner=(await handle.boundingBox())!,factor=zoom/100;
  await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);
  await page.mouse.down();await page.mouse.move(corner.x+corner.width/2+60*factor,corner.y+corner.height/2+32.5*factor,{steps:12});await page.mouse.up();
  await expect.poll(()=>image.boundingBox().then(rect=>rect!.width/factor)).toBeGreaterThan(298);
  const changed=(await image.boundingBox())!;
  expect(changed.width/factor).toBeLessThan(303);expect(changed.width/changed.height).toBeCloseTo(240/130,1);
  const xml=await saveXml(page,fs,`/Documents/${floating?'floating':'inline'}-${zoom}.docx`);
  const extent=xml.match(/<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  expect(extent).toBeTruthy();expect(Number(extent![1])/9525).toBeCloseTo(changed.width/factor,0);
  expect(Number(extent![2])/9525).toBeCloseTo(changed.height/factor,0);
  expect(xml).toContain(floating?'<wp:anchor':'<wp:inline');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(()=>image.boundingBox().then(rect=>Math.round(rect!.width/factor))).toBe(240);
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await expect.poll(()=>image.boundingBox().then(rect=>rect!.width/factor)).toBeGreaterThan(298);
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});

test('clicking either reopened picture activates its context and targets that picture in the dialog',async({page})=>{
  const fs=await open(page);
  await insertPicture(page,'First picture.png',160,90);await insertPicture(page,'Second picture.png',300,120);
  await saveXml(page,fs,'/Documents/Two pictures.docx');
  await page.goto('/tests/writer/harness.html?path=/Documents/Two%20pictures.docx');
  await expect(page.locator('.writer-opening')).toHaveCount(0,{timeout:30000});
  for(const [name,width,height] of [['First picture.png',160,90],['Second picture.png',300,120]] as const){
    await page.getByRole('tab',{name:'Home',exact:true}).click();
    await page.locator('.writer-engine-mount .superdoc-page img').and(page.getByAltText(name,{exact:true})).click();
    await expect(page.getByRole('tab',{name:'Picture Format',exact:true})).toHaveAttribute('aria-selected','true');
    await page.getByRole('button',{name:'Picture Properties',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Picture Format',exact:true});
    await expect(dialog.getByLabel('Width (px):',{exact:true})).toHaveValue(String(width));
    await expect(dialog.getByLabel('Height (px):',{exact:true})).toHaveValue(String(height));
    await expect.poll(()=>dialog.getByRole('combobox',{name:'Picture to format',exact:true}).evaluate(node=>(node as HTMLSelectElement).selectedOptions[0]?.textContent)).toContain(name);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
  }
});

for(const zoom of [100,150])test(`dragging a floating picture at ${zoom}% commits page offsets once and native Undo/Redo restores them`,async({page})=>{
  const fs=await open(page),image=await insertPicture(page,'Move target.png',240,130);
  await square(page,image);await setZoom(page,zoom);await image.click();
  const factor=zoom/100;
  await expect.poll(()=>image.boundingBox().then(rect=>Math.round(rect!.width))).toBe(240*factor);
  const before=await frameGeometry(image),dx=73*factor,dy=41*factor;
  const origin={left:(before.frame.x-before.page.x)/factor,top:(before.frame.y-before.page.y)/factor};
  await page.mouse.move(before.frame.x+before.frame.width/2,before.frame.y+before.frame.height/2);
  await page.mouse.down();await page.mouse.move(before.frame.x+before.frame.width/2+dx,before.frame.y+before.frame.height/2+dy,{steps:16});
  await expect(page.locator('.wr-picture-drag-preview')).toBeVisible();await page.mouse.up();
  await expect(page.locator('.wr-picture-drag-preview')).toHaveCount(0);
  await expect.poll(()=>frameGeometry(image).then(rect=>Math.abs(rect.frame.x-(before.frame.x+dx)))).toBeLessThan(2);
  await expect.poll(()=>frameGeometry(image).then(rect=>Math.abs(rect.frame.y-(before.frame.y+dy)))).toBeLessThan(2);
  const xml=await saveXml(page,fs,`/Documents/Moved-${zoom}.docx`),position=offsets(xml);
  expect(position.left).toBeCloseTo(origin.left+73,0);expect(position.top).toBeCloseTo(origin.top+41,0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(()=>frameGeometry(image).then(rect=>Math.abs(rect.frame.x-before.frame.x))).toBeLessThan(2);
  await expect.poll(()=>frameGeometry(image).then(rect=>Math.abs(rect.frame.y-before.frame.y))).toBeLessThan(2);
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await expect.poll(()=>frameGeometry(image).then(rect=>Math.abs(rect.frame.x-(before.frame.x+dx)))).toBeLessThan(2);
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});

test('dragging an inline picture shows a text caret and moves the native image into the target paragraph',async({page})=>{
  const fs=await open(page),editor=page.getByRole('textbox',{name:'Document content',exact:true});
  await editor.click({position:{x:110,y:110}});await page.keyboard.type('First paragraph before picture.');await page.keyboard.press('Enter');
  await page.keyboard.type('Drop target paragraph with words.');await page.keyboard.press('ControlOrMeta+Home');
  const image=await insertPicture(page,'Inline move.png',160,90);await image.click();
  const target=page.locator('.writer-engine-mount .superdoc-page .superdoc-fragment').filter({hasText:'Drop target paragraph with words.'}).first();
  const point=await target.evaluate(element=>{
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null;
    while((node=walker.nextNode()))if(node.textContent?.includes('Drop target paragraph with words.')){
      const range=document.createRange(),start=node.textContent.indexOf('Drop target paragraph with words.')+7;
      range.setStart(node,start);range.setEnd(node,start+1);const rect=range.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    }
    throw new Error('The target paragraph has no painted text.');
  });
  const before=await frameGeometry(image);
  await page.mouse.move(before.frame.x+before.frame.width/2,before.frame.y+before.frame.height/2);await page.mouse.down();
  await page.mouse.move(point.x,point.y,{steps:16});await expect(page.locator('.wr-picture-drop-caret')).toBeVisible();await page.mouse.up();
  await expect(page.locator('.wr-picture-drag-preview')).toHaveCount(0);
  const text=(xml:string)=>xml.replace(/<[^>]*>/g,'');
  const paragraph=(xml:string,needle:string)=>(xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)||[]).find(item=>text(item).includes(needle));
  const xml=await saveXml(page,fs,'/Documents/Inline moved.docx');
  expect(paragraph(xml,'Drop target paragraph with words.')).toMatch(/<w:drawing\b/);
  expect(paragraph(xml,'First paragraph before picture.')).not.toMatch(/<w:drawing\b/);
  expect(xml.match(/<w:drawing\b/g)).toHaveLength(1);expect(xml).toContain('<wp:inline');
  await page.getByRole('button',{name:'Undo',exact:true}).click();const undone=await saveXml(page,fs,'/Documents/Inline undone.docx');
  expect(paragraph(undone,'First paragraph before picture.')).toMatch(/<w:drawing\b/);
  expect(paragraph(undone,'Drop target paragraph with words.')).not.toMatch(/<w:drawing\b/);
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});

test('Escape cancels an active picture drag without changing the document',async({page})=>{
  const fs=await open(page),image=await insertPicture(page,'Cancel target.png',240,130);await square(page,image);
  const beforeXml=await saveXml(page,fs,'/Documents/Before cancelled drag.docx');await image.click();const before=await frameGeometry(image);
  await page.mouse.move(before.frame.x+before.frame.width/2,before.frame.y+before.frame.height/2);await page.mouse.down();
  await page.mouse.move(before.frame.x+before.frame.width/2+80,before.frame.y+before.frame.height/2+50,{steps:12});
  await expect(page.locator('.wr-picture-drag-preview')).toBeVisible();await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.locator('.wr-picture-drag-preview')).toHaveCount(0);
  const after=await frameGeometry(image);expect(after.frame.x).toBeCloseTo(before.frame.x,0);expect(after.frame.y).toBeCloseTo(before.frame.y,0);
  expect(await saveXml(page,fs,'/Documents/After cancelled drag.docx')).toBe(beforeXml);
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});

test('Viewing ignores picture drag and leaves the saved image unchanged',async({page})=>{
  const fs=await open(page),image=await insertPicture(page,'Viewing target.png',240,130);await square(page,image);
  const beforeXml=await saveXml(page,fs,'/Documents/Before viewing drag.docx');
  const reading=page.getByRole('button',{name:'Read mode',exact:true});await reading.click();await expect(reading).toHaveAttribute('aria-pressed','true');
  await image.click();const before=await frameGeometry(image);await page.mouse.move(before.frame.x+before.frame.width/2,before.frame.y+before.frame.height/2);await page.mouse.down();
  await page.mouse.move(before.frame.x+before.frame.width/2+80,before.frame.y+before.frame.height/2+50,{steps:12});await page.mouse.up();
  await expect(page.locator('.wr-picture-drag-preview')).toHaveCount(0);await expect(page.locator('.v2-image-resize-handle--interactive')).toHaveCount(0);
  const after=await frameGeometry(image);expect(after.frame.x).toBeCloseTo(before.frame.x,0);expect(after.frame.y).toBeCloseTo(before.frame.y,0);
  expect(await saveXml(page,fs,'/Documents/After viewing drag.docx')).toBe(beforeXml);
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});

test('crop handles edit one edge and native Undo restores the original crop',async({page})=>{
  const fs=await open(page),image=await insertPicture(page,'Crop target.png',240,130);await image.click();
  await page.getByRole('button',{name:'Crop',exact:true}).click();
  const toolbar=page.getByRole('toolbar',{name:'Crop picture',exact:true});await expect(toolbar).toBeVisible();
  const handle=page.getByRole('button',{name:'Crop picture w',exact:true}),rect=(await handle.boundingBox())!;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width/2+60,rect.y+rect.height/2,{steps:12});await page.mouse.up();
  await toolbar.getByRole('button',{name:'Done',exact:true}).click();await expect(toolbar).toHaveCount(0);
  const xml=await saveXml(page,fs,'/Documents/Asymmetric crop.docx'),crop=xml.match(/<a:srcRect\b[^>]*>/)?.[0];
  expect(crop).toBeTruthy();const left=Number(crop!.match(/\bl="(\d+)"/)?.[1]||0);
  expect(left).toBeGreaterThan(24000);expect(left).toBeLessThan(26000);
  for(const side of ['r','t','b'])expect(Number(crop!.match(new RegExp(`\\b${side}="(\\d+)"`))?.[1]||0)).toBe(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  const undone=await saveXml(page,fs,'/Documents/Crop undone.docx');
  expect(Number(undone.match(/<a:srcRect\b[^>]*\bl="(\d+)"/)?.[1]||0)).toBe(0);
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});

test('cancelling crop handles preserves the original image data',async({page})=>{
  const fs=await open(page),image=await insertPicture(page,'Cancel crop.png',240,130);
  const before=await saveXml(page,fs,'/Documents/Before cancelled crop.docx');await image.click();
  await page.getByRole('button',{name:'Crop',exact:true}).click();const toolbar=page.getByRole('toolbar',{name:'Crop picture',exact:true});
  const rect=(await page.getByRole('button',{name:'Crop picture e',exact:true}).boundingBox())!;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width/2-45,rect.y+rect.height/2,{steps:12});await page.mouse.up();
  await toolbar.getByRole('button',{name:'Cancel',exact:true}).click();await expect(toolbar).toHaveCount(0);
  expect(await saveXml(page,fs,'/Documents/After cancelled crop.docx')).toBe(before);
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});

test('a large asymmetric crop remains editable in Picture Properties and survives an unrelated size change',async({page})=>{
  const fs=await open(page),image=await insertPicture(page,'Large asymmetric crop.png',240,130);await image.click();
  await page.getByRole('button',{name:'Crop',exact:true}).click();const toolbar=page.getByRole('toolbar',{name:'Crop picture',exact:true});
  const handle=(await page.getByRole('button',{name:'Crop picture w',exact:true}).boundingBox())!;
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+144,handle.y+handle.height/2,{steps:16});await page.mouse.up();
  await toolbar.getByRole('button',{name:'Done',exact:true}).click();await expect(toolbar).toHaveCount(0);
  await page.getByRole('tab',{name:'Home',exact:true}).click();await image.click();
  await expect(page.getByRole('tab',{name:'Picture Format',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Picture Properties',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Picture Format',exact:true});
  await expect.poll(()=>dialog.getByLabel('Crop left (%)',{exact:true}).inputValue().then(Number)).toBeCloseTo(60,1);
  for(const side of ['right','top','bottom'])await expect(dialog.getByLabel(`Crop ${side} (%)`,{exact:true})).toHaveValue('0');
  await dialog.getByLabel('Width (px):',{exact:true}).fill('300');
  await dialog.getByRole('button',{name:'OK',exact:true}).click();await expect(dialog).toHaveCount(0);
  const xml=await saveXml(page,fs,'/Documents/Large asymmetric crop.docx'),crop=xml.match(/<a:srcRect\b[^>]*>/)?.[0];
  expect(crop).toBeTruthy();expect(Number(crop!.match(/\bl="(\d+)"/)?.[1])).toBeCloseTo(60000,0);
  for(const side of ['r','t','b'])expect(Number(crop!.match(new RegExp(`\\b${side}="(\\d+)"`))?.[1]||0)).toBe(0);
  const extent=xml.match(/<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  expect(Number(extent![1])/9525).toBe(300);expect(Number(extent![2])/9525).toBe(130);
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});
