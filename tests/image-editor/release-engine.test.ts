import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMask, alignLayers, BrushStroke, compositePixels, copyRendered, deserializeDocument, findLayer, History, identity, layer, newDocument,
  paintFill, pixel, selectShape, serializeDocument, surface, surfacePixels, updateLayer, type ImageDocument,
} from '../../packages/image-engine/src/index.ts';

test('Paint Bucket outside the layer does not wrap into another pixel row', () => {
  const doc = newDocument(8, 8, 'bucket-boundary', [0, 0, 0, 0]);
  for (const point of [{ x: -1, y: 1 }, { x: 8, y: 0 }, { x: -0.1, y: 3 }]) {
    const filled = paintFill(doc, '#ff0000', point);
    assert.deepEqual(surfacePixels(filled.layers[0].pixels!), surfacePixels(doc.layers[0].pixels!));
  }
  const translated = { ...doc, layers: [{ ...doc.layers[0], transform: { ...identity(), x: 3, y: 2 } }] };
  assert.deepEqual(compositePixels(paintFill(translated, '#ff0000', { x: 2, y: 3 })), compositePixels(translated));
});

test('Reveal All mask covers a downscaled raster source instead of clipping to document dimensions', () => {
  const doc = newDocument(8, 8, 'scaled-mask', [0, 0, 0, 0]);
  doc.layers[0] = { ...doc.layers[0], pixels: surface(32, 32, [240, 80, 20, 255]), transform: { ...identity(), scaleX: .25, scaleY: .25 } };
  const masked = addMask(doc);
  assert.deepEqual(compositePixels(masked), compositePixels(doc));
  assert.deepEqual([masked.layers[0].mask!.pixels.width, masked.layers[0].mask!.pixels.height], [32, 32]);
  assert.equal(masked.layers[0].pixels, doc.layers[0].pixels);
});

test('Selection mask samples transformed source pixel centers and retains the whole source extent', () => {
  let doc = newDocument(8, 8, 'selection-mask', [0, 0, 0, 0]);
  doc.layers[0] = { ...doc.layers[0], pixels: surface(16, 16, [100, 200, 50, 255]), transform: { ...identity(), scaleX: .5, scaleY: .5 } };
  doc = selectShape(doc, { x: 4, y: 2 }, { x: 8, y: 8 }, 'rectangle');
  const masked = compositePixels(addMask(doc));
  for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
    assert.equal(masked[(y * doc.width + x) * 4 + 3], doc.selection![y * doc.width + x]);
  }
});

test('Aligning a group plus a selected descendant moves the descendant exactly once', () => {
  const doc = newDocument(100, 100, 'align-nesting', [0, 0, 0, 0]);
  const left = { ...layer('left'), pixels: surface(10, 10), transform: { ...identity(), x: 10 } };
  const right = { ...layer('right'), pixels: surface(10, 10), transform: { ...identity(), x: 40 } };
  const group = { ...layer('group', 'group'), children: [left, right] };
  const fixture: ImageDocument = { ...doc, layers: [group], activeIds: [group.id, right.id] };
  const aligned = alignLayers(fixture, 'left');
  assert.equal(findLayer(aligned, left.id)!.transform.x, 0);
  assert.equal(findLayer(aligned, right.id)!.transform.x, 30);
  assert.equal(findLayer(fixture, right.id)!.transform.x, 40);
});

test('Native Open rejects corrupt geometry, collections and filter data before accepting a document', () => {
  const source = serializeDocument(newDocument(8, 8, 'source', [0, 0, 0, 0]));
  const corruptions: [string, (doc: any) => void][] = [
    ['missing transform position', doc => { delete doc.layers[0].transform.x; }],
    ['missing paths', doc => { delete doc.paths; }],
    ['non-array guides', doc => { doc.guides = {}; }],
    ['unknown active layer', doc => { doc.activeIds = ['missing']; }],
    ['invalid adjustment', doc => { doc.layers[0].filters = [{}]; }],
    ['invalid raster filter', doc => { doc.layers[0].rasterFilters = [null]; }],
    ['invalid effect', doc => { doc.layers[0].effects = [null]; }],
    ['invalid text geometry', doc => { doc.layers[0].text = { content: 'text', font: 'Arial', size: 12, leading: null }; }],
  ];
  for (const [name, corrupt] of corruptions) {
    const parsed = JSON.parse(source); corrupt(parsed.document);
    assert.throws(() => deserializeDocument(JSON.stringify(parsed)), /Invalid/, name);
  }
  assert.equal(deserializeDocument(source).name, 'source');
});

test('Copy retains feathered selection coverage outside the marching-ants boundary', () => {
  const doc = newDocument(3, 1, 'feathered-copy', [30, 60, 90, 255]);
  doc.selection = new Uint8Array([64, 255, 64]);
  const copied = copyRendered(doc, compositePixels(doc));
  assert.deepEqual([copied.pixels.width, copied.pixels.height], [3, 1]);
  assert.deepEqual([...surfacePixels(copied.pixels)], [30, 60, 90, 64, 30, 60, 90, 255, 30, 60, 90, 64]);
  doc.selection = new Uint8Array([0, 64, 0]);
  const faint = copyRendered(doc, compositePixels(doc));
  assert.deepEqual([...surfacePixels(faint.pixels)], [30, 60, 90, 64]);
});

test('Deleting the active mask retargets color painting; undo restores mask editing and original pixels', () => {
  const initial = addMask(newDocument(8, 8, 'delete-mask', [0, 0, 0, 0]));
  const history = new History(initial);
  const id = initial.activeIds[0];
  history.commit('Delete Layer Mask', updateLayer(history.current, id, item => ({ ...item, mask: undefined })));
  assert.equal(history.current.target, 'pixels');
  const stroke = new BrushStroke(history.current, { size: 1, hardness: 1, opacity: 1, flow: 1, spacing: .1, color: '#ff0000', pressure: false });
  stroke.add({ x: 3, y: 3 });
  history.commit('Brush', stroke.finish());
  assert.deepEqual(pixel(findLayer(history.current)!.pixels!, 3, 3), [255, 0, 0, 255]);
  history.undo();
  assert.equal(history.current.target, 'pixels');
  assert.deepEqual(pixel(findLayer(history.current)!.pixels!, 3, 3), [0, 0, 0, 0]);
  history.undo();
  assert.equal(history.current.target, 'mask');
  assert.ok(findLayer(history.current)!.mask);
  assert.deepEqual(pixel(findLayer(history.current)!.mask!.pixels, 3, 3), [255, 255, 255, 255]);
});
