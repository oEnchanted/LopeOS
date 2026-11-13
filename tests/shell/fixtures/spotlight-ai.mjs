/** A deterministic worker boundary for browser UI tests. The product has no test switch.
 * Real WebGPU/model execution is covered separately; this fixture never downloads weights. */
export async function installSpotlightAiFixture(page, { supported = true, halfPrecision = true } = {}) {
  await page.addInitScript(({ supported, halfPrecision }) => {
    const NativeWorker = window.Worker;
    const state = window.__spotlightAI = {
      workers: 0, terminations: 0, supportChecks: 0, incoming: [], clipboardWrites: [],
      loadMode: 'success', generationMode: 'success',
      replyChunks: ['A small ', 'local answer.'], delay: 80,
      emit: null,
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { state.clipboardWrites.push(text); } } });
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: supported ? {
      requestAdapter: async () => {
        state.supportChecks++;
        return { features: new Set(halfPrecision ? ['shader-f16'] : []), limits: {
          maxBufferSize: 1024 * 1024 * 1024, maxStorageBufferBindingSize: 1024 * 1024 * 1024,
        }, info: { vendor: 'QA', architecture: 'fixture' } };
      },
    } : undefined });
    class FixtureWorker extends EventTarget {
      constructor(url, options) {
        super();
        if (!String(url).includes('spotlight-ai')) return new NativeWorker(url, options);
        state.workers++;
        this.onmessage = null;
        this.onerror = null;
        this.dead = false;
        this.generating = null;
        state.emit = message => this.emit(message);
      }
      emit(message) {
        if (this.dead) return;
        const event = new MessageEvent('message', { data: message });
        this.onmessage?.(event);
        this.dispatchEvent(event);
      }
      postMessage(message) {
        state.incoming.push(structuredClone(message));
        // The concrete local-worker protocol is handled here once loaded by the test.
        this.handle(message);
      }
      handle(message) {
        const reply = value => this.emit({ ...value, id: message.id });
        if (message.type === 'load') {
          this.loading = message.id;
          setTimeout(() => reply({ type: 'progress', progress: .38, text: 'Downloading model: 38%' }), 30);
          if (state.loadMode === 'hold') return;
          setTimeout(() => {
            if (state.loadMode === 'error') reply({ type: 'error', message: 'Model download failed in test fixture.' });
            else reply({ type: 'ready' });
          }, state.delay * 2);
        } else if (message.type === 'generate') {
          const generation = { id: message.id, stopped: false };
          this.generating = generation;
          if (state.generationMode === 'error') {
            setTimeout(() => reply({ type: 'error', message: 'The model could not generate this response.' }), state.delay);
            return;
          }
          const chunks = [...state.replyChunks];
          const mode = state.generationMode;
          const next = index => setTimeout(() => {
            if (this.dead || generation.stopped || this.generating !== generation) return;
            if (index < chunks.length) {
              reply({ type: 'delta', text: chunks[index] });
              if (mode !== 'hold') next(index + 1);
            } else {
              this.generating = null;
              reply({ type: 'done', stopped: false });
            }
          }, state.delay);
          next(0);
        } else if (message.type === 'stop') {
          if (this.generating?.id === message.id) this.generating.stopped = true;
          setTimeout(() => reply({ type: 'done', stopped: true }), 20);
        } else if (message.type === 'reset') {
          if (this.generating) this.generating.stopped = true;
          this.generating = null;
          setTimeout(() => reply({ type: 'reset' }), 20);
        } else if (message.type === 'remove') {
          setTimeout(() => reply({ type: 'removed' }), 30);
        }
      }
      terminate() { if (!this.dead) state.terminations++; this.dead = true; }
    }
    window.Worker = FixtureWorker;
  }, { supported, halfPrecision });
}
