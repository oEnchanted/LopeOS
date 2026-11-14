# Reproduce the Photoshop audit

Run from the repository root with the existing installed dependencies. The audited environment uses Node 26.12.1, Vite 8.3.8, TypeScript 7.0.2, Playwright 1.65.0, React 19.3.1 and Pillow 11.3.0; exact sources, artifacts, versions and test hashes are in `environment.json` and `build-manifest.json`. Use disposable browser contexts and fixtures. No production account or original photo is required.

```sh
node --test tests/image-editor/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p tests/image-editor/tsconfig.json
npm test
node tests/image-editor/release-build.mjs
node node_modules/vite/bin/vite.js preview --outDir dist-photoshop-audit --host 127.0.0.1 --port 5189 --strictPort
```

Keep the loopback preview running in a separate terminal. The release builder uses the same Vite configuration and production modules for the actual desktop and instrumented SDK fixture entries. Test adapters expose engine/session objects in fixture entries only; these are not added to the desktop product entry. `dist-photoshop-audit` is a local audit artifact, **not a deployment bundle to publish**.

```sh
IMAGE_EDITOR_TEST_URL=http://127.0.0.1:5189 node tests/image-editor/release-regressions.mjs
IMAGE_EDITOR_TEST_URL=http://127.0.0.1:5189 node tests/image-editor/release-workflows.mjs
IMAGE_EDITOR_TEST_URL=http://127.0.0.1:5189 node tests/image-editor/release-session.mjs
IMAGE_EDITOR_TEST_URL=http://127.0.0.1:5189 node tests/image-editor/release-matrix.mjs
IMAGE_EDITOR_TEST_URL=http://127.0.0.1:5189 node tests/image-editor/release-shell.mjs
IMAGE_EDITOR_TEST_URL=http://127.0.0.1:5189 IMAGE_EDITOR_TEST_ENTRY=/tests/image-editor/release.html node tests/image-editor/release-ui.mjs
IMAGE_EDITOR_TEST_URL=http://127.0.0.1:5189 IMAGE_EDITOR_TEST_ENTRY=/tests/image-editor/release.html node tests/image-editor/release-ui-color.mjs
IMAGE_EDITOR_TEST_URL=http://127.0.0.1:5189 IMAGE_EDITOR_TEST_ENTRY=/tests/image-editor/release.html node tests/image-editor/release-ui-context.mjs
python3 tests/image-editor/release-images.py
node tests/image-editor/release-inventory.mjs
node tests/image-editor/release-report.mjs
```

The legacy regression adapter preserves assertions and changes only fixture URLs, browser module access to compiled module exports, and the existing About Prism product rename. It never serves source modules from the production server. Existing scripts may also write their historical report paths; the audit-specific logs remain under `evidence/`.

`release-matrix.mjs` attempts installed Chrome, bundled Chromium, WebKit and Firefox. Missing executables are explicitly UNVERIFIED, not skipped passes. 1152×720 and 720×450 are effective-space checks corresponding to 1440×900 at 125%/200%; actual browser zoom remains UNVERIFIED. The supported minimum is 740×500. Captures use DPR 1 and retain actual CSS/document zoom metadata; no screenshot stretching occurs.

`release-images.py` uses Pillow for independent PNG/PSD channel decoding. PSD merged previews encode transparency against white, so it checks the documented encoded relation and reports inverse quantization rather than comparing raw stored PSD RGBA as straight alpha. Full layered Adobe semantics remain unverified. Implementation-only before/after overlays and differences are clearly labelled; no Adobe-reference diff is fabricated.

The full app regression's native PTY initially failed because the existing `node-pty` helper lacked execute permission. An isolated temporary dependency copy restored that permission for retesting; the original installed dependency was not modified. See `evidence/pty-environment.json` and the final app regression log.

Stop the local preview after verification. Do not deploy this candidate. Obtain the captures/settings listed in `reference-request.md` and complete the open ledger before seeking identity release approval.

For the independent layered reader, create an isolated Python environment and install `psd-tools==1.10.9`; run `evidence/engine-psd-independent-reader.py` against the generated fixture. The retained report records the package version, layers, masks, text and partial-alpha quantization. This is separate from an authorized Adobe round trip.

The tested isolated checkout is `/private/tmp/lopeos-photoshop-audit`, branch `audit/photoshop-release-20261113`. Photoshop repairs were copied back to the primary workspace only after baseline-hash conflict checks. Later primary-workspace changes can make that workspace differ from the frozen candidate; `build-manifest.json` remains the authority for what was tested.
