import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// Isolated HMR frames exercise the real Vite/React refresh runtime without editing
// source files or broadcasting a development update to anybody else's browser.
const browser=await chromium.launch({headless:true});
const base=process.env.IMAGE_EDITOR_TEST_URL||'http://127.0.0.1:5176';
const errors=[],checks=[];
async function fixture(legacy=false){
  const page=await browser.newPage({viewport:{width:1440,height:900}});let socket;
  const sent=[],logs=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>logs.push(message.text()));
  await page.routeWebSocket('**',ws=>{socket=ws;ws.onMessage(message=>{try{sent.push(JSON.parse(String(message)));}catch{}});ws.send(JSON.stringify({type:'connected'}));});
  await page.route(/\/apps\/web\/src\/apps\/image-editor\/(dialogs|tools|panels|menus)\.tsx(?:\?.*)?$/,async route=>{const response=await route.fetch(),url=new URL(route.request().url());let body=await response.text();body=body.replace(/(import \* as __vite_react_currentExports from )"[^"]+";/,'$1'+JSON.stringify(url.pathname+url.search)+';');if(legacy&&url.pathname.endsWith('/dialogs.tsx'))body+='\nconst legacyFilterNames = {"gaussian-blur":"Gaussian Blur"}; export {legacyFilterNames as filterNames};\n';await route.fulfill({response,body});});
  await page.goto(base+'/tests/image-editor/harness.html');const app=page.getByTestId('image-editor-app');await expect(app).toHaveAttribute('data-session-ready','true');
  const command=id=>page.evaluate(id=>window.__imageTest.commands.execute(id),id);
  await command('image.new-layer');await command('image.filter-gaussian-blur');const dialog=app.getByRole('dialog',{name:'Gaussian Blur',exact:true});await expect(dialog).toBeVisible();await dialog.getByLabel('Preview',{exact:true}).uncheck();await dialog.getByLabel('Radius',{exact:true}).fill('7');
  return {page,app,dialog,sent,logs,update:async name=>{const path='/apps/web/src/apps/image-editor/'+name;socket.send(JSON.stringify({type:'update',updates:[{type:'js-update',path,acceptedPath:path,timestamp:Date.now()}]}));await expect.poll(()=>logs.filter(line=>line.includes('[vite] hot updated: '+path)).length).toBeGreaterThan(0);await page.waitForTimeout(100);}};
}
try{
  const current=await fixture(),timeOrigin=await current.page.evaluate(()=>performance.timeOrigin),before=await current.app.getAttribute('data-document-revision');
  for(const name of ['dialogs.tsx','tools.tsx','panels.tsx','menus.tsx']){
    await current.update(name);await expect(current.dialog).toBeVisible();await expect(current.dialog.getByLabel('Radius',{exact:true})).toHaveValue('7');await expect(current.app).toHaveAttribute('data-document-revision',before);expect(current.sent.filter(event=>event.event==='vite:invalidate')).toEqual([]);checks.push(name+' accepts React Fast Refresh without invalidating the parent or closing/resetting the open dialog');
  }
  expect(await current.page.evaluate(()=>performance.timeOrigin)).toBe(timeOrigin);await current.dialog.getByRole('button',{name:'Cancel',exact:true}).click();await current.page.evaluate(()=>window.__imageTest.commands.execute('image.undo'));await expect(current.app).not.toHaveAttribute('data-document-revision',before);checks.push('No browser reload; document revision remains stable and Undo still executes after four component updates');await current.page.close();
  const legacy=await fixture(true);await legacy.update('dialogs.tsx');await expect.poll(()=>legacy.sent.filter(event=>event.event==='vite:invalidate').length).toBe(1);const invalidation=legacy.sent.find(event=>event.event==='vite:invalidate').data;expect(invalidation.message).toContain('"filterNames" export is incompatible');checks.push('Control reproduction: restoring the old filterNames object export triggers the actual Vite incompatible-export invalidation');await legacy.page.close();
  expect(errors).toEqual([]);const report={date:'2026-11-13',checks,errors,controlInvalidation:invalidation,limits:'Simulated HMR transport with the real Vite/React runtime, isolated from the shared server. Changes to component hook signatures still legitimately remount components; persistent editor sessions protect document/history state.'};await writeFile('docs/image-editor/hmr-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
