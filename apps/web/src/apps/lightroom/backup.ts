import { crc32 } from '../../../../../packages/photo-engine/src/png';
import { validateRecipe, type Album, type Asset } from '../../../../../packages/photo-engine/src/model';
import { hashBlob, restoreLibrary } from './library';
const LIMIT=256*1024*1024;
type Entry={name:string;bytes:Uint8Array};
export function zipStore(entries:Entry[]):Blob {
  const chunks:Uint8Array[]=[],directory:Uint8Array[]=[];let offset=0;
  for(const entry of entries){const name=new TextEncoder().encode(entry.name),crc=crc32(entry.bytes),header=new Uint8Array(30+name.length),v=new DataView(header.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,entry.bytes.length,true);v.setUint32(22,entry.bytes.length,true);v.setUint16(26,name.length,true);header.set(name,30);chunks.push(header,entry.bytes);
    const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,entry.bytes.length,true);c.setUint32(24,entry.bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);directory.push(central);offset+=header.length+entry.bytes.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer),directorySize=directory.reduce((n,b)=>n+b.length,0);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,directorySize,true);e.setUint32(16,offset,true);return new Blob([...chunks,...directory,end] as BlobPart[],{type:'application/zip'});
}
export async function createBackup(assets:Asset[],albums:Album[],source:(a:Asset)=>Promise<Blob>,progress:(done:number)=>void):Promise<Blob>{
  if(assets.reduce((s,a)=>s+a.size+a.thumbnail.size,0)>LIMIT||assets.length>20_000)throw new Error('This backup exceeds the 256 MiB archive limit. Export originals in smaller batches.');
  const manifest={format:'lope-photo-library',version:1,created:new Date().toISOString(),albums,assets:assets.map(a=>({...a,thumbnail:undefined,storage:'managed',path:undefined,sourceVersion:undefined,originalFile:`originals/${a.id}`,thumbnailFile:`thumbnails/${a.id}.jpg`}))};
  if(new TextEncoder().encode(JSON.stringify(manifest)).length>32*1024*1024)throw new Error('Library metadata exceeds the 32 MiB backup-manifest limit. Back up a smaller library.');
  const entries:Entry[]=[{name:'library.json',bytes:new TextEncoder().encode(JSON.stringify(manifest))},{name:'README.txt',bytes:new TextEncoder().encode('LopeOS Luma library backup v1\nRestore this ZIP through Luma > Library settings > Restore library backup.\nOriginal bytes, recipes, history, versions, albums and retained XMP sidecars are included.\nOriginals are stored by stable asset ID; filenames and checksums are in library.json.\nNo source file is overwritten by restoring. Existing asset IDs are skipped.\n')}];
  let total=entries.reduce((n,e)=>n+e.bytes.length,0);for(let i=0;i<assets.length;i++){const a=assets[i],blob=await source(a),bytes=new Uint8Array(await blob.arrayBuffer()),thumbnail=new Uint8Array(await a.thumbnail.arrayBuffer());if(await hashBlob(blob)!==a.hash)throw new Error(`Checksum mismatch for ${a.name}; backup stopped.`);total+=bytes.length+thumbnail.length;if(total>LIMIT)throw new Error('Backup exceeds 256 MiB.');entries.push({name:`originals/${a.id}`,bytes},{name:`thumbnails/${a.id}.jpg`,bytes:thumbnail});progress(i+1);}return zipStore(entries);
}
export async function restoreBackup(blob:Blob,progress:(done:number,total:number)=>void):Promise<number>{
  if(blob.size>LIMIT)throw new Error('Backup exceeds the 256 MiB restoration limit.');const bytes=new Uint8Array(await blob.arrayBuffer()),v=new DataView(bytes.buffer),files=new Map<string,Uint8Array>();let p=0;
  while(p+30<=bytes.length&&v.getUint32(p,true)===0x04034b50){const flags=v.getUint16(p+6,true),method=v.getUint16(p+8,true),crc=v.getUint32(p+14,true),size=v.getUint32(p+18,true),nameSize=v.getUint16(p+26,true),extra=v.getUint16(p+28,true),start=p+30+nameSize+extra;if(flags&8||method!==0||size>LIMIT||start+size>bytes.length||files.size>40002)throw new Error('Unsupported or corrupt backup ZIP. Only Luma stored ZIP backups are accepted.');const name=new TextDecoder().decode(bytes.subarray(p+30,p+30+nameSize)),data=bytes.subarray(start,start+size);if(files.has(name)||name.includes('..')||name.startsWith('/')||crc32(data)!==crc)throw new Error('Backup integrity check failed.');files.set(name,data);p=start+size;}
  const json=files.get('library.json');if(!json||json.length>32*1024*1024)throw new Error('Luma backup manifest is missing or too large.');const manifest=JSON.parse(new TextDecoder().decode(json));if(manifest.format!=='lope-photo-library'||manifest.version!==1||!Array.isArray(manifest.assets)||!Array.isArray(manifest.albums)||manifest.assets.length>20000||manifest.albums.length>20000)throw new Error('Unsupported library backup.');
  const assetIds=new Set<string>(),albumIds=new Set<string>();
  // Validate every original and recipe before writing anything from the archive.
  for(const a of manifest.assets){if(typeof a.id!=='string'||!a.id||a.id.length>100||typeof a.name!=='string'||!Array.isArray(a.albumIds)||!Array.isArray(a.history)||!Array.isArray(a.future)||!Array.isArray(a.versions))throw new Error('Invalid backed-up asset.');if(assetIds.has(a.id))throw new Error('Backup contains duplicate asset IDs.');assetIds.add(a.id);validateRecipe(a.recipe);for(const h of [...a.history,...a.future,...a.versions])validateRecipe(h.recipe);const original=files.get(a.originalFile),thumbnail=files.get(a.thumbnailFile);if(!original||!thumbnail||await hashBlob(new Blob([original as BlobPart]))!==a.hash)throw new Error('Backup original is missing or its checksum failed.');}
  for(const a of manifest.albums){if(typeof a.id!=='string'||!a.id||typeof a.name!=='string'||!['album','folder','smart'].includes(a.type))throw new Error('Invalid backed-up album.');if(albumIds.has(a.id))throw new Error('Backup contains duplicate album IDs.');albumIds.add(a.id);}
  const entries=manifest.assets.map((a:Asset&{originalFile:string;thumbnailFile:string})=>({
    asset:{...a,recipe:validateRecipe(a.recipe),storage:'managed' as const,path:undefined,sourceVersion:undefined,thumbnail:new Blob([files.get(a.thumbnailFile)! as BlobPart],{type:'image/jpeg'})},
    original:new Blob([files.get(a.originalFile)! as BlobPart])
  }));
  const restored=await restoreLibrary(entries,manifest.albums);
  // Completion is reported only after all stores have committed successfully.
  if(manifest.assets.length)progress(manifest.assets.length,manifest.assets.length);
  return restored;
}
