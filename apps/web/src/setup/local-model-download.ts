/** Download-only adapter for WebLLM's default Cache API backend.
 * Cache keys/scopes mirror the installed @mlc-ai/web-llm runtime; chat consumes
 * these same responses, including config, tokenizer, runtime and weight shards.
 */
export interface SpotlightModelRecord { model: string; model_id: string; model_lib: string; model_manifest?: string }
export interface ByteProgress { received: number; transferred: number; total: number | null; file: string; verifying?: boolean }
export interface ModelDownloadEnvironment {
  fetch: typeof fetch;
  caches: Pick<CacheStorage, 'open'>;
}
const scopes = { config: 'webllm/config', model: 'webllm/model', wasm: 'webllm/wasm' } as const;
type Scope = keyof typeof scopes;
interface Shard { dataPath: string; nbytes: number }
const decodedSizeHeader = 'x-lope-decoded-bytes';

export function spotlightModelBase(record: SpotlightModelRecord): string {
  let base = record.model.endsWith('/') ? record.model : record.model + '/';
  if (!/.+\/resolve\/.+\//.test(base)) base += 'resolve/main/';
  return new URL(base).href;
}
function modelResource(base: string, path: string): string {
  const result = new URL(path, base);
  if (result.origin !== new URL(base).origin || !result.href.startsWith(base)) throw new Error('The model manifest contains an unsupported file location.');
  return result.href;
}
export function spotlightShards(value: unknown): Shard[] {
  const records = value && typeof value === 'object' ? (value as { records?: unknown }).records : undefined;
  if (!Array.isArray(records) || !records.length || records.length > 1000) throw new Error('The model download manifest is invalid.');
  const files = records.map(record => {
    if (!record || typeof record.dataPath !== 'string' || !record.dataPath || !Number.isSafeInteger(record.nbytes) || record.nbytes <= 0) throw new Error('The model download manifest is invalid.');
    return { dataPath: record.dataPath, nbytes: record.nbytes };
  });
  if (new Set(files.map(file => file.dataPath)).size !== files.length) throw new Error('The model download manifest contains duplicate files.');
  return files;
}
function tokenizerFile(value: unknown): string {
  const files = value && typeof value === 'object' ? (value as { tokenizer_files?: unknown }).tokenizer_files : undefined;
  if (!Array.isArray(files)) throw new Error('The model tokenizer configuration is invalid.');
  if (files.includes('tokenizer.json')) return 'tokenizer.json';
  if (files.includes('tokenizer.model')) return 'tokenizer.model';
  throw new Error('The model tokenizer is not supported by the local assistant.');
}
function knownSize(response: Response): number | null {
  const decoded = Number(response.headers.get(decodedSizeHeader));
  if (decoded > 0 && Number.isSafeInteger(decoded)) return decoded;
  if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') return null;
  const length = Number(response.headers.get('content-length'));
  return length > 0 && Number.isSafeInteger(length) ? length : null;
}
async function cachedBodySize(response: Response): Promise<number> {
  const known = knownSize(response); if (known !== null) return known;
  if (!response.body) return 0;
  const reader = response.body.getReader(); let bytes = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) return bytes; bytes += chunk.value.byteLength; } }
  finally { reader.releaseLock(); }
}
export async function cachedSpotlightModel(record: SpotlightModelRecord, storage: Pick<CacheStorage, 'open'>): Promise<{ installed: boolean; sizeBytes: number | null }> {
  if (record.model_manifest) throw new Error('This assistant package uses a new manifest format. Update its setup downloader before installing.');
  const base = spotlightModelBase(record);
  const [configCache, modelCache, wasmCache] = await Promise.all([storage.open(scopes.config), storage.open(scopes.model), storage.open(scopes.wasm)]);
  const [config, manifest, runtime] = await Promise.all([configCache.match(new URL('mlc-chat-config.json', base).href), modelCache.match(new URL('tensor-cache.json', base).href), wasmCache.match(record.model_lib)]);
  if (!config || !manifest || !runtime) return { installed: false, sizeBytes: null };
  try {
    const configBytes = await config.arrayBuffer(), manifestBytes = await manifest.arrayBuffer();
    const tokenizer = await modelCache.match(modelResource(base, tokenizerFile(JSON.parse(new TextDecoder().decode(configBytes)))));
    if (!tokenizer) return { installed: false, sizeBytes: null };
    const shards = spotlightShards(JSON.parse(new TextDecoder().decode(manifestBytes)));
    for (const shard of shards) {
      const response = await modelCache.match(modelResource(base, shard.dataPath));
      if (!response || await cachedBodySize(response) !== shard.nbytes) return { installed: false, sizeBytes: null };
    }
    const runtimeSize = await cachedBodySize(runtime), tokenizerSize = await cachedBodySize(tokenizer);
    if (!runtimeSize || !tokenizerSize) return { installed: false, sizeBytes: null };
    return { installed: true, sizeBytes: configBytes.byteLength + manifestBytes.byteLength + runtimeSize + tokenizerSize + shards.reduce((sum, shard) => sum + shard.nbytes, 0) };
  } catch { return { installed: false, sizeBytes: null }; }
}

