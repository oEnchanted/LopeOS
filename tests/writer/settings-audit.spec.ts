import { test, expect, type Page } from '@playwright/test';
import { writerFilesystem } from './runtime';
import { seedSession } from '../setup/seed-session.mjs';

const preferences = (page: Page) => page.getByRole('dialog',{name:'Writer Preferences',exact:true});
async function open(page: Page, category?: string) {
  await writerFilesystem(page);
  await page.addInitScript(()=>localStorage.setItem('test.writer.autosave','false'));
  await page.goto('/tests/writer/harness.html');
  await expect(page.locator('.writer-opening')).toHaveCount(0,{timeout:30000});
  await page.getByRole('button',{name:'Preferences',exact:true}).click();
  if (category) await preferences(page).getByRole('button',{name:category,exact:true}).click();
}

test('Preferences search finds actual option labels before their panes have been visited',async({page})=>{
  await open(page);
  const modal=preferences(page),search=modal.getByLabel('Search preferences',{exact:true});
  await search.fill('modern comments');
  await modal.getByRole('button',{name:'Open General preferences',exact:true}).click();
  await expect(modal.getByLabel('Enable modern comments',{exact:true})).toBeVisible();
  await search.fill('Print background colors and images');
  await modal.getByRole('button',{name:'Open Print preferences',exact:true}).click();
  await expect(modal.getByLabel('Print background colors and images',{exact:true})).toBeVisible();
  await search.fill('country region');
  await modal.getByRole('button',{name:'Open User Information preferences',exact:true}).click();
  await expect(modal.getByLabel('Country/Region:',{exact:true})).toBeVisible();
});

test('AutoCorrect tabs and replacement list support arrow keys and roving focus',async({page})=>{
  await open(page,'AutoCorrect');
  const modal=preferences(page),tabs=modal.getByRole('tablist',{name:'AutoCorrect sections',exact:true});
  await tabs.getByRole('tab',{name:'AutoCorrect',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab',{name:'Math AutoCorrect',exact:true})).toBeFocused();
  await expect(tabs.getByRole('tab',{name:'Math AutoCorrect',exact:true})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('End'); await expect(tabs.getByRole('tab',{name:'AutoText',exact:true})).toBeFocused();
  await page.keyboard.press('Home'); await expect(tabs.getByRole('tab',{name:'AutoCorrect',exact:true})).toBeFocused();
  await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
  const options=modal.getByRole('listbox',{name:'AutoCorrect replacements',exact:true}).getByRole('option');
  await options.first().focus(); await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toBeFocused(); await expect(options.nth(1)).toHaveAttribute('aria-selected','true');
  await expect(modal.getByLabel('AutoCorrect replace',{exact:true})).toHaveValue('(c)');
  await page.keyboard.press('End'); await expect(options.last()).toBeFocused();
  await page.keyboard.press('Home'); await expect(options.first()).toBeFocused();
  await expect(modal.getByRole('listbox').locator('[tabindex="0"]')).toHaveCount(1);
});

test('Preferences honors OS larger text and increased contrast in both themes',async({page})=>{
  await open(page,'General');
  const modal=preferences(page),label=modal.getByLabel('Show file extensions',{exact:true}).locator('..');
  const before=await label.evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
  await page.evaluate(()=>{(window as any).testSystemPreferences.set('textSize',150);(window as any).testSystemPreferences.set('increaseContrast',true);});
  await expect(modal).toHaveAttribute('data-increase-contrast','true');
  await expect.poll(()=>label.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBe(before*1.5);
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>(window as any).testSystemPreferences.set('theme',theme),theme);
    await expect(modal).toHaveAttribute('data-appearance',theme);
    const styles=await modal.evaluate(node=>({border:getComputedStyle(node.querySelector('select')!).borderTopWidth,checkBorder:getComputedStyle(node.querySelector('input[type=checkbox]:not(:disabled)')!).borderTopWidth,opacity:getComputedStyle(node.querySelector('.wr-pref-unavailable')!).opacity}));
    expect(styles.border).toBe('2px');expect(styles.checkBorder).toBe('2px');expect(styles.opacity).toBe('1');
    await modal.getByLabel('Search preferences',{exact:true}).focus();
    await expect.poll(()=>modal.locator('.wr-pref-search').evaluate(node=>getComputedStyle(node).outlineStyle)).toBe('solid');
  }
  await page.setViewportSize({width:700,height:700});
  const dimensions=await modal.evaluate(node=>({scroll:node.scrollWidth,width:node.clientWidth}));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width+1);
});

test('recovery interval follows shared updates and preserves conflicting drafts',async({page})=>{
  await writerFilesystem(page);await seedSession(page);
  await page.setViewportSize({width:1440,height:1000});
  await page.addInitScript(()=>localStorage.setItem('lope.layout.v1',JSON.stringify([{id:'writer-recovery-audit',appId:'lope.writer',title:'Writer',state:'normal',bounds:{x:36,y:42,width:1366,height:840},zIndex:1,launchArgs:{}}])));
  await page.goto('/');
  const app=page.locator('[data-app-id="lope.writer"]');
  await expect(app.getByRole('button',{name:'Save',exact:true})).toBeEnabled({timeout:30000});
  await app.getByRole('button',{name:'Preferences',exact:true}).click();
  const modal=preferences(page);await modal.getByRole('button',{name:'Save',exact:true}).click();
  const updateInterval=async(value:number)=>page.evaluate(async value=>{
    const url=performance.getEntriesByType('resource').map(entry=>entry.name).find(name=>new URL(name).pathname === '/packages/sdk/src/preferences.ts');
    if(!url)throw new Error('The public SDK preference module was not loaded.');
    const {preferences}=await import(url);
    preferences.set('writer.preferences',{...preferences.get('writer.preferences',{}),recoveryDelay:value});
  },value);
  const interval=modal.getByLabel('Recovery interval',{exact:true});
  await updateInterval(7);await expect(interval).toHaveValue('7');
  await interval.fill('8');await updateInterval(9);
  await expect(interval).toHaveValue('8');
  await modal.getByRole('button',{name:'Show all preferences',exact:true}).focus();
  await expect(modal.getByText('The interval changed in another Writer window.',{exact:false})).toBeVisible();
  await modal.getByRole('button',{name:'Use my interval',exact:true}).click();
  await expect(interval).toHaveValue('8');
  await updateInterval(10);await expect(interval).toHaveValue('10');
});

test('replacement limit prevents silent discard and still allows editing existing rules',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('test.writer.preferences',JSON.stringify({replacements:Array.from({length:200},(_,index)=>({from:`word${index}`,to:`replacement${index}`}))})));
  await open(page,'AutoCorrect');
  const modal=preferences(page),options=modal.getByRole('listbox').getByRole('option');
  await modal.getByLabel('AutoCorrect replace',{exact:true}).fill('extra');await modal.getByLabel('AutoCorrect with',{exact:true}).fill('new value');
  await expect(modal.getByRole('button',{name:'Add',exact:true})).toBeDisabled();
  await expect(modal.getByText('The 200-replacement limit has been reached.',{exact:false})).toBeVisible();
  await options.first().click();await modal.getByLabel('AutoCorrect with',{exact:true}).fill('updated');
  await modal.getByRole('button',{name:'Replace',exact:true}).click();
  await expect(options).toHaveCount(200);await expect(options.last()).toContainText('updated');
});

