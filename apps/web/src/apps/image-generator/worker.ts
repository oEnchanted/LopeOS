/// <reference lib="webworker" />
import { GENERATOR_CACHE, generatorKey } from './catalog';
import { ClipTokenizer } from './tokenizer';

// Minimal surface of onnxruntime-web used here; the runtime is loaded from the user's cached download.
type Tensor = { data: ArrayLike<number | bigint>; dims: readonly number[]; type: string; dispose(): void };
type Session = { inputNames: readonly string[]; outputNames: readonly string[]; inputMetadata?: readonly { name: string; type?: string }[]; run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> };
type Runtime = { env: { wasm: { numThreads: number; wasmPaths: unknown; proxy: boolean } }; Tensor: new (type: string, data: unknown, dims: number[]) => Tensor; InferenceSession: { create(model: Uint8Array, options: object): Promise<Session> } };

const SIZE = 512, LATENT = SIZE / 8, VAE_SCALE = 0.18215;
let runtime: Runtime | undefined, tokenizer: ClipTokenizer | undefined;
const sessions: Partial<Record<'text_encoder' | 'unet' | 'vae_decoder', Session>> = {};
const post = (message: object) => self.postMessage(message);

async function cached(id: string) {
  const response = await (await caches.open(GENERATOR_CACHE)).match(generatorKey(id));
  if (!response) throw new Error('Download the image generator model before generating.');
  return response;
}
async function initialize() {
  if (runtime && tokenizer && sessions.vae_decoder) return;
  if (!('gpu' in navigator)) throw new Error('Image generation needs WebGPU. Use a current Chrome, Edge, or Safari with hardware acceleration on.');
  post({ status: 'Starting the WebGPU engine…' });
  runtime = await import(/* @vite-ignore */ URL.createObjectURL(await (await cached('runtime')).blob())) as Runtime;
  runtime.env.wasm.numThreads = 1; runtime.env.wasm.proxy = false;
  runtime.env.wasm.wasmPaths = { wasm: URL.createObjectURL(await (await cached('wasm')).blob()) };
  tokenizer = new ClipTokenizer(await (await cached('vocab')).json(), await (await cached('merges')).text());
  const options = {
    executionProviders: ['webgpu'], enableMemPattern: false, enableCpuMemArena: false, graphOptimizationLevel: 'all',
    freeDimensionOverrides: { batch_size: 1, num_channels: 4, height: LATENT, width: LATENT, sequence_length: 77 },
    extra: { session: { disable_prepacking: '1', use_device_allocator_for_initializers: '1', use_ort_model_bytes_directly: '1', use_ort_model_bytes_for_initializers: '1' } },
  };
  for (const [id, label] of [['text_encoder', 'text encoder'], ['unet', 'image model'], ['vae_decoder', 'image decoder']] as const) {
    if (sessions[id]) continue;
    post({ status: `Loading the ${label} onto your GPU…` });
    sessions[id] = await runtime.InferenceSession.create(new Uint8Array(await (await cached(id)).arrayBuffer()), options);
  }
}

// float16 helpers: ORT accepts Uint16Array for float16 tensors.
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(value: number) {
  f32[0] = value; const x = u32[0], sign = (x >>> 16) & 0x8000, exp = ((x >>> 23) & 0xff) - 112, mant = x & 0x7fffff;
  if (exp <= 0) return exp < -10 ? sign : sign | ((mant | 0x800000) >> (1 - exp + 13));
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >> 13);
}
function fromHalf(h: number) {
  const sign = h & 0x8000 ? -1 : 1, exp = (h >> 10) & 0x1f, mant = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (mant / 1024);
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + mant / 1024);
}
const inputType = (session: Session, name: string, fallback: string) => session.inputMetadata?.find(m => m.name === name)?.type ?? fallback;
function floatTensor(type: string, data: Float32Array, dims: number[]) {
  return type === 'float16' ? new runtime!.Tensor('float16', Uint16Array.from(data, toHalf), dims) : new runtime!.Tensor('float32', data, dims);
}
function floats(tensor: Tensor) {
  if (tensor.data instanceof Float32Array) return tensor.data.slice();
  if (tensor.type === 'float16') return Float32Array.from(new Uint16Array((tensor.data as Uint16Array).buffer, (tensor.data as Uint16Array).byteOffset, tensor.data.length), fromHalf);
  return Float32Array.from(tensor.data as ArrayLike<number>);
}

