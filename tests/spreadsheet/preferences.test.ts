import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPreferences,
  normalizePreferences,
  readPreferences,
  workbookWithPreferences,
  workbookCellStyle,
  correctTypedText,
  typedHyperlink,
  listFillValue,
  PREFERENCES_KEY,
} from '../../apps/web/src/apps/spreadsheet/preferences.ts';
import type { SettingsService } from '../../packages/contracts/src/index.ts';

test('corrupt saved preferences recover safe defaults without changing valid neighboring settings', () => {
  const result = normalizePreferences({
    appearance: 'unknown', defaultFont: ' ', defaultFontSize: 999, newSheetCount: 0,
    defaultZoom: Infinity, recoveryInterval: -1, autocompleteMinLetters: 1.5,
    formulaBar: false, headings: 'false', gridlineColor: 'url(https://example.invalid)',
    errorIndicatorColor: '#abc', locale: 'not_a_locale', extraCommand: 'run code',
  });
  assert.equal(result.appearance, defaultPreferences.appearance);
  assert.equal(result.defaultFont, defaultPreferences.defaultFont);
  assert.equal(result.defaultFontSize, defaultPreferences.defaultFontSize);
  assert.equal(result.newSheetCount, 1);
  assert.equal(result.defaultZoom, 100);
  assert.equal(result.recoveryInterval, defaultPreferences.recoveryInterval);
  assert.equal(result.autocompleteMinLetters, 1);
  assert.equal(result.formulaBar, false);
  assert.equal(result.headings, true);
  assert.equal(result.gridlineColor, defaultPreferences.gridlineColor);
  assert.equal(result.errorIndicatorColor, defaultPreferences.errorIndicatorColor);
  assert.equal(result.locale, 'en-US');
  assert.equal('extraCommand' in result, false);
  assert.deepEqual(normalizePreferences(null), defaultPreferences);
  assert.deepEqual(normalizePreferences(['bad']), defaultPreferences);
});

test('numeric boundaries and persisted enums accept supported values only', () => {
  const result = normalizePreferences({defaultFontSize: 96, newSheetCount:32, defaultZoom:25, recoveryInterval:600, autocompleteMinLetters:10, appearance:'dark', defaultFormat:'xlsx', enterDirection:'left'});
  assert.equal(result.defaultFontSize,96); assert.equal(result.newSheetCount,32);
  assert.equal(result.defaultZoom,25); assert.equal(result.recoveryInterval,600);
  assert.equal(result.autocompleteMinLetters,10); assert.equal(result.appearance,'dark');
  assert.equal(result.defaultFormat,'xlsx'); assert.equal(result.enterDirection,'left');
  const invalid=normalizePreferences({newSheetCount:2.5, defaultFontSize:NaN, recoveryInterval:.49, defaultFormat:'xlsm'});
  assert.equal(invalid.newSheetCount,1); assert.equal(invalid.defaultFontSize,11);
  assert.equal(invalid.recoveryInterval,defaultPreferences.recoveryInterval); assert.equal(invalid.defaultFormat,'lopebook');
});

test('ribbon customization cannot hide Home or create unknown commands, and lists are bounded and detached', () => {
  const saved = {hiddenRibbonTabs:['Home','Data','Data','Developer',5],quickAccess:['print','save','print','delete-everything'],customLists:[['Red','Green','Blue'],[],[''],[12]],replacements:[{from:'a+b',to:'sum'},{from:'',to:'bad'},null]};
  const result=normalizePreferences(saved);
  assert.deepEqual(result.hiddenRibbonTabs,['Data']); assert.deepEqual(result.quickAccess,['print','save']);
  assert.deepEqual(result.customLists,[['Red','Green','Blue']]); assert.deepEqual(result.replacements,[{from:'a+b',to:'sum'}]);
  result.customLists[0][0]='Changed'; result.replacements[0].to='Changed';
  assert.equal(saved.customLists[0][0],'Red'); assert.equal(saved.replacements[0]!.to,'sum');
  const clone=normalizePreferences({});clone.customLists[0][0]='Mutated';clone.replacements[0].from='Mutated';
  assert.equal(defaultPreferences.customLists[0][0],'Sun');assert.equal(defaultPreferences.replacements[0].from,'(c)');
  assert.equal(normalizePreferences({replacements:Array.from({length:201},()=>({from:'x',to:'y'}))}).replacements.length,200);
});

