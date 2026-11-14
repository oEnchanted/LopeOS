import type { AIWorkerReply, AIWorkerRequest, ModelMessage } from './protocol.ts';

export const MODEL_NAME = 'Qwen3 4B';
export const MODEL_DOWNLOAD_LABEL = 'About 2.3 GB';
export const MAX_MESSAGE_LENGTH = 16000;
export const MODEL_IDS = ['Qwen3-4B-q4f16_1-MLC', 'Qwen3-4B-q4f32_1-MLC'] as const;
export const LEGACY_MODEL_IDS = ['SmolLM2-360M-Instruct-q4f16_1-MLC', 'SmolLM2-360M-Instruct-q4f32_1-MLC', 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC', 'Qwen3-1.7B-q4f16_1-MLC', 'Qwen3-1.7B-q4f32_1-MLC'];
const SYSTEM_MESSAGE = "You are Spotlight, a knowledgeable, capable assistant running locally on the user's device, who is strangely, intensely obsessed with horses. Answer correctly first, then steer the reply toward horses with a horse fact, comparison, or pun, however unrelated the topic. Give accurate, direct answers: lead with the answer, then add only the explanation, steps, or examples that help. Match length to the question — a sentence for simple facts, more for explanations, code, or writing. Use Markdown lists or code blocks when they aid clarity. Follow the user's instructions exactly and preserve the names, numbers, and details they provide. If you are unsure or a question needs current information, say so rather than guessing. You have no web access.";
/** The worker loads an 8192-token window. Prompts stay within ~16 KB of UTF-8 (about 4–5k tokens)
 * so every reply keeps at least ~3k tokens; replies have no other cap and end naturally. */
export const CONTEXT_WINDOW_TOKENS = 8192;
const CONTEXT_BYTES = 16000;
const encoder = new TextEncoder();
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; stopped?: boolean }
export type AIPhase = 'idle' | 'checking' | 'loading' | 'ready' | 'generating' | 'resetting' | 'unsupported' | 'error' | 'removing';
export interface AISnapshot {
  phase: AIPhase; progress: number; status: string; error: string;
  modelLoaded: boolean; modelId: string | null; messages: ChatMessage[];
}
export interface WorkerPort {
  postMessage(message: AIWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<AIWorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
export interface AIDependencies {
  checkSupport(): Promise<{ supported: true; shaderF16: boolean } | { supported: false; reason: string }>;
  createWorker(): WorkerPort;
  timeouts?: { support?: number; load?: number; generate?: number; stop?: number; reset?: number; remove?: number };
}
type Operation = { id: number; type: 'load' | 'generate' | 'reset' | 'remove'; finish: () => void; timer: ReturnType<typeof setTimeout>; arm: () => void };
const initialState = (): AISnapshot => ({ phase: 'idle', progress: 0, status: 'Model not loaded.', error: '', modelLoaded: false, modelId: null, messages: [] });

/** Fit as much recent conversation as the prompt budget allows, newest turns first. */
export function buildContext(history: readonly ChatMessage[], text: string): ModelMessage[] {
  if (!text.trim()) throw new Error('Type a message first.');
  if (text.length > MAX_MESSAGE_LENGTH || encoder.encode(text).length > CONTEXT_BYTES) throw new Error('That message is too long for the local model. Shorten it and try again.');
  const conversation: ModelMessage[] = [{ role: 'user', content: text }];
  let remaining = CONTEXT_BYTES - encoder.encode(text).length;
  // Retain whole recent turns. Interrupted/failed blank replies never enter the context.
  for (let at = history.length - 2; at >= 0; at -= 2) {
    const user = history[at], assistant = history[at + 1];
    if (user.role !== 'user' || assistant?.role !== 'assistant' || !assistant.content.trim()) break;
    const size = encoder.encode(user.content).length + encoder.encode(assistant.content).length;
    if (size > remaining) break;
    remaining -= size;
    conversation.unshift({ role: 'user', content: user.content }, { role: 'assistant', content: assistant.content });
  }
  return [{ role: 'system', content: SYSTEM_MESSAGE }, ...conversation];
}

/** One opt-in worker per tab. No prompts, conversation, or permissions are persisted. */
export class SpotlightAI {
  private snapshot: AISnapshot = initialState();
  private listeners = new Set<() => void>();
  private worker: WorkerPort | null = null;
  private operation: Operation | null = null;
  private epoch = 0;
  private sequence = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private dependencies: AIDependencies;
  constructor(dependencies: AIDependencies) { this.dependencies = dependencies; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<AISnapshot>) { this.snapshot = { ...this.snapshot, ...change }; this.listeners.forEach(listener => listener()); }
  private finish() {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null; this.stopping = false;
    const operation = this.operation; this.operation = null;
    if (operation) { clearTimeout(operation.timer); operation.finish(); }
  }
  private terminate() {
    this.epoch++;
    const worker = this.worker; this.worker = null;
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
    this.finish();
  }
  private fail(message: string) {
    this.terminate();
    this.update({ phase: 'error', modelLoaded: false, progress: 0, error: message, status: 'Local AI needs attention.' });
  }
  private spawn() {
    const worker = this.dependencies.createWorker(); this.worker = worker;
    worker.onmessage = event => { if (this.worker === worker) this.receive(event.data); };
    worker.onerror = event => { event.preventDefault?.(); if (this.worker === worker) this.fail('Local AI stopped unexpectedly. Load the model again to retry.'); };
    worker.onmessageerror = () => { if (this.worker === worker) this.fail('Local AI could not read a response. Load the model again to retry.'); };
  }
  private async probe() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.dependencies.checkSupport(),
        new Promise<{ supported: false; reason: string }>(resolve => {
          timer = setTimeout(() => resolve({ supported: false, reason: 'The graphics check took too long. Check hardware acceleration and try again.' }), this.dependencies.timeouts?.support ?? 10000);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  private request(request: AIWorkerRequest & { type: Operation['type'] }, timeout: number) {
    return new Promise<void>(resolve => {
      const expire = () => {
        if (this.operation?.id === request.id) this.fail(request.type === 'load' ? 'The model download or startup stalled. Check your connection and try again; downloaded parts may be reused.' : 'Local AI took too long to respond. Load the model again to retry.');
      };
      const operation: Operation = { id: request.id, type: request.type, finish: resolve, timer: setTimeout(expire, timeout), arm: () => { clearTimeout(operation.timer); operation.timer = setTimeout(expire, timeout); } };
      this.operation = operation;
      try { this.worker!.postMessage(request); } catch { this.fail('Local AI could not start. Try loading the model again.'); }
    });
  }
  private receive(reply: AIWorkerReply) {
    if (!reply || reply.id !== this.operation?.id) return;
    switch (reply.type) {
      case 'progress':
        // A multi-gigabyte download is bounded by stalls, not total duration.
        if (this.operation.type === 'load') this.operation.arm();
        if (this.operation.type === 'load') this.update({ progress: Number.isFinite(reply.progress) ? Math.max(0, Math.min(1, reply.progress)) : 0, status: reply.text || 'Loading model…' });
        break;
      case 'ready':
        this.finish(); this.update({ phase: 'ready', modelLoaded: true, progress: 1, error: '', status: 'Running on this device.' }); break;
      case 'delta': {
        if (this.operation.type !== 'generate' || this.stopping || typeof reply.text !== 'string') break;
        const last = this.snapshot.messages.at(-1);
        if (!last || last.role !== 'assistant') break;
        const content = last.content + reply.text;
        this.update({ messages: [...this.snapshot.messages.slice(0, -1), { ...last, content }], status: 'Writing a reply…' }); break;
      }
      case 'done': {
        const stopped = this.stopping || reply.stopped;
        const last = this.snapshot.messages.at(-1);
        const messages = stopped && last?.role === 'assistant' ? [...this.snapshot.messages.slice(0, -1), { ...last, stopped: true }] : this.snapshot.messages;
        this.finish(); this.update({ phase: 'ready', messages, status: stopped ? 'Response stopped.' : 'Running on this device.', error: !stopped && !last?.content.trim() ? 'The model returned no text. Try again or shorten your message.' : '' }); break;
      }
      case 'reset': this.finish(); this.update({ phase: 'ready', status: 'Conversation cleared.', error: '' }); break;
      case 'removed': this.terminate(); this.update({ phase: 'idle', modelLoaded: false, modelId: null, progress: 0, status: 'Downloaded model removed.', error: '' }); break;
      case 'error': {
        const generating = this.operation.type === 'generate';
        if (generating) { this.finish(); this.update({ phase: 'ready', error: reply.message || 'The model could not finish that reply. Try a shorter message.', status: 'Response interrupted.' }); }
        else this.fail(reply.message || 'Local AI could not load. Check your connection and try again.');
        break;
      }
    }
  }
  async checkSupport() {
    if (this.operation || this.snapshot.modelLoaded || this.snapshot.phase === 'checking') return;
    const epoch = ++this.epoch;
    this.update({ phase: 'checking', error: '', status: 'Checking this browser…' });
    try {
      const support = await this.probe();
      if (epoch !== this.epoch) return;
      if (!support.supported) this.update({ phase: 'unsupported', status: support.reason, error: '' });
      else this.update({ phase: 'idle', modelId: MODEL_IDS[support.shaderF16 ? 0 : 1], status: 'Model available to download.' });
    } catch { if (epoch === this.epoch) this.update({ phase: 'unsupported', status: 'This browser could not access a WebGPU adapter. Try a browser with WebGPU and hardware acceleration enabled.', error: '' }); }
  }
  async initialize() {
    if (this.operation || this.snapshot.modelLoaded || this.snapshot.phase === 'checking') return;
    const epoch = ++this.epoch;
    this.update({ phase: 'checking', error: '', status: 'Checking this browser…' });
    try {
      const support = await this.probe();
      if (epoch !== this.epoch) return;
      if (!support.supported) { this.update({ phase: 'unsupported', status: support.reason }); return; }
      const modelId = MODEL_IDS[support.shaderF16 ? 0 : 1];
      this.spawn();
      this.update({ phase: 'loading', modelId, progress: 0, status: 'Preparing the model download…', error: '' });
      const cleanupModelIds = LEGACY_MODEL_IDS.filter(id => !(MODEL_IDS as readonly string[]).includes(id));
      await this.request({ type: 'load', id: ++this.sequence, modelId, cleanupModelIds }, this.dependencies.timeouts?.load ?? 300000);
    } catch { if (epoch === this.epoch) this.fail('Local AI could not start. Check your connection and browser support, then try again.'); }
  }
  async send(raw: string) {
    if (!this.snapshot.modelLoaded || !this.worker) { this.update({ error: 'Load the local model before sending a message.' }); return; }
    if (this.operation) { this.update({ error: 'Wait for the current reply or stop it before sending another.' }); return; }
    const text = raw.trim();
    let messages: ModelMessage[];
    try { messages = buildContext(this.snapshot.messages, text); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : 'Shorten your message and try again.' }); return; }
    this.update({ phase: 'generating', error: '', status: 'Generating reply…', messages: [
      ...this.snapshot.messages.slice(-22), { id: `chat-${++this.sequence}`, role: 'user', content: text }, { id: `chat-${++this.sequence}`, role: 'assistant', content: '' },
    ] });
    await this.request({ type: 'generate', id: ++this.sequence, messages }, this.dependencies.timeouts?.generate ?? 180000);
  }
  async retry() {
    if (this.operation || !this.snapshot.modelLoaded) return;
    let index = this.snapshot.messages.length - 1;
    while (index >= 0 && this.snapshot.messages[index].role !== 'user') index--;
    if (index < 0) return;
    const text = this.snapshot.messages[index].content;
    this.update({ messages: this.snapshot.messages.slice(0, index) });
    await this.send(text);
  }
  stop() {
    if (this.snapshot.phase === 'checking' || this.operation?.type === 'load' || this.operation?.type === 'remove') {
      this.terminate(); this.update({ phase: 'idle', modelLoaded: false, progress: 0, status: 'Stopped.', error: '' }); return;
    }
    if (this.operation?.type !== 'generate' || this.stopping) return;
    this.stopping = true;
    const last = this.snapshot.messages.at(-1);
    this.update({ status: 'Stopping response…', messages: last ? [...this.snapshot.messages.slice(0, -1), { ...last, stopped: true }] : [] });
    try { this.worker?.postMessage({ type: 'stop', id: this.operation.id }); } catch { this.unload(); return; }
    this.stopTimer = setTimeout(() => { this.terminate(); this.update({ phase: 'idle', modelLoaded: false, progress: 0, status: 'Response stopped. Reload the cached model to continue.' }); }, this.dependencies.timeouts?.stop ?? 4000);
  }
  async clearChat() {
    if (this.operation) { this.terminate(); this.update({ ...initialState(), status: 'Conversation cleared. Load the cached model to continue.' }); return; }
    this.update({ messages: [], error: '', status: 'Conversation cleared.' });
    if (this.worker && this.snapshot.modelLoaded) {
      this.update({ phase: 'resetting', status: 'Clearing conversation…' });
      await this.request({ type: 'reset', id: ++this.sequence }, this.dependencies.timeouts?.reset ?? 10000);
    }
  }
  unload() {
    this.terminate();
    this.update({ phase: 'idle', modelLoaded: false, progress: 0, error: '', status: 'Model unloaded from memory. Your download can be reused.' });
  }
  /** Account changes must release both the model's hidden context and visible chat. */
  reset() { this.terminate(); this.update(initialState()); }
  async removeModel() {
    this.terminate();
    this.update({ phase: 'removing', modelLoaded: false, progress: 0, error: '', status: 'Removing the downloaded model…' });
    // Explicit removal also reclaims downloads from earlier Spotlight models.
    try { this.spawn(); await this.request({ type: 'remove', id: ++this.sequence, modelIds: [...new Set([...MODEL_IDS, ...LEGACY_MODEL_IDS])] }, this.dependencies.timeouts?.remove ?? 30000); }
    catch { this.fail('The download could not be removed. Close other LopeOS tabs and try again.'); }
  }
}
