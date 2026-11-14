/** Messages between Image Generator and its GPU worker. */
export type EngineRequest = { type: 'load' } | { type: 'generate'; id: number; prompt: string; seed: number; steps: number };
export type EnginePhase = 'idle' | 'loading' | 'ready' | 'error';
export type EngineMessage =
  | { type: 'engine'; phase: Exclude<EnginePhase, 'idle'>; text: string; progress?: number; device?: string }
  | { type: 'progress'; id: number; text: string; progress: number }
  | { type: 'result'; id: number; result?: { blob: Blob; durationMs: number }; error?: string };
