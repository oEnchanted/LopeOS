import { seedSession } from '../setup/seed-session.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({headless:true});
const errors=[]; const checks=[]; const metrics={};
await mkdir('docs/screenshots',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(error.message));
  await seedSession(page);await page.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.welcome-main h1')).toBeVisible();
  await page.screenshot({path:'docs/screenshots/desktop-1440.png'});
  checks.push('Initial desktop renders without JavaScript errors');
  const welcome=page.locator('[data-app-id="lope.welcome"]');
  const before=await welcome.boundingBox();
  await page.evaluate(()=>{window.__frames=[];window.__measure=true;let previous=performance.now();const tick=now=>{if(!window.__measure)return;window.__frames.push(now-previous);previous=now;requestAnimationFrame(tick)};requestAnimationFrame(tick)});
  await page.mouse.move(before.x+before.width/2,before.y+22);await page.mouse.down();
  for(let i=1;i<=60;i++){await page.mouse.move(before.x+before.width/2+i*1.5,before.y+22+i*.7);await page.waitForTimeout(16);}
  await page.mouse.up();
  const after=await welcome.boundingBox();
  expect(after.x-before.x).toBeGreaterThan(50); expect(after.y-before.y).toBeGreaterThan(20);
  metrics.drag=await page.evaluate(()=>{window.__measure=false;const values=window.__frames.filter(n=>n>0).sort((a,b)=>a-b);return {samples:values.length,medianMs:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)],over33ms:values.filter(v=>v>33.4).length}});
  checks.push('Pointer dragging changes window bounds');
  await page.getByRole('button',{name:'Minimize Welcome',exact:true}).click();await expect(welcome).toBeHidden();
  await page.getByRole('button',{name:'Open Welcome',exact:true}).click();await expect(welcome).toBeVisible();
  await page.getByRole('menuitem',{name:'Window',exact:true}).click();await page.getByRole('menuitem',{name:'Maximize',exact:true}).click();expect((await welcome.boundingBox()).width).toBeGreaterThan(1400);
  await page.getByRole('menuitem',{name:'Window',exact:true}).click();await page.getByRole('menuitem',{name:'Restore window',exact:true}).click();
  checks.push('Minimize, Dock restore, maximize and restore');
  await page.keyboard.press('Control+k');await page.keyboard.press('Control+1');await page.getByRole('textbox',{name:'Search LopeOS',exact:true}).fill('calculator');await page.keyboard.press('Enter');
  const calculator=page.getByTestId('calculator-app');await expect(calculator).toBeVisible();
  for(const key of ['7','Add','5','Equals'])await calculator.getByRole('button',{name:key,exact:true}).click();
  await expect(calculator.getByLabel('Expression',{exact:true})).toHaveValue('12');
  checks.push('Application search launches a functioning Calculator');
  await page.getByRole('button',{name:'Open Settings',exact:true}).click();
  const settings=page.getByTestId('settings-app');await expect(settings).toBeVisible();
  await settings.getByRole('button',{name:'Dark',exact:true}).click();await expect(page.locator('.desktop')).toHaveAttribute('data-theme','dark');
  await settings.getByRole('button',{name:'Accessibility',exact:true}).click();
  await settings.getByRole('switch',{name:'Reduce transparency',exact:true}).click();await expect(page.locator('.desktop')).toHaveAttribute('data-reduce-transparency','true');
  await settings.getByRole('button',{name:'Wallpaper',exact:true}).click();
  await settings.getByRole('button',{name:'After hours',exact:true}).click();
  await expect(page.locator('.wallpaper')).toHaveClass(/wallpaper--night/);
  await page.keyboard.press('Alt+F10');await expect(page.getByRole('menu',{name:'LopeOS',exact:true})).toBeVisible();await expect(page.getByRole('menuitem',{name:'About LopeOS',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');expect(await page.evaluate(()=>document.activeElement.textContent)).toContain('System Settings');
  await page.screenshot({path:'docs/screenshots/desktop-dark-menus.png'});await page.keyboard.press('Escape');
  checks.push('Settings update dark appearance, transparency, wallpaper; keyboard menu navigation');
  await page.getByRole('button',{name:'Open Text Editor',exact:true}).click();
  await page.getByLabel('Document content',{exact:true}).fill('An unsaved idea.');
  await page.keyboard.press('Control+w');
  const guard=page.getByRole('dialog',{name:'Save your changes?'});await expect(guard).toBeVisible();
  await guard.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByLabel('Document content')).toHaveValue('An unsaved idea.');
  await page.keyboard.press('Control+w');await page.getByRole('dialog',{name:'Save your changes?'}).getByRole('button',{name:'Discard changes',exact:true}).click();await expect(page.locator('[data-app-id="lope.editor"]')).toHaveCount(0);
  checks.push('Editor before-close dialog preserves or discards unsaved changes');
  await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByTestId('settings-app')).toBeVisible();await expect(page.locator('.desktop')).toHaveAttribute('data-theme','dark');
  checks.push('Layout and preferences survive reload');
  await page.evaluate(()=>{window.__frames=[];window.__measure=true;let previous=performance.now();const tick=now=>{if(!window.__measure)return;window.__frames.push(now-previous);previous=now;requestAnimationFrame(tick)};requestAnimationFrame(tick)});
  for(const button of await page.locator('.dock-item').all()){await button.hover();await page.waitForTimeout(100);}
  metrics.dock=await page.evaluate(()=>{window.__measure=false;const values=window.__frames.filter(n=>n>0).sort((a,b)=>a-b);return {samples:values.length,medianMs:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)],over33ms:values.filter(v=>v>33.4).length}});
  await page.close();
  for(const [width,height] of [[1920,1080],[390,844]]){
    const p=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});p.on('pageerror',e=>errors.push(e.message));
    await seedSession(p);await p.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});await expect(p.locator('.welcome-main h1')).toBeVisible();
    expect(await p.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await p.screenshot({path:`docs/screenshots/desktop-${width}.png`});
    if(width<700){await p.getByRole('button',{name:'All applications',exact:true}).click();await expect(p.getByRole('dialog',{name:'Find applications'})).toBeVisible();await p.keyboard.press('Escape');}
    await p.close();checks.push(`${width}×${height} viewport inspected without document overflow`);
  }
  expect(errors).toEqual([]);
  await writeFile('docs/screenshots/verification.json',JSON.stringify({conditions:'Chromium headless, macOS arm64, device scale 1; foreground page, 1440×900; animation frame intervals during automated mouse input. Not a physical-display GPU benchmark.',checks,metrics,errors},null,2)+'\n');
  console.log(JSON.stringify({checks,metrics,errors},null,2));
} finally {await browser.close();}
