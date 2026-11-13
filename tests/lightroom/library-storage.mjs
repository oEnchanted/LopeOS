/** Inspect durable state without importing development source modules into the page. */
export async function readLibrary(page,withHashes=false){
  return page.evaluate(async hashOriginals=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lope.photo-library.v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const value=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{
      const assets=await value(db.transaction('assets').objectStore('assets').getAll());
      if(hashOriginals){const store=db.transaction('originals').objectStore('originals'),blobs=await Promise.all(assets.map(a=>value(store.get(a.id))));for(let i=0;i<assets.length;i++)assets[i].originalHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blobs[i].arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');}
      return {assets};
    }finally{db.close();}
  },withHashes);
}
export async function hasDenoisePackage(page){
  return page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lope.photo-ai-models.v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction('packages').objectStore('packages').get('ffdnet-color-clip-v1');r.onsuccess=()=>resolve(!!r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}});
}
