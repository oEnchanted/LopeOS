import {test,expect,type Page} from '@playwright/test';
const key='sheets.preferences.v1';
const modal=(page:Page)=>page.getByRole('dialog',{name:'Sheets Preferences',exact:true});
const cell=(page:Page,address:string)=>page.locator(`.sheets-cell[data-address="${address}"]`);
async function open(page:Page,id='preferences-test'){
  await page.goto(`/tests/spreadsheet/harness.html?window=${id}`);
  await expect(page.getByRole('grid')).toBeVisible({timeout:30000});
  await expect(page.getByRole('status')).not.toHaveText('Calculating…');
}
async function preferences(page:Page,category?:string){
  await page.evaluate(()=> (window as any).testCommands.execute('sheets.preferences'));
  await expect(modal(page)).toBeVisible();
  if(category)await modal(page).getByRole('button',{name:category,exact:true}).click();
}
async function pane(page:Page,category:string){
  await modal(page).getByRole('button',{name:'Show all preferences',exact:true}).click();
  await modal(page).getByRole('button',{name:category,exact:true}).click();
}
async function close(page:Page){await modal(page).getByRole('button',{name:'Close Preferences',exact:true}).click();await expect(modal(page)).toHaveCount(0);}
async function enter(page:Page,address:string,value:string){
  await page.getByRole('textbox',{name:'Name box',exact:true}).fill(address);
  await page.getByRole('textbox',{name:'Name box',exact:true}).press('Enter');
  await cell(page,address).dblclick();
  await page.getByRole('textbox',{name:`Edit ${address}`,exact:true}).fill(value);
  await page.getByRole('textbox',{name:`Edit ${address}`,exact:true}).press('Enter');
}
async function number(page:Page,label:string,value:string){const input=modal(page).getByRole('spinbutton',{name:label,exact:true});await input.fill(value);await input.press('Tab');}
async function stored(page:Page){return page.evaluate(key=>(window as any).testSettings.get(key,{}),key);}

test('Preferences shortcut, category navigation, history and search reach the same settings window',async({page})=>{
  await open(page);
  await page.getByRole('grid').focus();
  await page.keyboard.press('ControlOrMeta+,');
  await expect(modal(page)).toBeVisible();
  await modal(page).getByRole('button',{name:'General',exact:true}).click();
  await expect(modal(page).locator('h1')).toHaveText('General');
  await pane(page,'Save');
  await modal(page).getByRole('button',{name:'Previous preferences pane',exact:true}).click();
  await expect(modal(page).getByRole('button',{name:'General',exact:true})).toBeVisible();
  await modal(page).getByRole('button',{name:'Previous preferences pane',exact:true}).click();
  await expect(modal(page).locator('h1')).toHaveText('General');
  await modal(page).getByRole('textbox',{name:'Search preferences',exact:true}).fill('recovery');
  await modal(page).getByRole('button',{name:'Open Save preferences',exact:true}).click();
  await expect(modal(page).locator('h1')).toHaveText('Save');
  await close(page);
  await page.getByRole('tab',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Preferences',exact:true}).click();
  await expect(modal(page)).toBeVisible();
});

test('view preferences hide headings, formula bar and displayed zeros and persist without modifying cells',async({page})=>{
  await open(page);await enter(page,'A1','0');
  const revision=await page.evaluate(()=>(window as any).sheetsTestEngine.workbook.revision);
  await preferences(page,'View');
  await modal(page).getByLabel('Show row and column headings',{exact:true}).uncheck();
  await modal(page).getByLabel('Show formula bar',{exact:true}).uncheck();
  await modal(page).getByLabel('Show zero values',{exact:true}).uncheck();
  await close(page);
  await expect(page.getByRole('rowheader')).toHaveCount(0);await expect(page.getByRole('columnheader')).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'Formula bar',exact:true})).toHaveCount(0);
  await expect(cell(page,'A1')).toHaveText('');
  const result=await page.evaluate(()=>({revision:(window as any).sheetsTestEngine.workbook.revision,value:(window as any).sheetsTestEngine.workbook.sheets[0].cells.A1.value}));
  expect(result).toEqual({revision,value:0});
  await expect(page.locator('.sheets-save-state')).toHaveText('Recovery saved locally');
  await page.reload();await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('rowheader')).toHaveCount(0);await expect(cell(page,'A1')).toHaveText('');
  await preferences(page,'View');await expect(modal(page).getByLabel('Show zero values',{exact:true})).not.toBeChecked();
});

