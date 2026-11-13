import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { writerFilesystem } from './runtime';
import { pdfText } from './pdf';
const { unzipSync, strFromU8 } = createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');
const modal = (page: Page) => page.getByRole('dialog', { name: 'Writer Preferences', exact: true });
const body = (page: Page) => page.getByRole('textbox', { name: 'Document content', exact: true });
async function open(page: Page, path = '') {
  const fs = await writerFilesystem(page);
  await page.addInitScript(() => localStorage.setItem('test.writer.autosave','false'));
  await page.goto('/tests/writer/harness.html' + (path ? '?path='+encodeURIComponent(path) : ''));
  await expect(page.locator('.writer-opening')).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  return fs;
}
async function preferences(page: Page, category?: string) {
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(modal(page)).toBeVisible();
  if (category) await modal(page).getByRole('button', { name: category, exact: true }).click();
}
async function close(page: Page) {
  await modal(page).getByRole('button', { name: 'Close Preferences', exact: true }).click();
  await expect(modal(page)).toHaveCount(0);
}
async function save(page: Page, path: string, as = false) {
  await page.evaluate(path => { (window as any).savePath=path; }, path);
  if (as) await page.evaluate(()=> (window as any).testCommands.execute('writer.save-as'));
  else await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.writer-title')).toContainText(path.split('/').at(-1)!);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
}

test('Preferences follows live LopeOS theme and the device theme in System mode', async ({ page }) => {
  await open(page); await preferences(page,'General');
  await page.evaluate(() => (window as any).testSystemPreferences.set('theme','light'));
  await expect(modal(page)).toHaveAttribute('data-appearance','light');
  await modal(page).getByRole('combobox', { name: 'Office theme:', exact: true }).selectOption('dark');
  await expect(page.locator('.writer-app')).toHaveAttribute('data-theme','dark');
  await expect(modal(page)).toHaveAttribute('data-appearance','light');
  await page.evaluate(() => (window as any).testSystemPreferences.set('theme','dark'));
  await expect(modal(page)).toHaveAttribute('data-appearance','dark');
  await expect(modal(page).locator('h1')).toHaveText('General');
  await page.evaluate(() => (window as any).testSystemPreferences.set('theme','system'));
  await page.emulateMedia({ colorScheme:'light' }); await expect(modal(page)).toHaveAttribute('data-appearance','light');
  await page.emulateMedia({ colorScheme:'dark' }); await expect(modal(page)).toHaveAttribute('data-appearance','dark');
});

test('category grid, history, search, File Options and keyboard shortcut open the same Preferences', async ({ page }) => {
  await open(page); await preferences(page);
  await expect(modal(page).locator('.wr-pref-category-grid button')).toHaveCount(16);
  await modal(page).getByRole('button', { name:'General',exact:true }).click();
  await modal(page).getByRole('button', { name:'Show all preferences',exact:true }).click();
  await modal(page).getByRole('button', { name:'Save',exact:true }).click();
  await modal(page).getByRole('button', { name:'Previous preferences pane',exact:true }).click();
  await expect(modal(page).locator('h1')).toHaveText('Writer Preferences');
  await modal(page).getByRole('button', { name:'Previous preferences pane',exact:true }).click();
  await expect(modal(page).locator('h1')).toHaveText('General');
  await modal(page).getByLabel('Search preferences', {exact:true}).fill('recovery');
  await modal(page).getByRole('button', {name:'Open Save preferences',exact:true}).click();
  await expect(modal(page).locator('h1')).toHaveText('Save');
  await close(page);
  await page.getByRole('tab', {name:'File',exact:true}).click();
  await page.getByRole('button', {name:'Options',exact:true}).click();
  await expect(modal(page)).toBeVisible(); await close(page);
  await page.keyboard.press('ControlOrMeta+,'); await expect(modal(page)).toBeVisible();
});

