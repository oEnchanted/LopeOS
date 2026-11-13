import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountLopeDrive } from '../../packages/runtime-client/src/mounted-files.ts';
import type { FileEntry } from '../../packages/contracts/src/index.ts';

function fixture(root: string) {
  const data = new Map<string, { content: string; version: string }>();
  let revision = 0;
  const stat = async (path: string): Promise<FileEntry> => {
    if (path === root) return { path, name: root, type: 'directory', size: 0, modified: '' };
    const file = data.get(path); if (!file) throw Object.assign(new Error('Missing'), { code: 'NOT_FOUND' });
    // Runtime metadata intentionally omits content versions.
    return { path, name: path.split('/').at(-1)!, type: 'file', size: file.content.length, modified: '' };
  };
  const write = async (path: string, content: string, options?: { createOnly?: boolean }) => {
    if (data.has(path) && options?.createOnly) throw Object.assign(new Error('Exists'), { code: 'CONFLICT' });
    const file = { content, version: String(++revision) }; data.set(path, file); return file;
  };
  const service = {
    data, stat, write,
    list: async (_path: string) => Promise.all([...data.keys()].map(stat)),
    read: async (path: string) => { await stat(path); return data.get(path)!; },
    readBinary: async (path: string) => { await stat(path); const file = data.get(path)!; return { data: new TextEncoder().encode(file.content), version: file.version }; },
    writeBinary: async (path: string, bytes: Uint8Array, options?: { createOnly?: boolean }) => write(path, new TextDecoder().decode(bytes), options),
    create: async (path: string, content: string) => write(path, content, { createOnly: true }),
    mkdir: async () => {}, rename: async () => {}, move: async () => {}, copy: async () => {},
    remove: async (path: string, options?: { version?: string }) => { if (options?.version && data.get(path)?.version !== options.version) throw new Error('Version conflict'); data.delete(path); },
    subscribe: () => () => {},
  };
  return service;
}
test('moving a runtime file to LopeDrive verifies read versions even when stat has no version', async () => {
  const runtime = fixture('/'), drive = fixture('/LopeDrive'), fs = mountLopeDrive(runtime, drive);
  await runtime.write('/a.txt', 'keep these bytes');
  await fs.move('/a.txt', '/LopeDrive/a.txt');
  assert.equal(runtime.data.has('/a.txt'), false);
  assert.equal((await drive.read('/LopeDrive/a.txt')).content, 'keep these bytes');
  await fs.move('/LopeDrive/a.txt', '/back.txt');
  assert.equal((await runtime.read('/back.txt')).content, 'keep these bytes');
  assert.equal(drive.data.has('/LopeDrive/a.txt'), false);
});
test('cross-volume destination collisions preserve the source and existing destination', async () => {
  const runtime = fixture('/'), drive = fixture('/LopeDrive'), fs = mountLopeDrive(runtime, drive);
  await runtime.write('/a.txt', 'source'); await drive.write('/LopeDrive/a.txt', 'existing');
  await assert.rejects(fs.move('/a.txt', '/LopeDrive/a.txt'));
  assert.equal((await runtime.read('/a.txt')).content, 'source');
  assert.equal((await drive.read('/LopeDrive/a.txt')).content, 'existing');
});
test('cross-volume copy keeps a concurrently changed source before any deletion', async () => {
  const runtime = fixture('/'), drive = fixture('/LopeDrive');
  await runtime.write('/a.txt', 'original');
  const write = drive.writeBinary;
  drive.writeBinary = async (...args) => { const result = await write(...args); await runtime.write('/a.txt', 'new edit'); return result; };
  await assert.rejects(mountLopeDrive(runtime, drive).move('/a.txt', '/LopeDrive/a.txt'), /changed/);
  assert.equal((await runtime.read('/a.txt')).content, 'new edit');
  assert.equal((await drive.read('/LopeDrive/a.txt')).content, 'original');
});
