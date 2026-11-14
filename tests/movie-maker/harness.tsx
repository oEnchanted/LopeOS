/** Test-only host. The production app uses its normal SDK manifest and LopeOS window. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import MovieMaker from '../../apps/web/src/apps/movie-maker';
import { AppProvider } from '../../packages/sdk/src';
import { Commands } from '../../apps/web/src/shell/commands';
import type { AppContext } from '../../packages/contracts/src';
import '../../packages/ui/src/styles.css';
const commands = new Commands();
const files = new Map<string, { data: Uint8Array; version: string }>();
const fileWrites: { path: string; options?: { createOnly?: boolean; version?: string }; version: string }[] = [];
let fileRevision = 0;
const context = {
  windowId: 'movie-maker-test', launchArgs: {},
  services: {
    commands,
    files: {
      read: async (path: string) => { const file = files.get(path); if (!file) throw new Error('File not found'); return { content: new TextDecoder().decode(file.data), version: file.version }; },
      write: async (path: string, content: string) => { const version = String(Date.now()); files.set(path, { data: new TextEncoder().encode(content), version }); return { content, version }; },
      readBinary: async (path: string) => { const file = files.get(path); if (!file) throw new Error('File not found'); return file; },
      writeBinary: async (path: string, data: Uint8Array, options?: { createOnly?: boolean; version?: string }) => { const previous = files.get(path); if (options?.createOnly && previous) throw new Error('File already exists. Choose another name.'); if (options?.version && previous?.version !== options.version) throw new Error('The file changed elsewhere. Download a project copy to preserve your edits.'); const version = String(++fileRevision); files.set(path, { data, version }); fileWrites.push({ path, options, version }); return { version }; },
      subscribe: () => () => {},
    },
    settings: { get: (key: string, fallback: unknown) => JSON.parse(localStorage.getItem(`movie.test.${key}`) || 'null') ?? fallback, set: (key: string, value: unknown) => localStorage.setItem(`movie.test.${key}`, JSON.stringify(value)), subscribe: () => () => {} },
    dialogs: { openFile: async () => (window as any).openPath || null, saveFile: async ({ defaultName }: { defaultName?: string } = {}) => (window as any).savePath || `/Documents/${defaultName || 'My movie.lopemovie'}` },
    notify: () => {}, openURL: () => {}, launch: () => {}, statusItems: { register: () => () => {} },
  },
  lifecycle: { setTitle: (title: string) => { document.title = title; }, onBeforeClose: (handler: unknown) => { (window as any).closeGuard = handler; return () => {}; } },
} as unknown as AppContext;
const root = createRoot(document.getElementById('root')!);
Object.assign(window, { testCommands: commands, testFiles: files, testContext: context, testRoot: root, testFileWrites: fileWrites });
root.render(<AppProvider context={context}><MovieMaker context={context}/></AppProvider>);
