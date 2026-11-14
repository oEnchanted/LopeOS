import { effectPresets, transitionPresets, panZoomPresets, textAnimationPresets, type Effect, type TransitionKind, type PanZoom, type TextAnimation, type AutoMovieTheme } from './galleries.ts';
export type { Effect, TransitionKind, PanZoom, TextAnimation, AutoMovieTheme } from './galleries.ts';
/** LopeOS Movie Maker decisions. Timeline times are integer rational-rate frames; speed edits may produce fractional source-frame boundaries. */
export interface FrameRate { num: number; den: number }
export type MediaKind = 'image' | 'video' | 'audio';
export interface MediaAsset { id: string; name: string; kind: MediaKind; mime: string; size: number; durationFrames: number; width: number; height: number; hasAudio: boolean }
export interface TextStyle { text: string; font: string; size: number; color: string; position: 'top' | 'center' | 'bottom'; outline: number; background: string; animation: TextAnimation; bold?: boolean; italic?: boolean; alignment?: 'left' | 'center' | 'right'; opacity?: number; outlineColor?: string; x?: number; y?: number; boxWidth?: number; start?: number; duration?: number }
export interface StabilizationData { version: 1; method: 'translation'; sourceAssetId: string; sourceIn: number; sourceOut: number; sampleRate: number; smoothingSeconds: number; cropScale: number; confidence: number; samples: { frame: number; x: number; y: number }[] }
export interface MovieClip { id: string; assetId?: string; kind: 'image' | 'video' | 'title'; name: string; sourceIn: number; sourceOut: number; duration: number; speed: number; rotation: 0 | 90 | 180 | 270; fit: 'fit' | 'fill'; effect: Effect; effects?: Effect[]; brightness?: number; backgroundColor?: string; stabilization?: StabilizationData; panZoom: PanZoom; transition: { kind: TransitionKind; duration: number }; volume: number; fadeIn: number; fadeOut: number; text?: TextStyle }
export interface TextOverlay extends TextStyle { id: string; clipId?: string; start: number; duration: number }
export interface AudioTrack { id: string; assetId: string; name: string; kind: 'music' | 'narration'; clipId?: string; start: number; sourceIn: number; sourceOut: number; volume: number; fadeIn: number; fadeOut: number }
export interface ExportSettings { format?: 'webm' | 'mp4'; width: number; height: number; fps: FrameRate; bitrate: number; audioBitrate: number; includeAudio: boolean }
export interface MovieProject { format: 'lope-movie'; version: 1; id: string; name: string; fps: FrameRate; aspectRatio: '16:9' | '4:3' | '9:16'; assets: Record<string, MediaAsset>; clips: MovieClip[]; overlays: TextOverlay[]; audio: AudioTrack[]; emphasis: 'balanced' | 'video' | 'music' | 'narration'; audioMix?: number; exportSettings: ExportSettings }
export type Project = MovieProject;
export type Clip = MovieClip;
export type Asset = MediaAsset;
export interface TimelineEntry { clip: MovieClip; index: number; start: number; end: number }
export const uid = () => globalThis.crypto.randomUUID();
export const framesToSeconds = (frames: number, fps: FrameRate) => frames * fps.den / fps.num;
export const secondsToFrames = (seconds: number, fps: FrameRate) => Math.round(seconds * fps.num / fps.den);
export const frameTimestamp = (frame: number, fps: FrameRate) => Math.round(frame * 1_000_000 * fps.den / fps.num);
export function defaultText(text = 'Your title'): TextStyle { return { text, font: 'Arial', size: 56, color: '#ffffff', position: 'center', outline: 2, background: '#00000000', animation: 'fade' }; }
export function createProject(name = 'My movie'): MovieProject { return { format: 'lope-movie', version: 1, id: uid(), name, fps: { num: 30, den: 1 }, aspectRatio: '16:9', assets: {}, clips: [], overlays: [], audio: [], emphasis: 'balanced', exportSettings: { width: 1280, height: 720, fps: { num: 30, den: 1 }, bitrate: 5_000_000, audioBitrate: 128_000, includeAudio: true } }; }
export function createClip(asset?: MediaAsset, fps: FrameRate = { num: 30, den: 1 }): MovieClip {
  const duration = asset?.kind === 'video' ? Math.max(1, asset.durationFrames) : secondsToFrames(7, fps);
  return { id: uid(), ...(asset ? { assetId: asset.id } : {}), kind: asset?.kind === 'video' ? 'video' : asset?.kind === 'image' ? 'image' : 'title', name: asset?.name ?? 'Title', sourceIn: 0, sourceOut: duration, duration, speed: 1, rotation: 0, fit: 'fit', effect: 'none', panZoom: 'none', transition: { kind: 'none', duration: 0 }, volume: 1, fadeIn: 0, fadeOut: 0, ...(!asset ? { text: defaultText() } : {}) };
}
export function timeline(project: MovieProject): TimelineEntry[] { let start = 0; return project.clips.map((clip, index) => { const entry = { clip, index, start, end: start + clip.duration }; start = entry.end; return entry; }); }
/** Effective transition is bounded by both neighboring clips without overwriting the user's requested duration. */
export function effectiveTransition(project: MovieProject, clipId: string): MovieClip['transition'] {
  const index = project.clips.findIndex(clip => clip.id === clipId), clip = project.clips[index], prior = project.clips[index - 1];
  if (!clip || !prior || clip.transition.kind === 'none') return { kind: 'none', duration: 0 };
  const duration = Math.min(clip.transition.duration, Math.floor(clip.duration / 2), Math.floor(prior.duration / 2));
  return duration > 0 ? { kind: clip.transition.kind, duration } : { kind: 'none', duration: 0 };
}
export const projectDuration = (project: MovieProject) => project.clips.reduce((sum, clip) => sum + clip.duration, 0);
export const activeClip = (project: MovieProject, frame: number) => timeline(project).find(entry => frame >= entry.start && frame < entry.end);
export const anchoredStart = (project: MovieProject, item: { clipId?: string; start: number }) => (item.clipId ? timeline(project).find(entry => entry.clip.id === item.clipId)?.start ?? 0 : 0) + item.start;
export const audioDuration = (track: AudioTrack) => Math.max(0, track.sourceOut - track.sourceIn);
/** Only used sources are needed to play, export or carry this edit sequence to another device. */
export function referencedAssetIds(project: MovieProject): Set<string> { return new Set([...project.clips.flatMap(clip => clip.assetId && clip.kind !== 'title' ? [clip.assetId] : []), ...project.audio.map(track => track.assetId)]); }

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function addAssets(project: MovieProject, assets: MediaAsset[], addClips = true): MovieProject { const next = structuredClone(project); for (const asset of assets) { next.assets[asset.id] = asset; if (addClips && asset.kind !== 'audio') next.clips.push(createClip(asset, project.fps)); } return next; }
export function updateClip(project: MovieProject, id: string, patch: Partial<MovieClip>): MovieProject {
  return { ...project, clips: project.clips.map(clip => { if (clip.id !== id) return clip; const next = { ...clip, ...patch, id: clip.id }; next.duration = Math.max(1, Math.round(next.duration)); next.transition = { ...next.transition, duration: clamp(Math.round(next.transition.duration), 0, Math.floor(next.duration / 2)) }; next.fadeIn = clamp(next.fadeIn, 0, next.duration); next.fadeOut = clamp(next.fadeOut, 0, next.duration); return next; }) };
}
/** Move the ordered selection before beforeId, or to the end. Linked captions/audio follow their clip. */
export function reorderClips(project: MovieProject, ids: string[], beforeId?: string): MovieProject { const selected = new Set(ids); if (beforeId && selected.has(beforeId)) return project; const moving = project.clips.filter(clip => selected.has(clip.id)); const rest = project.clips.filter(clip => !selected.has(clip.id)); const index = beforeId ? rest.findIndex(clip => clip.id === beforeId) : rest.length; rest.splice(index < 0 ? rest.length : index, 0, ...moving); return { ...project, clips: rest }; }
export function removeClips(project: MovieProject, ids: string[]): MovieProject { const selected = new Set(ids); return { ...project, clips: project.clips.filter(clip => !selected.has(clip.id)), overlays: project.overlays.filter(item => !item.clipId || !selected.has(item.clipId)), audio: project.audio.filter(item => !item.clipId || !selected.has(item.clipId)) }; }
export function duplicateClips(project: MovieProject, ids: string[]): MovieProject { const selected = new Set(ids); const next = structuredClone(project); next.clips = []; for (const clip of project.clips) { next.clips.push(clip); if (!selected.has(clip.id)) continue; const duplicate = { ...structuredClone(clip), id: uid() }; next.clips.push(duplicate); for (const overlay of project.overlays.filter(item => item.clipId === clip.id)) next.overlays.push({ ...overlay, id: uid(), clipId: duplicate.id }); for (const track of project.audio.filter(item => item.clipId === clip.id)) next.audio.push({ ...track, id: uid(), clipId: duplicate.id }); } return next; }
/** Split keeps the original source trim and moves/splits clip-anchored captions and audio. */
export function splitClip(project: MovieProject, id: string, localFrame: number): MovieProject {
  const original = project.clips.find(clip => clip.id === id); const at = Math.round(localFrame);
  if (!original || at <= 0 || at >= original.duration) return project;
  const next = structuredClone(project); const index = next.clips.findIndex(clip => clip.id === id); const splitSource = original.sourceIn + at * original.speed;
  const left = { ...original, duration: at, sourceOut: splitSource, fadeIn: Math.min(original.fadeIn, at), fadeOut: 0, transition: { ...original.transition, duration: Math.min(original.transition.duration, Math.floor(at / 2)) } };
  const right: MovieClip = { ...structuredClone(original), id: uid(), sourceIn: splitSource, duration: original.duration - at, fadeIn: 0, fadeOut: Math.min(original.fadeOut, original.duration - at), transition: { kind: 'none', duration: 0 } };
  next.clips.splice(index, 1, left, right);
  next.overlays = project.overlays.flatMap(item => { if (item.clipId !== id) return [item]; if (item.start >= at) return [{ ...item, clipId: right.id, start: item.start - at }]; if (item.start + item.duration <= at) return [item]; return [{ ...item, duration: at - item.start }, { ...item, id: uid(), clipId: right.id, start: 0, duration: item.start + item.duration - at }]; });
  next.audio = project.audio.flatMap(item => { if (item.clipId !== id) return [item]; if (item.start >= at) return [{ ...item, clipId: right.id, start: item.start - at }]; if (item.start + audioDuration(item) <= at) return [item]; const offset = at - item.start; return [{ ...item, sourceOut: item.sourceIn + offset, fadeOut: 0 }, { ...item, id: uid(), clipId: right.id, start: 0, sourceIn: item.sourceIn + offset, fadeIn: 0 }]; });
  return next;
}
/** Trim in local output frames. Trimmed-away anchored items disappear; overlapping items are clipped. */
export function trimClip(project: MovieProject, id: string, start: number, end: number): MovieProject {
  const clip = project.clips.find(item => item.id === id); if (!clip) return project;
  const from = clamp(Math.round(start), 0, clip.duration - 1); const to = clamp(Math.round(end), from + 1, clip.duration); const duration = to - from;
  let next = updateClip(project, id, { sourceIn: clip.sourceIn + from * clip.speed, sourceOut: Math.min(clip.sourceOut, clip.sourceIn + to * clip.speed), duration });
  next = { ...next, overlays: next.overlays.flatMap(item => { if (item.clipId !== id) return [item]; const a = Math.max(from, item.start), b = Math.min(to, item.start + item.duration); return b > a ? [{ ...item, start: a - from, duration: b - a }] : []; }), audio: next.audio.flatMap(item => { if (item.clipId !== id) return [item]; const a = Math.max(from, item.start), b = Math.min(to, item.start + audioDuration(item)); return b > a ? [{ ...item, start: a - from, sourceIn: item.sourceIn + a - item.start, sourceOut: item.sourceIn + b - item.start }] : []; }) };
  return next;
}
/** Exact source trim, including restoration of previously trimmed source. Anchored decisions remain tied to source moments. */
export function setSourceTrim(project: MovieProject, id: string, sourceIn: number, sourceOut: number): MovieProject {
  const clip = project.clips.find(item => item.id === id); if (!clip || clip.kind !== 'video' || !Number.isFinite(sourceIn) || !Number.isFinite(sourceOut)) return project;
  const maximum = project.assets[clip.assetId!]?.durationFrames ?? clip.sourceOut;
  const from = clamp(sourceIn, 0, Math.max(0, maximum - .25)), to = clamp(sourceOut, from + .25, maximum);
  const duration = Math.max(1, Math.round((to - from) / clip.speed)), offset = (from - clip.sourceIn) / clip.speed;
  const next = updateClip(project, id, { sourceIn: from, sourceOut: to, duration });
  return { ...next, overlays: next.overlays.flatMap(item => { if (item.clipId !== id) return [item]; const start = Math.max(0, Math.round(item.start - offset)), end = Math.min(duration, Math.round(item.start + item.duration - offset)); return end > start ? [{ ...item, start, duration: end - start }] : []; }), audio: next.audio.flatMap(item => { if (item.clipId !== id) return [item]; const rawStart = Math.round(item.start - offset), start = Math.max(0, rawStart), end = Math.min(duration, rawStart + audioDuration(item)); const audioIn = item.sourceIn + Math.max(0, -rawStart); return end > start ? [{ ...item, start, sourceIn: audioIn, sourceOut: audioIn + end - start }] : []; }) };
}
/** Linked caption timing and audio starts follow their source moment. Voice/music retain their natural playback speed. */
export function setClipSpeed(project: MovieProject, id: string, speed: number): MovieProject {
  const clip = project.clips.find(item => item.id === id); if (!clip || clip.kind !== 'video' || !Number.isFinite(speed)) return project;
  const safe = clamp(speed, 0.25, 4), factor = clip.speed / safe, duration = Math.max(1, Math.round((clip.sourceOut - clip.sourceIn) / safe));
  const next = updateClip(project, id, { speed: safe, duration });
  return { ...next, overlays: next.overlays.flatMap(item => { if (item.clipId !== id) return [item]; const start = Math.round(item.start * factor), end = Math.min(duration, Math.round((item.start + item.duration) * factor)); return end > start ? [{ ...item, start, duration: end - start }] : []; }), audio: next.audio.map(item => item.clipId === id ? { ...item, start: Math.round(item.start * factor) } : item) };
}
/** Extending a still keeps explicit caption/audio times. Shortening it clips its captions; narration may continue across the next cut. */
export function setStillDuration(project: MovieProject, id: string, frames: number): MovieProject {
  const clip = project.clips.find(item => item.id === id); if (!clip || clip.kind === 'video' || !Number.isFinite(frames)) return project;
  const duration = Math.max(1, Math.round(frames)); const next = updateClip(project, id, { duration, sourceOut: clip.sourceIn + duration });
  return { ...next, overlays: next.overlays.flatMap(item => item.clipId !== id ? [item] : item.start >= duration ? [] : [{ ...item, duration: Math.min(item.duration, duration - item.start) }]) };
}
/** AutoMovie presets expand into ordinary editable clip/text/audio decisions. */
export function applyTheme(project: MovieProject, theme: AutoMovieTheme): MovieProject {
  const next = structuredClone(project);
  const effect: Effect = theme === 'cinematic' ? 'contrast' : theme === 'travel' ? 'warm' : theme === 'black-white' ? 'grayscale' : theme === 'sepia' ? 'sepia' : 'none';
  next.clips = next.clips.map((clip, index) => ({ ...clip, effects: undefined, brightness: undefined, transition: { kind: index ? theme === 'contemporary' ? 'slide-left' : theme === 'fade' ? 'fade' : 'dissolve' : 'none', duration: index ? Math.min(secondsToFrames(theme === 'cinematic' ? 1 : .5, next.fps), Math.floor(clip.duration / 2)) : 0 }, effect, panZoom: clip.kind === 'image' && !['simple', 'fade'].includes(theme) ? index % 2 ? 'out' : 'in' : 'none' }));
  if (next.clips.length && !next.overlays.some(item => item.clipId === next.clips[0].id && item.start === 0)) next.overlays.push({ id: uid(), clipId: next.clips[0].id, start: 0, duration: Math.min(next.clips[0].duration, secondsToFrames(4, next.fps)), ...defaultText(next.name), animation: theme === 'contemporary' ? 'slide-left' : theme === 'cinematic' ? 'zoom' : 'fade' });
  for (const music of next.audio.filter(item => item.kind === 'music')) { music.fadeIn = secondsToFrames(1, next.fps); music.fadeOut = secondsToFrames(2, next.fps); music.sourceOut = Math.min(next.assets[music.assetId]?.durationFrames ?? music.sourceOut, music.sourceIn + Math.max(1, projectDuration(next) - anchoredStart(next, music))); }
  return next;
}
/** The midpoint retains normal gain; moving toward either side fades only the opposite family. */
export function audioMixGain(project: MovieProject, kind: 'video' | 'music' | 'narration'): number { const mix = project.audioMix ?? .5; return Math.min(1, 2 * (kind === 'video' ? 1 - mix : mix)); }
export function applyToAll(project: MovieProject, sourceId: string, feature: 'transitions' | 'panZoom' | 'effects'): MovieProject {
  const source = project.clips.find(clip => clip.id === sourceId); if (!source) return project;
  return { ...project, clips: project.clips.map((clip, index) => {
    if (feature === 'panZoom') return clip.kind === 'image' ? { ...clip, panZoom: source.panZoom } : clip;
    if (feature === 'effects') return { ...clip, effect: source.effect, effects: source.effects ? [...source.effects] : undefined, brightness: source.brightness };
    return { ...clip, transition: index ? { ...source.transition, duration: Math.min(source.transition.duration, Math.floor(clip.duration / 2)) } : { kind: 'none', duration: 0 } };
  }) };
}
/** Fit photos and title cards to the music end while keeping video trims and speeds unchanged. */
export function fitToMusic(project: MovieProject): MovieProject {
  const music = project.audio.filter(track => track.kind === 'music');
  if (!music.length) throw new Error('Add music before fitting the movie to its soundtrack.');
  const target = Math.max(...music.map(track => anchoredStart(project, track) + audioDuration(track)));
  const flexible = project.clips.filter(clip => clip.kind !== 'video');
  if (!flexible.length) throw new Error('Fit to music adjusts photo and title durations. Add a photo or title, or trim the video clips first.');
  const available = target - project.clips.filter(clip => clip.kind === 'video').reduce((sum, clip) => sum + clip.duration, 0);
  if (available < flexible.length) throw new Error('The music is shorter than the video clips. Trim those clips or choose a longer soundtrack.');
  const weight = flexible.reduce((sum, clip) => sum + clip.duration, 0), spare = available - flexible.length;
  const durations = flexible.map(clip => ({ id: clip.id, value: 1 + Math.floor(spare * clip.duration / weight), remainder: (spare * clip.duration / weight) % 1 }));
  let remaining = available - durations.reduce((sum, entry) => sum + entry.value, 0);
  for (const entry of [...durations].sort((a, b) => b.remainder - a.remainder)) { if (!remaining) break; entry.value++; remaining--; }
  const byId = new Map(durations.map(entry => [entry.id, entry.value]));
  return { ...project, clips: project.clips.map(clip => { const duration = byId.get(clip.id); return duration === undefined ? clip : { ...clip, duration, sourceOut: clip.sourceIn + duration, transition: { ...clip.transition, duration: Math.min(clip.transition.duration, Math.floor(duration / 2)) }, fadeIn: Math.min(clip.fadeIn, duration), fadeOut: Math.min(clip.fadeOut, duration) }; }), overlays: project.overlays.flatMap(item => { if (!item.clipId || !byId.has(item.clipId)) return [item]; const old = project.clips.find(clip => clip.id === item.clipId)!, duration = byId.get(item.clipId)!; const start = Math.round(item.start * duration / old.duration), end = Math.min(duration, Math.round((item.start + item.duration) * duration / old.duration)); return end > start ? [{ ...item, start, duration: end - start }] : []; }), audio: project.audio.map(track => track.kind === 'music' ? { ...track, clipId: undefined, start: anchoredStart(project, track) } : track) };
}
export function splitAudio(project: MovieProject, id: string, absoluteFrame: number): MovieProject {
  const track = project.audio.find(track => track.id === id); if (!track) return project;
  const local = Math.round(absoluteFrame - anchoredStart(project, track)); if (local <= 0 || local >= audioDuration(track)) return project;
  return { ...project, audio: project.audio.flatMap(item => item.id !== id ? [item] : [{ ...item, sourceOut: item.sourceIn + local, fadeOut: 0, fadeIn: Math.min(item.fadeIn, local) }, { ...item, id: uid(), start: item.start + local, sourceIn: item.sourceIn + local, fadeIn: 0, fadeOut: Math.min(item.fadeOut, audioDuration(item) - local) }]) };
}
export function trimAudioToPlayhead(project: MovieProject, id: string, absoluteFrame: number, edge: 'start' | 'end'): MovieProject {
  const track = project.audio.find(track => track.id === id); if (!track) return project;
  const local = Math.round(absoluteFrame - anchoredStart(project, track)); if (local <= 0 || local >= audioDuration(track)) return project;
  return { ...project, audio: project.audio.map(item => item.id !== id ? item : edge === 'start' ? { ...item, start: item.start + local, sourceIn: item.sourceIn + local, fadeIn: Math.min(item.fadeIn, audioDuration(item) - local), fadeOut: Math.min(item.fadeOut, audioDuration(item) - local) } : { ...item, sourceOut: item.sourceIn + local, fadeIn: Math.min(item.fadeIn, local), fadeOut: Math.min(item.fadeOut, local) }) };
}
export interface ProjectHistory { present: MovieProject; past: MovieProject[]; future: MovieProject[]; saved: string }
export const projectFingerprint = (project: MovieProject) => JSON.stringify(project);
export const createHistory = (project: MovieProject = createProject()): ProjectHistory => ({ present: project, past: [], future: [], saved: projectFingerprint(project) });
export function applyEdit(history: ProjectHistory, edit: MovieProject | ((project: MovieProject) => MovieProject)): ProjectHistory { const next = typeof edit === 'function' ? edit(structuredClone(history.present)) : edit; return projectFingerprint(next) === projectFingerprint(history.present) ? history : { ...history, present: next, past: [...history.past.slice(-99), history.present], future: [] }; }
export const undo = (history: ProjectHistory): ProjectHistory => history.past.length ? { ...history, present: history.past.at(-1)!, past: history.past.slice(0, -1), future: [history.present, ...history.future] } : history;
export const redo = (history: ProjectHistory): ProjectHistory => history.future.length ? { ...history, present: history.future[0], past: [...history.past, history.present], future: history.future.slice(1) } : history;
export const isDirty = (history: ProjectHistory) => history.saved !== projectFingerprint(history.present);
export const markSaved = (history: ProjectHistory, savedProject = history.present): ProjectHistory => ({ ...history, saved: projectFingerprint(savedProject) });

