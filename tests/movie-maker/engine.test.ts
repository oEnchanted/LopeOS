import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createClip, splitClip, reorderClips } from '../../packages/movie-maker/src/model.ts';
import { soundDecisions, gainAt } from '../../packages/media-engine/src/audio.ts';
import { sequenceAt } from '../../packages/media-engine/src/render.ts';

function fixture() {
  const project = createProject();
  const video = { id: 'video', name: 'source.mp4', kind: 'video' as const, mime: 'video/mp4', size: 100, durationFrames: 900, width: 640, height: 360, hasAudio: true };
  project.assets[video.id] = video;
  const clip = createClip(video); clip.sourceIn = 60; clip.sourceOut = 660; clip.speed = 2; clip.duration = 300; clip.fadeIn = 30;
  project.clips = [clip, { ...createClip(), id: 'second', duration: 150 }];
  project.audio = [{ id: 'voice', assetId: 'voice-source', kind: 'narration', name: 'voice', clipId: clip.id, start: 60, sourceIn: 30, sourceOut: 120, volume: .8, fadeIn: 0, fadeOut: 0 }];
  return project;
}
test('frame evaluator uses rational project time and exact clip boundaries', () => {
  const project = fixture(); project.fps = { num: 30000, den: 1001 };
  assert.equal(sequenceAt(project, 299)?.index, 0); assert.equal(sequenceAt(project, 300)?.local, 0); assert.equal(sequenceAt(project, 450), null);
  const sound = soundDecisions(project)[0]; assert.equal(sound.offset, 2.002); assert.equal(sound.duration, 10.01); assert.equal(sound.speed, 2);
});
test('clip anchored audio moves with reordered clip', () => {
  const project = fixture(); const reordered = reorderClips(project, ['second'], project.clips[0].id);
  const narration = soundDecisions(reordered).find(sound => sound.kind === 'narration')!;
  assert.equal(narration.start, 7); assert.equal(narration.offset, 1); assert.equal(narration.duration, 3);
});
test('split source audio retains contiguous source time with speed applied', () => {
  const project = fixture(); const split = splitClip(project, project.clips[0].id, 120);
  const sounds = soundDecisions(split).filter(sound => sound.kind === 'video');
  assert.deepEqual(sounds.map(sound => [sound.start, sound.offset, sound.duration]), [[0, 2, 4], [4, 10, 6]]);
});
test('emphasis ducks background only while foreground is active and respects fades', () => {
  const project = fixture(); const sounds = soundDecisions(project); const source = sounds[0];
  assert.equal(gainAt(source, 0, sounds, 'narration'), 0);
  assert.equal(gainAt(source, 1.5, sounds, 'narration'), 1);
  assert.ok(Math.abs(gainAt(source, 3, sounds, 'narration') - .24) < .001);
  assert.equal(gainAt(source, 6, sounds, 'narration'), 1);
  assert.equal(gainAt(source, 10, sounds, 'balanced'), 0);
});
