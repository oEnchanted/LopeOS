import type { MovieProject, MovieClip, TextStyle, Effect, PanZoom, TransitionKind } from '../../movie-maker/src/model.ts';
import { effectiveTransition } from '../../movie-maker/src/model.ts';
import type { MediaLibrary } from './media.ts';
import { frameSeconds } from './types.ts';
import { stabilizationAt } from './stabilization.ts';

export const effectFilters: Record<Effect, string> = {
  none: 'none', grayscale: 'grayscale(1)', sepia: 'sepia(1)', warm: 'sepia(.28) saturate(1.25)', cool: 'saturate(.85) hue-rotate(15deg)', contrast: 'contrast(1.35) saturate(1.1)', vintage: 'sepia(.5) contrast(.85) saturate(.75)',
  blur: 'blur(3px)', negative: 'invert(1)', cyan: 'grayscale(1) sepia(1) hue-rotate(130deg) saturate(1.6)',
  'blackwhite-orange': 'sepia(.8) saturate(1.2) grayscale(1) contrast(1.2)', 'blackwhite-red': 'sepia(1) saturate(2) grayscale(1) contrast(1.35)', 'blackwhite-yellow': 'sepia(.5) grayscale(1) brightness(1.1)',
  pixelate: 'none', posterize: 'none', threshold: 'none', edge: 'none', 'mirror-horizontal': 'none', 'mirror-vertical': 'none', 'fade-in-black': 'none', 'fade-out-black': 'none', 'fade-in-white': 'none', 'fade-out-white': 'none', 'hue-cycle': 'none',
};
export function effectPreviewFilter(clip: Pick<MovieClip, 'effect' | 'effects' | 'brightness'>): string {
  const filters = (clip.effects ?? [clip.effect]).map(effect => effectFilters[effect]).filter(filter => filter !== 'none');
  if (clip.brightness) filters.push(`brightness(${1 + clip.brightness})`);
  return filters.join(' ') || 'none';
}
export function sequenceAt(project: MovieProject, frame: number) {
  let start = 0;
  for (let index = 0; index < project.clips.length; index++) { const clip = project.clips[index]; if (frame < start + clip.duration) return { clip, index, start, local: Math.max(0, frame - start) }; start += clip.duration; }
  return null;
}
export function clipStart(project: MovieProject, clipId?: string) { if (!clipId) return 0; let start = 0; for (const clip of project.clips) { if (clip.id === clipId) return start; start += clip.duration; } return 0; }
function paintText(context: CanvasRenderingContext2D, style: TextStyle, width: number, height: number, progress: number) {
  const size = Math.max(8, style.size * height / 720), margin = width * .06, boxWidth = width * (style.boxWidth ?? .88), centerX = width * (style.x ?? .5), left = centerX - boxWidth / 2, lines: string[] = [];
  context.save(); context.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size}px ${style.font || 'sans-serif'}`; context.globalAlpha *= style.opacity ?? 1;
  for (const paragraph of style.text.split('\n')) { let line = ''; for (const word of paragraph.split(' ')) { const next = line ? `${line} ${word}` : word; if (line && context.measureText(next).width > boxWidth) { lines.push(line); line = word; } else line = next; } lines.push(line); }
  const lineHeight = size * 1.25, blockHeight = lines.length * lineHeight;
  let y = style.y !== undefined ? height * style.y - blockHeight / 2 : style.position === 'top' ? height * .12 : style.position === 'bottom' ? height * .88 - blockHeight : (height - blockHeight) / 2;
  const entrance = Math.min(1, progress * 5), eased = 1 - (1 - entrance) ** 3;
  if (style.animation === 'fade') context.globalAlpha *= Math.min(1, progress * 8, (1 - progress) * 8);
  if (style.animation === 'rise') { y += (1 - entrance) * height * .15; context.globalAlpha *= entrance; }
  if (style.animation === 'scroll') y = height - progress * (height + blockHeight);
  if (['zoom', 'stretch', 'fly', 'spin'].includes(style.animation)) {
    context.globalAlpha *= entrance; context.translate(centerX, y + blockHeight / 2);
    if (style.animation === 'zoom') context.scale(.6 + .4 * eased, .6 + .4 * eased);
    if (style.animation === 'stretch') context.scale(.15 + .85 * eased, 1);
    if (style.animation === 'fly') context.translate((1 - eased) * width * .4, (1 - eased) * height * .3);
    if (style.animation === 'spin') context.rotate(-(1 - eased) * Math.PI / 2);
    context.translate(-centerX, -y - blockHeight / 2);
  }
  if (style.animation === 'slide-left' || style.animation === 'slide-right') context.translate((1 - eased) * width * (style.animation === 'slide-left' ? -1 : 1), 0);
  if (style.background && style.background !== 'transparent') { context.fillStyle = style.background; context.fillRect(left - margin / 2, y - lineHeight * .2, boxWidth + margin, blockHeight + lineHeight * .3); }
  const alignment = style.alignment ?? 'center', x = alignment === 'left' ? left : alignment === 'right' ? left + boxWidth : centerX;
  context.textAlign = alignment; context.textBaseline = 'top'; context.lineJoin = 'round'; context.strokeStyle = style.outlineColor ?? '#000'; context.fillStyle = style.color;
  for (const [index, line] of lines.entries()) { if (style.outline > 0) { context.lineWidth = style.outline * height / 720; context.strokeText(line, x, y + index * lineHeight, boxWidth); } context.fillText(line, x, y + index * lineHeight, boxWidth); }
  context.restore();
}
export function panZoomTransform(preset: PanZoom, progress: number, width: number, height: number): { zoom: number; dx: number; dy: number } {
  const time = Math.max(0, Math.min(1, progress)); let zoom = 1, dx = 0, dy = 0;
  if (preset === 'in' || preset.startsWith('in-') || preset === 'out' || preset.startsWith('out-')) {
    const amount = preset.startsWith('out') ? 1 - time : time; zoom = 1 + .18 * amount;
    dx = preset.includes('left') ? width * .09 * amount : preset.includes('right') ? -width * .09 * amount : 0;
    dy = preset.includes('top') ? height * .09 * amount : preset.includes('bottom') ? -height * .09 * amount : 0;
  } else if (preset !== 'none') {
    zoom = 1.16; dx = preset.includes('left') ? -(time - .5) * width * .12 : preset.includes('right') ? (time - .5) * width * .12 : 0;
    dy = preset.includes('up') ? -(time - .5) * height * .12 : preset.includes('down') ? (time - .5) * height * .12 : 0;
  }
  return { zoom, dx, dy };
}
const scratch = new WeakMap<object, HTMLCanvasElement[]>();
function surface(owner: object, index: number, width: number, height: number) { let surfaces = scratch.get(owner); if (!surfaces) { surfaces = []; scratch.set(owner, surfaces); } const canvas = surfaces[index] ??= document.createElement('canvas'); if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height; return canvas; }
const filterOnly = (effect: Effect) => effectFilters[effect] !== 'none' || effect === 'none';
function applyEffect(source: HTMLCanvasElement, target: HTMLCanvasElement, effect: Effect, progress: number) {
  const context = target.getContext('2d')!, width = source.width, height = source.height;
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.filter = 'none'; context.clearRect(0, 0, width, height);
  if (filterOnly(effect)) { context.filter = effectFilters[effect]; context.drawImage(source, 0, 0); }
  else if (effect === 'mirror-horizontal' || effect === 'mirror-vertical') { context.translate(effect === 'mirror-horizontal' ? width : 0, effect === 'mirror-vertical' ? height : 0); context.scale(effect === 'mirror-horizontal' ? -1 : 1, effect === 'mirror-vertical' ? -1 : 1); context.drawImage(source, 0, 0); }
  else if (effect === 'pixelate') { const small = surface(source, 3, Math.max(1, Math.round(width / 16)), Math.max(1, Math.round(height / 16))); small.getContext('2d')!.drawImage(source, 0, 0, small.width, small.height); context.imageSmoothingEnabled = false; context.drawImage(small, 0, 0, width, height); }
  else if (effect === 'hue-cycle') { context.filter = `hue-rotate(${progress * 360}deg)`; context.drawImage(source, 0, 0); }
  else if (effect.startsWith('fade-')) { context.drawImage(source, 0, 0); context.globalAlpha = effect.includes('-in-') ? 1 - Math.min(1, progress * 4) : Math.max(0, 1 - (1 - progress) * 4); context.fillStyle = effect.endsWith('white') ? '#fff' : '#000'; context.fillRect(0, 0, width, height); }
  else {
    context.drawImage(source, 0, 0); const pixels = context.getImageData(0, 0, width, height), data = pixels.data;
    if (effect === 'posterize') { for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] / 64) * 64; }
    if (effect === 'threshold') { for (let i = 0; i < data.length; i += 4) { const level = data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722 > 128 ? 255 : 0; data[i] = data[i + 1] = data[i + 2] = level; } }
    if (effect === 'edge') {
      const input = new Uint8ClampedArray(data); const luminance = (x: number, y: number) => { const i = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4; return input[i] * .2126 + input[i + 1] * .7152 + input[i + 2] * .0722; };
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const gx = -luminance(x - 1, y - 1) + luminance(x + 1, y - 1) - 2 * luminance(x - 1, y) + 2 * luminance(x + 1, y) - luminance(x - 1, y + 1) + luminance(x + 1, y + 1); const gy = -luminance(x - 1, y - 1) - 2 * luminance(x, y - 1) - luminance(x + 1, y - 1) + luminance(x - 1, y + 1) + 2 * luminance(x, y + 1) + luminance(x + 1, y + 1); const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = Math.min(255, Math.hypot(gx, gy)); }
    }
    context.putImageData(pixels, 0, 0);
  }
  context.restore();
}
async function paintClip(project: MovieProject, clip: MovieClip, local: number, context: CanvasRenderingContext2D, width: number, height: number, library: MediaLibrary) {
  context.save(); context.fillStyle = clip.backgroundColor ?? '#101820'; context.fillRect(0, 0, width, height);
  try { if (clip.assetId && clip.kind !== 'title') {
    const sourceFrame = Math.min(clip.sourceOut - .001, clip.sourceIn + local * clip.speed);
    const source = clip.kind === 'image' ? await library.image(clip.assetId) : await library.frame(clip.assetId, Math.min(frameSeconds(clip.sourceOut, project.fps) - .000001, frameSeconds(sourceFrame, project.fps) + .00051), Math.max(width, height));
    const sw = (source as HTMLCanvasElement | ImageBitmap).width, sh = (source as HTMLCanvasElement | ImageBitmap).height;
    const swap = clip.rotation === 90 || clip.rotation === 270, orientedWidth = swap ? sh : sw, orientedHeight = swap ? sw : sh;
    const scale = clip.fit === 'fill' ? Math.max(width / orientedWidth, height / orientedHeight) : Math.min(width / orientedWidth, height / orientedHeight);
    const progress = Math.max(0, Math.min(1, local / Math.max(1, clip.duration - 1)));
    const motion = clip.kind === 'image' ? panZoomTransform(clip.panZoom, progress, width, height) : { zoom: 1, dx: 0, dy: 0 };
    const correction = clip.stabilization && clip.stabilization.sourceAssetId === clip.assetId && sourceFrame >= clip.stabilization.sourceIn && sourceFrame <= clip.stabilization.sourceOut ? stabilizationAt(clip.stabilization, sourceFrame) : { x: 0, y: 0, scale: 1 };
    const effects = clip.effects ?? [clip.effect], complex = effects.some(effect => !filterOnly(effect));
    const destination = complex ? surface(context.canvas, 0, width, height).getContext('2d')! : context;
    destination.save(); if (complex) { destination.setTransform(1, 0, 0, 1, 0, 0); destination.fillStyle = clip.backgroundColor ?? '#101820'; destination.fillRect(0, 0, width, height); }
    destination.translate(width / 2 + motion.dx, height / 2 + motion.dy); destination.rotate(clip.rotation * Math.PI / 180); destination.scale(scale * motion.zoom * correction.scale, scale * motion.zoom * correction.scale); destination.translate(correction.x * sw, correction.y * sh); destination.filter = complex ? 'none' : effectPreviewFilter(clip); destination.drawImage(source, -sw / 2, -sh / 2, sw, sh); destination.restore();
    if (complex) {
      let current = destination.canvas as HTMLCanvasElement; let next = surface(context.canvas, 1, width, height);
      for (const effect of effects) { if (effect === 'none') continue; applyEffect(current, next, effect, progress); [current, next] = [next, current]; }
      context.filter = clip.brightness ? `brightness(${1 + clip.brightness})` : 'none'; context.drawImage(current, 0, 0);
    }
  } } finally { context.restore(); }
}
function transitionMask(context: CanvasRenderingContext2D, kind: TransitionKind, progress: number, width: number, height: number) {
  context.beginPath();
  if (kind === 'wipe-left') context.rect(width * (1 - progress), 0, width * progress, height);
  else if (kind === 'wipe-right') context.rect(0, 0, width * progress, height);
  else if (kind === 'wipe-up') context.rect(0, height * (1 - progress), width, height * progress);
  else if (kind === 'wipe-down') context.rect(0, 0, width, height * progress);
  else if (kind === 'wipe-diagonal-right' || kind === 'wipe-diagonal-left') { const extent = progress * 2; if (kind.endsWith('left')) { context.moveTo(width, 0); context.lineTo(width - width * extent, 0); context.lineTo(width, height * extent); } else { context.moveTo(0, 0); context.lineTo(width * extent, 0); context.lineTo(0, height * extent); } context.closePath(); }
  else if (kind === 'iris') context.arc(width / 2, height / 2, Math.hypot(width, height) / 2 * progress, 0, Math.PI * 2);
  else if (kind === 'diamond') { context.moveTo(width / 2, height / 2 - height * progress); context.lineTo(width / 2 + width * progress, height / 2); context.lineTo(width / 2, height / 2 + height * progress); context.lineTo(width / 2 - width * progress, height / 2); context.closePath(); }
  else if (kind === 'barn-door') context.rect(width * (1 - progress) / 2, 0, width * progress, height);
  else if (kind === 'blinds-horizontal') { for (let index = 0; index < 10; index++) context.rect(0, index * height / 10, width, height / 10 * progress); }
  else if (kind === 'blinds-vertical') { for (let index = 0; index < 12; index++) context.rect(index * width / 12, 0, width / 12 * progress, height); }
  else if (kind === 'checkerboard') { for (let row = 0; row < 8; row++) for (let col = 0; col < 12; col++) { const amount = Math.max(0, Math.min(1, progress * 2 - (row + col) % 2)); context.rect(col * width / 12, row * height / 8, width / 12 * amount, height / 8); } }
  else if (kind === 'pixelate') { for (let row = 0; row < 18; row++) for (let col = 0; col < 32; col++) { const random = ((Math.imul(col + 17, 73856093) ^ Math.imul(row + 31, 19349663)) >>> 0) / 4294967296; if (random < progress) context.rect(col * width / 32, row * height / 18, width / 32 + 1, height / 18 + 1); } }
  else context.rect(0, 0, width, height);
  context.clip();
}

/** One edit evaluator is used for both visible preview and offline exported frames. */
export async function renderFrame(project: MovieProject, frame: number, canvas: HTMLCanvasElement, library: MediaLibrary) {
  const context = canvas.getContext('2d', { alpha: false }); if (!context) throw new Error('Canvas video rendering is unavailable.');
  const { width, height } = canvas; context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.filter = 'none'; context.fillStyle = '#101820'; context.fillRect(0, 0, width, height);
  try {
    const selected = sequenceAt(project, Math.max(0, frame)); if (!selected) return;
    const { clip, index, local } = selected, prior = project.clips[index - 1], transition = effectiveTransition(project, clip.id), transitionLength = transition.duration;
    if (prior && transition.kind !== 'none' && transitionLength > 0 && local < transitionLength) {
      const progress = local / transitionLength; await paintClip(project, prior, prior.duration - transitionLength + local, context, width, height, library);
      if (transition.kind === 'fade' || transition.kind === 'fade-white') {
        if (progress >= .5) await paintClip(project, clip, local, context, width, height, library);
        context.fillStyle = transition.kind === 'fade-white' ? '#fff' : '#000'; context.globalAlpha = progress < .5 ? progress * 2 : (1 - progress) * 2; context.fillRect(0, 0, width, height);
      } else {
        const layer = surface(canvas, 2, width, height); await paintClip(project, clip, local, layer.getContext('2d')!, width, height, library);
        context.save();
        if (transition.kind === 'dissolve') context.globalAlpha = progress;
        else if (transition.kind.startsWith('slide-')) context.translate(transition.kind === 'slide-left' ? width * (1 - progress) : transition.kind === 'slide-right' ? -width * (1 - progress) : 0, transition.kind === 'slide-up' ? height * (1 - progress) : transition.kind === 'slide-down' ? -height * (1 - progress) : 0);
        else transitionMask(context, transition.kind, progress, width, height);
        context.drawImage(layer, 0, 0); context.restore();
      }
      context.globalAlpha = 1;
    } else await paintClip(project, clip, local, context, width, height, library);
    let titleStart = 0;
    for (const item of project.clips) { if (item.text) { const start = titleStart + (item.text.start ?? 0), duration = item.text.duration ?? Math.max(1, item.duration - (item.text.start ?? 0)); if (frame >= start && frame < start + duration) paintText(context, item.text, width, height, (frame - start) / duration); } titleStart += item.duration; }
    for (const overlay of project.overlays) { const start = overlay.start + clipStart(project, overlay.clipId); if (frame >= start && frame < start + overlay.duration) paintText(context, overlay, width, height, (frame - start) / overlay.duration); }
  } finally { context.restore(); }
}
