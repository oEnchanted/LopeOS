import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FileEntry, FileService } from '../../packages/contracts/src/index.ts';
import { fileClipboard, FileConflictError, normalizeWorkspacePath, reverseMoves, transferEntries, uniqueCopyName, validateFileName } from '../../apps/web/src/apps/files/operations.ts';

const missing = () => Object.assign(new Error('Not found'), { code: 'NOT_FOUND' });
const conflict = () => Object.assign(new Error('Destination already exists'), { code: 'CONFLICT' });
function workspace() {
  const nodes = new Map<string, FileEntry>();
  const changes: string[] = [];
  const add = (path: string, type: FileEntry['type'] = 'file') => {
    const entry: FileEntry = { path, name: path.split('/').at(-1)!, type, size: type === 'directory' ? 0 : 7, modified: '2026-11-13T00:00:00Z', version: '1' };
    nodes.set(path, entry);
    return entry;
  };
  add('/', 'directory'); add('/Documents', 'directory'); add('/Downloads', 'directory'); add('/Pictures', 'directory');
  const transfer = (path: string, destination: string, move: boolean) => {
    if (!nodes.has(path)) throw missing();
    if (nodes.has(destination)) throw conflict();
    changes.push(`${move ? 'move' : 'copy'} ${path} → ${destination}`);
    const descendants = [...nodes].filter(([key]) => key === path || key.startsWith(path + '/'));
    for (const [key, value] of descendants) {
      const next = destination + key.slice(path.length);
      nodes.set(next, { ...value, path: next, name: next.split('/').at(-1)! });
      if (move) nodes.delete(key);
    }
  };
  const fs: FileService & { copy: (path: string, destination: string) => Promise<void> } = {
    async stat(path) { const entry = nodes.get(path); if (!entry) throw missing(); return { ...entry }; },
    async list(path) {
      if (!nodes.has(path)) throw missing();
      return [...nodes.values()].filter(entry => entry.path !== '/' && (entry.path.slice(0, entry.path.lastIndexOf('/')) || '/') === path).map(entry => ({ ...entry }));
    },
    async copy(path, destination) { transfer(path, destination, false); },
    async rename(path, destination) { transfer(path, destination, true); },
    async read() { throw new Error('Not used'); },
    async write() { throw new Error('Not used'); },
    async mkdir(path) { if (nodes.has(path)) throw conflict(); add(path, 'directory'); },
    async remove(path) { if (!nodes.delete(path)) throw missing(); },
    subscribe() { return () => {}; },
  };
  return { fs, nodes, changes, add };
}

test('workspace normalization resolves aliases without permitting escape or reserved path disguises', () => {
  assert.equal(normalizeWorkspacePath('/home/lope/Documents/../Downloads//./'), '/Downloads');
  assert.equal(normalizeWorkspacePath('~/Documents'), '/Documents');
  assert.equal(normalizeWorkspacePath('~'), '/');
  assert.equal(normalizeWorkspacePath('/Documents/../.Trash'), '/.Trash');
  for (const value of ['/../escape', '/home/lope/../escape', '~/../escape', 'relative', '/Docs\\a', '/Docs\nname', '/Docs\0name']) {
    assert.throws(() => normalizeWorkspacePath(value));
  }
});

test('names reject path segments and oversized UTF-8 without rejecting ordinary Unicode', () => {
  assert.equal(validateFileName('Résumé 🐾.txt'), 'Résumé 🐾.txt');
  assert.equal(validateFileName('.settings'), '.settings');
  for (const value of ['', '.', '..', ' leading', 'trailing ', 'a/b', 'a\\b', 'a\x7fb', '🐾'.repeat(64)]) assert.throws(() => validateFileName(value));
});

test('keep-both names preserve file extensions, dotfiles, and folder names', () => {
  assert.equal(uniqueCopyName('report.txt', 'file', new Set(['report.txt', 'report copy.txt'])), 'report copy 2.txt');
  assert.equal(uniqueCopyName('archive.tar.gz', 'file', new Set()), 'archive copy.tar.gz');
  assert.equal(uniqueCopyName('.env', 'file', new Set()), '.env copy');
  assert.equal(uniqueCopyName('Project.v2', 'directory', new Set()), 'Project.v2 copy');
  const name = uniqueCopyName('🐾'.repeat(62) + '.txt', 'file', new Set());
  assert.ok(new TextEncoder().encode(name).length <= 255);
  assert.ok(name.endsWith(' copy.txt'));
  assert.ok(!name.includes('\ufffd'));
});

