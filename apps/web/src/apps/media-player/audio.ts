// VLC's audio output chain on Web Audio: preamp → 10-band equalizer →
// compressor → stereo mode → delay → volume (up to 125%) → analyser.
import { EQ_BANDS, preampGain } from './formats';

export type StereoMode = 'stereo' | 'mono' | 'left' | 'right' | 'reverse';
export interface Compressor { enabled: boolean; threshold: number; ratio: number; knee: number; attack: number; release: number; makeup: number }
export const DEFAULT_COMPRESSOR: Compressor = { enabled: false, threshold: -20, ratio: 8, knee: 2.5, attack: 25, release: 100, makeup: 7 };

let shared: AudioContext | null = null;
const context = () => shared ??= new AudioContext({ latencyHint: 'playback' });

export class AudioChain {
  readonly analyser: AnalyserNode;
  private source: MediaElementAudioSourceNode;
  private preamp: GainNode;
  private bands: BiquadFilterNode[];
  private compressor: DynamicsCompressorNode;
  private makeup: GainNode;
  private matrix: GainNode[];
  private delay: DelayNode;
  private volume: GainNode;
  constructor(element: HTMLMediaElement) {
    const ctx = context();
    this.source = ctx.createMediaElementSource(element);
    // An explicit stereo node up-mixes mono and down-mixes surround with the
    // standard speaker rules before the channel matrix.
    const stereo = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    this.preamp = new GainNode(ctx);
    this.bands = EQ_BANDS.map(frequency => new BiquadFilterNode(ctx, { type: 'peaking', frequency, Q: 1.4, gain: 0 }));
    this.compressor = new DynamicsCompressorNode(ctx);
    this.makeup = new GainNode(ctx);
    const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 }), merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    // LL, LR, RL, RR: gain from input channel to output channel.
    this.matrix = [0, 1, 2, 3].map(() => new GainNode(ctx));
    splitter.connect(this.matrix[0], 0).connect(merger, 0, 0);
    splitter.connect(this.matrix[1], 0).connect(merger, 0, 1);
    splitter.connect(this.matrix[2], 1).connect(merger, 0, 0);
    splitter.connect(this.matrix[3], 1).connect(merger, 0, 1);
    this.delay = new DelayNode(ctx, { maxDelayTime: 10 });
    this.volume = new GainNode(ctx);
    this.analyser = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0.75 });
    let node: AudioNode = this.source.connect(stereo).connect(this.preamp);
    for (const band of this.bands) node = node.connect(band);
    node.connect(this.compressor).connect(this.makeup).connect(splitter);
    merger.connect(this.delay).connect(this.volume).connect(this.analyser).connect(ctx.destination);
    this.setStereo('stereo'); this.setCompressor(DEFAULT_COMPRESSOR);
  }
  resume() { if (shared?.state === 'suspended') void shared.resume(); }
  setVolume(value: number, muted: boolean) { this.volume.gain.value = muted ? 0 : value; }
  /** Two-pass runs the bands twice in VLC, which doubles each band's gain in dB. */
  setEqualizer(enabled: boolean, preamp: number, bands: number[], twoPass = false) {
    this.preamp.gain.value = enabled ? preampGain(preamp) : 1;
    this.bands.forEach((band, index) => { band.gain.value = enabled ? Math.max(-40, Math.min(40, (bands[index] ?? 0) * (twoPass ? 2 : 1))) : 0; });
  }
  setCompressor(value: Compressor) {
    const c = this.compressor;
    c.threshold.value = value.enabled ? value.threshold : 0;
    c.ratio.value = value.enabled ? value.ratio : 1;
    c.knee.value = value.knee; c.attack.value = value.attack / 1000; c.release.value = value.release / 1000;
    this.makeup.gain.value = value.enabled ? Math.pow(10, value.makeup / 20) : 1;
  }
  setStereo(mode: StereoMode) {
    const gains: Record<StereoMode, number[]> = { stereo: [1, 0, 0, 1], mono: [0.5, 0.5, 0.5, 0.5], left: [1, 1, 0, 0], right: [0, 0, 1, 1], reverse: [0, 1, 1, 0] };
    gains[mode].forEach((gain, index) => { this.matrix[index].gain.value = gain; });
  }
  /** Choose the output device ('' = system default). Players share one context, so they share the device. */
  async setOutput(deviceId: string) {
    const ctx = context() as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
    if (ctx.setSinkId && ctx.sinkId !== deviceId) await ctx.setSinkId(deviceId);
  }
  /** VLC's audio track synchronization; Web Audio can only delay, never advance. */
  setDelay(seconds: number) { this.delay.delayTime.value = Math.max(0, Math.min(10, seconds)); }
  disconnect() { this.source.disconnect(); this.analyser.disconnect(); }
}
