import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { writerFilesystem } from './runtime';
const {unzipSync,strFromU8}=createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');

test('Paragraph supports right indentation without resetting left indentation',async({page})=>{
 const fs=await writerFilesystem(page);await page.addInitScript(()=>localStorage.setItem('test.writer.autosave','false'));
 await page.goto('/tests/writer/harness.html');await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled({timeout:30000});
 await page.getByRole('textbox',{name:'Document content',exact:true}).click({position:{x:110,y:110}});await page.keyboard.type('Paragraph indents.');await page.keyboard.press('ControlOrMeta+a');
 await page.getByRole('button',{name:'Paragraph dialog launcher',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Paragraph',exact:true});
 await dialog.getByLabel('Left (inches):',{exact:true}).fill('0.25');await dialog.getByLabel('Right (inches):',{exact:true}).fill('0.5');
 await dialog.getByRole('button',{name:'OK',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.evaluate(()=>{(window as any).savePath='/Documents/Indents.docx';});await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.locator('.writer-title')).toContainText('Indents.docx');
 const xml=strFromU8(unzipSync(fs.files.get('/Documents/Indents.docx')!.data)['word/document.xml']);
 expect(xml).toMatch(/w:left="360"/);expect(xml).toMatch(/w:right="720"/);
});

test('formatting dialogs cannot apply changes while Viewing',async({page})=>{
 await writerFilesystem(page);await page.goto('/tests/writer/harness.html?path=/Documents/Review.docx');await expect(page.locator('.writer-opening')).toHaveCount(0,{timeout:30000});
 await page.getByRole('button',{name:'Read mode',exact:true}).click();
 await page.evaluate(()=> (window as any).testCommands.execute('writer.font'));
 const dialog=page.getByRole('dialog',{name:'Font',exact:true});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:/^(OK|Loading…)$/,exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.locator('.writer-title')).toContainText('Saved');
});

for (const kind of ['Paste','Symbol'] as const) test(`${kind} places continued typing after the inserted content`,async({page})=>{
 const fs=await writerFilesystem(page);
 await page.addInitScript(()=>{
  localStorage.setItem('test.writer.autosave','false');
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=> 'PASTED'}});
 });
 await page.goto('/tests/writer/harness.html');await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled({timeout:30000});
 await page.getByRole('textbox',{name:'Document content',exact:true}).click({position:{x:110,y:110}});
 await page.keyboard.type('Before After');await page.keyboard.press('ControlOrMeta+a');await page.keyboard.press('ArrowLeft');
 for(let i=0;i<7;i++)await page.keyboard.press('ArrowRight');
 if(kind==='Paste') await page.getByRole('button',{name:'Paste',exact:true}).click();
 else {
  await page.getByRole('tab',{name:'Insert',exact:true}).click();await page.getByRole('button',{name:'Symbol',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Symbol',exact:true});await dialog.getByLabel('Selected symbol:',{exact:true}).fill('Ω');
  await dialog.getByRole('button',{name:'Insert',exact:true}).click();await expect(dialog).toHaveCount(0);
 }
 await page.keyboard.type('X');await page.evaluate(kind=>{(window as any).savePath=`/Documents/${kind}.docx`;},kind);
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>fs.files.has(`/Documents/${kind}.docx`)).toBe(true);
 const xml=strFromU8(unzipSync(fs.files.get(`/Documents/${kind}.docx`)!.data)['word/document.xml']);
 expect(xml.replace(/<[^>]*>/g,'')).toContain(`Before ${kind==='Paste'?'PASTED':'Ω'}XAfter`);
});

test('Ribbon Copy and Cut transfer the complete long selection and Cut retains native undo',async({page})=>{
 const fs=await writerFilesystem(page);
 await page.addInitScript(()=>{
  localStorage.setItem('test.writer.autosave','false');(window as any).copiedText='';
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as any).copiedText=value;}}});
 });
 await page.goto('/tests/writer/harness.html');await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled({timeout:30000});
 await page.getByRole('textbox',{name:'Document content',exact:true}).click({position:{x:110,y:110}});
 const passage='Complete selection. '.repeat(360);
 await page.keyboard.insertText(passage);await page.keyboard.press('ControlOrMeta+a');
 await page.getByRole('button',{name:'Copy',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).copiedText)).toBe(passage);
 await page.getByRole('button',{name:'Cut',exact:true}).click();
 await expect.poll(()=>page.locator('.writer-engine-mount [role="textbox"]').textContent()).not.toContain('Complete selection.');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.evaluate(()=>{(window as any).savePath='/Documents/Clipboard.docx';});await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(()=>fs.files.has('/Documents/Clipboard.docx')).toBe(true);
 expect(strFromU8(unzipSync(fs.files.get('/Documents/Clipboard.docx')!.data)['word/document.xml']).replace(/<[^>]*>/g,'')).toContain(passage);
});
