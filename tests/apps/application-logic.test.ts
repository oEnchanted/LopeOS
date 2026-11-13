import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../../apps/web/src/apps/calculator/engine.ts';
import { acknowledgeSave, applyExternalChange, editDocument, isDirty, newDocument } from '../../apps/web/src/apps/text-editor/document.ts';

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
