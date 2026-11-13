# Image editor architecture

## Document and editing state

`packages/image-engine/src/model.ts` defines a document independently of the canvas. It records dimensions, resolution, RGB/8 metadata, profile label, recursive layer hierarchy, transforms, opacity/fill, blend modes, masks, clipping, text, shapes, adjustment parameters, effects, preserved sources, filter stacks, document paths, guides, selection and revision identity. `embeddedAsset` retains the exact bytes of a placed file; an imported document also retains its source bytes in a native project.

Selection is a document-coordinate `Uint8Array`. A layer mask is a separate tiled grayscale surface with independent enable/link state and transform. Neither is conflated with layer alpha. An active layer ID list and an explicit `pixels`/`mask` target choose the editing destination.

Raster surfaces are sparse 128 × 128 RGBA tiles with a constant default color. Empty 4096 × 4096 layers allocate no raster tiles. `SurfaceWriter` copies a tile the first time it is touched in a transaction. All untouched tile arrays remain shared with earlier states. Raw RGBA bytes, including hidden RGB values, survive native serialization.

Transforms are source-preserving matrices represented by translation, scale, rotation and shear. Cropping changes the document extent and shifts geometry, keeping cropped source pixels. Resizing changes geometry and selection sampling. Explicit merge and rasterize commands perform destructive conversion; previews do not replace text, masks, adjustments or source objects.

## Brush transactions

`BrushStroke` owns one writable surface for the full pointer gesture. Coalesced pointer samples are interpolated at a spacing based on brush diameter. Pressure affects size and deposited coverage. Hardness controls radial falloff; Pencil stamps hard pixels.

Flow accumulates per-dab coverage. Opacity caps the accumulated coverage for the entire stroke. Every updated pixel is recomputed from the original transaction pixel and the accumulated coverage, avoiding repeated opacity application during one stroke. A subsequent stroke deposits more paint. Selection coverage is sampled after converting the local pixel back to document coordinates. Mask painting changes grayscale coverage while retaining layer pixels.

Pointer movement does not copy every layer or append history. Pointer-up commits one brush history entry. Move and handle gestures similarly preview a transaction before committing. Numeric and slider changes of the same control coalesce briefly, without crossing a saved revision. Dialogs commit on confirmation.

Clone Stamp samples a preserved source surface and an Alt-click offset. Healing transfers that sample with a per-stamp RGB correction between source and destination centers. This is an approximation, not Photoshop Healing Brush or Poisson blending.

## Rendering and workers

`CanvasRenderer` prepares source content, text, shapes, filters, masks and effects. It uses native tile uploads instead of expanding every default-color pixel in JavaScript. Its source canvas cache is an LRU bounded to 96 MiB.

For supported flat layer stacks, `WebGLCompositor` composites with straight-alpha source-over and twenty-six blend equations. It uses two ping-pong framebuffers and a staging texture. RGB component blend modes use luminance/saturation formulas; no Photoshop proprietary engine is used. GPU textures are limited to 4096² to bound this allocation to roughly 192 MiB. Texture limits, shader errors and context loss trigger the Canvas path. The editing viewport presents the result directly without an additional GPU presentation copy.

Groups, adjustment layers and clipping stacks use the Canvas reference path. Pass Through groups operate on the incoming backdrop; isolated groups first render their children on transparency. Group opacity interpolates premultiplied results with the prior backdrop. Clipped raster stacks preserve the base layer alpha, including partial transparency. Complex clipping combinations remain listed as gaps.

Documents above 512 × 512 pixels render in a dedicated worker, with one in-flight preview and a coalesced latest request. Viewport previews crop to the visible region and scale to display resolution, capped at four megapixels. Filter/effect overscan preserves pixels at cropped viewport edges. `SceneEncoder` transmits only new or changed visible 128px tiles, dropping original-file bytes, selections and other irrelevant metadata from the preview messages. `SceneDecoder` retains source identities and prunes unused tiles. Unchanged layers reuse prepared content; source rasters, tile bitmaps and prepared content have separate 96/48/64 MiB cache budgets. The worker retains its renderer/cache across previews. ImageBitmap delivery updates the visible canvas without blocking the main thread on compositing. Old-document results are discarded. Smaller documents render directly; their redraws are grouped by animation frame.

