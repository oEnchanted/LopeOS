import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {writerFilesystem} from './runtime';
const {unzipSync,strFromU8}=createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');

async function open(page:Page){const fs=await writerFilesystem(page);await page.addInitScript(()=>localStorage.setItem('test.writer.autosave','false'));await page.goto('/tests/writer/harness.html');await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled({timeout:30000});return fs;}
async function png(page:Page){return page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=120;const x=c.getContext('2d')!;x.fillStyle='#e15c4d';x.fillRect(0,0,100,120);x.fillStyle='#2779b9';x.fillRect(100,0,100,120);return c.toDataURL().split(',')[1];});}
async function insert(page:Page){const bytes=await png(page);await page.evaluate(()=>(window as any).testCommands.execute('writer.picture'));const d=page.getByRole('dialog',{name:'Insert Picture',exact:true});await d.getByLabel('Picture file',{exact:true}).setInputFiles({name:'Two colors.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')});await d.getByRole('button',{name:'Insert',exact:true}).click();await expect(d).toHaveCount(0);const image=page.locator('.writer-engine-mount img').and(page.getByAltText('Two colors.png',{exact:true}));await expect(image).toBeVisible();return image;}
async function xml(page:Page,fs:Awaited<ReturnType<typeof writerFilesystem>>,name:string){const path=`/Documents/${name}.docx`;await page.evaluate(path=>{(window as any).savePath=path;void (window as any).testCommands.execute('writer.save-as');},path);await expect.poll(()=>fs.files.has(path)).toBe(true);return strFromU8(unzipSync(fs.files.get(path)!.data)['word/document.xml']) as string;}

test('new pictures keep their natural proportions and independent crop handles save real percent values',async({page})=>{
 const fs=await open(page),image=await insert(page);await expect.poll(()=>image.boundingBox().then(r=>[Math.round(r!.width),Math.round(r!.height)])).toEqual([200,120]);
 await image.click();await page.getByRole('button',{name:'Crop',exact:true}).click();
 const handle=page.getByRole('button',{name:'Crop picture w',exact:true}),r=(await handle.boundingBox())!;
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+40,r.y+r.height/2,{steps:8});await page.mouse.up();
 await page.getByRole('toolbar',{name:'Crop picture',exact:true}).getByRole('button',{name:'Done',exact:true}).click();
 await expect(page.getByRole('toolbar',{name:'Crop picture',exact:true})).toHaveCount(0);
 const saved=await xml(page,fs,'Cropped');const crop=saved.match(/<a:srcRect\b[^>]*>/)?.[0]||'';
 expect(crop).toMatch(/l="20000"/);expect(crop).not.toMatch(/r="[1-9]/);
 await expect.poll(()=>image.evaluate(node=>getComputedStyle(node).opacity)).toBe('0');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>image.evaluate(node=>getComputedStyle(node).opacity)).toBe('1');
});

test('cancelling a crop draft leaves image geometry and saved source crop unchanged',async({page})=>{
 const fs=await open(page),image=await insert(page);await image.click();await page.getByRole('button',{name:'Crop',exact:true}).click();
 const handle=page.getByRole('button',{name:'Crop picture e',exact:true});await handle.focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Escape');
 await expect(page.getByRole('toolbar',{name:'Crop picture',exact:true})).toHaveCount(0);
 const saved=await xml(page,fs,'Crop cancelled');expect(saved).not.toMatch(/<a:srcRect\b[^>]*[ltrb]="[1-9]/);
 await expect.poll(()=>image.boundingBox().then(r=>[Math.round(r!.width),Math.round(r!.height)])).toEqual([200,120]);
});

test('dropping an image file in document text inserts a naturally sized native picture with undo',async({page})=>{
 const fs=await open(page),bytes=await png(page);const editor=page.getByRole('textbox',{name:'Document content',exact:true});
 await editor.click({position:{x:110,y:110}});await page.keyboard.type('Drop the picture here.');const rect=(await editor.boundingBox())!;
 await page.evaluate(({bytes,x,y})=>{const data=Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)),transfer=new DataTransfer();transfer.items.add(new File([data],'Dropped.png',{type:'image/png'}));document.elementFromPoint(x,y)!.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,clientX:x,clientY:y,bubbles:true,cancelable:true}));},{bytes,x:rect.x+150,y:rect.y+110});
 const image=page.locator('.writer-engine-mount img').and(page.getByAltText('Dropped.png',{exact:true}));await expect(image).toBeVisible();
 await expect.poll(()=>image.boundingBox().then(r=>[Math.round(r!.width),Math.round(r!.height)])).toEqual([200,120]);
 const saved=await xml(page,fs,'Dropped');expect(saved).toContain('<wp:inline');expect(saved.replace(/<[^>]*>/g,'')).toContain('Drop the picture here.');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(image).toHaveCount(0);
});

