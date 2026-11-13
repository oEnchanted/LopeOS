import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureWorkspaceData, restoreWorkspaceData, summarizeWorkspaceData, validateWorkspaceData, type WorkspaceBackupData, type WorkspaceBackupService } from '../../apps/web/src/backup/workspace-data.ts';
import type { FileEntry } from '../../packages/contracts/src/index.ts';

const base64 = (data: string | number[]) => Buffer.from(typeof data === 'string' ? data : data).toString('base64');
const directory = (path: string) => ({ path, type: 'directory' as const });
const file = (path: string, content: string | number[]) => ({ path, type: 'file' as const, data: base64(content) });
function workspace() {
  const entries = new Map<string, FileEntry & { data?: Uint8Array }>();
  const mutations: string[] = []; let version = 0, failWrite = '';
  const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
  const notFound = () => Object.assign(new Error('Not found'), { code: 'NOT_FOUND' });
  const put = (path: string, data?: Uint8Array) => {
    const entry = { path, name: path.split('/').at(-1) || '', type: data ? 'file' as const : 'directory' as const, size: data?.length || 0, modified: '2026-01-01T00:00:00.000Z', version: String(++version), data };
    entries.set(path, entry); return entry;
  };
  put('/');
  const service: WorkspaceBackupService = {
    async list(path) { if (!entries.has(path)) throw notFound(); return [...entries.values()].filter(entry => entry.path !== '/' && parent(entry.path) === path); },
    async stat(path) { const entry = entries.get(path); if (!entry) throw notFound(); return entry; },
    async readBinary(path) { const entry = entries.get(path); if (!entry?.data) throw notFound(); return { data: new Uint8Array(entry.data), version: entry.version! }; },
    async writeBinary(path, data, options) {
      mutations.push(`write ${path}`);
      if (path === failWrite) throw new Error('Disconnected');
      if (options?.createOnly && entries.has(path)) throw new Error('Already exists');
      if (entries.get(parent(path))?.type !== 'directory') throw notFound();
      const entry = put(path, data); return { ...entry, version: entry.version! };
    },
    async mkdir(path) { mutations.push(`mkdir ${path}`); if (entries.has(path)) throw new Error('Already exists'); if (!entries.has(parent(path))) throw notFound(); put(path); },
    async remove(path, options) {
      mutations.push(`remove ${path}`);
      if (!entries.has(path)) throw notFound();
      if (!options?.recursive && [...entries.keys()].some(candidate => parent(candidate) === path)) throw new Error('Directory not empty');
      entries.delete(path);
    },
  };
  return { service, entries, mutations, put, failAt(path: string) { failWrite = path; } };
}

test('workspace backup round-trips hidden files, binary data, and empty directories', async () => {
  const source = workspace();
  source.put('/.config'); source.put('/.config/preferences', new Uint8Array([0, 255, 1, 128])); source.put('/Empty');
  source.put('/plain.txt', new TextEncoder().encode('Hello\n世界'));
  const data = await captureWorkspaceData(undefined, source.service);
  assert.deepEqual(summarizeWorkspaceData(data), { files: 2, folders: 2, bytes: 16 });
  const destination = workspace();
  await restoreWorkspaceData(data, undefined, destination.service);
  assert.deepEqual(destination.entries.get('/.config/preferences')?.data, new Uint8Array([0, 255, 1, 128]));
  assert.equal(new TextDecoder().decode(destination.entries.get('/plain.txt')?.data), 'Hello\n世界');
  assert.equal(destination.entries.get('/Empty')?.type, 'directory');
});

