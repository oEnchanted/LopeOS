# Noise reduction in Lightroom

Lightroom has two local noise-reduction engines under **Edit → Detail**. Image Editor is a separate app and its implementation is unchanged by this feature.

## Standard noise reduction

**Noise reduction → Luminance noise / Color noise** is available immediately, without a model download, GPU, external account or network connection. These controls run the original Lope bilateral filter in `packages/photo-engine/src/noise.ts`. A 5×5 spatial neighborhood and luminance/chroma range weights reduce noise while limiting smoothing across edges. Luminance and chroma have independent strengths. Zero settings bypass filtering exactly, source alpha remains unchanged, transparent samples do not contaminate opaque neighbors, and Float32 headroom is retained.

The normal development worker updates the preview as controls change. The same filter runs before geometry/tone edits in full-resolution exports. The recipe stores the settings, supports undo/reset, and leaves the source bytes untouched. As with other spatial photo controls, a downsampled main preview is not promised pixel-identical to a full-resolution export. Inspect at 100% when assessing fine detail.

## AI Denoise

1. Open a photo and choose **Edit → Detail → AI Denoise…**, or **Photo → AI Denoise…**.
2. On first use, choose **Download AI tools**. The total is **18,362,651 bytes (17.5 MiB)**: a **3,412,037-byte (3.25 MiB)** model plus the CPU WASM engine and loaders. No photo is uploaded.
3. A 100% before/after preview is generated automatically. Amount blends immediately, without another inference. Noise level and preview position changes refresh automatically after a short debounce; controls remain usable while a preview is running and the latest settings are processed next. The navigator and X/Y sliders choose source detail. **Refresh preview** can rerun the current settings; cancellation pauses automatic work until a relevant setting changes or preview is retried.
4. Choose **Create denoised copy**. Lightroom processes the full source resolution and saves a separate **16-bit TIFF**. The current recipe, ratings, labels, keywords and album membership carry over. The source photo and its edits remain unchanged.

Downloaded tools stay in browser storage for offline processing. The trash button beside **Local AI tools installed** removes them; saved TIFF copies remain editable and exportable. Download/inference cancellation creates no partial photo. A failed library save keeps the finished result available through **Retry saving copy**, without running inference again. Clearing browser storage can remove the tools and local library; library backups remain separate from the model cache.

## Model and processing

The model is **FFDNet Color (clipped)** by Kai Zhang and contributors, under MIT. Its official learned weights are unchanged. Source commit, checkpoint hash, ONNX graph shape, conversion oracle and license are pinned in [the model manifest](denoise-model-manifest.json). Execution uses **ONNX Runtime Web 1.31.1**, CPU WASM, one thread. No API key, native engine, Python installation, GPU, CDN or remote AI provider is needed to use the feature.

The worker decodes the original before applying the edit recipe. For RAW, this means LibRaw sensor development followed by RGB denoising. Linear working pixels are converted to the model's sRGB domain. Each 160×160 tile uses a 32-pixel halo and 96×96 valid core on the same global even-pixel grid for preview and full processing. Amount blends clean/model and original pixels in linear precision. Output TIFF dimensions match the oriented source, so inherited crops, masks and retouch coordinates remain aligned. The saved asset records model/hash, runtime, decoder, parameters, source identity/hash, date and duration.

The optional package is fetched from the same LopeOS origin. Every size and SHA-256 is checked before an atomic IndexedDB installation. Binary buffers are stored for WebKit compatibility and reconstructed into typed Blobs. The worker verifies them again before importing Blob modules and loading weights. The [runtime manifest](../../public/models/denoise/engine/manifest.json) lists every served file and hash. Downloaded packages are independent of the photo library. Cancelling terminates the dedicated worker and releases its module/WASM URLs.

This is an **opaque SDR RGB denoiser** trained for clipped Gaussian noise. HDR/out-of-range working values and transparency are rejected explicitly. It does not denoise sensor mosaics directly, estimate camera-specific noise automatically, supply Adobe's RAW Denoise model, or preserve a wider-gamut/HDR inference domain. Noise level is a manual standard deviation from 1–75 on the 0–255 scale; excessive values can soften detail. Real-camera scene quality needs further testing. Large full-resolution photos can take time on CPU; model tiling bounds inference tensor memory, while decoding and TIFF encoding still need full image buffers.

## Reproducing assets and checks

The checked-in public assets make builds independent of model downloads. To regenerate the ONNX model, obtain the pinned official checkpoint from the manifest, use an isolated build environment with NumPy and `onnx==1.17.0`, then run:

```sh
python3 scripts/export-denoise-model.py --checkpoint /path/to/ffdnet_color_clip.pth
npm run prepare:photo-ai
```

The exporter verifies the checkpoint hash before parsing a restricted allowlist of tensor/storage records. It does not run downloaded Python or require PyTorch. It checks the graph, compares an equivalent small graph against independent NumPy convolution/unshuffle/shuffle, and produces deterministic ONNX bytes. The asset-preparation script requires the pinned runtime version and model hash. MIT notices are retained in `public/models/denoise` and its `engine` directory.

Verification commands:

```sh
npm run test:photos
npm run build
# With a server running:
npm run test:photos:denoise
# The complete UI check can also run against built assets:
LOPE_PHOTO_BASE=http://127.0.0.1:5183 node tests/lightroom/denoise-browser.mjs
LOPE_PHOTO_BROWSER=webkit node tests/lightroom/denoise-probe.mjs
# With a production preview on port 5183:
node tests/lightroom/production.mjs
python3 tests/lightroom/validate-exports.py
```

The pure tests cover normalized neural tensors, halos/global tile placement, amount/alpha, explicit limits, standard-filter noise measurements/edges, and shared rendering. [UI evidence](denoise-verification.json) covers automatic preview changes during inference, standard processing offline before any model download, cancellation, cache integrity, offline AI processing, transactional save failure/retry, source preservation, reload and tool removal. [Production evidence](production-verification.json) uses a sensor-only synthetic DNG with no embedded preview and verifies a TIFF16 copy/export through the built app. [Pillow/LittleCMS](independent-reader-verification.json) independently opens exports and verifies their profiles and bit depth.

The [Chromium quality probe](denoise-probe.json) and [WebKit engine probe](denoise-webkit-probe.json) use an original 192×144 clipped Gaussian-noise fixture at sigma 25. The measured PSNR gain is about **18.9 dB** on this simple synthetic gradient/edge scene. This establishes real learned inference and a controlled reduction in error, not a general photography benchmark. WebKit verification covers cache and model inference; the complete application workflow is tested in Chromium. Browser versions and exact results are in the reports.
