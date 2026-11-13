import {test,expect} from '@playwright/test';
import {PreferenceStore,validatePreferenceImport,userPreferenceKey} from '../../packages/sdk/src/preferences';
class MemoryStorage{data=new Map<string,string>();getItem=(k:string)=>this.data.get(k)??null;setItem=(k:string,v:string)=>{this.data.set(k,v);};removeItem=(k:string)=>{this.data.delete(k);};}
test('migration preserves legacy preferences and separates documents, assets, and history',()=>{const backend=new MemoryStorage();backend.setItem('lope.theme','dark');backend.setItem('lope.dockSize','60');backend.setItem('lope.reducedTransparency','true');backend.setItem('lope.writer.document.window1',JSON.stringify({path:'/Documents/saved.docx'}));backend.setItem('lope.calculator.history',JSON.stringify([{expression:'2+2',result:'4'}]));const store=new PreferenceStore(backend);expect(store.getSnapshot().theme).toBe('dark');expect(store.getSnapshot().dockSize).toBe(60);expect(store.getSnapshot().reduceTransparency).toBe(true);expect(store.get('writer.document.window1',null)).toEqual({path:'/Documents/saved.docx'});expect(store.get('calculator.history',[])).toHaveLength(1);store.set('personalWallpaper',{asset:'data:image/png;base64,AA',name:'Mine'});store.reset();expect(store.get('writer.document.window1',null)).toEqual({path:'/Documents/saved.docx'});expect(store.get('personalWallpaper',null)).not.toBeNull();expect(store.get('calculator.history',[])).toHaveLength(1);store.clearAppHistory();expect(store.get('calculator.history',[])).toEqual([]);expect(store.get('writer.document.window1',null)).not.toBeNull();const exported=store.export();expect(JSON.stringify(exported)).not.toContain('saved.docx');expect(JSON.stringify(exported)).not.toContain('data:image');expect(validatePreferenceImport(exported).count).toBeGreaterThan(60);});
test('storage failure retains session changes and accurately reports persistence',()=>{const store=new PreferenceStore({getItem:()=>null,setItem:()=>{throw new Error('Quota exceeded');},removeItem:()=>{}});store.set('theme','dark');expect(store.getSnapshot().theme).toBe('dark');expect(store.getStatus().persistent).toBe(false);expect(store.export().preferences.theme).toBe('dark');expect(new PreferenceStore().getStatus().persistent).toBe(false);});
test('imports reject corrupt files, secret keys, invalid scope, duplicate status items, and out-of-range values',()=>{for(const preferences of [{theme:'evil'}, {interfaceScale:0}, {token:'secret'}, {searchRoots:['/Documents/../etc']}, {statusOrder:['clock','clock']}, {'weather.location':{name:'Denver',latitude:39,longitude:-104,token:'secret'}}])expect(()=>validatePreferenceImport({version:2,preferences})).toThrow();expect(()=>validatePreferenceImport({version:999,preferences:{theme:'dark'}})).toThrow();expect(()=>validatePreferenceImport({version:2,preferences:[]})).toThrow();const store=new PreferenceStore(new MemoryStorage());expect(()=>store.set('runtime.token','secret')).toThrow();expect(()=>store.set('__proto__',{bad:true})).toThrow();expect(validatePreferenceImport({version:2,preferences:{theme:'dark',soundVolume:0}}).count).toBe(2);});

test('authorized wallpaper migration replaces the temporary fallback once and preserves personal choices',()=>{
  const backend=new MemoryStorage();backend.setItem('lope.preferences.v2',JSON.stringify({version:2,preferences:{wallpaper:'aurora',theme:'dark'}}));
  const migrated=new PreferenceStore(backend);expect(migrated.getSnapshot().wallpaper).toBe('perfecthue-light');expect(migrated.getSnapshot().theme).toBe('dark');
  migrated.set('wallpaper','aurora');expect(new PreferenceStore(backend).getSnapshot().wallpaper).toBe('aurora');
  const personal=new MemoryStorage();personal.setItem('lope.wallpaper','personal');expect(new PreferenceStore(personal).getSnapshot().wallpaper).toBe('personal');
  const dark=new MemoryStorage();dark.setItem('lope.wallpaper','night');expect(new PreferenceStore(dark).getSnapshot().wallpaper).toBe('perfecthue-dark');
});

test('setup writes every chosen preference into defaults and the new account without sharing later changes', () => {
  const backend = new MemoryStorage();
  const store = new PreferenceStore(backend);
  const chosen = { theme: 'dark' as const, wallpaper: 'sky', background: 'blue-hour' as const, accent: '#7756c5', reduceMotion: true, reduceTransparency: true, increaseContrast: true, textSize: 85 };
  store.apply(chosen);
  store.copyToUser('alex');
  const saved = (key: string) => JSON.parse(backend.getItem(key)!).preferences;
  expect(saved('lope.preferences.v2')).toMatchObject(chosen);
  expect(saved(userPreferenceKey('alex'))).toMatchObject(chosen);
  store.activateUser('alex');
  store.set('textSize', 150);
  expect(saved(userPreferenceKey('alex')).textSize).toBe(150);
  expect(saved('lope.preferences.v2').textSize).toBe(85);
  store.activateUser(null);
  expect(store.getSnapshot()).toMatchObject(chosen);
  store.activateUser('new-user');
  expect(store.getSnapshot()).toMatchObject(chosen);
  const reopened = new PreferenceStore(backend);
  reopened.activateUser('alex');
  expect(reopened.getSnapshot().textSize).toBe(150);
});

test('setup surfaces a failed account-scope write and leaves system defaults available', () => {
  const backend = new MemoryStorage();
  const store = new PreferenceStore(backend);
  store.apply({ theme: 'dark', textSize: 150 });
  const write = backend.setItem;
  backend.setItem = (key, value) => { if (key === userPreferenceKey('alex')) throw new Error('Quota exceeded'); write(key, value); };
  expect(() => store.copyToUser('alex')).toThrow('Setup preferences could not be saved');
  expect(store.getStatus().persistent).toBe(false);
  expect(backend.getItem(userPreferenceKey('alex'))).toBeNull();
  expect(JSON.parse(backend.getItem('lope.preferences.v2')!).preferences.textSize).toBe(150);
  expect(() => new PreferenceStore().copyToUser('alex')).toThrow();
});

test('account refresh reads its own values and setup only changes system defaults', () => {
  const backend = new MemoryStorage();
  const store = new PreferenceStore(backend);
  store.copyToUser('alex');
  store.activateUser('alex');
  store.set('theme', 'dark');
  backend.setItem('lope.preferences.v2', JSON.stringify({ version: 2, preferences: { theme: 'light', textSize: 130 } }));
  store.refresh();
  expect(store.getSnapshot().theme).toBe('dark');
  store.activateUser(null);
  expect(store.getSnapshot().textSize).toBe(130);
  store.set('theme', 'system');
  store.activateUser('alex');
  expect(store.getSnapshot().theme).toBe('dark');
});
