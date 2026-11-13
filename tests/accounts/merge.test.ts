import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEntries, entryMap, type SyncEntry } from '../../apps/web/src/accounts/merge.ts';
const e = (key: string, hash: string): SyncEntry => ({ key, hash: hash.repeat(64), size: 10, modifiedAt: '2026-01-01T00:00:00Z' });
const map = (...entries: SyncEntry[]) => new Map(entries.map(entry => [entry.key, entry]));
test('an unchanged device receives server edits and deletions', () => {
  const old = e('file', 'a'), next = e('file', 'b');
  assert.equal(mergeEntries(map(old), map(old), map(next)).entries.get('file')?.hash, next.hash);
  assert.equal(mergeEntries(map(old), map(old), map()).entries.size, 0);
});
test('offline edits and deliberate local deletes propagate when remote has not changed', () => {
  const old = e('file', 'a'), next = e('file', 'b');
  assert.equal(mergeEntries(map(old), map(next), map(old)).entries.get('file')?.hash, next.hash);
  assert.equal(mergeEntries(map(old), map(), map(old)).entries.size, 0);
});
test('concurrent edits and first sign-in collisions preserve the local version', () => {
  const old = e('file', 'a'), local = e('file', 'b'), remote = e('file', 'c');
  for (const base of [map(old), map()]) {
    const result = mergeEntries(base, map(local), map(remote));
    assert.deepEqual(result.conflicts, [local]);
    assert.equal(result.entries.get('file')?.hash, remote.hash);
  }
});
test('an edit competing with a deletion survives', () => {
  const old = e('file', 'a'), changed = e('file', 'b');
  assert.equal(mergeEntries(map(old), map(changed), map()).entries.get('file')?.hash, changed.hash);
  assert.equal(mergeEntries(map(old), map(), map(changed)).entries.get('file')?.hash, changed.hash);
});
test('unavailable workspace scope preserves remote files', () => {
  const file = e('workspace:file:/file', 'a');
  assert.equal(mergeEntries(map(file), map(), map(file), key => !key.startsWith('workspace:')).entries.size, 1);
});
test('manifest validation rejects duplicates, traversal-like control keys, and oversized records', () => {
  const file = e('file', 'a');
  assert.throws(() => entryMap([file, file]));
  assert.throws(() => entryMap([{ ...file, key: '\u0000' }]));
  assert.throws(() => entryMap([{ ...file, size: 65 * 1024 * 1024 }]));
});

test('a new child preserves a concurrently removed parent folder', async () => {
  const { normalizeFileTopology } = await import('../../apps/web/src/accounts/merge.ts');
  const directory = e('drive:directory:/LopeDrive/folder', 'a'), child = e('drive:file:/LopeDrive/folder/new.txt', 'b');
  const merged = normalizeFileTopology(mergeEntries(map(directory), map(directory, child), map()));
  assert.ok(merged.entries.has(directory.key));
  assert.ok(merged.entries.has(child.key));
});
test('file-versus-folder conflicts preserve the file and valid tree structure', async () => {
  const { normalizeFileTopology } = await import('../../apps/web/src/accounts/merge.ts');
  const file = e('drive:file:/LopeDrive/same', 'a'), child = e('drive:file:/LopeDrive/same/new.txt', 'b');
  const merged = normalizeFileTopology(mergeEntries(map(), map(file), map(child)));
  assert.ok(merged.entries.has('drive:directory:/LopeDrive/same'));
  assert.ok(!merged.entries.has(file.key));
  assert.deepEqual(merged.conflicts, [file]);
});
