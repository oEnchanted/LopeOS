# Photoshop CS6 comparison

Audit date: **2026-11-13**. Reference: Adobe's [Photoshop Help and tutorials, February 2013](https://help.adobe.com/archive/en/photoshop/cs6/photoshop_reference.pdf). The archived PDF contains 757 pages; printed page numbers are seven less than PDF page numbers. The target is **Photoshop CS6 Standard on Windows, English, dark Essentials**. Exact installed build, display scaling and Adobe-rendered fixture comparisons remain unverified.

The reference contains both the perpetual CS6 feature set and separately labeled Creative Cloud updates. Extended-only 3D and technical-imaging capabilities are tracked separately. Modern subject segmentation, neural processing, generative editing and the Contextual Task Bar are outside the CS6 baseline. A local AI extension must therefore be assessed separately from CS6 parity.

The machine-readable [inventory](cs6-inventory.json) covers **125 feature families**. It is a broad comparison, not an exhaustive enumeration of every menu command, preference, keyboard variant or algorithm. “Implemented” means the stated independent workflow exists and has evidence. “Partial” identifies a working subset and its limits. These counts are not a Photoshop-equivalence score.

| Area | Implemented | Partial | Missing | Outside baseline |
|---|---:|---:|---:|---:|
| Workspace | 3 | 4 | 3 | 0 |
| History and files | 6 | 4 | 2 | 0 |
| Layers | 7 | 6 | 3 | 0 |
| Selections | 7 | 3 | 5 | 0 |
| Geometry | 3 | 2 | 5 | 0 |
| Painting and retouching | 4 | 8 | 4 | 0 |
| Adjustments | 1 | 5 | 5 | 0 |
| Filters | 1 | 4 | 5 | 0 |
| Type and paths | 1 | 4 | 2 | 0 |
| Color and production | 1 | 0 | 5 | 0 |
| Automation and media | 0 | 0 | 5 | 0 |
| Extended | 0 | 0 | 3 | 0 |
| Baseline exclusions | 0 | 0 | 0 | 4 |

## Concrete improvements from this audit

- Recovery now retains clean and dirty tabs, independent views, undo/redo, snapshots and tool state. An interrupted type draft is recovered as editable text. The session journal stores binary image assets once and updates metadata separately.
- Clipboard operations include selected Copy/Cut, Copy Merged, Paste, Paste in Place, Clear and Layer via Copy/Cut. Native image dimensions remain independent of document resolution metadata.
- Quick Mask edits selection coverage separately from image pixels. Saved selections appear as alpha channels and survive native save/reopen and image geometry changes.
- Color Range, Border and Smooth provide additional selection workflows. Their local algorithms are documented independently of Adobe's implementations.
- Blur, Sharpen, Smudge, Dodge, Burn and Sponge now affect actual pixels, respect selection coverage, preserve source alpha and participate in history.
- Fourteen adjustment types are editable. The additions include exposure, vibrance, monochrome color mixing, tint filtering, channel mixing, inversion, posterization, thresholding and a two-endpoint gradient map.
- Thirteen raster filter operations provide preview/apply/cancel and source-preserving stacks. A selected Smart Filter now captures soft coverage, follows object transforms and persists through native save/reopen. Added operations include box/motion blur, high pass, noise, mosaic, emboss, edges and solarization.
- Twenty-six layer and brush blend modes work through scalar, Canvas and WebGL paths, including ten additional RGB modes. Dissolve and Photoshop-specific Fill behavior remain incomplete.
- Group transforms and nonuniform affine geometry retain editable sources. Rotation preserves selections, saved alpha channels, guides, paths and unlinked masks. Transparent trimming and Reveal All are functional commands.
- Type supports direct canvas editing, one-step commit/cancel, history and recovery. It still uses one style per layer.

These are implementation results, rather than Adobe feature descriptions. Code paths and regression files are listed per entry in the inventory.

## Verification performed

`node tests/image-editor/cs6-browser.mjs` passed **ten workflow checks** in Chromium at 1440×900, device scale 1, with **zero page errors**:

1. Quick Mask selection painting preserves layer pixels and supports undo/redo.
2. Alpha channels save/load and retain coverage in native serialization.
3. Color Range selects matching composite colors while excluding a different-color fixture pixel.
4. Border and Smooth produce reversible selection transactions without changing image pixels.
5. Dodge, Burn and Sponge toolbar flyouts change the expected pixel properties and undo correctly.
6. Blur, Sharpen and Smudge are accessible and create reversible strokes; blur/sharpen values change in the expected direction.
7. All nine added adjustment types create editable layers without changing source pixels.
8. All eight added filters apply as source-preserving Smart Filters and undo to the original raster layer.
9. Filter parameters and alpha coverage survive Save, Close and Reopen.
10. Retouching an embedded source presents a rasterize instruction and preserves layers/history.

`node tests/image-editor/smart-filter-browser.mjs` passed **45 pixel comparisons** with a maximum channel error of **0** and zero page errors. The fixtures cover soft selection coverage, object scaling/rotation, source preservation, filter stacks, disable/undo/redo, native reopen, Canvas/WebGL rendering, eleven worker viewport filters, and cache pressure from 3600×3600 surfaces. Repeated frames and object movement transmit zero unchanged mask bytes. The [Smart Filter report](smart-filter-regressions.json) records every comparison. These compare internal rendering paths, not Adobe output.

