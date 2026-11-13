export type FormatSupport = { id: string; extensions: string[]; container: string; decode: string; metadata: string; export: string; precision: string; status: 'implemented' | 'conditional' | 'unsupported'; notes: string; original: boolean };
export const formatRegistry: FormatSupport[] = [
  { id:'jpeg',extensions:['jpg','jpeg'],container:'JPEG SOI',decode:'Browser full-resolution decode',metadata:'EXIF subset; original bytes preserved',export:'JPEG, sRGB, 8-bit',precision:'8-bit input → linear float32',status:'implemented',notes:'ICC conversion delegated to browser; CMYK/platform differences require validation.',original:true },
  { id:'png',extensions:['png'],container:'PNG signature',decode:'Browser 8-bit; native non-interlaced gray/RGB(A) 16-bit',metadata:'IHDR; profile chunks detected; original metadata bytes retained',export:'PNG, sRGB, 8/16-bit',precision:'8/16-bit → linear float32',status:'implemented',notes:'16-bit decoder supports filters 0–4 and deflate. Non-sRGB 16-bit ICC images rejected rather than silently reinterpreted. PNG is a LopeOS extension.',original:true },
  { id:'tiff',extensions:['tif','tiff'],container:'TIFF IFD',decode:'Uncompressed, chunky grayscale/RGB(A), strips, 8/16 unsigned or 32-bit float',metadata:'IFD/EXIF subset',export:'TIFF 8/16 unsigned sRGB; 32-bit float linear sRGB',precision:'Full sample precision → float32',status:'implemented',notes:'LZW/JPEG/ZIP, tiles, CMYK and arbitrary ICC require another decoder; rejected explicitly.',original:true },
  {id:'lopeimage',extensions:['lopeimage'],container:'Lope Image JSON v1',decode:'Shared Image Editor native renderer composite',metadata:'Native document dimensions/name',export:'Original native project; flattened photographic derivative',precision:'RGB/8 interchange; independent float32 photo recipe',status:'implemented',notes:'LopeOS extension. Native layers are preserved in original project bytes; photo adjustments apply to the composite.',original:true},
  ...[['dng','DNG'],['cr2','Canon CR2'],['cr3','Canon CR3'],['nef','Nikon NEF'],['nrw','Nikon NRW'],['arw','Sony ARW'],['raf','Fujifilm RAF'],['rw2','Panasonic RW2'],['orf','Olympus / OM ORF'],['pef','Pentax PEF'],['srw','Samsung SRW']].map(([id,container]): FormatSupport => ({id,extensions:[id],container,decode:'libraw-wasm 1.6.0; sensor processing, not embedded JPEG',metadata:'LibRaw metadata',export:'Original bytes only; developed output to JPEG/PNG/TIFF',precision:'16-bit linear sRGB development → float32',status:'conditional',notes:'Camera and compression coverage is not fully tested. DNG conversion is unavailable.',original:true})),
  { id:'psd',extensions:['psd'],container:'8BPS v1',decode:'ag-psd compatible merged composite only',metadata:'Canvas dimensions',export:'Original source only; flattened derivative to JPEG/PNG/TIFF',precision:'RGB/8 only',status:'conditional',notes:'Missing composite and higher precision are rejected; original layered bytes remain immutable.',original:true },
  { id:'psb',extensions:['psb'],container:'8BPS v2',decode:'Unavailable',metadata:'Signature only',export:'Original only',precision:'Unavailable',status:'unsupported',notes:'PSB import is not supported.',original:true },
  ...[['heif',['heif','heic','hif'],'HEIF'],['avif',['avif'],'AVIF'],['jxl',['jxl'],'JPEG XL']].map(([id,ext,container]): FormatSupport=>({id:id as string,extensions:ext as string[],container:container as string,decode:'Depends on browser support',metadata:'Limited',export:'Original only',precision:'8-bit SDR; high-bit-depth and HDR editing unavailable',status:'conditional',notes:'No fallback encoder/transcoder is bundled. Metadata and auxiliary HDR are retained only in original bytes.',original:true})),
  {id:'webp',extensions:['webp'],container:'RIFF WEBP',decode:'Browser',metadata:'Limited',export:'Original only',precision:'8-bit → float32',status:'conditional',notes:'Uses the browser WebP decoder.',original:true},
  {id:'video',extensions:['mp4','mov','m4v','avi','mts','m2ts','m2t','mpeg','mpg','3gp'],container:'Container + codec required',decode:'No video editing path',metadata:'Not implemented',export:'Original only',precision:'Not applicable',status:'unsupported',notes:'Video playback, trimming, transcoding, and audio export are unavailable.',original:true},
];
export const photoExtensions = formatRegistry.filter(f=>f.id!=='video').flatMap(f=>f.extensions.map(e=>'.'+e));
export const rawExtensions = new Set(['dng','cr2','cr3','nef','nrw','arw','raf','rw2','orf','pef','srw']);
export const extension = (name: string) => name.split('.').at(-1)?.toLowerCase() || '';
export function identifyFormat(bytes: Uint8Array, name: string) {
  if(bytes.length<12) throw new Error('The file is empty or truncated.');
  const text = (a:number,b:number)=>String.fromCharCode(...bytes.subarray(a,b));
  const ext=extension(name);
  if(ext==='lopeimage'&&new TextDecoder().decode(bytes.subarray(0,128)).trimStart().startsWith('{'))return 'lopeimage';
  if(rawExtensions.has(ext))return ext;
  if(bytes[0]===255&&bytes[1]===216)return 'jpeg';
  if(bytes[0]===137&&text(1,4)==='PNG')return 'png';
  if(['II','MM'].includes(text(0,2)))return 'tiff';
  if(text(0,4)==='8BPS')return bytes[5]===2?'psb':'psd';
  if(text(0,4)==='RIFF'&&text(8,12)==='WEBP')return 'webp';
  if(text(4,8)==='ftyp')return ['avif','avis'].includes(text(8,12))?'avif':'heif';
  if(ext==='jxl'&&(bytes[0]===255&&bytes[1]===10||text(4,8)==='JXL '))return 'jxl';
  throw new Error('Unrecognized photo container. The extension alone does not establish support.');
}
