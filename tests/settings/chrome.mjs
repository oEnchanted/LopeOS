import { seedSession } from '../setup/seed-session.mjs';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":{"code":"UNAVAILABLE","message":"Visual verification"}}'}));await seedSession(page);await page.goto(process.env.LOPE_SETTINGS_URL||'http://127.0.0.1:4182');await page.locator('.welcome-main h1').waitFor();await page.getByRole('button',{name:'Close Welcome',exact:true}).click();
 const shot=async name=>{await page.mouse.move(2,45);await page.waitForTimeout(200);await page.screenshot({path:'docs/settings-revision/'+name+'.png'});};
 await shot('after-desktop-clear-1440');await page.getByRole('button',{name:'Quick settings',exact:true}).click();await shot('after-quick-controls');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'All applications',exact:true}).click();await page.getByRole('textbox',{name:'Search LopeOS',exact:true}).fill('settings');await shot('after-search');await page.keyboard.press('Escape');
 await page.getByRole('menuitem',{name:'LopeOS system menu',exact:true}).click();await shot('after-menu');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Open Settings',exact:true}).click();await page.getByTestId('settings-app').waitFor();await page.locator('.settings-nav nav').getByRole('button',{name:'Notifications & Focus',exact:true}).click();await page.getByRole('button',{name:'Send test alert',exact:true}).click();await page.getByRole('button',{name:'Notifications',exact:true}).click();await shot('after-notifications');
 console.log('Captured empty desktop, quick controls, search, menu, and notifications.');
}finally{await browser.close();}
