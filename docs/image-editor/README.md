# LopeOS Image Editor

Launch **Image Editor** from LopeOS application search or the Dock. The initial **Alpine study** is editable sample artwork; **File → New** creates an empty document. The shell supplies the outer window and the editor supplies a compact dark Photoshop-style workspace.

## Implemented workflows

- Saved/recent document presets, multiple documents, menus, SDK commands, contextual options, document tabs, rulers/guides, independent view positions, saved workspaces, resizable docked groups and floating panels.
- Tiled Brush/Pencil/Eraser, opacity/flow/spacing/hardness, pressure input, twenty-six brush modes, Clone, sampled-color Healing, Blur, Sharpen, Smudge, Dodge, Burn and Sponge.
- Marquee, ellipse, lasso/polygon, Magic Wand, Color Range, Quick Mask, add/subtract/intersect, invert, feather, expand/contract, Border/Smooth, saved alpha selections and selection-constrained edits.
- Copy/Cut/Copy Merged, Paste/Paste in Place, Layer via Copy/Cut, device-image paste, Clear, inline editable Type and commit/cancel.
- Move, alignment/distribution, group transforms, affine scale/rotation/flips, crop/straighten, image/canvas resize, Trim and Reveal All.
- Layers, groups, reorder, visibility/locking, clipping, masks, opacity/fill, twenty-six blend modes, merge/rasterize, live shapes, polygonal paths and stroke/shadow/color effects.
- Fourteen editable adjustments and thirteen raster filters, including live preview/cancel and source-preserving Smart Filter stacks with selection coverage.
- Native layered projects, supported layered PSD subset, raster import, PNG/JPEG/WebP export, file conflict handling and dirty-close guards.
- Automatic session recovery for saved and unsaved tabs, undo/redo, snapshots, views, tools and unfinished type. Visible-region worker previews and incremental tile uploads reduce painting and redraw cost.

## Optional local AI

Open **Filter → Local AI → Select & Mask** or the **Local AI** contextual button. Download the approximately **37.2 MB** portrait engine, then use **Select Person** or **Remove Background**. It runs MODNet through WebAssembly locally; background removal creates an editable mask. The model/runtime can be deleted from the same dialog.

For **Edit → Generative Fill**, first select a region. **Generative Expand** extends the canvas and fills its new border. Both connect to an optional **user-installed localhost ComfyUI** engine and compatible checkpoint. The dialog provides the official download link and downloadable setup instructions. Generated pixels appear on a new top layer; original layers remain editable. See [installation, licenses and limits](../../packages/image-engine/src/ai/README.md).

This is an independent implementation, not complete Photoshop parity. The [CS6 comparison](cs6-comparison.md) distinguishes implemented, partial and missing workflows. The [format matrix](format-compatibility.md) and [remaining gaps](remaining-gaps.md) state the production limitations.

## Verify

From the repository root, after dependency installation:

```sh
node --test tests/image-editor/*.test.ts
npx tsc --noEmit -p tests/image-editor/tsconfig.json
npm test
npm run build
npx vite --host 127.0.0.1 --port 5176 --strictPort
```

With that preview running:

```sh
node tests/image-editor/browser.mjs
node tests/image-editor/stability.mjs
node tests/image-editor/presets.mjs
node tests/image-editor/hmr-browser.mjs
node tests/image-editor/cs6-browser.mjs
node tests/image-editor/ai-browser.mjs
node tests/image-editor/ai-portrait-browser.mjs
node tests/image-editor/render.mjs
node tests/image-editor/smart-filter-browser.mjs
node tests/image-editor/blend-browser.mjs
node tests/image-editor/performance.mjs
node tests/image-editor/capture.mjs
node tests/image-editor/inspect.mjs
```

Set `IMAGE_EDITOR_TEST_URL` for another preview URL except the real-shell `inspect.mjs` check, which uses port 5176. Playwright Chromium must be installed. The AI test obtains the actual pinned model/runtime, about 37.2 MB, when its temporary cached test assets are absent. It tests real portrait inference; a ComfyUI protocol fixture does not establish end-to-end diffusion quality.

Browser file tests use a versioned SDK filesystem fixture with real serialization and workers. They do not assert that the Linux filesystem runtime is deployed. The real-shell smoke check is separate.

## Delivery map

- [Architecture and memory](architecture.md) and [development refresh behavior](development-refresh.md)
- [CS6 feature comparison](cs6-comparison.md) and [machine-readable inventory](cs6-inventory.json)
- [Reference provenance](reference-inventory.md), [control inventory](parity-inventory.json), [workspace review](ui-review.md) and [visual comparison](visual-comparison.html)
- [Verification and performance](verification.md)
- [Integration notes](integration.md), [format compatibility](format-compatibility.md) and [remaining gaps](remaining-gaps.md)

Source lives in `apps/web/src/apps/image-editor/` and `packages/image-engine/`. Adobe documentation supplies behavioral references; no Adobe application binaries, proprietary models or artwork are shipped as runtime assets. The Alpine artwork is original, Lucide uses ISC and ag-psd uses MIT. Optional model/runtime license links accompany the download controls.
