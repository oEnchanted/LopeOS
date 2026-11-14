import { mixBlock, type MixBlock } from './mix-math.ts';
import { checkCancelled } from './types.ts';
/** Exactly one PCM block in flight. Transfers copies, never the OS decoder cache. */
export class AudioMixWorker {
  private worker: Worker | null = typeof Worker !== 'undefined' ? new Worker(new URL('./mix.worker.ts', import.meta.url), { type: 'module', name: 'LopeOS Movie audio mix' }) : null;
  private rejectPending: ((error: Error) => void) | null = null;
  async mix(block: MixBlock, signal?: AbortSignal): Promise<[Float32Array, Float32Array]> {
    checkCancelled(signal); if (!this.worker) return mixBlock(block);
    if (this.rejectPending) throw new Error('The audio mixer already has a block in progress.');
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.rejectPending = null; signal?.removeEventListener('abort', abort); worker.onmessage = null; worker.onerror = null; };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const abort = () => { fail(new DOMException('Movie export cancelled. Your project is unchanged.', 'AbortError')); worker.terminate(); this.worker = null; };
      this.rejectPending = fail; signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = event => { if (event.data.error) fail(new Error(event.data.error)); else { cleanup(); resolve(event.data.channels); } };
      worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'The audio worker stopped unexpectedly. Retry playback or export.')); worker.terminate(); this.worker = null; };
      const copied: MixBlock = { ...block, sources: block.sources.map(source => ({ ...source, pcm: { ...source.pcm, channels: source.pcm.channels.map(channel => channel.slice()) } })) };
      try { worker.postMessage(copied, copied.sources.flatMap(source => source.pcm.channels.map(channel => channel.buffer))); } catch (error) { fail(error instanceof Error ? error : new Error('Could not start the audio mix.')); }
    });
  }
  dispose() { this.rejectPending?.(new DOMException('Audio mixing stopped.', 'AbortError')); this.worker?.terminate(); this.worker = null; }
}
