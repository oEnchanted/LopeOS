/** Pinned, optional download. Prompts and images never leave this browser. */
const MODEL = 'https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/ace89b7d2cd849f9a73914cdbb8a3ea60c853dd1';
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist';
export const GENERATOR_CACHE = 'lope-image-generator-sdturbo-v1';
export const GENERATOR_MODEL = {
  name: 'SD-Turbo (ONNX, fp16)', runtime: 'ONNX Runtime Web 1.31.1 · WebGPU',
  license: 'Stability AI Non-Commercial Research Community License', licenseURL: 'https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md',
};
export type GeneratorAsset = { id: string; file: string; url: string; bytes: number; sha256: string };
export const GENERATOR_ASSETS: GeneratorAsset[] = [
  { id: 'runtime', file: 'ort.webgpu.bundle.min.mjs', url: `${ORT}/ort.webgpu.bundle.min.mjs`, bytes: 122491, sha256: 'c90275ffcd0e74e8929f527840ce9339399bfd45f11a74887e4b81a893907b70' },
  { id: 'wasm', file: 'ort-wasm-simd-threaded.jsep.wasm', url: `${ORT}/ort-wasm-simd-threaded.jsep.wasm`, bytes: 29520971, sha256: '5ab8361783822d02a57d1e97cf2514bceb451a628f2b29ae0d7b6e618201ff8f' },
  { id: 'vocab', file: 'vocab.json', url: `${MODEL}/tokenizer/vocab.json`, bytes: 1059962, sha256: 'e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349' },
  { id: 'merges', file: 'merges.txt', url: `${MODEL}/tokenizer/merges.txt`, bytes: 524619, sha256: '9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a' },
  { id: 'text_encoder', file: 'text_encoder.onnx', url: `${MODEL}/text_encoder/model.onnx`, bytes: 681393168, sha256: '5d1f5bd3286abf26313a9e87db6fd32e47d8b1b2a84ffdf470884c3fe89497c4' },
  { id: 'unet', file: 'unet.onnx', url: `${MODEL}/unet/model.onnx`, bytes: 1733430199, sha256: '7468133d9f7babec9cf6636e160188fe25aad206792c0abdaa722edc676963c4' },
  { id: 'vae_decoder', file: 'vae_decoder.onnx', url: `${MODEL}/vae_decoder/model.onnx`, bytes: 99094314, sha256: 'b37a85f91a982811957abd6cfb617499742309f7b8e253240da3132e533a7605' },
];
export const GENERATOR_BYTES = GENERATOR_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
export const generatorKey = (id: string) => new URL(`/__lope_image_generator__/${id}`, globalThis.location?.origin || 'http://localhost').href;
/** Small files are hashed in memory; multi-hundred-MB graphs are streamed to storage and checked by exact size from a pinned revision. */
const HASH_LIMIT = 64 * 1024 * 1024;
const hex = (data: ArrayBuffer) => [...new Uint8Array(data)].map(v => v.toString(16).padStart(2, '0')).join('');

export async function generatorInstalled() {
  if (!globalThis.caches) return false;
  const cache = await caches.open(GENERATOR_CACHE);
  const entries = await Promise.all(GENERATOR_ASSETS.map(asset => cache.match(generatorKey(asset.id))));
  return entries.every((entry, i) => entry?.headers.get('x-lope-sha256') === GENERATOR_ASSETS[i].sha256);
}
export async function removeGenerator() { await caches.delete(GENERATOR_CACHE); }

export type InstallProgress = { loaded: number; total: number; file: string };
export async function installGenerator(signal: AbortSignal, onProgress: (value: InstallProgress) => void) {
  if (!globalThis.caches || !crypto.subtle) throw new Error('The image generator needs HTTPS or localhost and browser storage.');
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota !== undefined && estimate.quota - (estimate.usage ?? 0) < GENERATOR_BYTES) throw new Error('Not enough browser storage. Free about 2.6 GB of site storage, then try again.');
  await navigator.storage?.persist?.().catch(() => false);
  const cache = await caches.open(GENERATOR_CACHE);
  let loaded = 0;
  for (const asset of GENERATOR_ASSETS) {
    signal.throwIfAborted();
    const key = generatorKey(asset.id);
    if ((await cache.match(key))?.headers.get('x-lope-sha256') === asset.sha256) { loaded += asset.bytes; onProgress({ loaded, total: GENERATOR_BYTES, file: asset.file }); continue; }
    const response = await fetch(asset.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${asset.file}`);
    let received = 0;
    const counted = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > asset.bytes) throw new Error(`Unexpected download size for ${asset.file}.`);
      onProgress({ loaded: loaded + received, total: GENERATOR_BYTES, file: asset.file }); controller.enqueue(chunk);
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
