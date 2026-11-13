# Verification results

Date: **2026-11-13**. Tests exercise this independent RGB/8 implementation. They do not establish Adobe rendering, file-format or pixel-perfect Windows UI equivalence.

| Check | Result | Evidence |
|---|---|---|
| Image engine, recovery, CS6, blending and AI unit tests | 56 pass | `node --test tests/image-editor/*.test.ts` |
| Standard LopeOS suite | 122 pass, 0 fail; 3 environment-dependent skips | `npm test`; Linux/Docker/gVisor acceptance requires its configured environment |
| TypeScript and production build | Editor scoped TypeScript and isolated production bundle pass; earlier whole-repository production build passed | Editor bundle uses root Vite config with `tests/image-editor/harness.html` as entry. Final whole-repository rerun is blocked by concurrent Writer calls to missing `WriterEngine.insertPageBreak`, `insertBlankPage` and `fitPage`; those files are outside this editor change |
| Editor production smoke | Bundled worker rendering, layer creation/undo and lazy AI dialog pass; no browser errors or failed requests | [production-verification.json](production-verification.json) |
| SDK/browser workflows | 17 pass, no page errors | [verification.json](verification.json) |
| Reload/recovery and editing regressions | 10 pass, no page errors | [stability.json](stability.json) |
| Added CS6 workflows | 10 pass, no page errors | [CS6 comparison](cs6-comparison.md), `cs6-browser.mjs` |
| Saved document presets | 3 pass | [preset-verification.json](preset-verification.json) |
| Development hot refresh | 6 checks pass, including reproduction of the prior invalidation | [hmr-verification.json](hmr-verification.json), [cause and limits](development-refresh.md) |
| General rendering and viewport filters | 70 comparisons; max channel error 2/255 | [pixel-regressions.json](pixel-regressions.json) |
| Blend modes, masks, groups and clipping | 222 comparisons; max channel error 4/255 | [blend-regressions.json](blend-regressions.json) |
| Smart Filter selections and cache pressure | 45 comparisons; exact fixture results | [smart-filter-regressions.json](smart-filter-regressions.json) |
| Local AI | Verified download, actual WASM model inference, deletion and 7 UI workflow checks | [local-ai-verification.json](local-ai-verification.json) |
| Workspace and accessibility | Desktop/compact sizing, panel persistence, keyboard/focus, lock guards, opaque fallback pass | [UI review](ui-review.md), [ui-verification.json](ui-verification.json) |
| Visual inventory | 18 states, 120 registered commands; no page errors | [visual-regions.json](visual-regions.json), [parity-inventory.json](parity-inventory.json) |
| Real LopeOS shell | Application search launch, rendered sample, scoped shortcuts and interactive review pass | [shell-verification.json](shell-verification.json) |
| Photoshop-side PSD and same-fixture appearance | Unverified | Requires an authorized fixed-build Photoshop installation |
| ComfyUI diffusion quality | Unverified | Actual engine/checkpoint absent; protocol/UI tests use a mocked local server |

## Functional scope

The unit tests exercise immutable touched tiles, opacity/flow, selection transforms, layer/mask targeting, hierarchy, alpha/clipping, adjustments, editable sources, native/PSD records, retained history, snapshots, clipboard, geometry, Quick Mask, saved alpha selections, retouch tools, filter selection masks, 26 blend modes and local AI input/output boundaries. Sparse and dense fixtures are kept distinct.

Browser tests operate the actual application and workers through a versioned SDK filesystem fixture. Reload checks cover clean and dirty tabs, complete retained undo/redo, per-tab views, tool settings, unfinished inline type and the LopeOS reload lifecycle. Saved presets retain dimensions, resolution and background across a browser refresh, create actual document pixels and can be deleted.

Smart Filter fixtures test soft selection coverage, moving/scaling/rotating the source, native reopen, undo/redo, Canvas/WebGL output, worker viewport transport and a 3600² cache-pressure case. Repeated rendering and source movement transfer zero unchanged filter-mask bytes. The broader blend suite checks every implemented mode on opaque/translucent input, plus masks/fill, isolated groups, repeated clipping, worker crops, threshold boundaries and whole-color ties. Canvas premultiplication rounding reaches 4/255 in a sensitive Vivid Light translucent clipping fixture; the report records that case explicitly.

The hot-refresh test uses the real Vite/React runtime with isolated update messages, without editing source or broadcasting updates to other browsers. Component refreshes retain an open dialog, its radius and document revision. Reintroducing the former string-valued object export reproduces Vite's incompatible-export invalidation. Legitimate hook-signature remounts and development-server restarts remain possible; persistent sessions protect documents through those events.

A separate public-domain NASA portrait probe produced useful broad person/helmet isolation in about 1.33 seconds; foreground and background samples were correct. Visual review found soft hair edges and small glove-area artifacts that still need refinement. This is one qualitative example, without ground-truth matte accuracy or Adobe-equivalence claims. The photo remains outside the shipped application.

The AI browser test installs all 37,168,009 pinned bytes and runs the real graph through WebAssembly with no external model/runtime fetch during inference. Select Person and background removal undo in one step. Cancellation preserves document state, and stale results cannot overwrite an intervening edit. The localhost fixture verifies checkpoint discovery, image/mask upload, graph queueing, exact-job polling, output fetch, top-layer placement, selection alpha, expansion geometry and undo. It does not test an installed diffusion checkpoint's output quality.

## Performance measurements

Host: Apple M1 Pro, arm64 macOS, 16 GiB RAM, headless Chromium 158, DPR 1, reported hardware concurrency 8. Other development work was active in the shared environment, so timings vary. Browser-managed canvas/GPU memory is not included in JS heap figures.

The [viewport profile](performance.json) uses a **4096 × 4096 document with eight nonempty 1024 × 1024 source layers**, each scaled 4×. Source tiles occupy 32 MiB. The visible document region is 4096 × 2560 at 25%, producing a 1024 × 640 preview:

- Cold delivered frame: **170.4 ms**, including 24 MiB initial tile transfer; worker rendering **70.5 ms**.
- Unchanged frame: **7.3 ms**, with **zero tile bytes** transferred.
- Warm edited frames: **9.5 ms median**, worker **8.6 ms median**; changed transfers are bounded to touched tile buffers.
- Brush update: **0.9 ms median** in this fixture.
- Maximum main-thread heartbeat gap during the measured workload: **9.3 ms**.
- Initial binary session journal: **98 ms**; subsequent view-only manifest update: **0.7 ms**.

This is a displayed-viewport measurement, not eight independent full-resolution photographic layers, all filters or export speed. The separate full-size eight-layer 4096² render under software **ANGLE SwiftShader** took approximately **5.59 seconds** in the latest recorded run; 558 main-thread heartbeat callbacks continued and worker cancellation passed. Hardware GPU, sustained large-document memory and physical pen measurements remain open.

## Visual evidence

The standard captures use the Alpine study at 50% in a 1440 × 900 internal viewport. Additional UI captures cover 780 × 550, persistent floating panels, Local AI, preset controls and accessibility fallbacks. The [visual review](visual-comparison.html) displays regional overlays against the documented Adobe reference. Its artwork/build/OS/scale differ, so no Photoshop image-match score is claimed.
