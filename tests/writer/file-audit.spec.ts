import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { writerFilesystem } from './runtime';
const { unzipSync, strFromU8 }=createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');
async function open(page:Page){const fs=await writerFilesystem(page);await page.addInitScript(()=>localStorage.setItem('test.writer.autosave','false'));await page.goto('/tests/writer/harness.html?path=/Documents/Review.docx');await expect(page.locator('.writer-opening')).toHaveCount(0,{timeout:30000});await expect(page.locator('.writer-title')).toContainText('Review.docx');return fs;}

test('opening another file freezes the old editing surface and document commands',async({page})=>{
 const fs=await open(page);const editor=page.getByRole('textbox',{name:'Document content',exact:true});
 await editor.click({position:{x:110,y:110}});
 const release=fs.holdNextRead();
 await page.evaluate(()=>{(window as any).openPath='/Documents/Fonts.docx';void (window as any).testCommands.execute('writer.open');});
 await expect(page.locator('.writer-engine-mount')).toHaveAttribute('inert','');
 await expect(page.getByRole('button',{name:'Bold',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
 await page.keyboard.type('This must not enter the old document.');
 expect(await page.locator('.writer-engine-mount [role="textbox"]').textContent()).not.toContain('This must not enter');
 await expect(page.locator('.writer-engine-mount [role="textbox"]')).toHaveAttribute('data-v2-source-coverage-revision','0');
 release();
 await expect(page.locator('.writer-title')).toContainText('Fonts.docx',{timeout:10000});
 await expect(page.locator('.writer-opening')).toHaveCount(0);
 await page.keyboard.type('New document input.');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(()=>strFromU8(unzipSync(fs.files.get('/Documents/Fonts.docx')!.data)['word/document.xml'])).toContain('New document input.');
 expect(strFromU8(unzipSync(fs.files.get('/Documents/Review.docx')!.data)['word/document.xml'])).not.toContain('This must not enter');
});

test('a failed open restores typing in the original document',async({page})=>{
 const fs=await open(page);await page.getByRole('textbox',{name:'Document content',exact:true}).click({position:{x:110,y:110}});
 fs.delayNextRead(600);
 await page.evaluate(()=>{(window as any).openPath='/Documents/Missing.docx';void (window as any).testCommands.execute('writer.open');});
 await expect(page.locator('.writer-opening')).toBeVisible();
 await expect(page.getByRole('alert')).toContainText('File not found');
 await expect(page.locator('.writer-opening')).toHaveCount(0);
 await page.keyboard.type('Typing after failed open.');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(()=>strFromU8(unzipSync(fs.files.get('/Documents/Review.docx')!.data)['word/document.xml'])).toContain('Typing after failed open.');
});
