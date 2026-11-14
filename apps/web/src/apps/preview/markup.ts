/** Markup annotations stay editable objects in image coordinates until they are flattened for saving. */
export type ShapeKind = 'rect' | 'rounded' | 'oval' | 'line' | 'arrow' | 'star' | 'bubble' | 'pen' | 'highlight' | 'text' | 'image';
export type FontId = 'system' | 'serif' | 'mono' | 'rounded' | 'hand';
export interface Shape {
  id: string; kind: ShapeKind;
  x1: number; y1: number; x2: number; y2: number;
  stroke: string; fill: string | null; width: number;
  points?: number[];
  text?: string; font?: FontId; size?: number; bold?: boolean; align?: 'left' | 'center' | 'right';
  image?: HTMLCanvasElement;
}
export interface Style { stroke: string; fill: string | null; width: number; font: FontId; size: number; bold: boolean; align: 'left' | 'center' | 'right' }
export const defaultStyle: Style = { stroke: '#e5322d', fill: null, width: 3, font: 'system', size: 28, bold: false, align: 'left' };
export const fonts: Record<FontId, { label: string; family: string }> = {
  system: { label: 'System', family: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  serif: { label: 'Serif', family: 'ui-serif, Georgia, "Times New Roman", serif' },
  mono: { label: 'Monospace', family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  rounded: { label: 'Rounded', family: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif' },
  hand: { label: 'Handwriting', family: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive' },
};
export const shapeLabels: Partial<Record<ShapeKind, string>> = { rect: 'Rectangle', rounded: 'Rounded Rectangle', oval: 'Oval', line: 'Line', arrow: 'Arrow', star: 'Star', bubble: 'Speech Bubble', highlight: 'Highlight', pen: 'Sketch', text: 'Text', image: 'Image' };
export const palette = ['#e5322d', '#f28c28', '#f5c518', '#34a853', '#1a73e8', '#8e44ad', '#000000', '#ffffff'];

export const box = (s: Pick<Shape, 'x1' | 'y1' | 'x2' | 'y2'>) => ({ x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) });
const font = (s: Shape) => `${s.bold ? 'bold ' : ''}${s.size ?? 28}px ${fonts[s.font ?? 'system'].family}`;
let measureContext: CanvasRenderingContext2D | null = null;
/** Text boxes size to their content, so selection and hit testing match the rendering. */
export function measureText(shape: Shape): Shape {
  measureContext ??= document.createElement('canvas').getContext('2d');
  const context = measureContext!; context.font = font(shape);
  const lines = (shape.text || ' ').split('\n'), size = shape.size ?? 28;
  const width = Math.max(size * 0.6, ...lines.map(line => context.measureText(line || ' ').width)) + size * 0.5;
  return { ...shape, x2: shape.x1 + width, y2: shape.y1 + lines.length * size * 1.25 + size * 0.3 };
}
function starPath(context: CanvasRenderingContext2D, b: ReturnType<typeof box>) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.4 : 1;
    const x = cx + Math.cos(angle) * b.w / 2 * r, y = cy + Math.sin(angle) * b.h / 2 * r;
    if (i) context.lineTo(x, y); else context.moveTo(x, y);
  }
  context.closePath();
}
function bubblePath(context: CanvasRenderingContext2D, b: ReturnType<typeof box>) {
  const h = b.h * 0.78, r = Math.min(b.w, h) * 0.3;
  context.moveTo(b.x + r, b.y); context.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + h, r); context.arcTo(b.x + b.w, b.y + h, b.x, b.y + h, r);
  context.lineTo(b.x + b.w * 0.42, b.y + h); context.lineTo(b.x + b.w * 0.18, b.y + b.h); context.lineTo(b.x + b.w * 0.26, b.y + h);
  context.arcTo(b.x, b.y + h, b.x, b.y, r); context.arcTo(b.x, b.y, b.x + b.w, b.y, r); context.closePath();
}
export function drawShape(context: CanvasRenderingContext2D, shape: Shape) {
  const b = box(shape);
  context.save();
  context.lineWidth = shape.width; context.strokeStyle = shape.stroke; context.fillStyle = shape.fill ?? 'transparent';
  context.lineJoin = 'round'; context.lineCap = 'round';
  context.beginPath();
  switch (shape.kind) {
    case 'rect': context.rect(b.x, b.y, b.w, b.h); break;
    case 'highlight': context.globalCompositeOperation = 'multiply'; context.fillStyle = shape.fill ?? shape.stroke; context.globalAlpha = 0.4; context.fillRect(b.x, b.y, b.w, b.h); context.restore(); return;
    case 'rounded': context.roundRect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.2); break;
    case 'oval': context.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); break;
    case 'star': starPath(context, b); break;
    case 'bubble': bubblePath(context, b); break;
    case 'line': case 'arrow': {
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1), head = Math.max(10, shape.width * 4);
      const endX = shape.kind === 'arrow' ? shape.x2 - Math.cos(angle) * head * 0.6 : shape.x2, endY = shape.kind === 'arrow' ? shape.y2 - Math.sin(angle) * head * 0.6 : shape.y2;
      context.moveTo(shape.x1, shape.y1); context.lineTo(endX, endY); context.stroke();
      if (shape.kind === 'arrow') {
        context.beginPath(); context.fillStyle = shape.stroke;
        context.moveTo(shape.x2, shape.y2);
        context.lineTo(shape.x2 - Math.cos(angle - 0.45) * head, shape.y2 - Math.sin(angle - 0.45) * head);
        context.lineTo(shape.x2 - Math.cos(angle + 0.45) * head, shape.y2 - Math.sin(angle + 0.45) * head);
        context.closePath(); context.fill();
      }
      context.restore(); return;
    }
    case 'pen': {
      const p = shape.points ?? [];
      if (p.length >= 2) {
        context.moveTo(p[0], p[1]);
        if (p.length === 2) context.lineTo(p[0] + 0.01, p[1]);
        for (let i = 2; i < p.length - 2; i += 2) context.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
        if (p.length > 2) context.lineTo(p[p.length - 2], p[p.length - 1]);
      }
      if (shape.fill) { context.closePath(); context.fill(); }
      context.stroke(); context.restore(); return;
    }
    case 'text': {
      const size = shape.size ?? 28;
      if (shape.fill) { context.fillStyle = shape.fill; context.fillRect(b.x, b.y, b.w, b.h); }
      context.font = font(shape); context.fillStyle = shape.stroke; context.textBaseline = 'top';
      context.textAlign = shape.align ?? 'left';
      const x = shape.align === 'center' ? b.x + b.w / 2 : shape.align === 'right' ? b.x + b.w - size * 0.25 : b.x + size * 0.25;
      (shape.text ?? '').split('\n').forEach((line, i) => context.fillText(line, x, b.y + size * 0.2 + i * size * 1.25));
      context.restore(); return;
    }
    case 'image': if (shape.image) { context.imageSmoothingQuality = 'high'; context.drawImage(shape.image, b.x, b.y, b.w, b.h); } context.restore(); return;
  }
  if (shape.fill) context.fill();
  if (shape.width > 0) context.stroke();
  context.restore();
}
export function drawShapes(context: CanvasRenderingContext2D, shapes: Shape[]) { for (const shape of shapes) drawShape(context, shape); }

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy, t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
export function hitTest(shapes: Shape[], x: number, y: number, tolerance: number): Shape | undefined {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i], slack = tolerance + s.width / 2;
    if (s.kind === 'line' || s.kind === 'arrow') { if (segmentDistance(x, y, s.x1, s.y1, s.x2, s.y2) <= slack) return s; continue; }
    if (s.kind === 'pen') { const p = s.points ?? []; for (let j = 0; j + 3 < p.length; j += 2) if (segmentDistance(x, y, p[j], p[j + 1], p[j + 2], p[j + 3]) <= slack) return s; if (p.length === 2 && Math.hypot(x - p[0], y - p[1]) <= slack) return s; continue; }
    const b = box(s);
    if (x >= b.x - slack && x <= b.x + b.w + slack && y >= b.y - slack && y <= b.y + b.h + slack) return s;
  }
}
export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end';
export function handles(shape: Shape): { id: Handle; x: number; y: number }[] {
  if (shape.kind === 'line' || shape.kind === 'arrow') return [{ id: 'start', x: shape.x1, y: shape.y1 }, { id: 'end', x: shape.x2, y: shape.y2 }];
  if (shape.kind === 'pen' || shape.kind === 'text') return [];
  const b = box(shape);
  return [{ id: 'nw', x: b.x, y: b.y }, { id: 'ne', x: b.x + b.w, y: b.y }, { id: 'sw', x: b.x, y: b.y + b.h }, { id: 'se', x: b.x + b.w, y: b.y + b.h }];
}
export function resizeShape(shape: Shape, handle: Handle, x: number, y: number, keepAspect: boolean): Shape {
  if (handle === 'start') return { ...shape, x1: x, y1: y };
  if (handle === 'end') return { ...shape, x2: x, y2: y };
  const b = box(shape), fixedX = handle.includes('w') ? b.x + b.w : b.x, fixedY = handle.startsWith('n') ? b.y + b.h : b.y;
  let w = x - fixedX, h = y - fixedY;
  if (keepAspect && b.w && b.h) { const ratio = b.w / b.h; if (Math.abs(w) / ratio > Math.abs(h)) h = Math.sign(h || 1) * Math.abs(w) / ratio; else w = Math.sign(w || 1) * Math.abs(h) * ratio; }
  return { ...shape, x1: fixedX, y1: fixedY, x2: fixedX + w, y2: fixedY + h };
}
export function moveShape(shape: Shape, dx: number, dy: number): Shape {
  return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy, ...(shape.points ? { points: shape.points.map((v, i) => v + (i % 2 ? dy : dx)) } : {}) };
}
/** Maps annotations through a geometry change: rotation, flip, crop offset, or scale. */
export function transformShapes(shapes: Shape[], map: (x: number, y: number) => [number, number], scale = 1, transformImage?: (image: HTMLCanvasElement) => HTMLCanvasElement): Shape[] {
  return shapes.map(shape => {
    const [x1, y1] = map(shape.x1, shape.y1), [x2, y2] = map(shape.x2, shape.y2);
    const next: Shape = { ...shape, x1, y1, x2, y2, width: shape.width * scale };
    if (shape.points) next.points = shape.points.flatMap((_, i, p) => i % 2 ? [] : map(p[i], p[i + 1]));
    if (shape.kind === 'text') { const b = box(next); return measureText({ ...next, x1: b.x, y1: b.y, size: (shape.size ?? 28) * scale }); }
    if (shape.kind === 'image' && shape.image && transformImage) next.image = transformImage(shape.image);
    return next;
  });
}
export const shapeBounds = (shape: Shape) => {
  if (shape.kind === 'pen' && shape.points?.length) { const xs = shape.points.filter((_, i) => i % 2 === 0), ys = shape.points.filter((_, i) => i % 2 === 1); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  return box(shape);
};
