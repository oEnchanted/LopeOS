LopeOS Lightroom optional local AI denoise model

FFDNet Color (clipped), by Kai Zhang and contributors.
MIT license: see LICENSE-FFDNet.txt in this directory.

The ONNX file contains unchanged official learned weights converted to a
self-contained inference graph. It does not include Adobe models or code.

Model: ffdnet-color-v1.onnx
Size: 3,412,037 bytes
SHA-256: 28c8ca2616c3283792a6db51ae26830ec44d1c8b5b823614c25788f785140f24

Optional complete download: 18,362,651 bytes (17.5 MiB), including the model
and ONNX Runtime Web 1.31.1 CPU WASM engine by Microsoft and contributors.
Runtime MIT license: engine/LICENSE-ONNX-Runtime.txt
https://github.com/microsoft/onnxruntime/tree/v1.31.1

The application downloads these assets only when requested, verifies their
SHA-256 checksums and caches them locally. Installed tools work offline.
No API key, external AI service, Python install or GPU is required.

Model input image: Float32 RGB NCHW [1,3,160,160], sRGB values in [0,1].
Noise input sigma: Float32 [1,1,1,1], noise standard deviation /255.
Output denoised: Float32 [1,3,160,160], direct clean RGB (not residual).

This is a post-development SDR color denoiser. Camera RAW sensor denoising,
Adobe pixel-equivalent results, and HDR/wide-gamut inference are not claimed.

Source and attribution:
https://github.com/cszn/KAIR/tree/fc1732f4a4514e42ce15e5b3a1e18c828af47a1e
https://github.com/cszn/KAIR/releases/download/v1.0/ffdnet_color_clip.pth

Rebuild instructions and checksum verification are in
scripts/export-denoise-model.py and docs/lightroom/denoise-model-manifest.json
in the LopeOS source checkout. The exporter uses NumPy and ONNX 1.17.0 and
does not require PyTorch. No source image is part of this model download.
