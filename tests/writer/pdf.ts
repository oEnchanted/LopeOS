import { createRequire } from 'node:module';
export async function pdfText(bytes: Uint8Array): Promise<string[]> {
  // Text extraction only; no canvas rendering is used in this Node test.
  (globalThis as any).DOMMatrix ??= class {};
  (globalThis as any).ImageData ??= class {};
  (globalThis as any).Path2D ??= class {};
  const url = createRequire(import.meta.url).resolve('../../packages/document-engine/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await import(url);
  const doc = await pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true,disableFontFace:true}).promise;
  const result:string[]=[];
  for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i);const text=await page.getTextContent();result.push(text.items.map((x:any)=>x.str||'').join(' '));}
  await doc.destroy();return result;
}
