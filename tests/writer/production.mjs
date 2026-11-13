import { seedSession } from '../setup/seed-session.mjs';
/** Production-bundle smoke, with the same test-only filesystem contract. */
import {chromium,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {writerFilesystem} from './runtime.ts';
const {unzipSync,strFromU8}=createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const files=await writerFilesystem(page);
 await page.addInitScript(()=>{localStorage.setItem('lope.layout.v1',JSON.stringify([{id:'writer-production',appId:'lope.writer',title:'Writer',state:'normal',bounds:{x:36,y:42,width:1366,height:840},zIndex:1,launchArgs:{}}]));localStorage.setItem('lope.writer.autosave','false');});
 await seedSession(page);await page.goto(process.env.WRITER_PREVIEW_URL||'http://127.0.0.1:5177/');
 const app=page.locator('[data-app-id="lope.writer"]');
 await expect(app.locator('.writer-opening')).toHaveCount(0,{timeout:40000});
 await app.getByRole('textbox',{name:'Document content',exact:true}).click({position:{x:110,y:110}});
 await page.keyboard.type('Production bundle edit.');await page.keyboard.press('ControlOrMeta+a');
 await app.getByRole('button',{name:'Bold',exact:true}).click();
 await app.getByRole('button',{name:'Save',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Save file',exact:true});await expect(dialog).toBeVisible();
 // The SDK now starts in browser-backed LopeDrive. Choose the workspace root
 // to exercise this smoke's production runtime transport against the mock FS.
 await dialog.getByRole('button',{name:'Parent folder',exact:true}).click();
 await expect(dialog.locator('.dialog-path span')).toHaveText('Workspace');
 const folder=(await dialog.locator('.dialog-path span').innerText()).replace(/^Workspace/,'').replace(/\/$/,'');
 const savedPath=`${folder}/${await dialog.getByLabel('File name',{exact:true}).inputValue()}`;
 await dialog.getByRole('button',{name:'Save',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect.poll(()=>[...files.files.keys()]).toContain(savedPath);
 await expect(app.locator('.writer-title')).toContainText('Document1.docx');
 await expect(app.locator('.writer-title')).toContainText('Saved');
 const bytes=files.files.get(savedPath)?.data;expect(bytes).toBeTruthy();
 const xml=strFromU8(unzipSync(bytes)['word/document.xml']);expect(xml).toContain('Production bundle edit.');expect(xml).toMatch(/<w:b\b/);
 await app.getByRole('button',{name:'Preferences',exact:true}).click();
 const preferences=app.getByRole('dialog',{name:'Writer Preferences',exact:true});await expect(preferences).toBeVisible();
 await expect(preferences).toHaveAttribute('data-appearance','light');
 await page.locator('.menubar').getByRole('menuitem',{name:'View',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:/^Dark appearance/}).click();
 await expect(preferences).toHaveAttribute('data-appearance','dark');
 await page.screenshot({path:'docs/writer/screenshots/production-preferences-dark.png'});
 await page.locator('.menubar').getByRole('menuitem',{name:'View',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:/^Dark appearance/}).click();
 await expect(preferences).toHaveAttribute('data-appearance','light');
 await page.screenshot({path:'docs/writer/screenshots/production-preferences-light.png'});
 await preferences.getByRole('button',{name:'Close Preferences',exact:true}).click();await expect(preferences).toHaveCount(0);
 await expect(app.locator('.writer-title')).toContainText('Document1.docx');
 expect(errors).toEqual([]);
 await page.screenshot({path:'docs/writer/screenshots/production.png'});
 await writeFile('docs/writer/production-verification.json',JSON.stringify({date:'2026-11-13',passed:true,checks:['Production shell loads lazy Writer and engine worker','Native text input and bold formatting','SDK Save dialog and binary save acknowledged','Saved OOXML text and bold run','Preferences opens from the app and follows live system Light/Dark changes','Closing Preferences retains the saved document','No browser page errors'],errors},null,2)+'\n');
 console.log('Production Writer load/edit/format/SDK-save passed.');
} finally {await browser.close();}
