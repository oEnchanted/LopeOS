import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTranslation, smoothMotionPath, type GrayFrame, type MotionPoint } from '../../packages/media-engine/src/stabilization-math.ts';
import { stabilizationAt } from '../../packages/media-engine/src/stabilization.ts';
import type { StabilizationData } from '../../packages/movie-maker/src/model.ts';

const width = 160, height = 120, border = 30, sourceWidth = width + border * 2;
const texture = new Uint8Array(sourceWidth * (height + border * 2));
let seed = 0x45ac93;
for (let i = 0; i < texture.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; texture[i] = seed >>> 24; }
function source(dx: number, dy: number, brightness = 0): GrayFrame {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = Math.max(0, Math.min(255, texture[(y - dy + border) * sourceWidth + x - dx + border] + brightness));
  return { width, height, data };
}

test('measured image motion recovers real positive and negative camera translations', () => {
  const original = source(0, 0);
  for (const [x, y] of [[5, -3], [-6, 4], [0, 0], [9, 8]]) {
    const result = estimateTranslation(original, source(x, y));
    assert.ok(Math.abs(result.x - x) < .15, `${result.x} vs ${x}`);
    assert.ok(Math.abs(result.y - y) < .15, `${result.y} vs ${y}`);
    assert.ok(result.confidence > .9); assert.ok(result.matches >= 10);
  }
});
test('robust background consensus rejects a moving foreground and tolerates brightness changes', () => {
  const original = source(0, 0), moved = source(4, -2, 18), foreground = source(-7, 5);
  for (let y = 40; y < 76; y++) for (let x = 65; x < 105; x++) moved.data[y * width + x] = foreground.data[y * width + x];
  const result = estimateTranslation(original, moved);
  assert.ok(Math.abs(result.x - 4) < .25); assert.ok(Math.abs(result.y + 2) < .25); assert.ok(result.confidence > .5);
});
test('blank, unmatched and discontinuous frames do not invent a stabilizing motion', () => {
  const blank = { width, height, data: new Uint8Array(width * height).fill(120) };
  assert.equal(estimateTranslation(blank, blank).confidence, 0);
  const cut = { width, height, data: source(0, 0).data.map((value, index) => value ^ (index * 23 & 255)) };
  assert.equal(estimateTranslation(source(0, 0), cut).confidence, 0);
});
test('smoothing removes measured jitter while preserving an intentional pan and derives the actual required crop', () => {
  const path: MotionPoint[] = Array.from({ length: 90 }, (_, index) => ({ frame: index, x: index * .12 + Math.sin(index * 2.1) * 5, y: Math.cos(index * 1.7) * 3, confidence: 1, segment: 0 }));
  const result = smoothMotionPath(path, 7, width, height);
  const originalError = path.reduce((sum, point, i) => sum + (point.x - i * .12) ** 2 + point.y ** 2, 0);
  const correctedError = result.samples.reduce((sum, point, i) => sum + (path[i].x + point.x * width - i * .12) ** 2 + (path[i].y + point.y * height) ** 2, 0);
  assert.ok(correctedError < originalError * .03, `${correctedError} vs ${originalError}`);
  assert.ok(result.cropScale > 1.06 && result.cropScale < 1.1);
  for (const point of result.samples) {
    assert.ok(result.cropScale * (.5 - Math.abs(point.x)) >= .5);
    assert.ok(result.cropScale * (.5 - Math.abs(point.y)) >= .5);
  }
  const pan = smoothMotionPath(path.map((point, i) => ({ ...point, x: i * .5, y: i * -.2 })), 7, width, height);
  assert.equal(pan.cropScale, 1); assert.ok(pan.samples.every(point => Math.abs(point.x) < 1e-12 && Math.abs(point.y) < 1e-12));
});
test('camera-path smoothing never interpolates across a scene cut', () => {
  const path = Array.from({ length: 20 }, (_, i) => ({ frame: i, x: i < 10 ? 0 : 50, y: 0, confidence: 1, segment: i < 10 ? 0 : 1 }));
  const result = smoothMotionPath(path, 10, width, height);
  assert.equal(result.cropScale, 1); assert.ok(result.samples.every(point => Math.abs(point.x) < 1e-12));
});
test('corrections interpolate in original source time, remain stable for trims/speed edits, and stop outside the analyzed range', () => {
  const data: StabilizationData = { version: 1, method: 'translation', sourceAssetId: 'source', sourceIn: 30, sourceOut: 90, sampleRate: 15, smoothingSeconds: .35, cropScale: 1.2, confidence: .9, samples: [{ frame: 30, x: -.02, y: .01 }, { frame: 60, x: .04, y: -.03 }, { frame: 89, x: 0, y: 0 }] };
  assert.deepEqual(stabilizationAt(data, 45), { x: .009999999999999998, y: -.01, scale: 1.2 });
  assert.deepEqual(stabilizationAt(data, 29), { x: 0, y: 0, scale: 1 }); assert.deepEqual(stabilizationAt(data, 90), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(stabilizationAt(data, 30 + 15 * 2), stabilizationAt(data, 60));
});

test('measured corrections remain undoable decisions and survive editable project serialization', async () => {
  const model = await import('../../packages/movie-maker/src/model.ts');
  const asset = { id: 'video', name: 'shake.webm', kind: 'video' as const, mime: 'video/webm', size: 100, durationFrames: 120, width: 240, height: 144, hasAudio: false };
  const project = model.addAssets(model.createProject(), [asset]);
  const correction: StabilizationData = { version: 1, method: 'translation', sourceAssetId: asset.id, sourceIn: 0, sourceOut: 120, sampleRate: 30, smoothingSeconds: .35, cropScale: 1.1, confidence: .9, samples: [{ frame: 0, x: -.02, y: .01 }, { frame: 119, x: .02, y: -.01 }] };
  const changed = model.applyEdit(model.createHistory(project), p => model.updateClip(p, p.clips[0].id, { stabilization: correction }));
  assert.deepEqual(model.parseProject(model.serializeProject(changed.present)).clips[0].stabilization, correction);
  assert.equal(model.undo(changed).present.clips[0].stabilization, undefined);
  assert.deepEqual(model.redo(model.undo(changed)).present.clips[0].stabilization, correction);
  const split = model.splitClip(changed.present, changed.present.clips[0].id, 60);
  assert.deepEqual(split.clips.map(clip => clip.stabilization), [correction, correction]);
});
