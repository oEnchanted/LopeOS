import {chromium,expect} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
import {seedSession} from '../setup/seed-session.mjs';
const base=process.env.IMAGE_EDITOR_TEST_URL||'http://127.0.0.1:5189',out='docs/image-editor/release-audit/evidence';
const build=JSON.parse(await readFile('docs/image-editor/release-audit/build-manifest.json','utf8'));
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],failedRequests=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));let result='FAIL',failure;
try{
 await seedSession(page);await page.goto(base+'/');await expect(page.locator('.desktop')).toBeVisible({timeout:30000});await page.keyboard.press('Control+k');const search=page.getByRole('dialog',{name:'Find applications'});await search.getByRole('button',{name:'Applications',exact:true}).click();await search.getByRole('textbox').fill('Prism');await expect(search.getByRole('option').first()).toContainText('Prism');await page.keyboard.press('Enter');const app=page.getByTestId('image-editor-app');await expect(app).toHaveAttribute('data-session-ready','true',{timeout:30000});await expect(app.getByTestId('image-composite')).toBeVisible();checks.push('Prism launches from production shell application search and renders worker-backed canvas');
 const count=await app.locator('[data-layer-id]').count();await app.getByTestId('image-canvas-area').focus();await page.keyboard.press('Control+Shift+n');await expect(app.locator('[data-layer-id]')).toHaveCount(count+1);await page.keyboard.press('Control+z');await expect(app.locator('[data-layer-id]')).toHaveCount(count);checks.push('Active shell command shortcuts create and undo a layer');
 await page.screenshot({path:out+'/production-shell.png'});expect(errors).toEqual([]);result='PASS';
}catch(error){failure=String(error);await page.screenshot({path:out+'/production-shell-failure.png'});console.error(failure);}finally{await writeFile(out+'/production-shell.json',JSON.stringify({result,failure,buildId:build.buildId,browser:browser.version(),checks,errors,failedRequests,scope:'Actual compiled shell; local disposable account. Backend runtime and native file permissions excluded.'},null,2)+'\n');await browser.close();}
if(result!=='PASS')process.exitCode=1;
