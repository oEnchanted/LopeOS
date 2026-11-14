/** Pinned, optional download. Prompts and images never leave this browser. */
const MODEL = 'https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/ace89b7d2cd849f9a73914cdbb8a3ea60c853dd1';
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist';
export const GENERATOR_CACHE = 'lope-image-generator-sdturbo-v1';
export const GENERATOR_MODEL = {
  name: 'SD-Turbo (ONNX, fp16)', runtime: 'ONNX Runtime Web 1.31.1 · WebGPU',
  license: 'Stability AI Non-Commercial Research Community License', licenseURL: 'https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md',
};
export type GeneratorAsset = { id: string; label: string; file: string; url: string; bytes: number; sha256: string };
export const GENERATOR_ASSETS: GeneratorAsset[] = [
  { id: 'runtime', label: 'Graphics engine', file: 'ort.webgpu.bundle.min.mjs', url: `${ORT}/ort.webgpu.bundle.min.mjs`, bytes: 122491, sha256: 'c90275ffcd0e74e8929f527840ce9339399bfd45f11a74887e4b81a893907b70' },
  // The WebGPU bundle runs the native WebGPU execution provider, which is built into the asyncify binary (not the older JSEP one).
  { id: 'wasm', label: 'Graphics engine', file: 'ort-wasm-simd-threaded.asyncify.wasm', url: `${ORT}/ort-wasm-simd-threaded.asyncify.wasm`, bytes: 28747738, sha256: 'ca319e9539cd0f1e291cf56074760121eaf39650f5dbf84b6e52c07f4b2944ec' },
  { id: 'vocab', label: 'Prompt vocabulary', file: 'vocab.json', url: `${MODEL}/tokenizer/vocab.json`, bytes: 1059962, sha256: 'e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349' },
  { id: 'merges', label: 'Prompt vocabulary', file: 'merges.txt', url: `${MODEL}/tokenizer/merges.txt`, bytes: 524619, sha256: '9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a' },
  { id: 'text_encoder', label: 'Text encoder', file: 'text_encoder.onnx', url: `${MODEL}/text_encoder/model.onnx`, bytes: 681393168, sha256: '5d1f5bd3286abf26313a9e87db6fd32e47d8b1b2a84ffdf470884c3fe89497c4' },
  { id: 'unet', label: 'Image model', file: 'unet.onnx', url: `${MODEL}/unet/model.onnx`, bytes: 1733430199, sha256: '7468133d9f7babec9cf6636e160188fe25aad206792c0abdaa722edc676963c4' },
  { id: 'vae_decoder', label: 'Image decoder', file: 'vae_decoder.onnx', url: `${MODEL}/vae_decoder/model.onnx`, bytes: 99094314, sha256: 'b37a85f91a982811957abd6cfb617499742309f7b8e253240da3132e533a7605' },
];
export const GENERATOR_BYTES = GENERATOR_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
export const generatorKey = (id: string) => new URL(`/__lope_image_generator__/${id}`, globalThis.location?.origin || 'http://localhost').href;
/** Small files are hashed in memory; multi-hundred-MB graphs are streamed to storage and checked by exact size from a pinned revision. */
const HASH_LIMIT = 64 * 1024 * 1024;
const hex = (data: ArrayBuffer) => [...new Uint8Array(data)].map(v => v.toString(16).padStart(2, '0')).join('');

/** Which pinned files are saved and verified; an engine update only needs the changed files. */
export async function inspectGenerator() {
  if (!globalThis.caches) return { installed: false, partial: false, missingBytes: GENERATOR_BYTES };
  const cache = await caches.open(GENERATOR_CACHE);
  const entries = await Promise.all(GENERATOR_ASSETS.map(asset => cache.match(generatorKey(asset.id))));
  const missing = GENERATOR_ASSETS.filter((asset, i) => entries[i]?.headers.get('x-lope-sha256') !== asset.sha256);
  const missingBytes = missing.reduce((sum, asset) => sum + asset.bytes, 0);
  return { installed: missing.length === 0, partial: missing.length > 0 && missing.length < GENERATOR_ASSETS.length, missingBytes };
}
export async function generatorInstalled() { return (await inspectGenerator()).installed; }
export async function removeGenerator() { await caches.delete(GENERATOR_CACHE); }

export type InstallProgress = { loaded: number; total: number; file: string; label: string; network: number };
export async function installGenerator(signal: AbortSignal, onProgress: (value: InstallProgress) => void) {
  if (!globalThis.caches || !crypto.subtle) throw new Error('The image generator needs HTTPS or localhost and browser storage.');
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  const { missingBytes } = await inspectGenerator();
  if (estimate?.quota !== undefined && estimate.quota - (estimate.usage ?? 0) < missingBytes) throw new Error(`Not enough browser storage. Free about ${(missingBytes / 1e9).toFixed(1)} GB of site storage, then try again.`);
  await navigator.storage?.persist?.().catch(() => false);
  const cache = await caches.open(GENERATOR_CACHE);
  let loaded = 0, network = 0;
  for (const asset of GENERATOR_ASSETS) {
    signal.throwIfAborted();
    const key = generatorKey(asset.id);
    if ((await cache.match(key))?.headers.get('x-lope-sha256') === asset.sha256) { loaded += asset.bytes; onProgress({ loaded, total: GENERATOR_BYTES, file: asset.file, label: asset.label, network }); continue; }
    const response = await fetch(asset.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${asset.file}`);
    let received = 0;
    const counted = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
      received += chunk.byteLength; network += chunk.byteLength;
      if (received > asset.bytes) throw new Error(`Unexpected download size for ${asset.file}.`);
      onProgress({ loaded: loaded + received, total: GENERATOR_BYTES, file: asset.file, label: asset.label, network }); controller.enqueue(chunk);
    } }));
    const headers = { 'Content-Type': asset.id === 'wasm' ? 'application/wasm' : asset.id === 'runtime' ? 'text/javascript' : 'application/octet-stream', 'x-lope-sha256': asset.sha256 };
    if (asset.bytes <= HASH_LIMIT) {
      const data = await new Response(counted).arrayBuffer();
      if (data.byteLength !== asset.bytes || hex(await crypto.subtle.digest('SHA-256', data)) !== asset.sha256) throw new Error(`Integrity check failed for ${asset.file}. The file was not installed.`);
      await cache.put(key, new Response(data, { headers }));
    } else {
      await cache.put(key, new Response(counted, { headers }));
      if (received !== asset.bytes) { await cache.delete(key); throw new Error(`Incomplete download: ${asset.file}. Try again.`); }
    }
    signal.throwIfAborted();
    loaded += asset.bytes;
  }
}
