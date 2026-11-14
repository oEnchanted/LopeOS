// Independent reviewer run of unchanged handoff assertions, adapted to compiled production library.
import {chromium,expect} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
const build=JSON.parse(await readFile('docs/image-editor/release-audit/build-manifest.json','utf8'));
const errors=[],failedRequests=[],externalRequests=[];
const browser=await chromium.launch({headless:true}),checks=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5189')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))externalRequests.push({url:r.url(),method:r.method()});});await page.goto('http://127.0.0.1:5189/tests/image-editor/release-handoff.html',{waitUntil:'domcontentloaded'});
  const photo=page.getByTestId('photo-studio');await photo.getByRole('button',{name:'Add sample photos'}).click();const dialog=page.getByRole('dialog',{name:'Add photos',exact:true});await expect(dialog.getByRole('button',{name:'Add 4 photos',exact:true})).toBeEnabled({timeout:30000});await dialog.getByRole('button',{name:'Add 4 photos',exact:true}).click();await expect(photo.getByTestId('photo-canvas')).toBeVisible({timeout:30000});
  await photo.getByLabel('Exposure value',{exact:true}).fill('.5');await photo.getByRole('heading',{name:'Edit',exact:true}).click();await expect(photo.getByText('Saved locally',{exact:true})).toBeVisible();
  const before=await page.evaluate(async()=>{const {loadLibrary}=window.__release.library;return (await loadLibrary()).assets.find(a=>a.recipe.values.exposure===.5);});
  await page.evaluate(()=>window.__handoff.commands.execute('photo.edit-in'));
  await expect(page.getByTestId('image-editor-app')).toBeVisible({timeout:30000});
  await expect(page.getByTestId('image-composite')).toBeVisible({timeout:30000});
  await expect.poll(()=>page.evaluate(()=>{const c=window.__handoff.commands.get('image.save');return typeof c?.enabled==='function'?c.enabled():c?.enabled!==false;}),{timeout:30000}).toBe(true);
  checks.push('A native layered project is written through the shared file service and opened by the real Image Editor');
  await page.evaluate(()=>window.__handoff.commands.execute('image.new-layer'));await page.evaluate(()=>window.__handoff.commands.execute('image.fill'));await page.evaluate(()=>window.__handoff.commands.execute('image.save'));
  console.log(await page.evaluate(()=>({files:[...window.__handoff.files].map(([path,f])=>({path,size:f.data.length,version:f.version})),photoError:document.querySelector('.ps-error')?.textContent,imageError:document.querySelector('.ie-error')?.textContent})));
  await expect.poll(()=>page.evaluate(async()=>{const {loadLibrary}=window.__release.library;return (await loadLibrary()).assets.length;}),{timeout:30000}).toBe(5);
  const returned=await page.evaluate(async id=>{const {loadLibrary,hashBlob,originalBlob}=window.__release.library;const state=await loadLibrary(),source=state.assets.find(a=>a.id===id),child=state.assets.find(a=>a.parentId===id);return {source:{hash:source.hash,actual:await hashBlob(await originalBlob(source.id)),exposure:source.recipe.values.exposure},child:{name:child.name,format:child.metadata.format,parentId:child.parentId,depth:child.metadata.bitDepth,hash:child.hash,actual:await hashBlob(await originalBlob(child.id))}};},before.id);
  expect(returned.source.hash).toBe(before.hash);expect(returned.source.actual).toBe(before.hash);expect(returned.source.exposure).toBe(.5);expect(returned.child.format).toBe('lopeimage');expect(returned.child.depth).toBe(8);expect(returned.child.hash).toBe(returned.child.actual);expect(returned.child.parentId).toBe(before.id);
  checks.push('Saving Image Editor changes creates a separate returned derivative with its source relationship and immutable native-project snapshot');checks.push('Original photo checksum and nondestructive recipe remain unchanged through the round trip');
  await page.getByRole('button',{name:'Return to Lightroom',exact:true}).click();await expect(photo.getByRole('button',{name:'Select '+returned.child.name,exact:true})).toBeVisible();await photo.getByRole('button',{name:'Select '+returned.child.name,exact:true}).click();await expect(photo.getByTestId('photo-canvas')).toBeVisible({timeout:30000});
  await photo.screenshot({path:'docs/image-editor/release-audit/evidence/engine-handoff-returned.png'});
  expect(errors).toEqual([]);expect(failedRequests).toEqual([]);expect(externalRequests).toEqual([]);expect(JSON.parse(await readFile('docs/image-editor/release-audit/build-manifest.json','utf8')).buildId).toBe(build.buildId);
  await writeFile('docs/image-editor/release-audit/evidence/engine-handoff.json',JSON.stringify({result:'PASS',buildId:build.buildId,commit:build.commit,scope:'Independent production bundle execution using isolated SDK filesystem; native/runtime permissions and LopeOS menu focus are not tested by this harness.',errors,failedRequests,externalRequests,date:'2026-11-13',browser:browser.version(),interchange:'Lope Image native JSON v1, RGB/8; high-bit-depth interchange unavailable in Image Editor',checks,returned},null,2));console.log(JSON.stringify({checks,returned},null,2));
}finally{await browser.close();}
