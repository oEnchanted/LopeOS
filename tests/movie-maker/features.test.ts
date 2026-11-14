import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createClip, defaultText, serializeProject, parseProject, validateProject, applyToAll, fitToMusic, splitAudio, trimAudioToPlayhead, anchoredStart, projectDuration, effectiveTransition, applyTheme, audioMixGain, type MovieProject, type MediaAsset } from '../../packages/movie-maker/src/model.ts';
import { effectPresets, transitionPresets, panZoomPresets, textAnimationPresets, themePresets } from '../../packages/movie-maker/src/galleries.ts';
import { soundDecisions } from '../../packages/media-engine/src/audio.ts';
import { panZoomTransform } from '../../packages/media-engine/src/render.ts';

function fixture(): MovieProject {
  const project = createProject('Feature decisions');
  const photo: MediaAsset = { id: 'photo', name: 'photo.jpg', kind: 'image', mime: 'image/jpeg', size: 10, durationFrames: 210, width: 1280, height: 720, hasAudio: false };
  const video: MediaAsset = { ...photo, id: 'video', name: 'video.webm', kind: 'video', mime: 'video/webm', durationFrames: 900, hasAudio: true };
  const music: MediaAsset = { ...photo, id: 'music', name: 'music.wav', kind: 'audio', mime: 'audio/wav', durationFrames: 1200, hasAudio: true };
  project.assets = { photo, video, music };
  const first = createClip(photo), middle = createClip(video), last = createClip(); first.id = 'photo-clip'; middle.id = 'video-clip'; middle.sourceIn = 150; middle.sourceOut = 450; middle.duration = 300; last.id = 'title-clip';
  project.clips = [first, middle, last];
  project.overlays = [{ ...defaultText('Caption'), id: 'caption', clipId: first.id, start: 30, duration: 90 }];
  project.audio = [{ id: 'soundtrack', assetId: 'music', name: 'Music', kind: 'music', start: 0, sourceIn: 30, sourceOut: 930, volume: .75, fadeIn: 30, fadeOut: 30 }];
  return project;
}
test('all named galleries serialize into supported non-destructive project decisions', () => {
  for (const effect of effectPresets) { const p = fixture(); p.clips[0].effect = effect.id; assert.equal(parseProject(serializeProject(p)).clips[0].effect, effect.id); }
  for (const transition of transitionPresets) { const p = fixture(); p.clips[1].transition = { kind: transition.id, duration: 20 }; assert.equal(parseProject(serializeProject(p)).clips[1].transition.kind, transition.id); }
  for (const panZoom of panZoomPresets) { const p = fixture(); p.clips[0].panZoom = panZoom.id; assert.equal(parseProject(serializeProject(p)).clips[0].panZoom, panZoom.id); }
  for (const animation of textAnimationPresets) { const p = fixture(); p.clips[2].text!.animation = animation.id; assert.equal(parseProject(serializeProject(p)).clips[2].text!.animation, animation.id); }
});
test('multiple effects, brightness, rich text and audio mix survive exact roundtrip without changing old files', () => {
  const p = fixture(); const legacy = parseProject(serializeProject(p)); assert.equal('effects' in legacy.clips[0], false); assert.equal('audioMix' in legacy, false); assert.equal('bold' in legacy.overlays[0], false);
  p.clips[0].effects = ['grayscale', 'negative', 'posterize']; p.clips[0].brightness = -.25;
  Object.assign(p.overlays[0], { bold: true, italic: true, alignment: 'right', opacity: .4, outlineColor: '#de0022', x: .7, y: .2, boxWidth: .4 }); p.audioMix = .2; Object.assign(p.clips[2].text!, { start: 30, duration: 400 }); p.clips[2].backgroundColor = '#982f47';
  assert.deepEqual(JSON.parse(serializeProject(p)), JSON.parse(JSON.stringify(p)));
  const bad = structuredClone(p); bad.clips[0].effects = Array(9).fill('blur'); assert.throws(() => validateProject(bad), /effect stack/);
  bad.clips[0].effects = []; bad.overlays[0].opacity = 1.5; assert.throws(() => validateProject(bad), /opacity/);
});
test('apply-to-all copies only the chosen feature and respects image eligibility and short transitions', () => {
  const p = fixture(); p.clips[0].effects = ['sepia', 'negative']; p.clips[0].brightness = .4; p.clips[0].panZoom = 'in-top-left'; p.clips[0].transition = { kind: 'wipe-down', duration: 60 };
  const effects = applyToAll(p, p.clips[0].id, 'effects'); assert.deepEqual(effects.clips[1].effects, ['sepia', 'negative']); assert.equal(effects.clips[1].sourceIn, 150); assert.equal(effects.clips[1].panZoom, 'none');
  const pans = applyToAll(p, p.clips[0].id, 'panZoom'); assert.equal(pans.clips[1].panZoom, 'none'); assert.equal(pans.clips[2].panZoom, 'none');
  const transitions = applyToAll(p, p.clips[0].id, 'transitions'); assert.deepEqual(transitions.clips[0].transition, { kind: 'none', duration: 0 }); assert.equal(effectiveTransition(transitions, transitions.clips[1].id).kind, 'wipe-down');
  assert.notEqual(effects.clips[0].effects, effects.clips[1].effects);
});
test('fit to music distributes integer photo/title frames, retains videos and retimes linked captions', () => {
  const p = fixture(), fitted = fitToMusic(p); assert.equal(projectDuration(fitted), 900); assert.deepEqual(fitted.clips[1], p.clips[1]); assert.equal(fitted.clips[0].duration, 300); assert.equal(fitted.clips[2].duration, 300);
  assert.equal(fitted.overlays[0].start, 43); assert.equal(fitted.overlays[0].duration, 128); assert.equal(p.clips[0].duration, 210);
  validateProject(fitted);
  const impossible = fixture(); impossible.audio[0].sourceOut = 100; assert.throws(() => fitToMusic(impossible), /shorter than the video/);
  const noPhotos = fixture(); noPhotos.clips = [noPhotos.clips[1]]; noPhotos.overlays = []; assert.throws(() => fitToMusic(noPhotos), /photo or title/);
});
test('audio split and playhead trims retain exact continuous source and anchored project timing', () => {
  const p = fixture(); p.audio[0].clipId = p.clips[1].id; p.audio[0].start = 20;
  const split = splitAudio(p, p.audio[0].id, 300); assert.equal(split.audio.length, 2); assert.equal(split.audio[0].sourceOut, split.audio[1].sourceIn); assert.equal(anchoredStart(split, split.audio[1]), 300);
  const start = trimAudioToPlayhead(p, p.audio[0].id, 300, 'start'); assert.equal(anchoredStart(start, start.audio[0]), 300); assert.equal(start.audio[0].sourceIn, 100);
  const end = trimAudioToPlayhead(p, p.audio[0].id, 300, 'end'); assert.equal(end.audio[0].sourceOut, 100); validateProject(start); validateProject(end);
});
test('video audio can be used in added music/narration lanes without adding its picture', () => {
  const p = fixture(); p.audio[0].assetId = 'video'; p.audio[0].sourceOut = 850; assert.equal(validateProject(p).audio[0].assetId, 'video');
  p.assets.video.hasAudio = false; assert.throws(() => validateProject(p), /video with sound/);
});
test('audio mix midpoint preserves old gain and endpoints silence only the opposite source family', () => {
  const p = fixture(); assert.equal(audioMixGain(p, 'video'), 1); assert.equal(audioMixGain(p, 'music'), 1);
  p.audioMix = 0; assert.equal(soundDecisions(p).filter(sound => sound.kind === 'music').length, 0); assert.equal(soundDecisions(p)[0].volume, 1);
  p.audioMix = 1; assert.equal(soundDecisions(p).filter(sound => sound.kind === 'video').length, 0); assert.equal(soundDecisions(p)[0].volume, .75);
  p.audioMix = .25; assert.equal(soundDecisions(p).find(sound => sound.kind === 'music')!.volume, .375);
});
test('all original-style themes remain editable and every pan/zoom reaches finite bounded transforms', () => {
  for (const theme of themePresets) { const p = fixture(), themed = applyTheme(p, theme.id); validateProject(themed); assert.equal(themed.clips[1].sourceIn, 150); assert.ok(themed.overlays.length); }
  for (const preset of panZoomPresets) { for (const progress of [0, .5, 1]) { const transform = panZoomTransform(preset.id, progress, 1280, 720); assert.ok(Object.values(transform).every(Number.isFinite)); assert.ok(transform.zoom >= 1 && transform.zoom <= 1.19); } }
  assert.notDeepEqual(panZoomTransform('in-top-left', 1, 1280, 720), panZoomTransform('in-bottom-right', 1, 1280, 720));
});