PSD parsing/writing, native serialization, raster decoding/encoding, fill, tolerance selection, feathering and selection growth run in workers. File work uses a separate worker from preview rendering. Session recovery stores normalized binary assets in IndexedDB, outside the native base64 file format. Cancel terminates the operation worker and rejects pending work; closing the app terminates workers, timers and subscriptions and deletes GPU resources. A cancelled filesystem write already handed to the shared runtime cannot be recalled.

## History and budgets

History stores structurally shared document states with names and revision IDs. It keeps at most 80 entries and prunes old entries when unique retained pixel/selection buffers exceed 192 MiB. Named session snapshots share immutable states and have the same admission budget. Current document buffers can exceed the history target; the two retained states are not silently discarded. Browser-managed canvas/GPU allocation is separate from the typed-array estimate.

Input constraints are 16,384 pixels per axis and 64 megapixels per surface/document; PSD input is capped at 256 MiB and native input at 512 MiB with a 384 MiB decoded raster budget. These are admission limits, not a guarantee that every maximum-size combination will fit available browser memory. Large dense documents need further tiling of the compositor; see the measured profiles and gaps.

## Files, recovery and SDK integration

The app calls `AppContext` files, dialogs, settings, notifications, command registry and lifecycle guards. New writes are atomic `createOnly`; existing saves supply an expected version. An existing new destination requires a concrete replacement dialog and a versioned write. External filesystem notifications trigger version checks. Conflicts preserve the open document and offer Save As/reload.

Native `.lopeimage` is a versioned JSON envelope with base64 tile arrays and source assets. It is lossless for this engine's implemented RGB/8 model. It is not a lossless conversion of arbitrary Photoshop files. PSD export regenerates per-layer previews and the merged composite and shows a compatibility report before conversion.

`SessionJournal` persists every open tab, including clean documents, undo/redo entries, snapshots, active tab, per-tab zoom/pan, tool settings and unfinished text drafts. A 250ms bounded schedule avoids starvation during continuous interaction. Typed-array tiles are normalized into binary assets and written once; view-only updates change the manifest without serializing all pixels again. History versions identify changed records. Atomic IndexedDB transactions update the manifest, history records and assets together, and prune unused assets. Resident state survives component remounts; IndexedDB survives browser reloads. Stored recovery is suspended if restoration fails, preventing accidental overwrite of the failed session.

Visibility changes, pagehide and the LopeOS Reload lifecycle request flush pending recovery. Reload keeps unsaved documents; an explicit app close follows the dirty-document guard and clears the journal. Abrupt termination can still lose the last unflushed fraction of a second. Recovery is browser-local and subject to browser storage availability/eviction; saving a native project remains a separate action.

Inline Type uses a temporary DOM editing overlay. It commits one document transaction on confirmation; Escape cancels. The draft is journaled and restored as editable text after interruption. Quick Mask uses a temporary tile view of selection coverage and never alters layer pixels. Saved alpha selections travel with native documents and are remapped by image/canvas resizing and rotation.

Workspace geometry, panel groups, active tabs, floating positions, tool columns, rulers and task bar state are settings; named workspace snapshots are independent from image documents.

## Optional AI and development updates

The lazy Local AI dialog installs SHA-256-verified model/runtime assets into Cache Storage. Portrait inference runs in its own worker. Its input uses a stripped scene containing only the chosen layer or needed composite layers, with copied tile buffers transferred to preserve immutable source data. Original file bytes, saved selections and unrelated metadata are omitted. Results carry a document/revision guard and commit through ordinary history. ComfyUI requests are restricted to loopback endpoints, use per-job polling and never globally interrupt the server. See [AI architecture and licenses](../../packages/image-engine/src/ai/README.md).

React UI modules export only components; mutable tool, panel, menu and filter metadata lives in separate modules. This avoids the former Vite incompatible-export invalidation on normal component updates. [Development refresh evidence](development-refresh.md) distinguishes this fix from unavoidable remounts caused by hook-signature edits or a development-server restart.