/** Euler discrete scheduler, scaled-linear betas, trailing spacing (SD-Turbo). */
function sigmas(steps: number) {
  const start = Math.sqrt(0.00085), end = Math.sqrt(0.012), cumulative: number[] = []; let product = 1;
  for (let i = 0; i < 1000; i++) { const beta = (start + (end - start) * i / 999) ** 2; product *= 1 - beta; cumulative.push(product); }
  const timesteps = Array.from({ length: steps }, (_, i) => Math.round(1000 - i * 1000 / steps) - 1);
  return { timesteps, sigmas: [...timesteps.map(t => Math.sqrt((1 - cumulative[t]) / cumulative[t])), 0] };
}
function noise(seed: number, length: number) {
  let state = seed >>> 0 || 1; const random = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 2) { const r = Math.sqrt(-2 * Math.log(random() || 1e-12)), a = 2 * Math.PI * random(); out[i] = r * Math.cos(a); if (i + 1 < length) out[i + 1] = r * Math.sin(a); }
  return out;
}

async function generate(prompt: string, steps: number, seed: number) {
  await initialize();
  const started = performance.now(), { text_encoder: text, unet, vae_decoder: vae } = sessions as Required<typeof sessions>;
  post({ status: 'Reading your prompt…' });
  const ids = tokenizer!.encode(prompt), idsType = inputType(text, text.inputNames[0], 'int32');
  const idTensor = idsType === 'int64' ? new runtime!.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, 77]) : new runtime!.Tensor('int32', Int32Array.from(ids), [1, 77]);
  const encoded = await text.run({ [text.inputNames[0]]: idTensor }); idTensor.dispose();
  const hidden = encoded.last_hidden_state ?? encoded[text.outputNames[0]];
  const schedule = sigmas(steps), dims = [1, 4, LATENT, LATENT];
  let latents = noise(seed, 4 * LATENT * LATENT).map(v => v * schedule.sigmas[0]);
  for (let step = 0; step < steps; step++) {
    post({ status: steps > 1 ? `Generating — step ${step + 1} of ${steps}…` : 'Generating…' });
    const sigma = schedule.sigmas[step], scale = 1 / Math.sqrt(sigma * sigma + 1), tType = inputType(unet, 'timestep', 'int64'), t = schedule.timesteps[step];
    const sample = floatTensor(inputType(unet, 'sample', 'float32'), latents.map(v => v * scale), dims);
    const timestep = tType === 'int64' ? new runtime!.Tensor('int64', BigInt64Array.of(BigInt(t)), [1]) : floatTensor(tType, Float32Array.of(t), [1]);
    const result = await unet.run({ sample, timestep, encoder_hidden_states: hidden });
    const eps = floats(result.out_sample ?? result[unet.outputNames[0]]); sample.dispose(); timestep.dispose(); Object.values(result).forEach(r => r.dispose());
    const delta = schedule.sigmas[step + 1] - sigma;
    latents = latents.map((v, i) => v + eps[i] * delta);
  }
  Object.values(encoded).forEach(r => r.dispose());
  post({ status: 'Decoding the image…' });
  const latentInput = floatTensor(inputType(vae, vae.inputNames[0], 'float32'), latents.map(v => v / VAE_SCALE), dims);
  const decoded = await vae.run({ [vae.inputNames[0]]: latentInput }); latentInput.dispose();
  const pixels = floats(decoded.sample ?? decoded[vae.outputNames[0]]); Object.values(decoded).forEach(r => r.dispose());
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4), plane = SIZE * SIZE;
  for (let i = 0; i < plane; i++) { for (let c = 0; c < 3; c++) rgba[i * 4 + c] = (pixels[c * plane + i] / 2 + 0.5) * 255; rgba[i * 4 + 3] = 255; }
  const canvas = new OffscreenCanvas(SIZE, SIZE); canvas.getContext('2d')!.putImageData(new ImageData(rgba, SIZE, SIZE), 0, 0);
  return { blob: await canvas.convertToBlob({ type: 'image/png' }), durationMs: performance.now() - started };
}

let queue = Promise.resolve();
self.onmessage = ({ data }) => { queue = queue.then(async () => {
  try { post({ id: data.id, result: await generate(String(data.prompt), Math.min(4, Math.max(1, data.steps | 0)), data.seed >>> 0) }); }
  catch (error) { post({ id: data.id, error: error instanceof Error ? error.message : 'Image generation failed.' }); }
}); };
