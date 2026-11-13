export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type AIWorkerRequest =
  | { type: 'load'; id: number; modelId: string; cleanupModelIds: string[] }
  | { type: 'generate'; id: number; messages: ModelMessage[] }
  | { type: 'stop'; id: number }
  | { type: 'reset'; id: number }
  | { type: 'remove'; id: number; modelIds: string[] };
export type AIWorkerReply =
  | { type: 'progress'; id: number; progress: number; text: string }
  | { type: 'ready'; id: number }
  | { type: 'delta'; id: number; text: string }
  | { type: 'done'; id: number; stopped: boolean }
  | { type: 'reset'; id: number }
  | { type: 'removed'; id: number }
  | { type: 'error'; id: number; message: string };