test('Preferences is a compact utility window with readable category labels in the real shell',async({page})=>{
 await writerFilesystem(page);await seedSession(page);await page.setViewportSize({width:1440,height:1000});
 await page.addInitScript(()=>localStorage.setItem('lope.layout.v1',JSON.stringify([{id:'writer-compact-preferences',appId:'lope.writer',title:'Writer',state:'normal',bounds:{x:36,y:42,width:1366,height:840},zIndex:1,launchArgs:{}}])));
 await page.goto('/');const app=page.locator('[data-app-id="lope.writer"]');
 await expect(app.getByRole('button',{name:'Preferences',exact:true})).toBeVisible({timeout:30000});
 await app.getByRole('button',{name:'Preferences',exact:true}).click();const modal=preferences(page);
 const rect=await modal.boundingBox();expect(rect!.width).toBeLessThanOrEqual(850);expect(rect!.height).toBeLessThanOrEqual(640);
 await expect(modal.locator('.wr-pref-category-grid button')).toHaveCount(16);
 for(const dark of [true,false]){
  await page.locator('.menubar').getByRole('menuitem',{name:'View',exact:true}).click();
  await page.getByRole('menuitemcheckbox',{name:/^Dark appearance/}).click();
  await expect(modal).toHaveAttribute('data-appearance',dark?'dark':'light');
  await expect.poll(()=>modal.evaluate(surface=>{
   const content=surface.querySelector('.wr-preferences-content')!,visible=content.getBoundingClientRect();
   const luminance=(rgb:number[])=>rgb.slice(0,3).map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
   const rgb=(color:string)=>color.match(/[\d.]+/g)!.map(Number);
   return [...surface.querySelectorAll<HTMLElement>('.wr-pref-category-grid button')].every(button=>{
    const label=button.lastElementChild!,text=getComputedStyle(label),bounds=button.getBoundingClientRect();
    let ancestor:Element|null=button,background='rgba(0, 0, 0, 0)';
    while(ancestor&&(!rgb(background)[3]&&rgb(background).length===4)){background=getComputedStyle(ancestor).backgroundColor;ancestor=ancestor.parentElement;}
    const foregroundL=luminance(rgb(text.color)),backgroundL=luminance(rgb(background));
    const contrast=(Math.max(foregroundL,backgroundL)+.05)/(Math.min(foregroundL,backgroundL)+.05);
    return contrast>=4.5&&parseFloat(text.fontSize)<=16&&bounds.top>=visible.top-1&&bounds.bottom<=visible.bottom+1;
   });
  })).toBe(true);
 }
});