test('view and unit preferences persist without resetting editing history', async ({ page }) => {
  const fs=await open(page);
  await body(page).click({position:{x:110,y:110}}); await page.keyboard.type('Preferences retain this text.'); await page.keyboard.press('ControlOrMeta+a');
  await preferences(page,'General');
  await modal(page).getByRole('combobox', { name:'Show measurement in units of:',exact:true }).selectOption('cm');
  await modal(page).getByRole('button', { name:'Show all preferences',exact:true }).click();
  await modal(page).getByRole('button', { name:'View',exact:true }).click();
  await modal(page).getByLabel('Horizontal ruler', {exact:true}).check();
  await modal(page).getByLabel('All', {exact:true}).check();
  await close(page);
  await expect(page.getByRole('button', {name:'Undo',exact:true})).toBeEnabled();
  await expect(page.locator('.v2-ruler-host')).toBeVisible();
  await page.getByRole('button', {name:'Paragraph dialog launcher',exact:true}).click();
  const paragraph=page.getByRole('dialog', {name:'Paragraph',exact:true});
  await paragraph.getByLabel('Left (cm):', {exact:true}).fill('2.54');
  await paragraph.getByRole('button', {name:'OK',exact:true}).click(); await expect(paragraph).toHaveCount(0);
  await save(page,'/Documents/Preferences.docx');
  const xml=strFromU8(unzipSync(fs.files.get('/Documents/Preferences.docx')!.data)['word/document.xml']);
  expect(xml).toContain('Preferences retain this text.'); expect(xml).toMatch(/w:left="1440"/);
  await page.reload(); await expect(page.locator('.writer-opening')).toHaveCount(0, {timeout:30000});
  await preferences(page,'General');
  await expect(modal(page).getByRole('combobox', {name:'Show measurement in units of:',exact:true})).toHaveValue('cm');
});

test('author changes apply to new comments and survive DOCX saving', async ({ page }) => {
  const fs=await open(page);
  await body(page).click({position:{x:110,y:110}}); await page.keyboard.type('A passage to review.'); await page.keyboard.press('ControlOrMeta+a');
  await preferences(page,'User Information');
  await modal(page).getByLabel('Name:', {exact:true}).fill('Luke Reviewer');
  await modal(page).getByLabel('Initials:', {exact:true}).fill('LR');
  await close(page);
  await page.evaluate(() => (window as any).testCommands.execute('writer.comment'));
  const comment=page.getByRole('dialog', {name:'New Comment',exact:true});
  await comment.getByLabel('New Comment text', {exact:true}).fill('Authored through Preferences.');
  await comment.getByRole('button', {name:'Post comment',exact:true}).click(); await expect(comment).toHaveCount(0);
  await page.getByRole('button', {name:'Comments',exact:true}).click();
  await expect(page.getByLabel('Comments pane', {exact:true})).toContainText('Luke Reviewer');
  await save(page,'/Documents/Author.docx');
  const comments=strFromU8(unzipSync(fs.files.get('/Documents/Author.docx')!.data)['word/comments.xml']);
  expect(comments).toContain('Luke Reviewer');
});

test('custom AutoCorrect replacements are real, persistent and undoable', async ({ page }) => {
  const fs=await open(page); await preferences(page,'AutoCorrect');
  await modal(page).getByLabel('Replace text as you type', {exact:true}).check();
  await modal(page).getByLabel('AutoCorrect replace', {exact:true}).fill('brb');
  await modal(page).getByLabel('AutoCorrect with', {exact:true}).fill('be right back');
  await modal(page).getByRole('button', {name:'Add',exact:true}).click();
  await expect(modal(page).getByRole('option', {name:'brb be right back',exact:true})).toBeVisible();
  await close(page);
  await body(page).click({position:{x:110,y:110}}); await page.keyboard.type('brb ');
  await expect(body(page)).toContainText('be right back', {timeout:10000});
  await page.keyboard.press('ControlOrMeta+z'); await expect(body(page)).toContainText('brb');
  await page.getByRole('button',{name:'Redo',exact:true}).click(); await expect(body(page)).toContainText('be right back');
  await page.keyboard.type('now'); await save(page,'/Documents/AutoCorrect.docx');
  const xml=strFromU8(unzipSync(fs.files.get('/Documents/AutoCorrect.docx')!.data)['word/document.xml']);
  expect(xml.replace(/<[^>]+>/g,'')).toContain('be right back now');
  await preferences(page,'AutoCorrect');
  await expect(modal(page).getByRole('option', {name:'brb be right back',exact:true})).toBeVisible();
});

test('animation controls honor both system and device Reduce Motion', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'reduce'}); await open(page); await preferences(page,'Accessibility');
  await expect(page.locator('.writer-app')).toHaveAttribute('data-motion','off');
  expect(await modal(page).evaluate(el=>getComputedStyle(el).animationDuration)).toBe('0s');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(() => (window as any).testSystemPreferences.set('reduceMotion',true));
  await expect(page.locator('.writer-app')).toHaveAttribute('data-motion','off');
  await page.evaluate(() => (window as any).testSystemPreferences.set('reduceMotion',false));
  await expect(page.locator('.writer-app')).toHaveAttribute('data-motion','on');
  await modal(page).getByLabel('Show interface animations', {exact:true}).uncheck();
  await expect(page.locator('.writer-app')).toHaveAttribute('data-motion','off');
  await close(page); await preferences(page,'Accessibility');
  await expect(modal(page).getByLabel('Show interface animations', {exact:true})).not.toBeChecked();
});