test('new-workbook sheet count, fonts and zoom apply to new documents without restyling the current document',async({page})=>{
  await open(page);await enter(page,'A1','Existing document');
  await preferences(page,'General');
  await modal(page).getByRole('combobox',{name:'Default font',exact:true}).selectOption('Georgia');
  await number(page,'Font size','14');await number(page,'Sheets in new workbooks','3');await number(page,'Default zoom','125');
  await close(page);
  const current=await page.evaluate(()=>(window as any).sheetsTestEngine.workbook.metadata?.defaultCellStyle);
  expect(current?.fontFamily).not.toBe('Georgia');
  await page.evaluate(()=>(window as any).testCommands.execute('sheets.new'));
  await page.getByRole('button',{name:'Continue without saving',exact:true}).click();
  await expect(page.locator('.sheets-sheet-tabs').getByRole('tab')).toHaveCount(3);
  await expect(page.getByRole('slider',{name:'Worksheet zoom',exact:true})).toHaveValue('125');
  await enter(page,'A1','New document');
  const created=await page.evaluate(()=>(window as any).sheetsTestEngine.workbook.metadata.defaultCellStyle);
  expect(created).toEqual({fontFamily:'Georgia',fontSize:14});await expect(cell(page,'A1')).toHaveCSS('font-family',/Georgia/);
});

test('separate workbook windows share preference changes without overwriting unrelated fields',async({page,context})=>{
  await open(page,'preferences-window-one');
  const second=await context.newPage();await open(second,'preferences-window-two');
  await preferences(page,'General');await number(page,'Default zoom','150');
  await preferences(second,'View');await modal(second).getByLabel('Show row and column headings',{exact:true}).uncheck();
  await expect.poll(async()=> (await stored(page)).headings).toBe(false);
  await expect.poll(async()=> (await stored(second)).defaultZoom).toBe(150);
  await pane(second,'General');await expect(modal(second).getByRole('spinbutton',{name:'Default zoom',exact:true})).toHaveValue('150');
  await number(second,'Sheets in new workbooks','2');
  await expect(modal(page).getByRole('spinbutton',{name:'Sheets in new workbooks',exact:true})).toHaveValue('2');
  await modal(page).getByRole('combobox',{name:'Default font',exact:true}).selectOption('Arial');
  const final=await stored(second);expect(final).toMatchObject({defaultFont:'Arial',defaultZoom:150,newSheetCount:2,headings:false});
  await second.close();
});

test('AutoRecover toggle stops new snapshots and resumes with the configured interval',async({page})=>{
  await open(page,'preferences-recovery');await preferences(page,'Save');
  await modal(page).getByLabel('Save AutoRecover information',{exact:true}).uncheck();
  await close(page);
  await page.evaluate(async()=>{const {removeRecovery}=await import('/packages/spreadsheet-engine/src/persistence.ts');await removeRecovery('window:preferences-recovery');});
  await enter(page,'A1','Recovery controlled by preference');
  await page.waitForTimeout(1100);
  const missing=await page.evaluate(async()=>{const {loadRecovery}=await import('/packages/spreadsheet-engine/src/persistence.ts');return await loadRecovery('window:preferences-recovery');});expect(missing).toBeUndefined();
  await preferences(page,'Save');await modal(page).getByLabel('Save AutoRecover information',{exact:true}).check();
  await number(page,'Recovery interval','0.5');await close(page);
  await expect.poll(()=>page.evaluate(async()=>{const {loadRecovery}=await import('/packages/spreadsheet-engine/src/persistence.ts');return(await loadRecovery('window:preferences-recovery'))?.sheets[0].cells.A1?.value;})).toBe('Recovery controlled by preference');
});

