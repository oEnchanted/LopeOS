export class ImageWorker {
  private worker?: Worker;
  private sequence = 0;
  private waiting = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>();
  private start() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../../../../../packages/image-engine/src/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = event => { const pending = this.waiting.get(event.data.id); this.waiting.delete(event.data.id); if (event.data.error) pending?.reject(new Error(event.data.error)); else pending?.resolve(event.data.result); };
    this.worker.onerror = event => { this.cancel(event.message || 'The image worker stopped unexpectedly.'); };
    return this.worker;
  }
  run<T>(action: string, payload: unknown,transfer:Transferable[]=[]): Promise<T> {
    return new Promise((resolve, reject) => { const id = ++this.sequence; this.waiting.set(id, { resolve, reject }); try { this.start().postMessage({ id, action, payload },transfer); } catch (error) { this.waiting.delete(id); reject(error); } });
  }
  cancel(message = 'Operation cancelled.') { this.worker?.terminate(); this.worker = undefined; this.waiting.forEach(item => item.reject(new Error(message))); this.waiting.clear(); }
  dispose() { this.cancel('The document was closed.'); }
}
