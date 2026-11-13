type ModelCacheRecord = { model: string; model_lib: string };
type CacheAccess = { keys(): Promise<readonly Request[]>; delete(request: Request): Promise<boolean> };
type CacheStorageAccess = { keys(): Promise<string[]>; open(name: string): Promise<CacheAccess> };

/** WebLLM 0.2.88 uses these CacheStorage scopes by default. Remove only known model artifacts.
 * Its public deletion helper fetches missing manifests, so it cannot remove partial downloads offline.
 */
export async function deleteCachedModels(records: readonly ModelCacheRecord[], storage: CacheStorageAccess = caches) {
  const modelPrefixes = records.map(record => `${record.model.replace(/\/+$/, '')}/`);
  const libraries = new Set(records.map(record => new URL(record.model_lib).href));
  for (const name of await storage.keys()) {
    if (name !== 'webllm/model' && name !== 'webllm/config' && name !== 'webllm/wasm') continue;
    const cache = await storage.open(name);
    for (const request of await cache.keys()) {
      const matches = name === 'webllm/wasm'
        ? libraries.has(request.url)
        : modelPrefixes.some(prefix => request.url.startsWith(prefix));
      if (matches) await cache.delete(request);
    }
  }
}