test('preferences follow system light and dark appearance, contrast and a narrow viewport',async({page})=>{
  await open(page);await preferences(page);
  await page.evaluate(()=>(window as any).testSystemPreferences.set('theme','light'));
  await expect(modal(page)).toHaveAttribute('data-appearance','light');
  await page.screenshot({path:'docs/spreadsheet/screenshots/preferences-light.png'});
  await page.evaluate(()=>{(window as any).testSystemPreferences.set('theme','dark');(window as any).testSystemPreferences.set('increaseContrast',true);});
  await expect(modal(page)).toHaveAttribute('data-appearance','dark');
  await page.screenshot({path:'docs/spreadsheet/screenshots/preferences-dark.png'});
  await page.setViewportSize({width:640,height:760});
  await modal(page).getByRole('button',{name:'General',exact:true}).click();
  const bounds=await modal(page).boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(640);
  expect(await modal(page).evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
  await expect(modal(page).getByRole('button',{name:'Close Preferences',exact:true})).toBeVisible();
  await page.screenshot({path:'docs/spreadsheet/screenshots/preferences-640.png'});
});

test('Ribbon and Quick Access customizations change live controls and retain command ordering after reload',async({page})=>{
  await open(page);await preferences(page,'Ribbon & Toolbar');
  await modal(page).getByLabel('Data',{exact:true}).uncheck();
  await modal(page).getByLabel('Print Preview',{exact:true}).check();
  for(let i=0;i<3;i++)await modal(page).getByRole('button',{name:'Move Print Preview up',exact:true}).click();
  await modal(page).getByLabel('Redo',{exact:true}).uncheck();
  await close(page);
  await expect(page.getByRole('tab',{name:'Data',exact:true})).toHaveCount(0);
  expect(await page.locator('.sheets-quick-access button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')))).toEqual(['Print Preview','Save','Undo']);
  await page.reload();await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('tab',{name:'Data',exact:true})).toHaveCount(0);
  expect(await page.locator('.sheets-quick-access button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')))).toEqual(['Print Preview','Save','Undo']);
});

test('AutoCorrect replacement and custom list controls affect actual cell entry and fill-handle sequences',async({page})=>{
  await open(page);await preferences(page,'AutoCorrect');
  await modal(page).getByLabel('Automatically correct text as you type',{exact:true}).check();
  await modal(page).getByRole('textbox',{name:'Replace',exact:true}).fill('lope');
  await modal(page).getByRole('textbox',{name:'With',exact:true}).fill('LopeOS');
  await modal(page).getByRole('button',{name:'Add',exact:true}).click();
  await pane(page,'Custom Lists');
  await modal(page).getByRole('textbox',{name:'List entries',exact:true}).fill('Low\nMedium\nHigh');
  await modal(page).getByRole('button',{name:'Add',exact:true}).click();
  await close(page);
  await enter(page,'A1','lope');await expect(cell(page,'A1')).toHaveText('LopeOS');
  await enter(page,'B1','Low');
  await page.getByRole('textbox',{name:'Name box',exact:true}).fill('B1');await page.getByRole('textbox',{name:'Name box',exact:true}).press('Enter');
  const handle=await page.getByRole('button',{name:'Fill handle',exact:true}).boundingBox();
  const destination=await cell(page,'B4').boundingBox();
  await page.mouse.move(handle!.x+handle!.width/2,handle!.y+handle!.height/2);await page.mouse.down();
  await page.mouse.move(destination!.x+destination!.width-4,destination!.y+destination!.height-4,{steps:8});await page.mouse.up();
  await expect(cell(page,'B2')).toHaveText('Medium');await expect(cell(page,'B3')).toHaveText('High');await expect(cell(page,'B4')).toHaveText('Low');
});
