Run from the repository root. The audited source commit is `7136412011e06dcb2cbee96ccff8419fe0ff3ba2` in the preserved isolated checkout at `/private/tmp/lopeos-lightroom-release-audit`. The shared working tree has the guarded repairs copied back; its existing unrelated changes were preserved. Test-only follow-up edits do not change the audited application bundle.

Dependencies used: Node26.12.1, pnpm10.32.1, Playwright1.65.0 with Chromium158.0.8127.18 and WebKit27.2, React19.3.1, Vite8.3.8, TypeScript7.0.2, libraw-wasm1.6.0, Pillow11.3.0. `package.json` and the existing lockfiles remain the installation contract. Firefox failed before launching; no Firefox pass is claimed.

```sh
npm run build
npm test
node --test tests/lightroom/*.test.ts
```

Use separate terminals for the optional disposable account service, development app and production preview. This does not publish anything. The audit config retains the repository's filesystem deny rules and permits the resolved node_modules directory for nested RAW workers in an isolated checkout. `.accounts-data` is never read from the user's working tree.

```sh
LOPE_ACCOUNTS_PORT=5196 LOPE_ACCOUNTS_DATA=/private/tmp/lopeos-lightroom-audit-accounts LOPE_ACCOUNTS_ORIGINS=http://127.0.0.1:5191,http://127.0.0.1:5193 node services/accounts/server.mjs
node node_modules/vite/bin/vite.js --config tests/lightroom/vite.audit.config.ts --host 127.0.0.1 --port 5191 --strictPort
node node_modules/vite/bin/vite.js preview --config tests/lightroom/vite.audit.config.ts --host 127.0.0.1 --port 5193 --strictPort
```

Production tests use fresh guest contexts, real UI imports and actual built workers. Only the setup-completion flag is seeded. The original `production.mjs` uses the older isolated test-account seed; the new full-shell UI/handoff tests use guest setup only.

```sh
LOPE_PHOTO_BASE=http://127.0.0.1:5193 LOPE_AUDIT_PHASE=repeat node tests/lightroom/release-ui.mjs
LOPE_PHOTO_BASE=http://127.0.0.1:5193 LOPE_AUDIT_PHASE=repeat node tests/lightroom/controls-integration.mjs
LOPE_PHOTO_BASE=http://127.0.0.1:5193 node tests/lightroom/release-handoff.mjs
python3 tests/lightroom/release-handoff-reader.py
LOPE_PHOTO_BASE=http://127.0.0.1:5193 node tests/lightroom/release-details.mjs
LOPE_PHOTO_PRODUCTION_BASE=http://127.0.0.1:5193 node tests/lightroom/production.mjs
python3 tests/lightroom/validate-exports.py
```

Component/storage failure tests use isolated harnesses with explicitly injected failures. They are distinct from the production UI runs. The old handoff harness uses an in-memory file service; the production handoff above uses the real LopeDrive and shared file dialog. AI tests load the bundled local tools, run real inference and verify cached offline processing.

```sh
LOPE_PHOTO_BASE=http://127.0.0.1:5191 node tests/lightroom/browser.mjs
LOPE_PHOTO_BASE=http://127.0.0.1:5191 node tests/lightroom/release-regressions.mjs
LOPE_PHOTO_BASE=http://127.0.0.1:5191 node tests/lightroom/controls-audit.mjs
LOPE_PHOTO_BASE=http://127.0.0.1:5191 node tests/lightroom/release-data.mjs
LOPE_PHOTO_BASE=http://127.0.0.1:5191 node tests/lightroom/release-codec-worker.mjs
python3 tests/lightroom/release-codec-reader.py
LOPE_PHOTO_BASE=http://127.0.0.1:5191 node tests/lightroom/codecs.mjs
LOPE_PHOTO_BASE=http://127.0.0.1:5191 node tests/lightroom/denoise-browser.mjs
```

The stored before evidence comes from the workspace snapshot `a3c817f`, with test harness corrections documented in logs. Do not regenerate before images from repaired code. Test runs write new observations and some legacy output reports; preserve the supplied audit evidence if rerunning. `build-manifest.json` hashes every one of the112 files in the supplied archive; extracting that archive reproduces the exact tested artifact, whereas rebuilding can change embedded build timestamps.

The first RAW checks failed because a symlinked dependency worker was outside Vite's filesystem allow-list. The audit-only configuration fixed that test environment issue; the initial403/timeouts are retained. Subsequent RAW checks and built-worker runs passed. Early UI attempts also exposed test selector/resize-order mistakes; those attempts remain alongside the successful final run. The final production application still logs real workspace API401/403 responses because the authenticated workspace service was unavailable for this guest audit. These are not suppressed or mocked into successful responses.

`ui-inventory.csv` is the final expanded evidence register. `inventory-source.csv` is the original source/contract denominator; `build-inventory.py` updates only that source register and does not replace runtime findings. The before/after pixel differences compare implementation screenshots only. No matched Adobe pixel-difference image exists because the required reference scale and captures are unknown.
