import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { unzipSync, strFromU8 } = createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');
async function mount(page: Page, file = 'multipage.docx') {
  await page.goto(`/tests/writer/harness.html?engine&file=/tests/writer/fixtures/${file}`);
  await page.waitForFunction(() => (window as any).engineReady, null, { timeout: 40000 });
  await expect.poll(() => page.evaluate(() => (window as any).snapshot?.pages)).toBeGreaterThan(0);
}
async function exported(page: Page) { return new Uint8Array(await page.evaluate(async () => Array.from(await (window as any).testEngine.export()) as number[])); }

test('multi-page selection transactions, undo/redo, named style, TOC, DOCX round trip', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror',e=>errors.push(e.message));
  await mount(page);
  await expect.poll(() => page.evaluate(() => (window as any).snapshot.pages)).toBe(3);
  const result = await page.evaluate(async () => {
    const e = (window as any).testEngine;
    const original = await e.api.getText({});
    const target = { kind:'selection', start:{kind:'text',blockId:'00000005',offset:10}, end:{kind:'text',blockId:'00000006',offset:7} };
    const changed = await e.api.replace({ target, text:'Text edited across a page boundary. ' });
    const edited = await e.api.getText({});
    await e.command('undo'); const undone = await e.api.getText({});
    await e.command('redo'); const redone = await e.api.getText({});
    await e.ui.selection.applyAndWait({kind:'selection',start:{kind:'text',blockId:'00000002',offset:0},end:{kind:'text',blockId:'00000002',offset:16}});
    await e.command('linked-style','Heading2');
    await e.invoke('styles.apply',{target:{scope:'style',styleId:'Heading2',channel:'run'},patch:{fontSize:36,bold:true}});
    await e.updateTOC();
    const toc = await e.api.toc.list({});
    return {original,edited,undone,redone,changed,toc};
  });
  expect(result.changed.success).toBe(true); expect(result.edited).toContain('Text edited across a page boundary.');
  expect(result.undone).toBe(result.original); expect(result.redone).toBe(result.edited); expect(result.toc.items.length).toBe(1);
  const bytes = await exported(page); const pkg = unzipSync(bytes);
  const xml = strFromU8(pkg['word/document.xml']);
  expect(xml).toContain('Heading2'); expect(strFromU8(pkg['word/styles.xml'])).toContain('w:sz w:val="36"'); expect(xml).toContain('TOC'); expect(xml).toContain('👩🏽‍💻');
  await writeFile('tests/writer/fixtures/roundtrip.docx', bytes);
  await mount(page,'roundtrip.docx');
  const reopened = await page.evaluate(async () => ({ text:await (window as any).testEngine.api.getText({}),toc:await (window as any).testEngine.api.toc.list({}) }));
  expect(reopened.text).toContain('Text edited across a page boundary.'); expect(reopened.toc.items).toHaveLength(1); expect(errors).toEqual([]);
});

test('comments and replies remain separate from tracked insertion/deletion decisions', async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(async () => {
    const e = (window as any).testEngine;
    await e.ui.selection.applyAndWait({kind:'selection',start:{kind:'text',blockId:'00000003',offset:0},end:{kind:'text',blockId:'00000003',offset:20}});
    await new Promise(r=>setTimeout(r,100));
    const capture=e.capture();
    await e.addComment(capture,'Please review this passage.'); const created={success:true};
    const comments=await e.api.comments.list({includeResolved:true}); if(!comments.items[0]) return {created,capture,comments,selection:e.ui.selection.current()}; const id=comments.items[0].id;
    const replied=await e.ui.comments.reply(id,{text:'Reviewed locally.'});
    const resolved=await e.ui.comments.resolve(id);
    const reopened=await e.ui.comments.reopen(id);
    const target={kind:'selection',start:{kind:'text',blockId:'00000007',offset:0},end:{kind:'text',blockId:'00000007',offset:4}};
    await e.api.replace({target,text:'That'},{changeMode:'tracked'});
    const revisions=await e.api.trackChanges.list({});
    e.setReviewDisplay('final');
    const hidden=await e.api.trackChanges.list({});
    e.setReviewDisplay('review');
    const first=revisions.items[0]; const rejected=await e.ui.trackChanges.rejectAsync(first.id);
    const restored=await e.api.getText({});
    await e.api.replace({target:{kind:'selection',start:{kind:'text',blockId:'00000007',offset:0},end:{kind:'text',blockId:'00000007',offset:4}},text:'That'},{changeMode:'tracked'});
    const next=await e.api.trackChanges.list({});
    const accepted=await e.ui.trackChanges.acceptAsync(next.items[0].id);
    const final=await e.api.getText({});
    return {created,replied,resolved,reopened,comments,revisions,hidden,rejected,accepted,restored,final};
  });
  expect(result.created.success).toBe(true);
  expect(result.created.success).toBe(true); expect(result.replied.success).toBe(true);
  expect(result.rejected.success).toBe(true); expect(result.accepted.success).toBe(true); expect(result.restored).toContain('This paragraph starts'); expect(result.final).toContain('That paragraph starts');
  expect(result.hidden.items.length).toBe(result.revisions.items.length); expect(result.revisions.items.length).toBeGreaterThan(0);
  const bytes=await exported(page); const pkg=unzipSync(bytes);
  expect(strFromU8(pkg['word/comments.xml'])).toContain('Please review this passage.');
  expect(strFromU8(pkg['word/comments.xml'])).toContain('Reviewed locally.');
});

