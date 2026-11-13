# Remaining gaps

The implemented workflows are listed in [README](README.md) and compared with Adobe's CS6 manual in the [125-family audit](cs6-comparison.md). This is an independent editor, not complete Photoshop parity.

## Reference and visual verification

- No authorized Windows Photoshop installation or identical Adobe-rendered fixture was available. Exact build, Windows scaling, font metrics and same-fixture pixel differences remain unverified.
- The workspace follows Photoshop's compact dark layout, with independently drawn icons and LopeOS floating materials. The contextual task bar and local AI are modern additions outside the CS6 baseline.
- Docked split heights and floating panel geometry are configurable. Every Photoshop docking target, document arrangement, custom toolbar and keyboard editor is not implemented.

## Editing completeness

- Pen paths are polygonal. Bézier handles, Magnetic Lasso, Quick Selection, Refine Edge, selection-boundary transforms, perspective crop, warp meshes, Puppet Warp, content-aware scaling and artboards remain absent.
- Type supports direct canvas editing and remains editable, but uses one style per layer and browser fonts. Mixed character runs, vertical type, paragraph boxes, text-on-path, outline conversion and Photoshop shaping parity remain incomplete.
- Twenty-six layer and brush blend modes work. Dissolve, Photoshop-specific Fill blending, extensive brush dynamics/presets, airbrush timing, tilt and stroke smoothing remain gaps. Physical stylus testing is pending.
- Group and affine transforms preserve geometry, including rotated nonuniform scaling and mask links. Pass-through group clipping/effects, knockout, persistent linked layers and layer comps need more work and Adobe-side comparison.
- Thirteen raster filters and fourteen adjustment types work with editable source preservation. Their algorithms are independent approximations: for example, three-point curves, RGB color-balance offsets and local sampled-color healing are not Adobe implementations.
- Smart Filters capture selection coverage and keep it with the transformed source. Photoshop's shared filter-mask editing, per-filter blending options, broad Filter Gallery, Blur Gallery and advanced neural filters are incomplete.
- Stroke/shadow/color overlays work; bevel, glow, satin, pattern/gradient style families are missing. Spot Healing, Patch, Content-Aware Fill/Move, Liquify, Vanishing Point, panorama registration and Auto-Blend remain missing.
- Actions, batch processing, scripting/plugin runtimes, printing, Bridge workflows, video/timeline and CS6 Extended 3D/technical-imaging features remain unimplemented.

## Files, color and persistence

- The [format matrix](format-compatibility.md) records PSD limitations. Vector masks, Smart Object/filter descriptors and full effects do not round-trip as native Photoshop semantics. Complete imported source bytes are retained; unsupported descriptors are not interpreted as editable features.
- Editing is RGB/8 in browser sRGB. ICC conversion/proofing, CMYK/Lab/high-depth processing, RAW editing in this app, PSB/TIFF/PDF/EPS interchange and calibrated printing remain gaps. Photoshop-side PSD validation is pending.
- Reload recovery now includes clean and dirty tabs, views, full retained undo/redo, snapshots, tool settings and unfinished type. IndexedDB/browser quota or eviction and termination before the bounded journal write completes can still prevent recovery. Native project files intentionally do not embed session undo history.
- Embedded original bytes are retained, but opening/editing an embedded source as a nested document and extracting those bytes through a dedicated UI remain missing.
- SDK fixtures exercise versioned binary writes and conflict handling. Actual Linux runtime acceptance requires its configured container. Cancellation cannot revoke a write already received by that runtime.

## Performance and memory

- Interactive previews crop to the visible document region, cap output resolution, transfer only newly needed/changed tiles and use a worker for larger documents. Painting modifies touched tiles. Full-resolution export and operations requiring a whole-image scan still allocate large intermediate surfaces and can be slow.
- The [viewport benchmark](performance.json) uses eight nonempty 1024² sources scaled across a 4096² document. It measures this specific displayed view, not eight independent 4096² photographic sources or every tool/filter combination.
- Full-size GPU rendering was tested under Chromium SwiftShader, not a physical GPU. Groups, adjustments and clipping can use Canvas. Native canvas/driver memory is not fully reflected in JS heap measurements.
- Source, tile and prepared-view caches have bounded ownership, but an active render may retain an evicted surface until that frame finishes. Maximum document dimensions do not guarantee every layer combination fits memory. Native base64 serialization and preserved originals increase peak save memory/file size.

## Local AI and external services

- Downloadable MODNet provides local **portrait** selection and background removal. It does not recognize every subject or reproduce Adobe's models. Inference is bounded to a 768-pixel longest edge and resampled to document size; image quality depends on the photograph.
- Generative Fill and Expand require a separately installed localhost ComfyUI server and compatible SD checkpoint. Inputs are limited to 1024 pixels and generated results are resized to the document. Protocol and patch application tests pass; end-to-end diffusion remains unverified without that installation.
- The local AI installer verifies pinned model/runtime bytes. Offline inference works after installation, but the browser can evict cached assets. Model/runtime deletion, cancellation and reinstall are supported. See [local AI setup, licenses and limits](../../packages/image-engine/src/ai/README.md).
- Adobe Firefly, Adobe accounts/cloud libraries, Adobe plugins and remote services are not integrated. Unsupported features remain explicitly identified.
