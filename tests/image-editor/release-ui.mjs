import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.IMAGE_EDITOR_TEST_URL||'http://127.0.0.1:5188';
const observe=process.env.AUDIT_OBSERVE==='1';
const output='docs/image-editor/release-audit/evidence';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const results=[];const app=page.getByTestId('image-editor-app');
const command=async id=>{await page.evaluate(id=>window.__imageTest.commands.execute(id),id);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
const check=async(id,expected,actual)=>{results.push({id,expected,actual,status:JSON.stringify(expected)===JSON.stringify(actual)?'PASS':'FAIL'});if(!observe)expect(actual,id).toEqual(expected);};
try{
 await page.goto(base+(process.env.IMAGE_EDITOR_TEST_ENTRY||'/tests/image-editor/harness.html'));await expect(app).toHaveAttribute('data-session-ready','true',{timeout:30000});
 await command('image.new');const dialog=app.getByRole('dialog',{name:'New Document',exact:true});
 const width=dialog.getByLabel('Width',{exact:true});await width.fill('');await check('PS-UI-01-empty-numeric-draft','',await width.inputValue());
 await width.fill('96');await dialog.getByLabel('Height',{exact:true}).fill('64');await dialog.getByLabel('Document name').fill('UI audit');await dialog.getByLabel('Background contents').selectOption('transparent');await dialog.getByRole('button',{name:'Create',exact:true}).click();
 await command('image.transform-dialog');const transform=app.getByRole('dialog',{name:'Transform',exact:true});const x=transform.getByLabel('Horizontal',{exact:true});await x.fill('');await x.pressSequentially('-25',{delay:20});await check('PS-UI-02-negative-numeric-draft','-25',await x.inputValue());
 if (!observe) {
   await x.fill('');await x.pressSequentially('-0.25',{delay:20});await check('PS-UI-02-negative-decimal-draft','-0.25',await x.inputValue());
   await x.fill('');await x.press('Tab');await check('PS-UI-01-empty-draft-restores-last-valid-value','-0.25',await x.inputValue());
 }
 await transform.screenshot({path:`${output}/ui-numeric-${observe?'before':'after'}.png`});await transform.getByRole('button',{name:'Cancel',exact:true}).click();
 await app.getByRole('button',{name:'Brush Tool',exact:true}).click();await page.keyboard.press('Shift+B');await check('PS-UI-03-shortcut-selects-pencil','pencil',await app.getAttribute('data-tool'));
 await app.getByRole('button',{name:'Move Tool',exact:true}).click();await check('PS-UI-03-group-retains-last-tool',1,await app.getByRole('button',{name:'Pencil Tool',exact:true}).count());
 await app.screenshot({path:`${output}/ui-tool-group-${observe?'before':'after'}.png`});
 await command('image.save');const before=await page.evaluate(()=>new TextDecoder().decode(window.__imageTest.files.get(window.__imageTest.nextSave).data));
 // Start a real Move drag, deliver window focus loss, then return and release.
 await app.getByLabel('Canvas zoom percentage',{exact:true}).fill('400');
 await app.getByRole('button',{name:'Move Tool',exact:true}).click();const box=await page.getByTestId('image-composite').boundingBox();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.45,box.y+box.height*.4,{steps:4});
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.move(box.x+box.width*.55,box.y+box.height*.4,{steps:2});await page.mouse.up();await command('image.save');
 const after=await page.evaluate(()=>new TextDecoder().decode(window.__imageTest.files.get(window.__imageTest.nextSave).data));
 await check('PS-UI-04-focus-loss-cancels-move',true,before===after);
 await app.screenshot({path:`${output}/ui-cancelled-stroke-${observe?'before':'after'}.png`});
 if (!observe) {
   await app.getByRole('button',{name:'Pencil Tool',exact:true}).click();
   await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.3,{steps:3});await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();await command('image.save');
   await check('PS-UI-04-focus-loss-cancels-paint',true,before===await page.evaluate(()=>new TextDecoder().decode(window.__imageTest.files.get(window.__imageTest.nextSave).data)));
 }

 await check('PS-UI-no-page-errors',[],errors);
}finally{
 await writeFile(`${output}/ui-${observe?'before':'after'}-results.json`,JSON.stringify({date:'2026-11-13',browser:browser.version(),base,entry:process.env.IMAGE_EDITOR_TEST_ENTRY||'/tests/image-editor/harness.html',viewport:{width:1440,height:900},dpr:1,checks:results,errors},null,2)+'\n');
 console.log(JSON.stringify(results,null,2));await browser.close();
}