test('an entire batch is preflighted so a later collision cannot partially move files', async () => {
  const { fs, add, changes, nodes } = workspace();
  const first = add('/Documents/one.txt'); const second = add('/Documents/two.txt'); add('/Downloads/two.txt');
  const result = await transferEntries(fs, [first, second], '/Downloads', { mode: 'move', conflict: 'error' });
  assert.ok(result.failure instanceof FileConflictError);
  assert.deepEqual(result.completed, []);
  assert.equal(result.failed, undefined);
  assert.deepEqual(changes, []);
  assert.ok(nodes.has(first.path)); assert.ok(nodes.has(second.path));
});

test('a missing later source also fails before any mutation', async () => {
  const { fs, add, changes } = workspace();
  const first = add('/Documents/one.txt');
  const absent = { ...first, path: '/Documents/missing.txt', name: 'missing.txt' };
  const result = await transferEntries(fs, [first, absent], '/Downloads', { mode: 'move', conflict: 'error' });
  assert.match(result.failure!.message, /Not found/);
  assert.deepEqual(changes, []);
});

test('keep-both reserves planned names for duplicate basenames from different folders', async () => {
  const { fs, add, nodes } = workspace();
  const first = add('/Documents/report.txt'); const second = add('/Pictures/report.txt'); add('/Downloads/report.txt');
  const result = await transferEntries(fs, [first, second], '/Downloads', { mode: 'copy', conflict: 'keep-both' });
  assert.equal(result.failure, undefined);
  assert.deepEqual(result.completed, [
    { source: first.path, destination: '/Downloads/report copy.txt' },
    { source: second.path, destination: '/Downloads/report copy 2.txt' },
  ]);
  assert.ok(nodes.has(first.path)); assert.ok(nodes.has(second.path)); assert.ok(nodes.has('/Downloads/report.txt'));
});

test('skip preserves conflicts while moving the remaining selected files', async () => {
  const { fs, add, nodes } = workspace();
  const one = add('/Documents/one.txt'); const two = add('/Documents/two.txt'); add('/Downloads/one.txt');
  const result = await transferEntries(fs, [one, two], '/Downloads', { mode: 'move', conflict: 'skip' });
  assert.equal(result.failure, undefined);
  assert.deepEqual(result.skipped, [one.path]);
  assert.deepEqual(result.completed, [{ source: two.path, destination: '/Downloads/two.txt' }]);
  assert.ok(nodes.has(one.path)); assert.ok(!nodes.has(two.path));
});

test('copying in place duplicates, moving in place is harmless, and overlapping selections transfer once', async () => {
  const { fs, add, nodes } = workspace();
  const folder = add('/Documents/Project', 'directory'); const child = add('/Documents/Project/note.txt');
  const copied = await transferEntries(fs, [child, folder, folder], '/Documents', { mode: 'copy', conflict: 'keep-both' });
  assert.equal(copied.completed.length, 1);
  assert.ok(nodes.has('/Documents/Project copy/note.txt'));
  const moved = await transferEntries(fs, [folder], '/Documents', { mode: 'move', conflict: 'keep-both' });
  assert.deepEqual(moved.skipped, [folder.path]);
  assert.deepEqual(moved.completed, []);
});

test('workspace, Trash, traversal, and moving a folder inside itself are refused', async () => {
  const { fs, add, changes } = workspace();
  const folder = add('/Documents/Project', 'directory'); add('/Documents/Project/child', 'directory');
  add('/LopeDrive', 'directory'); add('/LopeDrive/.Trash', 'directory'); add('/LopeDrive/.Trash/hidden');
  for (const destination of ['/Documents/Project', '/Documents/Project/child', '/Documents/../.Trash', '/home/lope/../Downloads', '/LopeDrive/.Trash']) {
    const result = await transferEntries(fs, [folder], destination, { mode: 'move', conflict: 'keep-both' });
    assert.ok(result.failure);
  }
  for (const path of ['/', '/.Trash/hidden', '/Documents/../.Trash/hidden', '/LopeDrive/.Trash/hidden']) {
    const result = await transferEntries(fs, [{ ...folder, path }], '/Downloads', { mode: 'copy', conflict: 'keep-both' });
    assert.ok(result.failure);
  }
  assert.deepEqual(changes, []);
});

test('a late runtime failure reports acknowledged successes and the failed attempt separately', async () => {
  const { fs, add, nodes } = workspace();
  const one = add('/Documents/one.txt'); const two = add('/Documents/two.txt'); const three = add('/Documents/three.txt');
  const rename = fs.rename;
  fs.rename = async (source, destination) => {
    if (source === two.path) throw new Error('Storage unavailable');
    return rename(source, destination);
  };
  const result = await transferEntries(fs, [one, two, three], '/Downloads', { mode: 'move', conflict: 'error' });
  assert.match(result.failure!.message, /Storage unavailable/);
  assert.deepEqual(result.completed, [{ source: one.path, destination: '/Downloads/one.txt' }]);
  assert.deepEqual(result.failed, { source: two.path, destination: '/Downloads/two.txt' });
  assert.ok(nodes.has(two.path)); assert.ok(nodes.has(three.path));
});

