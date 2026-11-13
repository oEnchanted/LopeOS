import type { MLCEngine } from '@mlc-ai/web-llm';
import type { AIWorkerReply, AIWorkerRequest } from './protocol';
import { deleteCachedModels } from './cache';
import { createResponseFilter } from './response';

const scope = globalThis as unknown as { postMessage(message: AIWorkerReply): void; onmessage: ((event: MessageEvent<AIWorkerRequest>) => void) | null };
let engine: MLCEngine | null = null;
let active: number | null = null;
let interrupted = false;
let loading = false;
const reply = (message: AIWorkerReply) => scope.postMessage(message);
function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const diagnostic = error instanceof Error ? `${error.name}: ${message}` : message;
  if (/quota|storage.*(?:full|space)|not enough.*(?:space|storage)/i.test(diagnostic)) return 'There is not enough browser storage for this model. Free some browser storage or choose Remove download, then try again.';
  if (/device.*lost|out of memory|out-of-memory|\boom\b/i.test(message)) return 'The graphics device could not keep the model in memory. Unload it, close other graphics-heavy tabs, and try again.';
  if (/fetch|network|cors|download|http.*(?:404|403|500|502)/i.test(message)) return 'The model could not be downloaded. Check your connection and try again; downloaded parts may be reused.';
  if (/webgpu|gpu adapter|shader-f16|no adapter/i.test(message)) return 'The model could not start on this graphics device. Check hardware acceleration or try another browser.';
  return `Local AI could not finish: ${message.slice(0, 400)}`;
}
async function handle(request: AIWorkerRequest) {
  if (request.type === 'stop') {
    if (active === request.id) { interrupted = true; try { await engine?.interruptGenerate(); } catch { /* Controller force-terminates an unresponsive worker. */ } }
    return;
  }
  try {
    if (request.type === 'load') {
      if (active !== null || loading) throw new Error('The model is already busy.');
      loading = true;
      const { MLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm');
      if (request.cleanupModelIds?.length) {
        reply({ type: 'progress', id: request.id, progress: 0, text: 'Removing the previous Spotlight model download…' });
        const obsolete = prebuiltAppConfig.model_list.filter(record => record.model_id !== request.modelId && request.cleanupModelIds.includes(record.model_id));
        await deleteCachedModels(obsolete);
      }
      engine = new MLCEngine({ logLevel: 'ERROR', initProgressCallback: progress => reply({ type: 'progress', id: request.id, progress: progress.progress, text: progress.text }) });
      await engine.reload(request.modelId, { context_window_size: 4096 });
      loading = false;
      reply({ type: 'ready', id: request.id }); return;
    }
    if (request.type === 'remove') {
      const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
      await deleteCachedModels(prebuiltAppConfig.model_list.filter(record => request.modelIds.includes(record.model_id)));
      reply({ type: 'removed', id: request.id }); return;
    }
    if (!engine) throw new Error('Load the local model first.');
    if (request.type === 'reset') {
      if (active !== null) throw new Error('Stop the current response first.');
      await engine.resetChat(); reply({ type: 'reset', id: request.id }); return;
    }
    if (request.type === 'generate') {
      if (active !== null || loading) throw new Error('Stop the current response first.');
      active = request.id; interrupted = false;
      try {
        const filter = createResponseFilter();
        const stream = await engine.chat.completions.create({ messages: request.messages, stream: true, max_tokens: 256, temperature: 0.3, top_p: 0.9, extra_body: { enable_thinking: false, resumable: { enabled: false } } });
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta.content;
          if (text && !interrupted) { const content = filter.push(text); if (content) reply({ type: 'delta', id: request.id, text: content }); }
        }
        const remaining = filter.finish();
        if (remaining && !interrupted) reply({ type: 'delta', id: request.id, text: remaining });
        reply({ type: 'done', id: request.id, stopped: interrupted });
      } finally { active = null; }
    }
  } catch (error) {
    loading = false;
    reply({ type: 'error', id: request.id, message: readableError(error) });
  }
}
scope.onmessage = event => { void handle(event.data); };
