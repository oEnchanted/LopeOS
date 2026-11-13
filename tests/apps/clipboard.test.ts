import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClipboardHistory } from '../../apps/web/src/shell/clipboard-store.ts';

test('clipboard capture requires opt-in and immediately forgets text when disabled', () => {
  let enabled = false;
  const clipboard = new ClipboardHistory(() => ({ enabled, retentionMinutes: 15 }));
  assert.equal(clipboard.add('private draft'), null);
  enabled = true;
  assert.ok(clipboard.add('private draft'));
  enabled = false;
  assert.deepEqual(clipboard.items(), []);
  enabled = true;
  assert.deepEqual(clipboard.items(), []);
});

test('duplicate copies retain their stable identity, exact text, and pin state', () => {
  let now = 1000;
  const clipboard = new ClipboardHistory(() => ({ enabled: true, retentionMinutes: 15 }), () => now);
  const original = clipboard.add('  multiline\n  selection  ', 'copy')!;
  clipboard.togglePin(original.id);
  now += 2000;
  const duplicate = clipboard.add(original.text, 'paste')!;
  assert.equal(duplicate.id, original.id);
  assert.equal(duplicate.pinned, true);
  assert.equal(duplicate.time, now);
  assert.equal(duplicate.source, 'paste');
  assert.equal(clipboard.items().length, 1);
  assert.equal(clipboard.items()[0].text, '  multiline\n  selection  ');
});

test('pins appear first, survive capacity eviction, and still expire under retention policy', () => {
  let now = 1;
  const clipboard = new ClipboardHistory(() => ({ enabled: true, retentionMinutes: 1 }), () => now, 3);
  const pinned = clipboard.add('pinned')!;
  clipboard.togglePin(pinned.id);
  now += 1; clipboard.add('oldest');
  now += 1; clipboard.add('newer');
  now += 1; clipboard.add('newest');
  assert.deepEqual(clipboard.items().map(item => item.text), ['pinned', 'newest', 'newer']);
  now = 60_001;
  assert.equal(clipboard.prune(), true);
  assert.deepEqual(clipboard.items().map(item => item.text), ['newest', 'newer']);
  assert.equal(clipboard.togglePin(pinned.id), false);
});

test('a full pinned shelf rejects new text without losing retained items', () => {
  const clipboard = new ClipboardHistory(() => ({ enabled: true, retentionMinutes: 15 }), Date.now, 2);
  const first = clipboard.add('first')!, second = clipboard.add('second')!;
  clipboard.togglePin(first.id); clipboard.togglePin(second.id);
  assert.throws(() => clipboard.add('third'), /full/i);
  assert.equal(clipboard.items().length, 2);
  assert.equal(clipboard.add('first')!.id, first.id);
  clipboard.togglePin(second.id);
  clipboard.add('third');
  assert.deepEqual(new Set(clipboard.items().map(item => item.text)), new Set(['first', 'third']));
});

test('history never silently truncates text and deletion is stable after reordering', () => {
  const clipboard = new ClipboardHistory(() => ({ enabled: true, retentionMinutes: 15 }), Date.now, 3, 10);
  const first = clipboard.add('first')!, second = clipboard.add('second')!;
  assert.equal(clipboard.add(' \n\t '), null);
  assert.throws(() => clipboard.add('long clipboard content'), /too large/i);
  clipboard.togglePin(second.id);
  assert.equal(clipboard.remove(first.id), true);
  assert.equal(clipboard.remove(first.id), false);
  assert.deepEqual(clipboard.items().map(item => item.id), [second.id]);
  assert.equal(clipboard.clear(), true);
  assert.deepEqual(clipboard.items(), []);
  assert.equal(clipboard.clear(), false);
});