export async function downloadSpotlightModel(record: SpotlightModelRecord, signal: AbortSignal, progress: (value: ByteProgress) => void, environment: ModelDownloadEnvironment = { fetch: globalThis.fetch.bind(globalThis), caches: globalThis.caches }): Promise<number> {
  if (record.model_manifest) throw new Error('This assistant package uses a new manifest format. Update its setup downloader before installing.');
  if (!environment.caches) throw new Error('Local model storage requires HTTPS or localhost and browser storage access.');
  const base = spotlightModelBase(record);
  let received = 0, transferred = 0, total: number | null = null;
  const report = (file: string, verifying = false) => progress({ received, transferred, total, file, verifying });
  async function asset(scope: Scope, url: string, file: string, expected?: number): Promise<Response> {
    signal.throwIfAborted();
    const cache = await environment.caches.open(scopes[scope]);
    let cached = await cache.match(url);
    const cachedSize = cached ? await cachedBodySize(cached.clone()) : 0;
    if (cached && (!cachedSize || expected !== undefined && cachedSize !== expected)) { await cache.delete(url); cached = undefined; }
    if (cached) {
      received += cachedSize; report(file); return cached;
    }
    report(file);
    const response = await environment.fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body) throw new Error(`Could not download ${file} (${response.status}). Check your connection and try again.`);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (expected !== undefined && size > expected) throw new Error(`The downloaded ${file} has an unexpected size. Try again.`);
        chunks.push(part.value); received += part.value.byteLength; transferred += part.value.byteLength; report(file);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (expected !== undefined && size !== expected) throw new Error(`The downloaded ${file} is incomplete. Try again.`);
    if (!size) throw new Error(`The downloaded ${file} is empty. Try again.`);
    signal.throwIfAborted(); report(file, true);
    // Preserve the complete response only after all of its bytes have arrived.
    const headers = new Headers(response.headers);
    headers.delete('content-encoding'); headers.delete('content-length'); headers.delete('vary');
    headers.set(decodedSizeHeader, String(size)); headers.set('content-length', String(size));
    const stored = new Response(new Blob(chunks as BlobPart[]), { status: 200, headers });
    await cache.put(url, stored);
    signal.throwIfAborted();
    const result = await cache.match(url);
    if (!result) throw new Error('The browser could not save the model download. Check available storage and try again.');
    return result;
  }
  const config = await asset('config', new URL('mlc-chat-config.json', base).href, 'Assistant configuration');
  const manifest = await asset('model', new URL('tensor-cache.json', base).href, 'Model manifest');
  let shards: Shard[], tokenizer: string;
  try { shards = spotlightShards(await manifest.json()); tokenizer = tokenizerFile(await config.json()); }
  catch (cause) {
    await Promise.all([(await environment.caches.open(scopes.config)).delete(new URL('mlc-chat-config.json', base).href), (await environment.caches.open(scopes.model)).delete(new URL('tensor-cache.json', base).href)]);
    throw new Error(cause instanceof Error ? cause.message : 'The model download manifest could not be read.');
  }
  // Read all auxiliary bytes first. Once these are known, shard sizes give an exact total.
  await asset('model', modelResource(base, tokenizer), 'Assistant tokenizer');
  await asset('wasm', record.model_lib, 'Assistant engine');
  total = received + shards.reduce((sum, shard) => sum + shard.nbytes, 0);
  report('Model weights');
  for (let index = 0; index < shards.length; index++) {
    const shard = shards[index];
    await asset('model', modelResource(base, shard.dataPath), `Model weights ${index + 1} of ${shards.length}`, shard.nbytes);
  }
  report('Checking saved model', true);
  const saved = await cachedSpotlightModel(record, environment.caches);
  signal.throwIfAborted();
  if (!saved.installed) throw new Error('The downloaded model could not be verified in browser storage. Try again.');
  return total;
}