`node tests/image-editor/blend-browser.mjs` passed **222 comparisons** covering all 26 modes, translucent layers, masks/fill, repeated clipping, isolated groups, worker viewports and 256-pixel threshold/tie fixtures. Maximum error against the internal scalar oracle was **4 RGB/8 levels** for translucent Vivid Light clipping, where Canvas premultiply/unpremultiply round trips amplify rounding; other fixtures permit at most three levels. Five new engine tests cover hand-calculated equations, alpha math, brushes and all native/PSD mode names. The [blend report](blend-regressions.json) records fixtures, per-case tolerances and observed channel errors.

The numerical, native-format and PSD descriptor tests are in [cs6.test.ts](../../tests/image-editor/cs6.test.ts). Recovery and clipboard browser regressions are in [stability.mjs](../../tests/image-editor/stability.mjs). Render comparisons exercise controlled internal RGB oracles and browser/GPU paths; they do not establish Photoshop rendering equivalence.

## Remaining work with material user impact

**Production color and formats:** ICC conversion and proofing, CMYK/Lab/indexed/duotone editing, 16/32-bit processing, RAW workflows in this editor, PSB/TIFF/PDF/EPS interchange, calibrated printing and metadata editing remain substantial gaps. Native projects preserve the implemented editable state; PSD export retains only the documented subset. Alpha-channel PSD export, editable vector masks and Smart Object descriptors are still incomplete.

**Selection and geometry:** Quick Selection, Magnetic Lasso, Refine Edge, a separate selection-boundary transform, perspective crop, distort/perspective handles, warp meshes, Puppet Warp and content-aware scaling remain absent. Quick Mask overlay preferences and full channel operations are incomplete.

**Retouching and synthesis:** Clone and local healing work, but Photoshop-like spot healing, patch synthesis, Content-Aware Fill/Move, Liquify, Vanishing Point, panorama registration and Auto-Blend are missing. Generative AI is a different capability and must not be presented as an exact replacement for these algorithms.

**Layer and filter completeness:** Dissolve, Photoshop-specific Fill blend behavior, layer comps, persistent linked layers, separate lock modes, knockout, full style families, independent Smart Filter mask painting, per-filter blending and robust nested-object editing remain work. Captured selection masks are supported; the basic filter stack alone is not full CS6 Smart Filter behavior.

**Painting, vectors and typography:** Custom brush tips, scattering, texture, tilt, brush dynamics, Mixer/Pattern/Art History brushes, complex gradients, Bézier pen controls, vector booleans, mixed text runs, paragraph boxes, vertical/path type and full typography styles remain incomplete.

**Specialized workflows:** Blur Gallery, adaptive lens correction, Oil Paint, Lighting Effects, the broad Filter Gallery, video/animation timelines, actions/batches/scripts, web slices, contact sheets and printing remain absent. CS6 Extended 3D and measurement capabilities are a separate missing group.

## Algorithm and visual fidelity limits

The editor intentionally uses independent browser algorithms. Gaussian blur uses multiple box passes; motion blur limits sample count; brush retouching uses local kernels; healing uses sampled color correction; curves currently use three control points; color adjustments use a simplified RGB pipeline. Their controls can be useful without producing pixel-identical Adobe output. Limits belong in the inventory and compatibility documentation rather than being hidden behind enabled menu entries.

The internal layout follows Photoshop's menu/options/toolbar/document/panel organization, while LopeOS supplies window chrome and shared floating-surface materials. An exact CS6 visual comparison requires an authorized reference captured at the same viewport, scaling, fixture and document zoom. Current screenshots demonstrate this implementation only; they should not be labeled an Adobe similarity score.

## Added blend-mode equations

These independent RGB/8 equations use normalized base `b` and source `s`; `clamp` limits to 0–1. Alpha uses straight-alpha source-over, and Fill scales source alpha uniformly. Adobe has special Fill behavior for some modes, which remains outside this implementation.

| Mode | Independent blend calculation |
|---|---|
| Linear Burn | `max(0, b + s - 1)` |
| Linear Dodge | `min(1, b + s)` |
| Darker / Lighter Color | Choose one whole RGB color by the lower/higher sum of its channels; ties keep the base. |
| Vivid Light | Color Burn with `2s` below 0.5; Color Dodge with `2s - 1` otherwise. |
| Linear Light | `clamp(b + 2s - 1)` |
| Pin Light | `min(b, 2s)` below 0.5; `max(b, 2s - 1)` otherwise. |
| Hard Mix | 1 when `b + s >= 1`, otherwise 0. |
| Subtract | `max(0, b - s)` |
| Divide | `min(1, b / s)`; zero source returns 1. |

The same scalar math drives painting and the Canvas fallback. GPU mode indices for the original sixteen modes are retained. Browser-supported modes continue to use Canvas compositing; the ten added modes use an explicit buffer compositor so an unsupported Canvas operation cannot silently fall back to Normal.
