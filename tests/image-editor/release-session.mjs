import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const base = process.env.IMAGE_EDITOR_TEST_URL || 'http://127.0.0.1:5187';
const evidence = 'docs/image-editor/release-audit/evidence';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const build=JSON.parse(await readFile('docs/image-editor/release-audit/build-manifest.json','utf8'));
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const app = page.getByTestId('image-editor-app');
const command = async id => { await page.evaluate(id => window.__imageTest.commands.execute(id), id); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
const current = () => page.evaluate(() => { const s=window.__release.session.residentSession('image-test'); const d=s.sessions.find(t=>t.history.current.id===s.activeId).history.current; return { name:d.name,width:d.width,height:d.height,selection:d.selection ? [...d.selection] : null }; });
const enabled = id => page.evaluate(id => { const c=window.__imageTest.commands.get(id); return typeof c.enabled==='function' ? c.enabled() : c.enabled!==false; }, id);
try {
  await page.goto(base+'/tests/image-editor/release.html');
  await expect(app).toHaveAttribute('data-session-ready','true');
  await command('image.close');
  for (const [name,width,height] of [['Selection A',8,6],['Selection B',4,3]]) {
    await page.evaluate(({name,width,height}) => {
      const e=window.__release.engine,t=window.__imageTest,d=e.newDocument(width,height,name+'.lopeimage',[10,20,30,255]);
      t.nextOpen='/Fixtures/'+d.name;t.files.set(t.nextOpen,{data:new TextEncoder().encode(e.serializeDocument(d)),version:'original'});
    }, {name,width,height});
    await command('image.open');
    if(name==='Selection A') { await command('image.select-all'); await command('image.deselect'); }
  }
  expect(await enabled('image.reselect'), 'An untouched document must not inherit another tab’s selection').toBe(false);
  checks.push('PS-R01: Reselect remains unavailable in a different, untouched document');
  await command('image.select-all');await command('image.deselect');await command('image.reselect');
  expect((await current()).selection).toEqual(Array(12).fill(255));
  await app.getByRole('tab',{name:/Selection A/}).click();await command('image.reselect');
  expect((await current()).selection).toEqual(Array(48).fill(255));
  checks.push('PS-R01: Each tab restores its own selection with valid dimensions');
  await command('image.deselect');
  await page.evaluate(()=>window.__release.session.sessionJournal('image-test').flush());
  await page.reload();await expect(app).toHaveAttribute('data-session-ready','true');
  expect(await enabled('image.reselect')).toBe(true);await command('image.reselect');
  expect((await current()).selection).toEqual(Array(48).fill(255));
  checks.push('PS-R01: Per-document Reselect survives session recovery');
  const menu=app.getByRole('menubar');const file=menu.getByRole('menuitem',{name:'File',exact:true});
  await file.focus();await page.keyboard.press('ArrowDown');
  await expect(app.getByRole('menuitem',{name:'New…',exact:false}).first()).toBeFocused();
  const toolBeforeMenu=await app.getAttribute('data-tool');await page.keyboard.press('b');expect(await app.getAttribute('data-tool')).toBe(toolBeforeMenu);
  await page.keyboard.press('Escape');await expect(file).toBeFocused();
  checks.push('PS-R02: Escape returns internal menu focus to its trigger');
  await page.keyboard.press('ArrowRight');await expect(menu.getByRole('menuitem',{name:'Edit',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('End');
  await expect(app.getByRole('menuitem',{name:'Preferences',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowRight');await expect(app.getByRole('menuitem',{name:'Reset Essentials',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(app.getByRole('menuitem',{name:'Preferences',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(menu.getByRole('menuitem',{name:'Edit',exact:true})).toBeFocused();
  checks.push('PS-R02: Arrow navigation, End and nested Escape keep focus in the correct menu');
  await page.screenshot({path:evidence+'/session-menus-after.png'});
  expect(errors).toEqual([]);
} catch (error) {
  await page.screenshot({path:evidence+'/session-menus-failure.png'});
  await writeFile(evidence+'/session-menus-result.json',JSON.stringify({result:'FAIL',checks,errors,error:String(error)},null,2));throw error;
} finally {
  if(checks.length===5) await writeFile(evidence+'/session-menus-result.json',JSON.stringify({result:'PASS',buildId:build.buildId,base,browser:browser.version(),checks,errors},null,2));
  await browser.close();
}
