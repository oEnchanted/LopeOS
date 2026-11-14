/** Translation-only camera-motion estimation. No codec or source media ownership. */
export interface GrayFrame { width: number; height: number; data: Uint8Array }
export interface MotionEstimate { x: number; y: number; confidence: number; matches: number; candidates: number }
export interface MotionPoint { frame: number; x: number; y: number; confidence: number; segment: number }
export interface CorrectionPoint { frame: number; x: number; y: number }
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };

/** Robust, brightness-invariant patch matches vote for the global image translation. */
export function estimateTranslation(previous: GrayFrame, current: GrayFrame, searchRadius = 12): MotionEstimate {
  const { width, height } = previous;
  if (width !== current.width || height !== current.height || previous.data.length !== width * height || current.data.length !== width * height) throw new Error('Motion frames must have matching dimensions and complete luminance planes.');
  const radius = Math.max(2, Math.min(20, Math.floor(searchRadius))), patch = 3, margin = radius + patch + 2;
  const candidates: { x: number; y: number; error: number; quality: number }[] = [];
  let textured = 0;
  const step = Math.max(12, Math.round(Math.min(width, height) / 6));
  for (let y = margin; y < height - margin; y += step) for (let x = margin; x < width - margin; x += step) {
    let sum = 0, squares = 0;
    const values: number[] = [];
    for (let py = -patch; py <= patch; py++) for (let px = -patch; px <= patch; px++) { const value = previous.data[(y + py) * width + x + px]; values.push(value); sum += value; squares += value * value; }
    const count = values.length, variance = squares - sum * sum / count;
    if (variance / count < 36) continue;
    textured++;
    const score = (dx: number, dy: number) => {
      let deltaSum = 0, deltaSquares = 0, index = 0;
      for (let py = -patch; py <= patch; py++) for (let px = -patch; px <= patch; px++) { const delta = values[index++] - current.data[(y + py + dy) * width + x + px + dx]; deltaSum += delta; deltaSquares += delta * delta; }
      return Math.max(0, deltaSquares - deltaSum * deltaSum / count) / variance;
    };
    // Search every integer location. Coarse sampling can miss isolated narrow features.
    let best = Infinity, bestX = 0, bestY = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const error = score(dx, dy);
      if (error < best) { best = error; bestX = dx; bestY = dy; }
    }
    if (best > .5 || Math.abs(bestX) === radius || Math.abs(bestY) === radius) continue;
    // Parabolic refinement retains subpixel translations from downsampled video frames.
    const refine = (minus: number, center: number, plus: number) => { const denominator = minus - 2 * center + plus; return denominator > .001 ? Math.max(-.5, Math.min(.5, .5 * (minus - plus) / denominator)) : 0; };
    const dx = bestX + refine(score(bestX - 1, bestY), best, score(bestX + 1, bestY));
    const dy = bestY + refine(score(bestX, bestY - 1), best, score(bestX, bestY + 1));
    candidates.push({ x: dx, y: dy, error: best, quality: 1 - best });
  }
  if (candidates.length < 4) return { x: 0, y: 0, confidence: 0, matches: 0, candidates: textured };
  let consensus: typeof candidates = [], bestWeight = 0;
  for (const candidate of candidates) {
    const inliers = candidates.filter(match => Math.hypot(match.x - candidate.x, match.y - candidate.y) <= 1.25);
    const weight = inliers.reduce((sum, match) => sum + match.quality, 0);
    if (weight > bestWeight) { consensus = inliers; bestWeight = weight; }
  }
  const confidence = Math.min(1, consensus.length / 10) * bestWeight / Math.max(1, textured);
  if (consensus.length < 4 || confidence < .2) return { x: 0, y: 0, confidence: 0, matches: consensus.length, candidates: textured };
  return { x: median(consensus.map(match => match.x)), y: median(consensus.map(match => match.y)), confidence, matches: consensus.length, candidates: textured };
}

/** Gaussian local-linear smoothing retains an intentional constant-speed pan, including endpoints. */
export function smoothMotionPath(path: MotionPoint[], sigmaFrames: number, width: number, height: number): { samples: CorrectionPoint[]; cropScale: number; confidence: number } {
  if (!path.length) throw new Error('There are no motion samples to stabilize.');
  const sigma = Math.max(1, sigmaFrames), radius = Math.ceil(sigma * 3);
  let largestX = 0, largestY = 0;
  const samples = path.map((point, index) => {
    let s0 = 0, s1 = 0, s2 = 0, x0 = 0, x1 = 0, y0 = 0, y1 = 0;
    for (let at = Math.max(0, index - radius); at <= Math.min(path.length - 1, index + radius); at++) {
      const neighbor = path[at]; if (neighbor.segment !== point.segment) continue;
      const t = at - index, weight = Math.exp(-.5 * t * t / (sigma * sigma));
      s0 += weight; s1 += weight * t; s2 += weight * t * t;
      x0 += weight * neighbor.x; x1 += weight * t * neighbor.x; y0 += weight * neighbor.y; y1 += weight * t * neighbor.y;
    }
    const determinant = s0 * s2 - s1 * s1;
    const targetX = determinant > 1e-6 ? (x0 * s2 - x1 * s1) / determinant : point.x;
    const targetY = determinant > 1e-6 ? (y0 * s2 - y1 * s1) / determinant : point.y;
    const x = (targetX - point.x) / width, y = (targetY - point.y) / height;
    largestX = Math.max(largestX, Math.abs(x)); largestY = Math.max(largestY, Math.abs(y));
    return { frame: point.frame, x, y };
  });
  const margin = Math.max(largestX, largestY);
  if (margin > .35) throw new Error('The measured motion needs more than 70% cropping. Try Gentle stabilization or split this clip into shorter sections.');
  const cropScale = margin < .0001 ? 1 : Math.max(1 / (1 - 2 * largestX), 1 / (1 - 2 * largestY)) * 1.002;
  const measured = path.slice(1); const confidence = measured.length ? measured.reduce((sum, point) => sum + point.confidence, 0) / measured.length : 0;
  return { samples, cropScale, confidence };
}
