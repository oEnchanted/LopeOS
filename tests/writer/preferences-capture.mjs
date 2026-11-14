import { preferencesName } from './labels.ts';
import { chromium, expect } from '@playwright/test';
import { writerFilesystem } from './runtime.ts';
const base=process.env.WRITER_TEST_URL || 'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await writerFilesystem(page);
 await page.addInitScript(()=>localStorage.setItem('test.writer.autosave','false'));
 await page.goto(`${base}/tests/writer/harness.html?path=/Documents/Review.docx`);
 await expect(page.locator('.writer-opening')).toHaveCount(0,{timeout:30000});
 await page.evaluate(()=>window.testSystemPreferences.set('theme','dark'));
 await page.getByRole('button',{name:'Preferences',exact:true}).click();
 const modal=page.getByRole('dialog',{name:preferencesName,exact:true});
 const settle=async()=>modal.evaluate(node=>Promise.all(node.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))));
 await expect(modal).toBeVisible();await settle();
 await page.screenshot({path:'docs/writer/screenshots/preferences-home.png'});await page.screenshot({path:'docs/writer/screenshots/preferences-home-dark.png'});
 for(const title of ['General','View','Edit','Spelling & Grammar','AutoCorrect','Accessibility','East Asian Languages','Save','Print','Track Changes','User Information','Security','File Locations','Privacy','Show Your Pride']){
  await modal.getByRole('button',{name:title,exact:true}).click();
  await expect(modal.locator('h1')).toHaveText(title);await settle();
  await page.screenshot({path:`docs/writer/screenshots/preferences-${title.toLowerCase().replace(/[^a-z]+/g,'-')}.png`});
  await modal.getByRole('button',{name:'Show all preferences',exact:true}).click();
 }
 await page.evaluate(()=>window.testSystemPreferences.set('theme','light'));await expect(modal).toHaveAttribute('data-appearance','light');await settle();await page.screenshot({path:'docs/writer/screenshots/preferences-home-light.png'});await modal.getByRole('button',{name:'General',exact:true}).click();await settle();await page.screenshot({path:'docs/writer/screenshots/preferences-general-light.png'});await modal.getByRole('button',{name:'Show all preferences',exact:true}).click();
 await page.setViewportSize({width:700,height:700});await settle();
 await page.screenshot({path:'docs/writer/screenshots/preferences-narrow.png'});
 await page.setViewportSize({width:1366,height:900});
 await modal.getByRole('button',{name:'General',exact:true}).click();
 await page.evaluate(()=>{window.testSystemPreferences.set('textSize',150);window.testSystemPreferences.set('increaseContrast',true);});
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>window.testSystemPreferences.set('theme',theme),theme);
  await expect(modal).toHaveAttribute('data-appearance',theme);await settle();
  await page.screenshot({path:`docs/writer/screenshots/preferences-${theme}-text150-contrast.png`});
 }
 console.log(JSON.stringify({errors,categories:16,viewport:'1366x900',narrow:'700x700',osTextSize:150,increasedContrast:true}));
 expect(errors).toEqual([]);
} finally {await browser.close();}