test('a lost response does not pretend an unacknowledged operation succeeded or roll it back', async () => {
  const { fs, add, nodes } = workspace();
  const item = add('/Documents/note.txt'); const rename = fs.rename;
  fs.rename = async (...args) => { await rename(...args); throw new Error('Connection lost after commit'); };
  const result = await transferEntries(fs, [item], '/Downloads', { mode: 'move', conflict: 'error' });
  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.failed, { source: item.path, destination: '/Downloads/note.txt' });
  assert.ok(nodes.has('/Downloads/note.txt'));
  assert.ok(!nodes.has(item.path));
});

test('progress errors cannot conceal a successful operation, and copy support is explicit', async () => {
  const { fs, add } = workspace(); const item = add('/Documents/note.txt');
  const result = await transferEntries(fs, [item], '/Downloads', { mode: 'copy', conflict: 'error' }, () => { throw new Error('UI failed'); });
  assert.equal(result.completed.length, 1); assert.equal(result.failure, undefined);
  const unavailable = { ...fs, copy: undefined };
  const denied = await transferEntries(unavailable, [item], '/Pictures', { mode: 'copy', conflict: 'error' });
  assert.match(denied.failure!.message, /Copying is unavailable/);
});

test('concurrent batches on one service reserve distinct keep-both names', async () => {
  const { fs, add, nodes } = workspace(); const item = add('/Documents/note.txt');
  const results = await Promise.all([
    transferEntries(fs, [item], '/Downloads', { mode: 'copy', conflict: 'keep-both' }),
    transferEntries(fs, [item], '/Downloads', { mode: 'copy', conflict: 'keep-both' }),
  ]);
  assert.ok(results.every(result => !result.failure));
  assert.ok(nodes.has('/Downloads/note.txt')); assert.ok(nodes.has('/Downloads/note copy.txt'));
});

test('undo preflights every original destination and never overwrites a new occupant', async () => {
  const { fs, add, nodes } = workspace(); const one = add('/Documents/one.txt'); const two = add('/Documents/two.txt');
  const moved = await transferEntries(fs, [one, two], '/Downloads', { mode: 'move', conflict: 'error' });
  add(one.path);
  const blocked = await reverseMoves(fs, moved.completed);
  assert.ok(blocked.failure instanceof FileConflictError);
  assert.equal(blocked.completed.length, 0);
  assert.ok(nodes.has('/Downloads/one.txt')); assert.ok(nodes.has('/Downloads/two.txt'));
  nodes.delete(one.path);
  const restored = await reverseMoves(fs, moved.completed);
  assert.equal(restored.failure, undefined); assert.equal(restored.completed.length, 2);
  assert.ok(nodes.has(one.path)); assert.ok(nodes.has(two.path));
});

test('undo does not disguise connectivity errors as an absent destination', async () => {
  const { fs, add } = workspace(); const item = add('/Documents/note.txt');
  const moved = await transferEntries(fs, [item], '/Downloads', { mode: 'move', conflict: 'error' });
  const stat = fs.stat;
  fs.stat = async path => { if (path === item.path) throw Object.assign(new Error('Disconnected'), { code: 'UNAVAILABLE' }); return stat(path); };
  const result = await reverseMoves(fs, moved.completed);
  assert.match(result.failure!.message, /Disconnected/);
  assert.deepEqual(result.completed, []);
});

test('clipboard shares stable immutable snapshots and removes only completed cut items', () => {
  fileClipboard.clear();
  const { add } = workspace(); const one = add('/Documents/one.txt'); const two = add('/Documents/two.txt');
  let updates = 0;
  const unsubscribe = fileClipboard.subscribe(() => updates++);
  fileClipboard.set('cut', [one, two, one]);
  const snapshot = fileClipboard.getSnapshot()!;
  assert.equal(fileClipboard.getSnapshot(), snapshot);
  assert.equal(snapshot.entries.length, 2);
  one.name = 'changed outside clipboard';
  assert.equal(snapshot.entries[0].name, 'one.txt');
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.entries)); assert.ok(Object.isFrozen(snapshot.entries[0]));
  fileClipboard.remove(['/unrelated']);
  assert.equal(fileClipboard.getSnapshot(), snapshot);
  fileClipboard.remove(['/home/lope/Documents/one.txt']);
  assert.deepEqual(fileClipboard.getSnapshot()!.entries.map(entry => entry.path), [two.path]);
  assert.equal(updates, 2);
  unsubscribe();
  fileClipboard.clear();
  assert.equal(fileClipboard.getSnapshot(), null);
  assert.equal(updates, 2);
});