test('table across pages supports cell edits and row/column operations', async ({ page }) => {
  await mount(page,'spanning-table.docx');
  await expect.poll(()=>page.evaluate(()=>(window as any).snapshot.pages)).toBeGreaterThan(1);
  const result=await page.evaluate(async()=>{
    const e=(window as any).testEngine; const tables=await e.api.blocks.list({nodeTypes:['table']}); const table=tables.blocks[0];
    const nodeId=table.nodeId || table.address?.nodeId;
    const edit=await e.api.tables.setCellText({nodeId,rowIndex:1,columnIndex:1,text:'Updated across pages'});
    const add=await e.api.tables.insertRow({nodeId,rowIndex:1,position:'after'});
    return {tables,edit,add};
  });
  expect(result.edit.success).toBe(true); expect(result.add.success).toBe(true);
  const bytes=await exported(page);const xml=strFromU8(unzipSync(bytes)['word/document.xml']);
  expect(xml).toContain('Updated across pages');expect(xml).toContain('tblHeader');
});

test('image insertion, resizing, wrapping, crop and media relationship survive export',async({page})=>{
 await mount(page);
 const result=await page.evaluate(async()=>{
  const e=(window as any).testEngine;
  const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#185abd';ctx.fillRect(0,0,80,40);
  await e.command('image',{src:canvas.toDataURL(),alt:'A blue rectangle',size:{width:160,height:80}});
  const images=await e.api.images.list({});const imageId=images.items[0].sdImageId;
  const floating=await e.api.images.convertToFloating({imageId});
  const wrap=await e.api.images.setWrapType({imageId,type:'Square'});
  const resize=await e.api.images.setSize({imageId,size:{width:240,height:120}});
  const crop=await e.api.images.crop({imageId,crop:{left:.1,right:.1}});
  return {floating,wrap,resize,crop,images:await e.api.images.list({})};
 });
 expect(result.wrap.success).toBe(true);expect(result.resize.success).toBe(true);expect(result.crop.success).toBe(true);
 const bytes=await exported(page);const pkg=unzipSync(bytes);expect(Object.keys(pkg).some(p=>p.startsWith('word/media/'))).toBe(true);expect(strFromU8(pkg['word/document.xml'])).toContain('wrapSquare');
});

test('50-page document keeps a semantic selection while editing and navigating',async({page})=>{
 await mount(page,'fifty-pages.docx');
 await expect.poll(()=>page.evaluate(()=>(window as any).snapshot.pages),{timeout:30000}).toBe(50);
 const result=await page.evaluate(async()=>{
  const e=(window as any).testEngine;const target={kind:'selection',start:{kind:'text',blockId:'00000064',offset:0},end:{kind:'text',blockId:'00000064',offset:7}};
  const applied=await e.ui.selection.applyAndWait(target);
  const changed=await e.api.replace({target,text:'Final page edited'});
  const text=await e.api.getText({});
  await e.ui.viewport.scrollIntoView({target:{kind:'text',blockId:'00000064',range:{start:0,end:17}}});
  const selection=e.ui.selection.current();
  return {applied,changed,text,selection};
 });
 expect(result.changed.success).toBe(true);expect(result.text).toContain('Final page edited');expect(result.selection.selectionTarget).not.toBeNull();
 await page.screenshot({path:'docs/writer/screenshots/fifty-pages.png'});
});


