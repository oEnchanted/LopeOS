import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.IMAGE_EDITOR_TEST_URL||'http://127.0.0.1:5188',observe=process.env.AUDIT_OBSERVE==='1',output='docs/image-editor/release-audit/evidence';
await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));const app=page.getByTestId('image-editor-app');
const check=(id,expected,actual)=>{checks.push({id,expected,actual,status:JSON.stringify(expected)===JSON.stringify(actual)?'PASS':'FAIL'});if(!observe)expect(actual,id).toEqual(expected);};
const setColor=async value=>{await app.getByRole('button',{name:'Foreground color',exact:true}).click();const dialog=app.getByRole('dialog',{name:'Color Picker (Foreground Color)'});await dialog.getByLabel('Hex color').fill(value);await dialog.getByRole('button',{name:'OK',exact:true}).click();};
const foreground=()=>app.getByRole('button',{name:'Foreground color',exact:true}).evaluate(el=>el.style.backgroundColor);
try{
 await page.goto(base+(process.env.IMAGE_EDITOR_TEST_ENTRY||'/tests/image-editor/harness.html'));await expect(app).toHaveAttribute('data-session-ready','true',{timeout:30000});await setColor('00ff00');
 check('PS-UI-05-color-hue-reflects-selected-color','120',await app.getByLabel('Color hue',{exact:true}).inputValue());
 check('PS-UI-05-color-marker-reflects-selected-color',{left:'100%',top:'0%'},await app.locator('.ie-saturation>i').evaluate(el=>({left:el.style.left,top:el.style.top})));
 await app.locator('.ie-color-panel').screenshot({path:`${output}/ui-color-${observe?'before':'after'}.png`});
 await app.getByLabel('Color hue',{exact:true}).fill('240');check('PS-UI-06-hue-preserves-saturation-and-brightness','rgb(0, 0, 255)',await foreground());
 await setColor('00ff00');const saturation=app.getByRole('slider',{name:'Color saturation and brightness'});await saturation.focus();await saturation.press('ArrowLeft');check('PS-UI-07-saturation-keyboard-does-not-change-hue','rgb(3, 255, 3)',await foreground());
 if (!observe) {
   await app.getByRole('button',{name:'Background color',exact:true}).click();const picker=app.getByRole('dialog',{name:'Color Picker (Background Color)'});await picker.getByLabel('Hex color').fill('123456');await picker.getByRole('button',{name:'OK',exact:true}).click();
   check('PS-UI-08-background-chip-matches-state','rgb(18, 52, 86)',await app.locator('.ie-panel-color-chips>span').last().evaluate(el=>el.style.backgroundColor));
 }
 check('PS-UI-color-no-page-errors',[],errors);
}finally{await writeFile(`${output}/ui-color-${observe?'before':'after'}-results.json`,JSON.stringify({date:'2026-11-13',browser:browser.version(),base,entry:process.env.IMAGE_EDITOR_TEST_ENTRY||'/tests/image-editor/harness.html',viewport:{width:1440,height:900},dpr:1,checks,errors},null,2)+'\n');console.log(JSON.stringify(checks,null,2));await browser.close();}
