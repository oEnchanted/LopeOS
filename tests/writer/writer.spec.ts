import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { writerFilesystem } from './runtime';
import { pdfText } from './pdf';
const { unzipSync,strFromU8 }=createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');
async function open(page:Page,path=''){
  await page.addInitScript(()=>localStorage.setItem('test.writer.autosave','false'));
  await page.goto(`/tests/writer/harness.html${path?'?path='+encodeURIComponent(path):''}`);
  await expect(page.locator('.writer-opening')).toHaveCount(0,{timeout:30000});
  if(path)await expect(page.locator('.writer-title')).toContainText(path.split('/').at(-1)!);
}
const body=(page:Page)=>page.getByRole('textbox',{name:'Document content',exact:true});

test('native text input, ribbon selection, semantic save/reload, recovery and close guard',async({page})=>{
 const fs=await writerFilesystem(page);await open(page);
 await body(page).click({position:{x:110,y:100}});
 await page.keyboard.type('A clear place to write.');await page.keyboard.press('ControlOrMeta+a');
 await expect(page.getByRole('button',{name:'Bold',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Bold',exact:true}).click();
 await expect(page.getByRole('button',{name:'Bold',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByLabel('Font size',{exact:true}).selectOption('18');
 await page.evaluate(()=>{(window as any).savePath='/Documents/Draft.docx';});
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.locator('.writer-title')).toContainText('Draft.docx');
 const xml=strFromU8(unzipSync(fs.files.get('/Documents/Draft.docx')!.data)['word/document.xml']);
 expect(xml).toContain('A clear place to write.');expect(xml).toMatch(/<w:b\b/);expect(xml).toContain('w:val="36"');
 await page.reload();await expect(page.locator('.writer-title')).toContainText('Draft.docx');
 await expect(body(page)).toBeVisible();
 await body(page).click({position:{x:110,y:100}});await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' Unsaved recovery.');
 await expect(page.locator('.writer-save-status')).toContainText('Recovery copy saved',{timeout:10000});
 page.once('dialog',d=>d.accept());await page.reload();
 await expect(page.getByRole('button',{name:'Recover',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Recover',exact:true}).click();
 await expect(page.locator('.writer-title')).toContainText('Unsaved');
 await expect.poll(()=>body(page).innerText()).toContain('Unsaved recovery.');
 await page.evaluate(()=>{(window as any).guardPromise=(window as any).closeGuard();});
 await expect(page.getByRole('dialog',{name:'Save your changes?',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).guardPromise)).toBe(false);
});

test('external modifications and interrupted saves preserve unsaved edits',async({page})=>{
 const fs=await writerFilesystem(page);await open(page,'/Documents/Review.docx');
 await body(page).click({position:{x:130,y:100}});await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' Local version.');
 const external=await readFile('tests/writer/fixtures/multipage.docx');fs.externalWrite('/Documents/Review.docx',external);
 await expect(page.getByRole('alert')).toContainText('changed elsewhere');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'Reload it'})).toBeVisible();
 expect(fs.files.get('/Documents/Review.docx')!.data.equals(external)).toBe(true);
 await page.evaluate(()=>{(window as any).savePath='/Documents/My copy.docx';});
 await page.getByRole('button',{name:'Save a copy',exact:true}).click();
 await expect(page.locator('.writer-title')).toContainText('My copy.docx');
 expect(strFromU8(unzipSync(fs.files.get('/Documents/My copy.docx')!.data)['word/document.xml'])).toContain('Local version.');
 await page.reload();await expect(page.locator('.writer-title')).toContainText('My copy.docx');
 await body(page).click({position:{x:130,y:100}});await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' Interrupted.');
 fs.interruptNextWrite();await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.locator('.writer-title')).toContainText('Unsaved');
 await expect(page.getByRole('alert').filter({hasText:/connection|fetch|network|unavailable|conflict/i})).toBeVisible();
});

test('unsafe packages require a read-only or copy route and keep the original',async({page})=>{
 const fs=await writerFilesystem(page);const original=fs.files.get('/Documents/Unsafe.docx')!.data;
 await open(page);
 await page.evaluate(()=>{(window as any).openPath='/Documents/Unsafe.docx';return (window as any).testCommands.execute('writer.open');});
 await expect(page.getByRole('dialog',{name:'Document compatibility'})).toBeVisible();
 await page.getByRole('button',{name:'Edit a copy',exact:true}).click();
 await expect(page.locator('.writer-title')).toContainText('Unsafe.docx');
 await page.evaluate(()=>{(window as any).savePath='/Documents/Unsafe.docx';});
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('preserve the original');
 expect(fs.files.get('/Documents/Unsafe.docx')!.data.equals(original)).toBe(true);
});

test('comments dialog freezes selection; review panes, search, and formatting dialogs work',async({page})=>{
 await writerFilesystem(page);await open(page,'/Documents/Review.docx');
 await body(page).click({position:{x:110,y:110}});await page.keyboard.press('ControlOrMeta+Home');await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
 await page.getByRole('tab',{name:'Review',exact:true}).click();
 await page.getByRole('button',{name:'New Comment',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'New Comment',exact:true});await dialog.getByLabel('New Comment text').fill('Check the opening title.');
 await dialog.getByRole('button',{name:'Post comment'}).click();
 await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Show Comments',exact:true}).click();
 await expect(page.getByLabel('Comments pane',{exact:true})).toContainText('Check the opening title.');
 await page.getByRole('button',{name:'Resolve',exact:true}).click();
 await expect(page.getByLabel('Comments pane',{exact:true})).toContainText('Resolved');
 await page.getByRole('button',{name:'Close Comments pane',exact:true}).click();
 await page.evaluate(()=>{void (window as any).testCommands.execute('writer.find');});
 await page.getByLabel('Search document',{exact:true}).fill('document');
 await expect(page.locator('.wr-search-summary')).toContainText('results');
 await page.getByRole('button',{name:'Close Navigation pane',exact:true}).click();
 await page.getByRole('tab',{name:'Home',exact:true}).click();
 await page.getByRole('button',{name:'Font dialog launcher',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Font',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Paragraph dialog launcher',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Paragraph',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
});

test('print preview and PDF use every engine page with matching page count',async({page,context})=>{
 await writerFilesystem(page);await open(page,'/Documents/Review.docx');
 await page.evaluate(()=>{void (window as any).testCommands.execute('writer.print');});
 await expect(page.locator('.wr-print-preview-canvas .superdoc-page')).toHaveCount(3,{timeout:30000});
 await page.screenshot({path:'docs/writer/screenshots/print.png'});
 const html=await page.evaluate(async()=>{const {createPrintHtml}=await import('/apps/web/src/apps/writer/print.ts');return createPrintHtml(document.querySelector('.wr-print-preview-canvas') as HTMLElement,3);});
 const pdfPage=await context.newPage();await pdfPage.goto('/tests/writer/print.html');await pdfPage.setContent(html);await pdfPage.evaluate(()=>document.fonts.ready);
 const bytes=await pdfPage.pdf({path:'docs/writer/sample-output.pdf',preferCSSPageSize:true,printBackground:true});
 expect(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length).toBe(3);
 const text=await pdfText(bytes);expect(text[0]).toContain('A shared place to write');expect(text[1]).toContain('The next chapter');expect(text[2]).toContain('Final notes');
 await pdfPage.close();
});


test('missing fonts are reported alongside save state and the ruler can be toggled',async({page})=>{
 await writerFilesystem(page);await open(page,'/Documents/Fonts.docx');
 await expect(page.locator('.writer-font-warning')).toContainText('Lope Missing Font 123');
 await expect(page.locator('.writer-save-status')).toContainText('Saved');
 await page.getByRole('tab',{name:'View',exact:true}).click();
 await page.getByRole('button',{name:'Ruler',exact:true}).click();
 await expect(page.locator('[data-superdoc-v2-ruler]')).toHaveCount(1);
 await page.getByRole('button',{name:'Ruler',exact:true}).click();
 await expect(page.locator('[data-superdoc-v2-ruler]')).toHaveCount(0);
});


test('AutoSave acknowledges the workspace version without resetting undo history',async({page})=>{
 const fs=await writerFilesystem(page);await open(page,'/Documents/Review.docx');
 await page.getByRole('button',{name:'AutoSave Off',exact:true}).click();
 await body(page).click({position:{x:110,y:110}});await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' Automatically saved.');
 await expect.poll(()=>strFromU8(unzipSync(fs.files.get('/Documents/Review.docx')!.data)['word/document.xml']),{timeout:10000}).toContain('Automatically saved.');
 await expect(page.locator('.writer-title')).toContainText('Saved');
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();
});
