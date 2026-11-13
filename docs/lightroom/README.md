# LopeOS Lightroom

Lightroom is the independent Lightroom-style photo library registered as `lope.lightroom`. Open **Lightroom** from the Dock, application search (which also matches “Lightroom”), or Files → File → Open With. It uses the existing LopeOS window frame, global commands, settings, file service, notifications, and session restoration. The photograph and its evaluation surround remain opaque neutral surfaces.

This is a working local photo application, **not completed Lightroom 10.0 equivalence**. The full acceptance backlog remains in [the feature matrix](feature-matrix.json); unimplemented capabilities are explicitly unavailable in the app. No Adobe icons, sample photos, profiles, or screenshot assets are bundled in the product. The photographic examples are [public-domain Jon Sullivan photos](../../public/photos/credits.json).

## Run and verify

From the repository root, with Node 24+ and the project's pinned pnpm:

```sh
npx pnpm@10.32.1 install
npm run dev
```

Open `http://127.0.0.1:5173`, then Lightroom. Add your own photos or choose **Explore with sample photos** and review the four bundled examples. Local photo processing needs no external account, API key or workspace container. LopeOS workspace reads/writes and the Image Editor round trip use the existing authenticated runtime; its setup is documented in `docs/runtime-contract.md` and `docs/runtime-isolation.md`.

```sh
npm run build
npm run test:photos
npm test
# With the local dev server running:
node tests/lightroom/browser.mjs
node tests/lightroom/codecs.mjs
node tests/lightroom/handoff.mjs
node tests/lightroom/denoise-probe.mjs
node tests/lightroom/denoise-browser.mjs
# With a production preview running on port 5183:
node tests/lightroom/production.mjs
# Optional independent readers, using an existing Pillow installation:
python3 tests/lightroom/validate-exports.py
```

Playwright Chromium is required for UI checks. Codec verification also attempts available Firefox and WebKit builds and distinguishes a launch failure from an engine failure. The tested Firefox executable could not initialize a profile on this host; Firefox is not marked verified. WebKit testing is not a claim that every released Safari build or display is supported.

On the November 13 check, the production build passed, all 24 photo-engine tests passed, and the full repository suite passed 108 tests with three environment-dependent Docker/gVisor checks skipped. Runtime HTTP/WebSocket checks require localhost networking; the sandbox-only attempt reported EPERM, and the permitted run passed. Lightroom AI/standard-denoise workflow, production RAW/export and independent-reader results are recorded below. Image Editor implementation files were not modified by this Lightroom task.

## Working workflows

- Device file/folder selection, drag-and-drop, and linked LopeOS workspace imports, with actual decoded previews, content hashes, duplicate review, album assignment, per-file failures and cancellation. Each imported asset and managed original commit in one IndexedDB transaction. Interrupted-import journals report completed work and support reselecting remaining originals without filename-based deduplication.
- A durable local library with albums/folders, smart rules, flags, stars, color labels, keywords, combined search/filters, ordering, stacks, recoverable Deleted, matching-checksum relinking, and separate permanent removal of managed browser data. Removing album membership or a linked library entry does not delete its source file.
- Distinct justified Photo Grid and equal-cell Square Grid, a filmstrip, Detail, Compare and Survey. Grid DOM rendering is limited to nearby rows. Compare renders the actual current recipes; its inspection controls are a basic implementation, not full reference comparison parity.
- Worker-based Float32 linear-sRGB development with immutable originals and versioned recipes. Exposure, tone controls, relative white balance/sampling, vibrance/saturation, editable curve points, eight color mixer bands, three-way grading, texture/clarity/dehaze, vignette/grain, sharpening/noise filters, manual optics, crop/straighten/rotate/flip and perspective controls produce real pixels.
- **Standard noise reduction:** the Luminance noise and Color noise controls under Edit → Detail use an edge-aware bilateral filter. They update the normal preview, support undo/reset, and run in regular exports without downloading a model.
- **AI Denoise:** open a photo, expand **Edit → Detail**, then choose **AI Denoise…** (also in the Photo menu). Download the optional **17.5 MiB** local tools once, inspect the automatic 100% before/after preview, adjust Amount and Noise level, then create a separate **16-bit TIFF** copy. Its edit recipe carries over and the source remains unchanged. Tools stay cached for offline processing and can be removed without removing saved copies. The 3.25 MiB FFDNet model runs on CPU, needs no API key, and uploads no photos. It processes opaque SDR RGB, including supported RAW after development; it is independent of Adobe's sensor-domain denoiser. See [AI Denoise](ai-denoise.md) for exact limits and verification.
- Manual source-relative brush, linear/radial, luminance and color masks; mask exposure/saturation/temperature; inversion, enable/disable, rename and duplication. Brush components can add/subtract/intersect. Manual clone and tone-matched heal are separate operations. These are not generative removal or AI segmentation.
- Temporary preset previews, original Lope presets, user preset creation/deletion, intensity, favorite edit controls, named versions, persistent recipe history, grouped slider gestures, and undo/redo. Develop settings can be copied to multiple selected photos with a shared undo transaction. Source-specific masks and sampled retouch patches are not blindly copied to another image.
- Real JPEG, PNG 8/16-bit and TIFF 8/16/32-bit encoders, or exact original download. Exports include dimensions/quality, filename suffix/numbering, generated output profiles, optional XMP, a high-precision text overlay, output sharpening after resizing, sequential batch progress/cancel, browser downloads or create-only workspace destinations. A browser download handoff is reported as such; it is not proof of the user's final filesystem save.
- ZIP library backup and restoration of originals, thumbnails, albums, metadata, recipes, versions, history and retained sidecars. Restoration validates CRCs, source hashes and recipes before import; existing stable asset IDs are skipped.

