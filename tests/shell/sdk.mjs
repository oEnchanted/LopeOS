import { seedSession } from '../setup/seed-session.mjs';
import { chromium, expect } from '@playwright/test';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await seedSession(page);await page.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'All applications',exact:true}).click();await page.getByPlaceholder('A thought away. Find an app…').fill('Example Notes');await page.keyboard.press('Enter');
 const example=page.locator('[data-app-id="example.notes"]');await expect(example).toBeVisible();await example.getByLabel('A quick note').fill('From a manifest.');
 await page.getByRole('menuitem',{name:'Edit',exact:true}).click();await page.getByRole('menuitem',{name:'Clear Draft',exact:true}).click();await expect(example.getByLabel('A quick note')).toHaveValue('');
 await page.getByRole('button',{name:'Close Example Notes',exact:true}).click();
 await page.getByRole('button',{name:'Open Text Editor',exact:true}).click();await page.locator('.is-focused').getByLabel('Document content').fill('First document');
 await page.getByRole('menuitem',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:/^New window/}).click();await expect(page.locator('[data-app-id="lope.editor"]')).toHaveCount(2);
 await page.locator('.is-focused').getByLabel('Document content').fill('Second document');
 await page.keyboard.press('Control+w');await page.getByRole('dialog',{name:'Save your changes?'}).getByRole('button',{name:'Discard changes',exact:true}).click();
 await expect(page.locator('[data-app-id="lope.editor"]')).toHaveCount(1);await expect(page.getByLabel('Document content')).toHaveValue('First document');
 const before=await page.locator('.is-focused').boundingBox();await page.locator('.is-focused .window-titlebar').click();await page.keyboard.press('Alt+ArrowRight');const after=await page.locator('.is-focused').boundingBox();expect(after.x).toBeGreaterThan(before.x);
 expect(errors).toEqual([]);console.log('Passed: manifest-only extension launch and menus, independent editor close guards, keyboard window movement.');
} finally{await browser.close();}
