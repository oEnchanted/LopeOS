import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createDocument, inspectPackage, documentWordCount } from '../../packages/document-engine/src/package.ts';
const { unzipSync,zipSync,strFromU8 }=createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');
test('generated DOCX includes native paragraphs, named styles, page geometry and Unicode',()=>{
 const bytes=createDocument([{text:'Hello العربية 👩🏽‍💻',style:'Heading1'},{text:'Second page',pageBreak:true}]);
 assert.equal(inspectPackage(bytes).preserveOriginal,false);
 const pkg=unzipSync(bytes);const xml=strFromU8(pkg['word/document.xml']);
 assert.match(xml,/<w:pStyle w:val="Heading1"/);assert.match(xml,/<w:pageBreakBefore/);assert.match(xml,/العربية 👩🏽‍💻/);assert.match(xml,/w:w="12240"/);
 assert.ok(pkg['word/styles.xml']);assert.ok(pkg['_rels/.rels']);
});
test('opaque embedded objects require preserving the source',()=>{
 const pkg=unzipSync(createDocument());pkg['word/embeddings/object.bin']=new Uint8Array([1]);
 const report=inspectPackage(zipSync(pkg));assert.equal(report.preserveOriginal,true);assert.match(report.warnings[0],/Embedded objects/);
});
test('legacy and malformed packages are refused before editing',()=>{
 assert.throws(()=>inspectPackage(new Uint8Array([0xd0,0xcf,0x11,0xe0])),/Legacy DOC or encrypted/);
 assert.throws(()=>inspectPackage(new TextEncoder().encode('<html>not a DOCX</html>')),/not an Open XML/);
 assert.throws(()=>inspectPackage(zipSync({'random.xml':new Uint8Array([1])})),/missing its main document/);
});
test('declared ZIP expansion is bounded before decompression',()=>{
 const bytes=createDocument();const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(let i=0;i+46<bytes.length;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint32(i+24,200*1024*1024,true);break;}
 assert.throws(()=>inspectPackage(bytes),/safe document limit/);
});
test('word counts handle Unicode word boundaries and exclude punctuation',()=>{
 assert.equal(documentWordCount('One, two… three!'),3);assert.ok(documentWordCount('مرحبا بالعالم 日本語')>=3);assert.equal(documentWordCount('… — 👩🏽‍💻'),0);
});
