import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.LOPE_PHOTO_BASE || 'http://127.0.0.1:5191';
const phase = process.env.AUDIT_PHASE || 'after';
const evidence = 'docs/lightroom/release-audit/evidence';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${base}/tests/lightroom/handoff.html`);
  const results = await page.evaluate(async () => {
    const lib = await import('/apps/web/src/apps/lightroom/library.ts');
    const { defaultRecipe } = await import('/packages/photo-engine/src/model.ts');
    const { zipStore, restoreBackup } = await import('/apps/web/src/apps/lightroom/backup.ts');
    const blob = new Blob(['Permission-cleared procedural original.']);
    const hash = await lib.hashBlob(blob);
    const asset = id => ({ id, name: `${id}.jpg`, hash, imported: '2026-11-13T00:00:00Z', size: blob.size,
      metadata: {width: 1,height: 1,bitDepth: 8,format:'jpeg',decoder:'Storage fixture only',colorSpace:'sRGB',orientation:1,warnings:[],raw:false},
      thumbnail:new Blob(['thumbnail']),recipe:defaultRecipe(),history:[],future:[],rating:0,flag:'none',label:'',keywords:[],albumIds:[],order:0,versions:[],storage:'managed' });
    const reset = async () => {
      const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('lope.photo-library.v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try { await new Promise((resolve,reject)=>{const tx=db.transaction(['assets','originals','albums','jobs'],'readwrite');for(const name of ['assets','originals','albums','jobs'])tx.objectStore(name).clear();tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);}); } finally {db.close();}
    };
    const backup = async (assets, albums=[]) => {
      const originals = new Map(assets.map(a=>[a.id,a]));
      return zipStore([
        {name:'library.json',bytes:new TextEncoder().encode(JSON.stringify({format:'lope-photo-library',version:1,albums,assets:assets.map(a=>({...a,thumbnail:undefined,originalFile:`originals/${a.id}`,thumbnailFile:`thumbnails/${a.id}.jpg`}))}))},
        ...await Promise.all([...originals.values()].flatMap(a=>[
          blob.arrayBuffer().then(bytes=>({name:`originals/${a.id}`,bytes:new Uint8Array(bytes)})),
          a.thumbnail.arrayBuffer().then(bytes=>({name:`thumbnails/${a.id}.jpg`,bytes:new Uint8Array(bytes)}))
        ]))
      ]);
    };
    const results=[];
    const run=async(id,action)=>{await reset();try{const result=await action();results.push({id,...result});}catch(error){results.push({id,passed:false,unexpectedError:String(error)});}};
    await lib.loadLibrary();
    await run('LR-DATA-001',async()=>{
      const a=asset('batch-a'),b=asset('batch-b');await lib.addAsset(a,blob);await lib.addAsset(b,blob);
      b.recipe.values.exposure=99;let rejection;try{await lib.saveAssets([{...a,rating:5},b]);}catch(error){rejection=String(error);}
      const {assets}=await lib.loadLibrary();return {passed:!!rejection&&assets.every(a=>a.rating===0),rejection,ratings:assets.map(a=>({id:a.id,rating:a.rating}))};
    });
    await run('LR-DATA-002',async()=>{
      const a=asset('clone-a'),b=asset('clone-b');await lib.addAsset(a,blob);await lib.addAsset(b,blob);
      let rejection;try{await lib.saveAssets([{...a,rating:4},{...b,uncloneable:()=>{}}]);}catch(error){rejection=String(error);}
      const {assets}=await lib.loadLibrary();return {passed:!!rejection&&assets.every(a=>a.rating===0),rejection,ratings:assets.map(a=>({id:a.id,rating:a.rating}))};
    });
    await run('LR-DATA-003',async()=>{
      const parent={id:'folder',name:'Folder',type:'folder'},child={id:'child',name:'Nested album',type:'album',parentId:parent.id};
      const a={...asset('folder-photo'),albumIds:[child.id]};await lib.saveAlbum(parent);await lib.saveAlbum(child);await lib.addAsset(a,blob);
      await lib.removeAlbum(parent.id,[a]);const current=await lib.loadLibrary();const stored=current.albums.find(a=>a.id===child.id);
      return {passed:!!stored&&!stored.parentId&&current.assets[0].albumIds.includes(child.id)&&await lib.hashBlob(await lib.originalBlob(a.id))===hash,storedChild:stored,sourceHash:await lib.hashBlob(await lib.originalBlob(a.id))};
    });
    await run('LR-DATA-004',async()=>{
      const a=asset('duplicate');let rejection;try{await restoreBackup(await backup([a,a],[{id:'restored-folder',name:'Folder',type:'folder'}]),()=>{});}catch(error){rejection=String(error);}
      const current=await lib.loadLibrary();return {passed:!!rejection&&current.assets.length===0&&current.albums.length===0,rejection,assetCount:current.assets.length,albumCount:current.albums.length};
    });
    await run('LR-DATA-005',async()=>{
      const a=asset('quota-a'),b=asset('quota-b'),archive=await backup([a,b],[{id:'quota-folder',name:'Folder',type:'folder'}]);
      const originalAdd=IDBObjectStore.prototype.add;let rejection;
      IDBObjectStore.prototype.add=function(value,key){if(this.name==='originals'&&key===b.id)throw new DOMException('Injected storage quota failure','QuotaExceededError');return originalAdd.call(this,value,key);};
      try{await restoreBackup(archive,()=>{});}catch(error){rejection=String(error);}finally{IDBObjectStore.prototype.add=originalAdd;}
      const current=await lib.loadLibrary();return {passed:!!rejection&&current.assets.length===0&&current.albums.length===0,rejection,assetCount:current.assets.length,albumCount:current.albums.length};
    });
    await run('LR-DATA-006',async()=>{
      const a=asset('restore-a'),b=asset('restore-b');await lib.addAsset({...a,rating:5},blob);const archive=await backup([a,b],[{id:'restored',name:'Restored',type:'album'}]);
      const progress=[];const first=await restoreBackup(archive,(done,total)=>progress.push({done,total}));const second=await restoreBackup(archive,()=>{});const current=await lib.loadLibrary();const hashes=await Promise.all(current.assets.map(async a=>({id:a.id,hash:await lib.hashBlob(await lib.originalBlob(a.id))})));
      return {passed:first===1&&second===0&&current.assets.length===2&&current.assets.find(a=>a.id==='restore-a')?.rating===5&&hashes.every(h=>h.hash===hash),restoredCounts:[first,second],ratings:current.assets.map(a=>({id:a.id,rating:a.rating})),hashes,progress};
    });
    await run('LR-DATA-007',async()=>{
      const albums=Array.from({length:50},(_,i)=>({id:`folder-${i}`,name:`Folder ${i}`,type:i===49?'album':'folder',...(i?{parentId:`folder-${i-1}`}:{})}));const a={...asset('deep-photo'),albumIds:[albums.at(-1).id]};
      const visible=lib.visibleAssets([a],albums[0],albums[0].id,{query:'',rating:0,flag:'',label:'',sort:'name',stacked:false},[...albums].reverse());
      return {passed:visible.length===1,depth:albums.length,visibleIds:visible.map(a=>a.id)};
    });
    return results;
  });
  const report={date:'2026-11-13',browser:browser.version(),base,phase,fixture:'Disposable procedural storage-only blobs; no codec assertion uses these files',results,errors};
  await writeFile(`${evidence}/data-storage-${phase}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  expect(errors).toEqual([]);
  expect(results.filter(r=>!r.passed)).toEqual([]);
} finally { await browser.close(); }
