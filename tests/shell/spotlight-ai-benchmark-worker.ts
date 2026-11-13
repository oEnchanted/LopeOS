import { MLCEngine } from '@mlc-ai/web-llm';
let engine: MLCEngine | null = null;
self.onmessage = async (event: MessageEvent) => {
  const request = event.data;
  const post = (data: object) => self.postMessage({ id: request.id, ...data });
  try {
    if (request.type === 'load') {
      engine = new MLCEngine({ logLevel: 'ERROR', initProgressCallback: progress => post({ type: 'progress', progress: progress.progress, text: progress.text }) });
      await engine.reload(request.modelId, { context_window_size: 4096 });
      post({ type: 'ready' }); return;
    }
    if (!engine) throw new Error('Model not initialized.');
    await engine.resetChat();
    const stream = await engine.chat.completions.create({ messages: request.messages, stream: true, max_tokens: 256, temperature: 0.3, top_p: 0.9, seed: 11, extra_body: { enable_thinking: false, resumable: { enabled: false } } });
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta.content;
      if (text) post({ type: 'delta', text });
    }
    post({ type: 'done' });
  } catch (error) { post({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
