/** Pure audio math shared by the dedicated worker, unit checks and fallback. */
export interface Sound { assetId: string; kind: 'video' | 'music' | 'narration'; start: number; duration: number; offset: number; speed: number; volume: number; fadeIn: number; fadeOut: number }
export type Emphasis = 'balanced' | 'video' | 'music' | 'narration';
export interface PCMBlock { start: number; sampleRate: number; channels: Float32Array[] }
export interface MixBlock { first: number; length: number; sources: { sound: Sound; pcm: PCMBlock }[]; sounds: Sound[]; emphasis: Emphasis }
export function gainAt(sound: Sound, seconds: number, sounds: Sound[], emphasis: Emphasis) {
  const local = seconds - sound.start; if (local < 0 || local >= sound.duration) return 0;
  let gain = sound.volume;
  if (sound.fadeIn > 0) gain *= Math.min(1, local / sound.fadeIn);
  if (sound.fadeOut > 0) gain *= Math.min(1, (sound.duration - local) / sound.fadeOut);
  if (emphasis !== 'balanced' && sound.kind !== emphasis) {
    let duck = 0;
    for (const foreground of sounds) if (foreground.kind === emphasis) { const distance = Math.min(seconds - foreground.start + .1, foreground.start + foreground.duration + .1 - seconds); duck = Math.max(duck, Math.max(0, Math.min(1, distance / .1))); }
    gain *= 1 - .76 * duck;
  }
  return gain;
}
export function mixBlock(block: MixBlock): [Float32Array, Float32Array] {
  const output: [Float32Array, Float32Array] = [new Float32Array(block.length), new Float32Array(block.length)];
  for (const { sound, pcm } of block.sources) {
    const first = Math.max(block.first, Math.ceil(sound.start * 48000)), last = Math.min(block.first + block.length, Math.ceil((sound.start + sound.duration) * 48000));
    for (let ch = 0; ch < 2; ch++) {
      const samples = pcm.channels[Math.min(ch, pcm.channels.length - 1)], channel = output[ch];
      for (let i = first; i < last; i++) { const time = i / 48000, sample = (sound.offset + (time - sound.start) * sound.speed) * pcm.sampleRate - pcm.start, index = Math.floor(sample), fraction = sample - index; const value = (samples[index] ?? 0) * (1 - fraction) + (samples[index + 1] ?? 0) * fraction; channel[i - block.first] += value * gainAt(sound, time, block.sounds, block.emphasis); }
    }
  }
  for (const channel of output) for (let i = 0; i < channel.length; i++) if (Math.abs(channel[i]) > .95) channel[i] = Math.sign(channel[i]) * (.95 + .05 * Math.tanh((Math.abs(channel[i]) - .95) / .05));
  return output;
}