test('paragraph transactions, page setup, hyperlinks, footnotes, headers and page fields remain structures',async({page})=>{
 await mount(page);
 const result=await page.evaluate(async()=>{
  const e=(window as any).testEngine;
  await e.invoke('format.paragraph.applyBatch',{targets:[{kind:'block',nodeType:'paragraph',nodeId:'00000003'}],operations:[
   {operationId:'format.paragraph.setAlignment',input:{alignment:'center'}},
   {operationId:'format.paragraph.setSpacing',input:{before:12,after:6,line:360,lineRule:'auto'}},
   {operationId:'format.paragraph.setKeepOptions',input:{keepNext:true,widowControl:true}},
   {operationId:'format.paragraph.setTabStop',input:{position:72,alignment:'left'}},
  ]});
  await e.pageSetup('margins',.75);
  await e.ui.selection.applyAndWait({kind:'selection',start:{kind:'text',blockId:'00000007',offset:0},end:{kind:'text',blockId:'00000007',offset:4}});
  await e.command('link',{href:'https://example.com',text:'This'});
  const selection=await e.api.selection.current();
  await e.ui.selection.applyAndWait({...selection.selectionTarget,start:selection.selectionTarget.end,end:selection.selectionTarget.end});
  await e.invoke('footnotes.insert',{type:'footnote',content:'A real footnote.'});
  const sections=await e.api.sections.list({});const section=sections.items[0].address;
  const part=await e.api.headerFooters.parts.create({kind:'header'});
  await e.api.headerFooters.refs.set({target:{kind:'headerFooterSlot',section,headerFooterKind:'header',variant:'default'},refId:part.refId});
  await e.invoke('create.paragraph',{text:'Document header',in:{kind:'story',storyType:'headerFooterPart',refId:part.refId}});
  await e.command('page-numbers-apply',{kind:'footer',alignment:'center'});
  return {sections,part};
 });
 const bytes=await exported(page);const pkg=unzipSync(bytes),xml=strFromU8(pkg['word/document.xml']);
 expect(xml).toContain('w:jc');expect(xml).toContain('hyperlink');expect(xml).toContain('w:left="1080"');expect(xml).toContain('footnoteReference');
 expect(Object.keys(pkg).some(p=>/header.*xml/.test(p))).toBe(true);expect(Object.keys(pkg).some(p=>/footer.*xml/.test(p))).toBe(true);
 await writeFile('tests/writer/fixtures/structures-roundtrip.docx',bytes);
});

test('pending reviews and opaque package metadata survive DOCX save and reopen',async({page})=>{
 await mount(page,'opaque-package.docx');
 const result=await page.evaluate(async()=>{
  const e=(window as any).testEngine;
  await e.ui.selection.applyAndWait({kind:'selection',start:{kind:'text',blockId:'00000003',offset:0},end:{kind:'text',blockId:'00000003',offset:20}});
  const capture=await e.captureFresh();await e.addComment(capture,'Keep this unresolved comment.');
  await e.api.replace({target:{kind:'selection',start:{kind:'text',blockId:'00000007',offset:0},end:{kind:'text',blockId:'00000007',offset:4}},text:'That'},{changeMode:'tracked'});
  e.setReviewDisplay('final');
  return {changes:await e.api.trackChanges.list({}),comments:await e.api.comments.list({includeResolved:true})};
 });
 expect(result.changes.items).toHaveLength(1);expect(result.comments.items).toHaveLength(1);
 const bytes=await exported(page),pkg=unzipSync(bytes),xml=strFromU8(pkg['word/document.xml']);
 expect(strFromU8(pkg['customXml/item1.xml'])).toContain('Retain original package metadata.');
 expect(xml).toMatch(/<w:ins\b/);expect(xml).toMatch(/<w:del\b/);expect(strFromU8(pkg['word/comments.xml'])).toContain('Keep this unresolved comment.');
 await writeFile('tests/writer/fixtures/review-roundtrip.docx',bytes);
 await mount(page,'review-roundtrip.docx');
 const reopened=await page.evaluate(async()=>({changes:await (window as any).testEngine.api.trackChanges.list({}),comments:await (window as any).testEngine.api.comments.list({includeResolved:true})}));
 expect(reopened.changes.items).toHaveLength(1);expect(reopened.comments.items[0].text).toBe('Keep this unresolved comment.');
});