test('validation rejects traversal, runtime aliases, duplicate paths, missing parents and malformed binary before writes', async () => {
  const invalid: unknown[] = [
    { version: 2, entries: [] }, { version: 1, entries: [], secret: true },
    { version: 1, entries: [file('/../escape', '')] }, { version: 1, entries: [file('/home/lope/file', '')] },
    { version: 1, entries: [file('/a//b', '')] }, { version: 1, entries: [file('/a\\b', '')] },
    { version: 1, entries: [directory('/a'), directory('/a')] },
    { version: 1, entries: [file('/missing/child', '')] },
    { version: 1, entries: [file('/parent', ''), file('/parent/child', '')] },
    { version: 1, entries: [{ path: '/bad', type: 'file', data: '!!!=' }] },
    { version: 1, entries: [{ path: '/bad', type: 'file', data: 'AB==' }] },
    { version: 1, entries: [{ path: '/bad', type: 'symlink' }] },
  ];
  const target = workspace();
  for (const value of invalid) await assert.rejects(restoreWorkspaceData(value as WorkspaceBackupData, undefined, target.service));
  assert.deepEqual(target.mutations, []);
});

test('conflicting files abort the entire import before creating preceding entries', async () => {
  const target = workspace(); target.put('/z-existing', new TextEncoder().encode('Keep me'));
  await assert.rejects(restoreWorkspaceData({ version: 1, entries: [directory('/a-new'), file('/z-existing', 'Replacement')] }, undefined, target.service), /conflicts.*z-existing/);
  assert.deepEqual(target.mutations, []);
  assert.equal(new TextDecoder().decode(target.entries.get('/z-existing')!.data), 'Keep me');
});

test('identical existing files are skipped, unrelated files are preserved, and unsorted parents restore first', async () => {
  const target = workspace(); target.put('/same', new TextEncoder().encode('same')); target.put('/unrelated', new TextEncoder().encode('safe'));
  await restoreWorkspaceData({ version: 1, entries: [file('/new/deeper/file', 'new'), directory('/new/deeper'), file('/same', 'same'), directory('/new')] }, undefined, target.service);
  assert.deepEqual(target.mutations, ['mkdir /new', 'mkdir /new/deeper', 'write /new/deeper/file']);
  assert.equal(new TextDecoder().decode(target.entries.get('/unrelated')!.data), 'safe');
});

test('write failures remove additions while preserving preexisting workspace data', async () => {
  const target = workspace(); target.put('/existing', new TextEncoder().encode('safe')); target.failAt('/new/z');
  await assert.rejects(restoreWorkspaceData({ version: 1, entries: [directory('/new'), file('/new/a', 'first'), file('/new/z', 'failed')] }, undefined, target.service), /Import stopped at \/new\/z/);
  assert.deepEqual([...target.entries.keys()], ['/', '/existing']);
});

test('rollback avoids deleting imported files changed after restore and nonempty folders', async () => {
  const target = workspace();
  const result = await restoreWorkspaceData({ version: 1, entries: [directory('/new'), file('/new/file', 'first')] }, undefined, target.service);
  target.put('/new/file', new TextEncoder().encode('edited meanwhile'));
  await assert.rejects(result.rollback(), /could not be removed/);
  assert.equal(new TextDecoder().decode(target.entries.get('/new/file')!.data), 'edited meanwhile');
  assert.ok(target.entries.has('/new'));
});

test('export fails explicitly for inaccessible files, links and files above the runtime limit', async () => {
  const inaccessible = workspace(); inaccessible.put('/secret', new Uint8Array([1])); inaccessible.service.readBinary = async () => { throw new Error('Access denied'); };
  await assert.rejects(captureWorkspaceData(undefined, inaccessible.service), /secret.*Access denied/);
  const linked = workspace(); const entry = linked.put('/link'); (entry as { type: string }).type = 'symlink';
  await assert.rejects(captureWorkspaceData(undefined, linked.service), /link or special/);
  const large = workspace(); const largeFile = large.put('/big', new Uint8Array([1])); largeFile.size = 8 * 1024 * 1024 + 1;
  await assert.rejects(captureWorkspaceData(undefined, large.service), /8 MiB/);
});

test('empty workspaces and empty files are valid', async () => {
  assert.deepEqual(validateWorkspaceData({ version: 1, entries: [] }), { version: 1, entries: [] });
  const target = workspace();
  await restoreWorkspaceData({ version: 1, entries: [file('/empty', '')] }, undefined, target.service);
  assert.equal(target.entries.get('/empty')?.data?.length, 0);
});
