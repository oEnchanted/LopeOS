/** Test-only host. Production launches Writer through its SDK manifest. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import Writer from '../../apps/web/src/apps/writer';
import { AppProvider } from '../../packages/sdk/src';
import { preferences as systemPreferences } from '../../packages/sdk/src/preferences';
(window as any).testSystemPreferences = systemPreferences;
import { Commands } from '../../apps/web/src/shell/commands';
import { fileService } from '../../packages/runtime-client/src';
import { WriterEngine, createDocument } from '../../packages/document-engine/src';
import type { AppContext } from '../../packages/contracts/src';
const query = new URLSearchParams(location.search);
if (query.has('engine')) {
  const host = document.getElementById('root')!;
  host.className = 'writer-app';
  const engine = new WriterEngine(snapshot => { (window as any).snapshot = snapshot; }, error => { (window as any).engineError = String(error); });
  (window as any).testEngine = engine;
  const bytes = query.get('file') ? new Uint8Array(await (await fetch(query.get('file')!)).arrayBuffer()) : createDocument();
  await engine.mount(host, bytes);
  (window as any).engineReady = true;
} else {
  const commands = new Commands();
  const context = {
    windowId: 'writer-test', launchArgs: { path: query.get('path') || '' },
    services: {
      commands, files: fileService,
      settings: { get: (key: string, fallback: unknown) => JSON.parse(localStorage.getItem('test.'+key) || 'null') ?? fallback, set: (key: string,value: unknown) => localStorage.setItem('test.'+key,JSON.stringify(value)), subscribe: () => () => {} },
      dialogs: { openFile: async () => (window as any).openPath || null, saveFile: async () => (window as any).savePath || null },
      notify: () => {}, openURL: () => {}, launch: () => {}, statusItems: { register: () => () => {} },
    },
    lifecycle: { setTitle: (title: string) => { document.title = title; }, onBeforeClose: (fn: unknown) => { (window as any).closeGuard = fn; return () => {}; } },
  } as unknown as AppContext;
  (window as any).testCommands = commands;
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (['s','o','n','f','h','k'].includes(key)) { e.preventDefault(); void commands.execute(`writer.${({s:e.shiftKey?'save-as':'save',o:'open',n:'new',f:'find',h:'replace',k:'link'} as Record<string,string>)[key]}`); }
  });
  createRoot(document.getElementById('root')!).render(<AppProvider context={context}><Writer context={context}/></AppProvider>);
}
