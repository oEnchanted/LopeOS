import { estimateTranslation, type GrayFrame } from './stabilization-math.ts';
self.onmessage = (event: MessageEvent<{ previous: GrayFrame; current: GrayFrame }>) => {
  try { self.postMessage({ result: estimateTranslation(event.data.previous, event.data.current) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Motion estimation failed.' }); }
};
