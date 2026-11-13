import { CanvasRenderer, SurfaceWriter, context2d, fromPixels, identity, layer, makeCanvas, newDocument, surface, uid, type ImageDocument } from '../../../../../packages/image-engine/src';
/** Original deterministic artwork; no Adobe or third-party image assets are shipped. */
export function sampleDocument(): ImageDocument {
  const width = 1440; const height = 960; const canvas = makeCanvas(width, height); const ctx = context2d(canvas);
  const sky = ctx.createLinearGradient(0, 0, 0, height); sky.addColorStop(0, '#172d37'); sky.addColorStop(.55, '#7c9a98'); sky.addColorStop(1, '#b6b3a0'); ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
  let seed = 103; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const atmosphere = ctx.createRadialGradient(1050, 260, 10, 1050, 260, 720); atmosphere.addColorStop(0, '#e1cba54d'); atmosphere.addColorStop(1, '#e1cba500'); ctx.fillStyle = atmosphere; ctx.fillRect(0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height); for (let i = 0; i < pixels.data.length; i += 4) { const grain = (random() - .5) * 7; for (let c = 0; c < 3; c++) pixels.data[i + c] += grain; } ctx.putImageData(pixels, 0, 0);
  const doc = newDocument(width, height, 'Alpine study.lopeimage'); const background = { ...layer('Atmosphere'), pixels: fromPixels(width, height, ctx.getImageData(0, 0, width, height).data), locked: true };
  ctx.clearRect(0, 0, width, height);
  const mountain = (points: number[][], fill: string) => { ctx.beginPath(); ctx.moveTo(0, height); points.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(width, height); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
  mountain([[0,660],[100,590],[230,632],[390,400],[490,468],[610,332],[780,510],[900,443],[1100,580],[1230,490],[1440,610]], '#7e9997');
  mountain([[0,745],[130,652],[225,560],[340,619],[505,447],[580,512],[720,370],[850,510],[1010,590],[1120,545],[1260,663],[1440,610]], '#46676b');
  ctx.beginPath(); ctx.moveTo(505,447); ctx.lineTo(580,512); ctx.lineTo(720,370); ctx.lineTo(690,430); ctx.lineTo(644,455); ctx.lineTo(621,487); ctx.lineTo(595,530); ctx.lineTo(560,539); ctx.closePath(); ctx.fillStyle = '#b9c5b7a0'; ctx.fill();
  const mountains = { ...layer('Mountain range', 'embedded'), source: fromPixels(width, height, ctx.getImageData(0, 0, width, height).data) };
  ctx.clearRect(0, 0, width, height);
  const lake = ctx.createLinearGradient(0,650,0,height); lake.addColorStop(0, '#668581'); lake.addColorStop(1, '#173e47'); ctx.fillStyle = lake; ctx.beginPath(); ctx.moveTo(0,720); ctx.bezierCurveTo(300,680,650,830,1440,695); ctx.lineTo(width,height); ctx.lineTo(0,height); ctx.fill();
  for (let i = 0; i < 420; i++) { const y = 725 + random() * 235; const x = random() * width; ctx.strokeStyle = random() > .5 ? '#c1c6b41a' : '#0a313815'; ctx.lineWidth = random() * 2; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x + 5 + random() * 70, y); ctx.stroke(); }
  mountain([[0,852],[200,865],[340,895],[555,910],[768,960],[0,960]], '#142e33');
  for (let x = -30; x < 420; x += 14 + random() * 16) { const y = 835 + x * .12; const size = 40 + random() * 100; ctx.fillStyle = '#173035'; ctx.beginPath(); ctx.moveTo(x,y-size); ctx.lineTo(x-size*.28,y); ctx.lineTo(x+size*.28,y); ctx.fill(); ctx.fillRect(x-2,y-5,4,20); }
  const foreground = { ...layer('Lake & forest'), pixels: fromPixels(width, height, ctx.getImageData(0, 0, width, height).data) };
  const circle = { ...layer('Evening sun', 'shape'), transform: { ...identity(), x: 1050, y: 180 }, opacity: .8, shape: { type: 'ellipse' as const, width: 102, height: 102, fill: '#cdb393', stroke: '#000000', strokeWidth: 0 } };
  const caption = { ...layer('LAYERED SAMPLE', 'text'), transform: { ...identity(), x: 111, y: 140 }, text: { content: 'LAYERED SAMPLE', font: 'Arial', size: 15, color: '#d9d6bd', bold: false, italic: false, align: 'left' as const, leading: 1.2, tracking: 5 } };
  const title = { ...layer('Alpine lake', 'text'), transform: { ...identity(), x: 105, y: 190 }, text: { content: 'Alpine\nlake', font: 'Georgia', size: 91, color: '#ede9d9', bold: false, italic: false, align: 'left' as const, leading: 1.03, tracking: -2 } };
  const paint = { ...layer('Retouch'), pixels: surface(width, height), mask: { pixels: surface(width, height, [255,255,255,255]), enabled: true, linked: true, transform: identity() } };
  doc.layers = [background, circle, mountains, foreground, caption, title, paint]; doc.activeIds = [paint.id]; doc.revision = uid(); return doc;
}