## Image Editor handoff

**Photo → Edit a copy in Image Editor** renders the saved recipe into an RGB/8 `.lopeimage` native project through the shared file service and opens that actual project in the existing Image Editor. Saving it there triggers a file-service subscription in Lightroom. The changed native project is rendered by the shared Image Editor renderer and imported as a separate managed derivative with `parentId` pointing to the source. Its layers are preserved in its immutable native-project bytes. Lightroom develops the composite; editing native layers remains an Image Editor operation.

Image Editor currently supplies RGB/8 interchange. High-bit-depth interchange is not claimed. Lightroom retains the original RAW bytes and its own recipe. Pending handoff paths/hashes persist as small settings records; managed originals and project snapshots remain in IndexedDB.

## Formats, references and evidence

- [Reference manifest](reference-manifest.json) and [control/workflow inventory](reference-inventory.md): dated Adobe desktop 10.0 documentation, observed control order, original reference images outside product assets, provisional dimensions and evidence limits.
- [Format registry](format-registry.json), generated from `packages/photo-engine/src/formats.ts`, and [exact tested coverage](coverage.json). An extension is not a compatibility claim. Camera/compression combinations without fixtures are unverified.
- [Engine/dependency manifest](engine-manifest.json): versions, working data, binary checksums, source build pins, machine and memory limits. The optional [local denoise model](denoise-model-manifest.json) has pinned weights and runtime assets; no remote AI provider is configured.
- [UI verification](verification.json), [codec verification](codec-verification.json), [independent reader results](independent-reader-verification.json), and [handoff verification](handoff-verification.json), when generated by the corresponding checks.
- [AI workflow verification](denoise-verification.json) covers download and processing cancellation, real inference, offline processing, storage retry, immutable sources, reload, integrity checks and tool removal. The [controlled quality probe](denoise-probe.json) measures a simple procedural Gaussian-noise fixture, not general photographic quality.
- [Production verification](production-verification.json) confirms the built, hashed worker/WASM assets import a sensor-only DNG, perform local AI denoise and export genuine 16-bit TIFFs without development source URLs.
- [Screenshots](screenshots/) show import, detail, grid, crop/masking, export, narrow layout, and LopeOS integration. Unknown reference scale/platform means these are implementation evidence, not matched pixel-parity results.
- [Architecture](architecture.md), [remaining differences](remaining-gaps.md), and [third-party components](THIRD_PARTY_NOTICES.md).

Source files are in `apps/web/src/apps/lightroom` and `packages/photo-engine/src`. The main entry is lazy-loaded; the RAW payload loads when required. Core processing makes no photo-upload request. Future provider interfaces are defined in `jobs.ts`; there is no simulated job backend or credential input in this build.