test('partial stored settings migrate through defaults using the application preference namespace', () => {
  let requested='';
  const settings={get<T>(key:string,_fallback:T):T{requested=key;return {defaultFont:'Georgia',newSheetCount:3,formulaBar:false} as T;},set(){},subscribe(){return()=>{};}} as SettingsService;
  const result=readPreferences(settings);
  assert.equal(requested,PREFERENCES_KEY);assert.equal(result.defaultFont,'Georgia');assert.equal(result.newSheetCount,3);
  assert.equal(result.formulaBar,false);assert.equal(result.statusBar,true);assert.equal(result.recoveryEnabled,true);
});

test('new-workbook defaults create separate sparse sheets and document-local default styles', () => {
  const settings=normalizePreferences({defaultFont:'Georgia',defaultFontSize:14,newSheetCount:3,gridlines:false,userName:'Test author'});
  const first=workbookWithPreferences(settings,'First'),second=workbookWithPreferences(settings,'Second');
  assert.equal(first.name,'First');assert.deepEqual(first.sheets.map(sheet=>sheet.name),['Sheet1','Sheet2','Sheet3']);
  assert.equal(new Set(first.sheets.map(sheet=>sheet.id)).size,3);
  assert.ok(first.sheets.every(sheet=>Object.keys(sheet.cells).length===0&&!sheet.showGridlines));
  assert.deepEqual(workbookCellStyle(first),{fontFamily:'Georgia',fontSize:14});assert.equal(first.metadata?.author,'Test author');
  first.sheets[0].cells.A1={value:'Independent'};assert.equal(second.sheets[0].cells.A1,undefined);
  settings.defaultFont='Arial';assert.equal(workbookCellStyle(first).fontFamily,'Georgia');
});

test('AutoCorrect uses literal word boundaries and never rewrites formulas, quoted text, identifiers or URLs', () => {
  const settings=normalizePreferences({autoCorrect:true,replacements:[{from:'teh',to:'the'},{from:'a+b',to:'sum'},{from:'(c)',to:'©'}]});
  assert.equal(correctTypedText('teh quick a+b (c)',settings),'the quick sum ©');
  assert.equal(correctTypedText('tehran aab',settings),'tehran aab');
  for(const input of ['=IF(A1="teh",1,0)',"'teh",'001teh','-123teh','https://example.invalid/teh','mailto:teh@example.invalid'])assert.equal(correctTypedText(input,settings),input);
  assert.equal(correctTypedText('teh',normalizePreferences({autoCorrect:false})),'teh');
});

test('capitalization preferences and hyperlink recognition are actual text transformations with safe protocols', () => {
  const settings=normalizePreferences({capitalizeDays:true,correctInitialCapitals:true,capitalizeSentences:true});
  assert.equal(correctTypedText('we meet monday. TEst this.',settings),'We meet Monday. Test this.');
  assert.equal(typedHyperlink('https://example.org/a',settings),'https://example.org/a');
  assert.equal(typedHyperlink('person@example.org',settings),'mailto:person@example.org');
  assert.equal(typedHyperlink('javascript:alert(1)',settings),undefined);
  assert.equal(typedHyperlink('file:///private/example',settings),undefined);
  assert.equal(typedHyperlink('https://example.org',normalizePreferences({autoHyperlinks:false})),undefined);
});

test('custom fill lists cycle in both directions and respect case-insensitive matching', () => {
  const settings=normalizePreferences({customLists:[['Low','Medium','High']]});
  assert.equal(listFillValue('medium',1,settings),'High');assert.equal(listFillValue('Medium',2,settings),'Low');
  assert.equal(listFillValue('Low',-1,settings),'High');assert.equal(listFillValue('Unknown',1,settings),undefined);
  assert.equal(listFillValue('Mon',7,normalizePreferences({})),'Mon');
});
