import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileEntry, FileService } from '../../packages/contracts/src/index.ts';
import { emptyTrash, listTrash, moveToTrash, removeTrashItem, restoreTrashItem, TRASH_PATH } from '../../apps/web/src/shell/trash.ts';

async function workspace(t: { after(callback: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'lope-trash-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const resolve = (path: string) => join(directory, path);
  const info = async (path: string): Promise<FileEntry> => {
    const data = await stat(resolve(path));
    return { path, name: path.split('/').at(-1)!, type: data.isDirectory() ? 'directory' : 'file', size: data.size, modified: data.mtime.toISOString() };
  };
  const service: FileService = {
    stat: info,
    async list(path) { return Promise.all((await readdir(resolve(path))).map(name => info(`${path === '/' ? '' : path}/${name}`))); },
    async read(path) { return { content: await readFile(resolve(path), 'utf8'), version: '1' }; },
    async write(path, content, options) {
      await writeFile(resolve(path), content, { flag: typeof options === 'object' && options.createOnly ? 'wx' : 'w' });
      return { content, version: '1' };
    },
    async mkdir(path) { await mkdir(resolve(path)); },
    async rename(path, target) {
      // The real runtime implements this with an atomic RENAME_NOREPLACE.
      try { await stat(resolve(target)); throw Object.assign(new Error('The destination already exists.'), { code: 'CONFLICT' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rename(resolve(path), resolve(target));
    },
    async remove(path, options) {
      if ((await stat(resolve(path))).isDirectory() && !options?.recursive) await rmdir(resolve(path));
      else await rm(resolve(path), { recursive: options?.recursive ?? false });
    },
    subscribe() { return () => {}; },
  };
  await service.mkdir('/Documents');
  await service.mkdir('/Downloads');
  return service;
}

test('Trash is lazy and recovers files and folders with their complete contents', async t => {
  const fs = await workspace(t);
  assert.deepEqual(await listTrash(fs), []);
  await assert.rejects(fs.stat(TRASH_PATH));
  await fs.mkdir('/Documents/Project');
  await fs.write('/Documents/Project/notes.txt', 'notes\nwith unicode: 🐾');
  const trashed = await moveToTrash(fs, '/Documents/Project');
  await assert.rejects(fs.stat('/Documents/Project'));
  assert.equal((await fs.read(`${trashed.path}/notes.txt`)).content, 'notes\nwith unicode: 🐾');
  const [persisted] = await listTrash(fs);
  assert.equal(persisted.name, 'Project');
  assert.equal(persisted.originalPath, '/Documents/Project');
  assert.equal(await restoreTrashItem(fs, persisted), '/Documents/Project');
  assert.equal((await fs.read('/Documents/Project/notes.txt')).content, 'notes\nwith unicode: 🐾');
  assert.deepEqual(await listTrash(fs), []);
});

test('same-name items retain independent recovery metadata and restoration never overwrites', async t => {
  const fs = await workspace(t);
  await fs.write('/Documents/report.txt', 'documents');
  await fs.write('/Downloads/report.txt', 'downloads');
  const items = await Promise.all([moveToTrash(fs, '/Documents/report.txt'), moveToTrash(fs, '/Downloads/report.txt')]);
  assert.notEqual(items[0].path, items[1].path);
  assert.equal((await listTrash(fs)).length, 2);
  await fs.write('/Documents/report.txt', 'new report');
  await assert.rejects(restoreTrashItem(fs, items[0]), /already exists/);
  assert.equal((await fs.read('/Documents/report.txt')).content, 'new report');
  assert.equal((await fs.read(items[0].path)).content, 'documents');
  await restoreTrashItem(fs, items[1]);
  assert.equal((await fs.read('/Downloads/report.txt')).content, 'downloads');
  assert.equal((await listTrash(fs)).length, 1);
});

test('missing original folders leave trashed data intact and report a recoverable error', async t => {
  const fs = await workspace(t);
  await fs.mkdir('/Documents/Old');
  await fs.write('/Documents/Old/notes.txt', 'recover me');
  const item = await moveToTrash(fs, '/Documents/Old/notes.txt');
  await fs.remove('/Documents/Old', { recursive: false });
  await assert.rejects(restoreTrashItem(fs, item), /Recreate it/);
  assert.equal((await fs.read(item.path)).content, 'recover me');
  await fs.mkdir('/Documents/Old');
  await restoreTrashItem(fs, item);
  assert.equal((await fs.read('/Documents/Old/notes.txt')).content, 'recover me');
});

test('metadata failure cannot delete originals and an uncertain move cannot delete committed data', async t => {
  const fs = await workspace(t);
  await fs.write('/Documents/notes.txt', 'precious');
  const write = fs.write.bind(fs);
  fs.write = async () => { throw new Error('Storage full'); };
  await assert.rejects(moveToTrash(fs, '/Documents/notes.txt'), /Storage full/);
  assert.equal((await fs.read('/Documents/notes.txt')).content, 'precious');
  fs.write = write;
  const move = fs.rename.bind(fs);
  fs.rename = async (...args) => { await move(...args); throw new Error('Connection lost after commit'); };
  await assert.rejects(moveToTrash(fs, '/Documents/notes.txt'), /Connection lost/);
  const [item] = await listTrash(fs);
  assert.equal(item.originalPath, '/Documents/notes.txt');
  assert.equal((await fs.read(item.path)).content, 'precious');
});

test('protected paths and forged Trash entries cannot mutate workspace data', async t => {
  const fs = await workspace(t);
  for (const path of ['/', '/.Trash', '/.Trash/anything', '/home/lope/.Trash', '/Documents/../.Trash']) {
    await assert.rejects(moveToTrash(fs, path));
  }
  await fs.write('/Documents/keep.txt', 'keep');
  const item = await moveToTrash(fs, '/Documents/keep.txt');
  await fs.write('/Documents/keep.txt', 'new');
  await assert.rejects(removeTrashItem(fs, { ...item, path: '/Documents/keep.txt' }), /outside Trash/);
  await assert.rejects(restoreTrashItem(fs, { ...item, id: '../Documents' }), /invalid/);
  assert.equal((await fs.read('/Documents/keep.txt')).content, 'new');
  assert.equal((await fs.read(item.path)).content, 'keep');
});

test('damaged metadata leaves items visible; forged restore destinations are rejected', async t => {
  const fs = await workspace(t);
  await fs.write('/Documents/notes.txt', 'recoverable');
  const item = await moveToTrash(fs, '/Documents/notes.txt');
  await fs.write(`${TRASH_PATH}/${item.id}/metadata.json`, '{broken');
  let [listed] = await listTrash(fs);
  assert.equal(listed.name, 'notes.txt');
  assert.equal(listed.originalPath, undefined);
  await assert.rejects(restoreTrashItem(fs, { ...listed, originalPath: '/Documents/elsewhere.txt' }), /original location/);
  await fs.write(`${TRASH_PATH}/${item.id}/metadata.json`, JSON.stringify({ schema: 1, originalPath: '/.Trash/notes.txt', deletedAt: item.deletedAt }));
  [listed] = await listTrash(fs);
  assert.equal(listed.originalPath, undefined);
  assert.equal((await fs.read(item.path)).content, 'recoverable');
});

test('permanent deletion removes only selected content and emptying preserves new arrivals', async t => {
  const fs = await workspace(t);
  await fs.write('/Documents/one.txt', 'one');
  await fs.write('/Documents/two.txt', 'two');
  const first = await moveToTrash(fs, '/Documents/one.txt');
  const second = await moveToTrash(fs, '/Documents/two.txt');
  await removeTrashItem(fs, first);
  assert.deepEqual((await listTrash(fs)).map(item => item.path), [second.path]);
  await fs.write('/Documents/keep.txt', 'outside Trash');
  const remove = fs.remove.bind(fs);
  fs.remove = async (path, options) => {
    if (path === second.path) {
      // Simulate a separate client adding content to this bucket after listing.
      await fs.write(path.replace('two.txt', 'arrived.txt'), 'late arrival');
    }
    return remove(path, options);
  };
  await emptyTrash(fs);
  const [arrived] = await listTrash(fs);
  assert.equal(arrived.name, 'arrived.txt');
  assert.equal((await fs.read(arrived.path)).content, 'late arrival');
  assert.equal((await fs.read('/Documents/keep.txt')).content, 'outside Trash');
  fs.remove = remove;
  await emptyTrash(fs);
  assert.deepEqual(await listTrash(fs), []);
});

test('listing does not disguise permission and connectivity failures as empty Trash', async t => {
  const fs = await workspace(t);
  fs.list = async () => { throw Object.assign(new Error('Unavailable'), { code: 'UNAVAILABLE' }); };
  await assert.rejects(listTrash(fs), /Unavailable/);
});
