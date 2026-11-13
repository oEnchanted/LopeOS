import { preferences } from '../../../../../packages/sdk/src/preferences';
import { SpotlightAI, type WorkerPort } from './core';
export { MODEL_NAME, MODEL_DOWNLOAD_LABEL, MAX_MESSAGE_LENGTH } from './core';
export type { AISnapshot, ChatMessage, AIPhase } from './core';

type GPUAccess = { requestAdapter(options?: { powerPreference: string }): Promise<{ features: { has(name: string): boolean } } | null> };
export const spotlightAI = new SpotlightAI({
  async checkSupport() {
    if (!globalThis.isSecureContext) return { supported: false, reason: 'Local AI needs HTTPS or localhost. Open LopeOS through a secure address.' };
    if (typeof Worker === 'undefined') return { supported: false, reason: 'This browser does not support the background worker needed for local AI.' };
    const gpu = (navigator as Navigator & { gpu?: GPUAccess }).gpu;
    if (!gpu) return { supported: false, reason: 'WebGPU is unavailable. Use a browser with WebGPU and hardware acceleration enabled.' };
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { supported: false, reason: 'No compatible graphics device is available. Enable hardware acceleration or try another browser.' };
    return { supported: true, shaderF16: adapter.features.has('shader-f16') };
  },
  createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'lope-spotlight-ai' }) as WorkerPort,
});

// Switching accounts cannot retain a previous user's chat or hidden model context.
if (typeof window !== 'undefined') {
  let owner = preferences.getActiveUser();
  const unsubscribe = preferences.subscribe(() => {
    const next = preferences.getActiveUser();
    if (next !== owner) { owner = next; spotlightAI.reset(); }
  });
  const reset = () => spotlightAI.reset();
  window.addEventListener('lope:sign-out', reset);
  window.addEventListener('pagehide', reset);
  import.meta.hot?.dispose(() => {
    unsubscribe();
    window.removeEventListener('lope:sign-out', reset);
    window.removeEventListener('pagehide', reset);
    spotlightAI.reset();
  });
}
