import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createDocument } from '../../../packages/document-engine/src/package.ts';
const { unzipSync, zipSync, strFromU8, strToU8 } = createRequire(import.meta.url)('../../../packages/document-engine/node_modules/fflate');
const dir = new URL('./', import.meta.url);
const paragraphs = [
 {text:'A shared place to write',style:'Title'},
 {text:'Project overview',style:'Heading1'},
 {text:'Writer brings familiar document tools to LopeOS. Select a passage, apply a style, and keep every idea in its place.'},
 {text:'A practical approach',style:'Heading2'},
 {text:'A document is more than its visible text. It carries structure, comments, revisions, and a page layout that should survive every save.'},
 {text:'The next chapter',style:'Heading1',pageBreak:true},
 {text:'This paragraph starts on the second page. Editing across pages must preserve a continuous selection and coherent undo history.'},
 {text:'Final notes',style:'Heading1',pageBreak:true},
 {text:'Unicode round trip: café, naïve, Ελληνικά, العربية, 日本語, and 👩🏽‍💻.'},
];
await writeFile(new URL('multipage.docx',dir), createDocument(paragraphs));
await writeFile(new URL('fifty-pages.docx',dir),createDocument(Array.from({length:50},(_,i)=>[{text:`Chapter ${i+1}`,style:'Heading1',pageBreak:i>0},{text:`Page ${i+1} — `+'A representative paragraph for editing and navigation. '.repeat(8)}]).flat()));
const tablePackage = unzipSync(createDocument([{text:'Table across pages',style:'Heading1'},{text:'After the table.'}]));
let xml = strFromU8(tablePackage['word/document.xml']);
let table = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(s=>`<w:${s} w:val="single" w:sz="4" w:color="B5B5B5"/>`).join('')+'</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3120"/><w:gridCol w:w="3120"/><w:gridCol w:w="3120"/></w:tblGrid>';
for(let row=0;row<55;row++)table+='<w:tr>'+ (row===0?'<w:trPr><w:tblHeader/></w:trPr>':'')+Array.from({length:3},(_,col)=>`<w:tc><w:tcPr><w:tcW w:w="3120" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${row===0?['Item','Description','Status'][col]:`Row ${row}, cell ${col+1}`}</w:t></w:r></w:p></w:tc>`).join('')+'</w:tr>';
table+='</w:tbl>';
xml=xml.replace('<w:sectPr>',table+'<w:sectPr>');tablePackage['word/document.xml']=strToU8(xml);await writeFile(new URL('spanning-table.docx',dir),zipSync(tablePackage));
const unsafe=unzipSync(createDocument([{text:'Preserve this original'}]));unsafe['word/embeddings/object1.bin']=new Uint8Array([1,2,3,4]);await writeFile(new URL('embedded-object.docx',dir),zipSync(unsafe));
const fonts=unzipSync(createDocument([{text:'A document with a missing font.'}]));fonts['word/styles.xml']=strToU8(strFromU8(fonts['word/styles.xml']).replaceAll('Aptos','Lope Missing Font 123'));await writeFile(new URL('missing-font.docx',dir),zipSync(fonts));
console.log('Generated DOCX fixtures.');
const opaque=unzipSync(createDocument(paragraphs));
opaque['customXml/item1.xml']=strToU8('<?xml version="1.0" encoding="UTF-8"?><lope:metadata xmlns:lope="urn:lopeos:writer:fixture"><lope:value>Retain original package metadata.</lope:value></lope:metadata>');
opaque['word/_rels/document.xml.rels']=strToU8(strFromU8(opaque['word/_rels/document.xml.rels']).replace('</Relationships>','<Relationship Id="lopeCustomData" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>'));
await writeFile(new URL('opaque-package.docx',dir),zipSync(opaque));
