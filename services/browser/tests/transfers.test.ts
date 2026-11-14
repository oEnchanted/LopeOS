import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadName, saveBrowserDownload } from '../../../apps/web/src/apps/browser/transfers.ts';
import { BrowserClient } from '../../../packages/browser-client/src/index.ts';
import { createFileService, RuntimeClient } from '../../../packages/runtime-client/src/index.ts';
import type { FileService } from '../../../packages/contracts/src/index.ts';

test('downloads enter client LopeDrive create-only, with collisions and no server vault API', async () => {
  const calls: unknown[] = [];
  const files = {
    mkdir: async (path: string) => { calls.push(['mkdir',path]); },
    writeBinary: async (path: string, data: Uint8Array, options: { createOnly?: boolean; assertCurrent?: () => void }) => {
      assert.equal(typeof options.assertCurrent, 'function');
      const { assertCurrent: _guard, ...wireOptions } = options;
      calls.push(['write',path,[...data],wireOptions]);
      if (path.endsWith('/chosen.bin')) throw Object.assign(new Error('exists'),{code:'CONFLICT'});
      return {version:'new'};
    },
  } as unknown as FileService;
  assert.equal(await saveBrowserDownload(files,new Blob([new Uint8Array([0,1,255])]),'chosen.bin'),'/LopeDrive/Downloads/1-chosen.bin');
  assert.deepEqual(calls,[['mkdir','/LopeDrive/Downloads'],['write','/LopeDrive/Downloads/chosen.bin',[0,1,255],{createOnly:true}],['write','/LopeDrive/Downloads/1-chosen.bin',[0,1,255],{createOnly:true}]]);
  assert.equal(downloadName('../unsafe\\name'),'.._unsafe_name');
  assert.ok(new TextEncoder().encode(downloadName('世界'.repeat(200))).byteLength <= 180);
});

test('multiple uploads stream only the selected files, then commit exactly those', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  let next = 0;
  const client = new BrowserClient(async (url, options) => {
    calls.push({ url: String(url), options });
    return String(url).endsWith('/files') ? Response.json({ id: 'staged-' + next++ }) : Response.json({ id: 'session' });
  });
  await client.uploadFiles('session','chooser',[new File(['selected one'],'one.txt'),new File(['selected two'],'two.txt')]);
  const staged = calls.filter(call => call.url.endsWith('/uploads/chooser/files'));
  assert.deepEqual(await Promise.all(staged.map(async call => [decodeURIComponent(new Headers(call.options?.headers).get('x-file-name') ?? ''), await (call.options?.body as File).text()])),[['one.txt','selected one'],['two.txt','selected two']]);
  const commit = calls.at(-1)!;
  assert.match(commit.url, /\/uploads\/chooser$/);
  assert.deepEqual(JSON.parse(String(commit.options?.body)), { staged: ['staged-0', 'staged-1'] });
});

test('opening an HTML file sends only that file, and refuses other types and oversized files locally', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const client = new BrowserClient(async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ id: 'session' }); });
  await client.openFile('session', new File(['<title>Ünïcode</title>'], 'My page.html'));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sessions\/session\/opened-files$/);
  assert.equal(calls[0].options?.method, 'POST');
  assert.equal(decodeURIComponent(new Headers(calls[0].options?.headers).get('x-file-name') ?? ''), 'My page.html');
  assert.equal(await (calls[0].options?.body as File).text(), '<title>Ünïcode</title>');
  await assert.rejects(client.openFile('session', new File(['secret'], 'notes.txt')), /HTML files/);
  const large = new File(['x'], 'large.html'); Object.defineProperty(large, 'size', { value: 32 * 1024 * 1024 + 1 });
  await assert.rejects(client.openFile('session', large), /32 MB/);
  assert.equal(calls.length, 1);
});

test('download bytes are not written after the account changes during blob conversion', async () => {
  const bytes = new Uint8Array([17, 29, 53]);
  let account = 'original';
  let finishConversion!: (value: ArrayBuffer) => void;
  let conversionStarted!: () => void;
  const started = new Promise<void>(resolve => { conversionStarted = resolve; });
  const converted = new Promise<ArrayBuffer>(resolve => { finishConversion = resolve; });
  const blob = new Blob([bytes]);
  blob.arrayBuffer = () => { conversionStarted(); return converted; };
  const writes: string[] = [];
  const files = {
    mkdir: async () => {},
    writeBinary: async () => { writes.push(account); return { version: 'saved' }; },
  } as unknown as FileService;
  const pending = saveBrowserDownload(files, blob, 'original-account.bin', () => {
    if (account !== 'original') throw new Error('Account changed');
  });
  await started;
  account = 'different';
  finishConversion(bytes.buffer);
  await assert.rejects(pending, /Account changed/);
  assert.deepEqual(writes, []);
});

test('expired worker sessions request a fresh owned session instead of retrying an old id forever', async () => {
  const client = new BrowserClient(async()=>new Response(null,{status:404}));
  let reconnect!: () => void;
  const expired = new Promise<void>(resolve => { reconnect=resolve; });
  const unsubscribe=client.subscribe('old-session',()=>assert.fail('No state expected'),()=>{},reconnect);
  await expired; unsubscribe();
});

test('remote file guards stay local and recheck identity after asynchronous credential lookup', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const sent: unknown[] = [];
  globalThis.fetch = async (_url, options) => {
    const value = JSON.parse(String(options?.body));
    sent.push(value);
    return Response.json({ ...value, name: 'file.bin', type: 'file', modifiedAt: 0, version: 'saved' });
  };
  let releaseToken!: (value: string) => void;
  const token = new Promise<string>(resolve => { releaseToken = resolve; });
  const files = createFileService(new RuntimeClient({ baseUrl: 'https://lope.example', getToken: () => token }));
  let current = true;
  const options = { createOnly: true, assertCurrent: () => { if (!current) throw new Error('Account changed'); } };
  const pending = files.writeBinary('/file.bin', new Uint8Array([0, 255]), options);
  current = false;
  releaseToken('private-test-token');
  await assert.rejects(pending, /Account changed/);
  assert.deepEqual(sent, []);
  current = true;
  await files.writeBinary('/file.bin', new Uint8Array([0, 255]), options);
  assert.deepEqual(sent, [{ path: '/file.bin', data: 'AP8=', createOnly: true }]);
});