test('Layout Options applies square, front, behind and inline placement to the selected picture',async({page})=>{
 const fs=await open(page),image=await insert(page);await image.click();await page.getByRole('button',{name:'Layout Options',exact:true}).click();const menu=page.getByRole('dialog',{name:'Layout Options',exact:true});
 await menu.getByRole('button',{name:'Square',exact:true}).click();await expect(menu.getByRole('button',{name:'Square',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await xml(page,fs,'Square')).toContain('wrapSquare');
 for(const [label,value] of [['Behind Text','1'],['In Front of Text','0']] as const){
  await menu.getByRole('button',{name:label,exact:true}).click();await expect(menu.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await xml(page,fs,label)).toMatch(new RegExp(`behindDoc="${value}"`));
 }
 await menu.getByRole('button',{name:'In Line with Text',exact:true}).click();await expect(menu.getByRole('button',{name:'In Line with Text',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await xml(page,fs,'Inline')).toContain('<wp:inline');
});

test('Layout Options accepts precise page positions without intercepting input arrow keys',async({page})=>{
 const fs=await open(page),image=await insert(page);await image.click();await page.getByRole('button',{name:'Layout Options',exact:true}).click();const menu=page.getByRole('dialog',{name:'Layout Options',exact:true});
 await menu.getByRole('button',{name:'Square',exact:true}).click();
 const horizontal=menu.getByLabel('Picture horizontal position (in)',{exact:true}),vertical=menu.getByLabel('Picture vertical position (in)',{exact:true});
 await horizontal.fill('2');await horizontal.press('ArrowLeft');await expect(horizontal).toBeFocused();await vertical.fill('2.5');
 await menu.getByRole('button',{name:'Apply position',exact:true}).click();
 await expect.poll(()=>image.evaluate(node=>{const r=node.getBoundingClientRect(),p=node.closest('.superdoc-page')!.getBoundingClientRect();return [Math.round(r.left-p.left),Math.round(r.top-p.top)];})).toEqual([192,240]);
 const saved=await xml(page,fs,'Position');expect(saved).toMatch(/<wp:positionH[^>]*relativeFrom="page"[\s\S]*?<wp:posOffset>1828800<\/wp:posOffset>/);
 expect(saved).toMatch(/<wp:positionV[^>]*relativeFrom="page"[\s\S]*?<wp:posOffset>2286000<\/wp:posOffset>/);
});

test('dragging near the workspace edge scrolls and reanchors a floating picture onto the next page',async({page})=>{
 const fs=await open(page);await page.goto('/tests/writer/harness.html?path=/Documents/Review.docx');await expect(page.locator('.writer-opening')).toHaveCount(0,{timeout:30000});
 const image=await insert(page);await image.click();await page.getByRole('button',{name:'Layout Options',exact:true}).click();const options=page.getByRole('dialog',{name:'Layout Options',exact:true});await options.getByRole('button',{name:'Square',exact:true}).click();await expect(options.getByRole('button',{name:'Square',exact:true})).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape');await image.click();
 await expect.poll(()=>image.evaluate(node=>node.closest('[data-page-number]')?.getAttribute('data-page-number'))).toBe('1');
 const workspace=page.locator('.writer-workspace'),viewport=(await workspace.boundingBox())!,rect=(await image.boundingBox())!;
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2,viewport.y+viewport.height-8,{steps:14});
 await expect.poll(()=>workspace.evaluate(node=>node.scrollTop),{timeout:10000}).toBeGreaterThan(1000);
 const nextPage=page.locator('.writer-engine-mount .superdoc-page[data-page-number="2"]');await expect(nextPage).toBeVisible();const next=(await nextPage.boundingBox())!;
 await page.mouse.move(next.x+300,Math.max(viewport.y+100,next.y+200),{steps:8});await page.mouse.up();
 await expect.poll(()=>image.evaluate(node=>node.closest('[data-page-number]')?.getAttribute('data-page-number'))).toBe('2');
 await expect(page.locator('.writer-message.error')).toHaveCount(0);
 const saved=await xml(page,fs,'Moved to next page');expect(saved).toContain('<wp:anchor');expect(saved).toContain('Two colors.png');
});

test('picture controls follow OS theme, text size and contrast without changing the document',async({page})=>{
 await open(page);const image=await insert(page);await image.click();await page.getByRole('button',{name:'Layout Options',exact:true}).click();
 const layer=page.locator('.writer-picture-layer'),menu=page.getByRole('dialog',{name:'Layout Options',exact:true}),label=menu.locator('header strong');
 const size=await label.evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),revision=await page.evaluate(()=>(window as any).writerTestEngine.snapshot.revision);
 for(const theme of ['dark','light']){await page.evaluate(theme=>(window as any).testSystemPreferences.set('theme',theme),theme);await expect(layer).toHaveAttribute('data-glass-tone',theme);}
 await page.evaluate(()=>{(window as any).testSystemPreferences.set('textSize',150);(window as any).testSystemPreferences.set('increaseContrast',true);});
 await expect.poll(()=>label.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBe(size*1.5);
 await expect(menu).toHaveCSS('backdrop-filter','none');
 expect(await menu.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 expect(await page.evaluate(()=>(window as any).writerTestEngine.snapshot.revision)).toBe(revision);
});

test('Picture Format edits alt text and resets crop on the selected picture',async({page})=>{
 const fs=await open(page),image=await insert(page);await image.click();await page.getByRole('button',{name:'Alt Text',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Picture Format',exact:true});await dialog.getByLabel('Picture alt text',{exact:true}).fill('Red and blue panels for the color study');
 await dialog.getByLabel('Crop left (%)',{exact:true}).fill('30');await dialog.getByRole('button',{name:'OK',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await xml(page,fs,'Image description')).toContain('descr="Red and blue panels for the color study"');
 await page.getByRole('button',{name:'Reset Crop',exact:true}).click();
 await expect(page.locator('.writer-engine-mount [data-writer-image-presentation="crop"]')).toHaveCount(0);
 const saved=await xml(page,fs,'Reset crop');expect(saved).not.toMatch(/<a:srcRect\b[^>]*[ltrb]="[1-9]/);
 expect(saved).toContain('descr="Red and blue panels for the color study"');
});
