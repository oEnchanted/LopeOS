import { mixBlock, type MixBlock } from './mix-math.ts';
const worker = self as unknown as { onmessage: ((event: MessageEvent<MixBlock>) => void) | null; postMessage(value: unknown, transfer?: Transferable[]): void };
worker.onmessage = event => { try { const channels = mixBlock(event.data); worker.postMessage({ channels }, channels.map(channel => channel.buffer)); } catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : 'Audio mixing failed.' }); } };