test('Save preferences update AutoSave and recovery controls', async ({ page }) => {
  await open(page); await preferences(page,'Save');
  await modal(page).getByLabel('Turn on AutoSave by default', {exact:true}).check();
  await modal(page).getByLabel('Recovery interval', {exact:true}).fill('3');
  await modal(page).getByLabel('Save AutoRecover info', {exact:true}).uncheck();
  await expect(modal(page).getByLabel('Recovery interval', {exact:true})).toBeDisabled();
  await close(page);
  await expect(page.getByRole('button', {name:'AutoSave On',exact:true})).toHaveAttribute('aria-pressed','true');
  await preferences(page,'Save');
  await expect(modal(page).getByLabel('Save AutoRecover info', {exact:true})).not.toBeChecked();
});

test('picture and print preferences change saved wrapping and actual print output', async ({ page, context }) => {
  const fs=await open(page,'/Documents/Review.docx');
  await preferences(page,'Edit');
  await modal(page).getByRole('combobox',{name:'Insert pictures as:',exact:true}).selectOption('square'); await close(page);
  await page.evaluate(()=> (window as any).testCommands.execute('writer.picture'));
  const picture=page.getByRole('dialog',{name:'Insert Picture',exact:true});
  await picture.getByLabel('Picture file').setInputFiles({name:'print-picture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
  await picture.getByLabel('Width (px):',{exact:true}).fill('64'); await picture.getByLabel('Height (px):',{exact:true}).fill('40');
  await picture.getByRole('button',{name:'Insert',exact:true}).click(); await expect(picture).toHaveCount(0);
  await save(page,'/Documents/PrintPreferences.docx',true);
  const xml=strFromU8(unzipSync(fs.files.get('/Documents/PrintPreferences.docx')!.data)['word/document.xml']);
  expect(xml).toMatch(/<wp:anchor\b/); expect(xml).toMatch(/<wp:wrapSquare\b/);
  await preferences(page,'Print');
  await modal(page).getByLabel('Reverse print order',{exact:true}).check();
  await modal(page).getByLabel('Drawing objects',{exact:true}).uncheck(); await close(page);
  await page.evaluate(()=> (window as any).testCommands.execute('writer.print'));
  await expect(page.locator('.wr-print-preview-canvas .superdoc-page')).toHaveCount(3,{timeout:30000});
  await expect(page.locator('.wr-print-preview-canvas img')).toHaveCount(1);
  await page.evaluate(()=> {
    const observer=new MutationObserver(records=>{
      for(const record of records) for(const added of record.addedNodes) {
        if(added instanceof HTMLIFrameElement && added.title === 'Print document') {
          added.contentWindow!.print=()=> { (window as any).printedWriterHtml=added.contentDocument!.documentElement.outerHTML; };
          observer.disconnect();
        }
      }
    });
    observer.observe(document.body,{childList:true});
  });
  await page.locator('.wr-print-button').click();
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).printedWriterHtml))).toBe(true);
  const html=await page.evaluate(()=> (window as any).printedWriterHtml as string);
  const summary=await page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html'),pages=[...doc.querySelectorAll('.superdoc-page')];
    return {first:pages[0]?.textContent,last:pages.at(-1)?.textContent,images:doc.querySelectorAll('img').length};
  },html);
  expect(summary.first).toContain('Final notes'); expect(summary.last).toContain('A shared place to write'); expect(summary.images).toBe(0);
  const output=await context.newPage(); await output.goto('/tests/writer/print.html'); await output.setContent(html); await output.evaluate(()=>document.fonts.ready);
  const text=await pdfText(await output.pdf({preferCSSPageSize:true,printBackground:true}));
  expect(text).toHaveLength(3); expect(text[0]).toContain('Final notes'); expect(text[2]).toContain('A shared place to write'); await output.close();
});

test('closing animations return typing focus immediately', async ({ page }) => {
  const fs=await open(page);
  await body(page).click({position:{x:110,y:110}}); await page.keyboard.type('Before. ');
  await preferences(page);
  await modal(page).getByRole('button',{name:'Close Preferences',exact:true}).click();
  await page.keyboard.type('After Preferences. ');
  await expect(modal(page)).toHaveCount(0);
  await page.getByRole('button',{name:'Font dialog launcher',exact:true}).click();
  const font=page.getByRole('dialog',{name:'Font',exact:true});
  await font.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.keyboard.type('After Font.'); await expect(font).toHaveCount(0);
  await save(page,'/Documents/AnimatedFocus.docx');
  const xml=strFromU8(unzipSync(fs.files.get('/Documents/AnimatedFocus.docx')!.data)['word/document.xml']);
  expect(xml.replace(/<[^>]+>/g,'')).toContain('Before. After Preferences. After Font.');
});