function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`); return value as Record<string, unknown>; }
function str(value: unknown, label: string, max = 1000): string { if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${label}.`); return value; }
function num(value: unknown, label: string, min = 0, max = 10_000_000, integer = false): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Invalid ${label}.`); return value; }
function choice<T extends string>(value: unknown, options: readonly T[], label: string): T { if (typeof value !== 'string' || !options.includes(value as T)) throw new Error(`Invalid ${label}.`); return value as T; }
function list(value: unknown, label: string, max = 5000): unknown[] { if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${label}.`); return value; }
function rate(value: unknown): FrameRate { const r = object(value, 'frame rate'); const result = { num: num(r.num, 'frame rate', 1, 120000, true), den: num(r.den, 'frame rate denominator', 1, 10000, true) }; if (result.num / result.den < 1 || result.num / result.den > 120) throw new Error('Frame rate must be between 1 and 120 fps.'); return result; }
function optionalBoolean(value: unknown, label: string): boolean { if (typeof value !== 'boolean') throw new Error(`Invalid ${label}.`); return value; }
function hexColor(value: unknown, label: string): string { const color = str(value, label, 9); if (!/^#[\da-f]{6}([\da-f]{2})?$/i.test(color)) throw new Error(`${label} must be hexadecimal.`); return color; }
function textStyle(value: unknown): TextStyle {
  const t = object(value, 'text');
  return { text: str(t.text, 'text', 10000), font: str(t.font, 'font', 100), size: num(t.size, 'font size', 8, 300), color: hexColor(t.color, 'Text color'), position: choice(t.position, ['top', 'center', 'bottom'], 'text position'), outline: num(t.outline, 'text outline', 0, 20), background: hexColor(t.background, 'Text background'), animation: choice(t.animation, textAnimationPresets.map(preset => preset.id), 'text animation'), ...(t.bold !== undefined ? { bold: optionalBoolean(t.bold, 'bold') } : {}), ...(t.italic !== undefined ? { italic: optionalBoolean(t.italic, 'italic') } : {}), ...(t.alignment !== undefined ? { alignment: choice<'left' | 'center' | 'right'>(t.alignment, ['left', 'center', 'right'], 'text alignment') } : {}), ...(t.opacity !== undefined ? { opacity: num(t.opacity, 'text opacity', 0, 1) } : {}), ...(t.outlineColor !== undefined ? { outlineColor: hexColor(t.outlineColor, 'Outline color') } : {}), ...(t.x !== undefined ? { x: num(t.x, 'text horizontal position', 0, 1) } : {}), ...(t.y !== undefined ? { y: num(t.y, 'text vertical position', 0, 1) } : {}), ...(t.boxWidth !== undefined ? { boxWidth: num(t.boxWidth, 'text box width', .1, 1) } : {}), ...(t.start !== undefined ? { start: num(t.start, 'text start', 0, 10_000_000, true) } : {}), ...(t.duration !== undefined ? { duration: num(t.duration, 'text duration', 1, 10_000_000, true) } : {}) };
}
function stabilizationData(value: unknown): StabilizationData {
  const data = object(value, 'stabilization'); if (data.version !== 1 || data.method !== 'translation') throw new Error('Unsupported stabilization analysis.');
  const sourceIn = num(data.sourceIn, 'stabilization start'), sourceOut = num(data.sourceOut, 'stabilization end', sourceIn, 10_000_000);
  const samples = list(data.samples, 'stabilization motion samples', 18001).map(value => { const sample = object(value, 'motion sample'); return { frame: num(sample.frame, 'motion frame', sourceIn, sourceOut), x: num(sample.x, 'horizontal motion', -.35, .35), y: num(sample.y, 'vertical motion', -.35, .35) }; });
  if (!samples.length || samples.some((sample, index) => index > 0 && sample.frame <= samples[index - 1].frame)) throw new Error('Stabilization samples must be ordered and unique.');
  return { version: 1, method: 'translation', sourceAssetId: str(data.sourceAssetId, 'stabilized source'), sourceIn, sourceOut, sampleRate: num(data.sampleRate, 'motion sample rate', 1, 120), smoothingSeconds: num(data.smoothingSeconds, 'motion smoothing', .05, 10), cropScale: num(data.cropScale, 'stabilization crop', 1, 4), confidence: num(data.confidence, 'motion confidence', 0, 1), samples };
}
/** Parse untrusted projects into a fresh allowlisted object; reject future formats rather than silently flattening them. */
export function validateProject(value: unknown): MovieProject {
  const p = object(value, 'project'); if (p.format !== 'lope-movie' || p.version !== 1) throw new Error('This is not a supported LopeOS Movie project (version 1). Legacy .wlmp is not supported.');
  const assets: Record<string, MediaAsset> = Object.create(null); const records = object(p.assets, 'media references'); if (Object.keys(records).length > 5000) throw new Error('Too many media references.');
  for (const [key, value] of Object.entries(records)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid media identifier.'); const a = object(value, 'asset'); const id = str(a.id, 'media identifier'); if (!id || id !== key) throw new Error('Invalid media reference.'); assets[id] = { id, name: str(a.name, 'filename'), kind: choice(a.kind, ['image', 'video', 'audio'], 'media kind'), mime: str(a.mime, 'media type', 200), size: num(a.size, 'file size', 0, Number.MAX_SAFE_INTEGER, true), durationFrames: num(a.durationFrames, 'media duration', 0, 10_000_000, true), width: num(a.width, 'width', 0, 32768, true), height: num(a.height, 'height', 0, 32768, true), hasAudio: a.hasAudio === true }; }
  const clips = list(p.clips, 'clips').map(value => { const c = object(value, 'clip'), tr = object(c.transition, 'transition'); const kind = choice(c.kind, ['image', 'video', 'title'], 'clip kind'); const assetId = c.assetId === undefined ? undefined : str(c.assetId, 'asset reference'); if (kind !== 'title' && (!assetId || !assets[assetId] || assets[assetId].kind !== kind)) throw new Error('A clip has an invalid media reference.'); const rotation = num(c.rotation, 'rotation', 0, 270, true); if (rotation % 90) throw new Error('Invalid rotation.'); const duration = num(c.duration, 'clip duration', 1, 10_000_000, true), sourceIn = num(c.sourceIn, 'source in', 0, 10_000_000), sourceOut = num(c.sourceOut, 'source out', 0.001, 10_000_000); if (sourceOut <= sourceIn || (kind === 'video' && sourceOut > assets[assetId!].durationFrames)) throw new Error('Clip trim lies outside its source.'); const clip: MovieClip = { id: str(c.id, 'clip id'), ...(assetId ? { assetId } : {}), name: str(c.name, 'clip name'), kind, sourceIn, sourceOut, duration, speed: num(c.speed, 'playback speed', 0.25, 4), rotation: rotation as MovieClip['rotation'], fit: choice(c.fit, ['fit', 'fill'], 'image fit'), effect: choice(c.effect, effectPresets.map(preset => preset.id), 'visual effect'), ...(c.effects !== undefined ? { effects: list(c.effects, 'effect stack', 8).map(value => choice(value, effectPresets.map(preset => preset.id), 'visual effect')) } : {}), ...(c.brightness !== undefined ? { brightness: num(c.brightness, 'brightness', -1, 1) } : {}), ...(c.backgroundColor !== undefined ? { backgroundColor: hexColor(c.backgroundColor, 'Clip background') } : {}), ...(c.stabilization !== undefined ? { stabilization: stabilizationData(c.stabilization) } : {}), panZoom: choice(c.panZoom, panZoomPresets.map(preset => preset.id), 'pan and zoom'), transition: { kind: choice(tr.kind, transitionPresets.map(preset => preset.id), 'transition'), duration: num(tr.duration, 'transition duration', 0, Math.floor(duration / 2), true) }, volume: num(c.volume, 'clip volume', 0, 2), fadeIn: num(c.fadeIn, 'audio fade in', 0, duration, true), fadeOut: num(c.fadeOut, 'audio fade out', 0, duration, true), ...(c.text !== undefined ? { text: textStyle(c.text) } : {}) }; if (kind === 'title' && !clip.text) throw new Error('A title needs editable text.'); if (kind === 'video' && duration !== Math.max(1, Math.round((sourceOut - sourceIn) / clip.speed))) throw new Error('Video duration does not match its source trim and playback speed.'); return clip; });
  const clipIds = new Set(clips.map(clip => clip.id)); if (clipIds.size !== clips.length || clipIds.has('')) throw new Error('Clip identifiers must be unique.');
  const anchor = (o: Record<string, unknown>) => { if (o.clipId === undefined) return {}; const clipId = str(o.clipId, 'clip anchor'); if (!clipIds.has(clipId)) throw new Error('A caption or audio track refers to a missing clip.'); return { clipId }; };
  const overlays = list(p.overlays, 'text overlays').map(value => { const o = object(value, 'text overlay'); return { ...textStyle(o), id: str(o.id, 'overlay id'), ...anchor(o), start: num(o.start, 'text start', 0, 10_000_000, true), duration: num(o.duration, 'text duration', 1, 10_000_000, true) }; });
  const audio = list(p.audio, 'audio tracks').map(value => { const a = object(value, 'audio track'); const assetId = str(a.assetId, 'audio reference'); if (!assets[assetId] || (assets[assetId].kind !== 'audio' && !(assets[assetId].kind === 'video' && assets[assetId].hasAudio))) throw new Error('An audio track must reference a decodable audio source or a video with sound.'); const sourceIn = num(a.sourceIn, 'audio source in', 0, 10_000_000, true), sourceOut = num(a.sourceOut, 'audio source out', 1, assets[assetId].durationFrames, true); if (sourceOut <= sourceIn) throw new Error('Invalid audio trim.'); return { id: str(a.id, 'audio id'), assetId, name: str(a.name, 'audio name'), kind: choice(a.kind, ['music', 'narration'], 'audio lane'), ...anchor(a), start: num(a.start, 'audio start', 0, 10_000_000, true), sourceIn, sourceOut, volume: num(a.volume, 'audio volume', 0, 2), fadeIn: num(a.fadeIn, 'audio fade in', 0, 10_000_000, true), fadeOut: num(a.fadeOut, 'audio fade out', 0, 10_000_000, true) }; });
  for (const items of [overlays, audio]) { const ids = new Set(items.map(item => item.id)); if (ids.size !== items.length || ids.has('')) throw new Error('Text and audio identifiers must be unique.'); }
  const e = object(p.exportSettings, 'export settings'); const project: MovieProject = { format: 'lope-movie', version: 1, id: str(p.id, 'project id'), name: str(p.name, 'project name'), fps: rate(p.fps), aspectRatio: choice(p.aspectRatio, ['16:9', '4:3', '9:16'], 'aspect ratio'), assets, clips, overlays, audio, emphasis: choice(p.emphasis, ['balanced', 'video', 'music', 'narration'], 'audio emphasis'), ...(p.audioMix !== undefined ? { audioMix: num(p.audioMix, 'audio mix', 0, 1) } : {}), exportSettings: { ...(e.format !== undefined ? { format: choice<'webm' | 'mp4'>(e.format, ['webm', 'mp4'], 'export format') } : {}), width: num(e.width, 'export width', 64, 4096, true), height: num(e.height, 'export height', 64, 4096, true), fps: rate(e.fps), bitrate: num(e.bitrate, 'video bitrate', 100000, 100000000, true), audioBitrate: num(e.audioBitrate, 'audio bitrate', 16000, 512000, true), includeAudio: e.includeAudio === true } }; if (projectDuration(project) > secondsToFrames(86400, project.fps)) throw new Error('Projects longer than 24 hours are not supported.'); return project;
}
export const serializeProject = (project: MovieProject) => JSON.stringify(validateProject(project), null, 2);
export function parseProject(json: string): MovieProject { if (json.length > 20_000_000) throw new Error('This project exceeds the 20 MB decision-file limit.'); try { return validateProject(JSON.parse(json)); } catch (error) { if (error instanceof SyntaxError) throw new Error('This file is not valid project JSON.'); throw error; } }
