import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../../apps/web/src/apps/calculator/engine.ts';
import { acknowledgeSave, applyExternalChange, editDocument, findNext, isDirty, newDocument, replaceAllText } from '../../apps/web/src/apps/text-editor/document.ts';

test('calculator handles decimal arithmetic and rejects invalid operations', () => {
  assert.equal(calculate('0.1 + 0.2'), '0.3');
  assert.equal(calculate('(7 − 3) × 2'), '8');
  assert.throws(() => calculate('1 ÷ 0'), /divide by zero/i);
  assert.throws(() => calculate('process.exit()'));
});

test('editor keeps local edits when external changes arrive', () => {
  const clean = newDocument('original', '/note.txt', 'v1');
  const dirty = editDocument(clean, 'my edits');
  const conflict = applyExternalChange(dirty, 'someone else', 'v2');
  assert.equal(conflict.text, 'my edits');
  assert.equal(conflict.externalChange, true);
  assert.equal(isDirty(conflict), true);
  assert.equal(applyExternalChange(clean, 'someone else', 'v2').text, 'someone else');
});

test('save acknowledgment does not mark subsequent edits as saved', () => {
  const editedAgain = editDocument(newDocument('saved', '/note.txt', 'v1'), 'later edit');
  const result = acknowledgeSave(editedAgain, '/note.txt', 'saved', 'v2');
  assert.equal(result.text, 'later edit');
  assert.equal(isDirty(result), true);
});

test('editor search keeps original text offsets when Unicode case folding changes length', () => {
  const text = 'İstanbul road; ROAD';
  assert.deepEqual(findNext(text, 'road'), [9, 13]);
  assert.deepEqual(findNext(text, 'road', 13), [15, 19]);
  assert.deepEqual(findNext(text, 'road', 19), [9, 13]);
  assert.deepEqual(findNext(text, 'İstanbul'), [0, 8]);
  assert.deepEqual(replaceAllText(text, 'road', 'path'), { text: 'İstanbul path; path', count: 2 });
});

test('editor search treats regex characters literally and honors case-sensitive matching', () => {
  assert.deepEqual(findNext('A+B a+b', 'a+b'), [0, 3]);
  assert.deepEqual(findNext('A+B a+b', 'a+b', 0, true), [4, 7]);
  assert.equal(findNext('A+B', 'a+b', 0, true), null);
  assert.equal(findNext('A+B', ''), null);
});

test('editor find and replace agree on Unicode case-insensitive matches', () => {
  assert.deepEqual(findNext('Σ ς σ', 'σ'), [0, 1]);
  assert.deepEqual(findNext('Σ ς σ', 'σ', 1), [2, 3]);
  assert.deepEqual(replaceAllText('Σ ς σ', 'σ', '$&'), { text: '$& $& $&', count: 3 });
});
