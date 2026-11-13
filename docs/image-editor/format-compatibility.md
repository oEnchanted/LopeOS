# Format compatibility

Tested library: **ag-psd 31.0.3**, resolved by the workspace lockfile. It reads/writes PSD structures; this app supplies rendering. The [library's limitations](https://github.com/Agamnentzar/ag-psd#limitations) and [Adobe's format specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/) are separate from Photoshop rendering parity.

| Format / feature | Read | Write | Preservation and limits |
|---|---|---|---|
| Native `.lopeimage` v1 | Yes | Yes | Exact implemented RGB/8 document state, tiled bytes, masks, editable text/shapes/adjustments, sources, filter/effect parameters, selection, paths, guides and imported original bytes |
| PSD RGB, 8 bits/channel | Supported subset | Supported subset | Real ag-psd parser/writer; layers, hierarchy, masks, opacity/fill, supported blending, basic horizontal text and fourteen adjustments |
| PSD raster layers | Yes | Yes | Source RGBA imported; regenerated previews and merged composite on export |
| PSD groups | Yes | Yes | Hierarchy, visibility, open state, opacity and Pass Through/isolated blend metadata; advanced knockout behavior unavailable |
| PSD raster masks | Yes | Yes | Grayscale coverage, offsets, enabled state; export bakes mask geometry into a separate mask preview |
| PSD text | Basic horizontal | Basic horizontal | Content and primary style stay editable. Browser fonts/metrics substitute; mixed runs, vertical type, warp and paragraph styles not retained in the editable subset |
| PSD brightness/contrast, levels, curves, hue/saturation, balance | Parameters | Parameters | Local algorithms approximate Photoshop. Three-point curves and primary/master channels only |
| PSD Exposure, Vibrance, Black & White, Photo Filter, Channel Mixer, Invert, Posterize, Threshold, Gradient Map | Supported parameters | Supported parameters | Basic RGB variants; local algorithms differ from Photoshop. Gradient Map supports two endpoints; mixed channel/tint variants remain partial |
| Native saved alpha selections | Yes | Yes | Selection coverage, names and IDs persist; PSD alpha-channel export remains unavailable |
| PSD clipping | Basic metadata | Basic metadata | Raster clipping stacks supported locally; complex interactions unverified |
| Photoshop vector masks/shapes | Stored raster preview | Raster preview | Full original PSD stays in native project; vector semantics are not round-tripped |
| Photoshop Smart Objects | Stored raster preview | Raster preview | Original PSD retained in native project. Native embedded sources and placed-file bytes stay editable/preserved in native format; not exported as Photoshop Smart Objects |
| Photoshop layer effects | Stored preview where present | Rendered preview | Native effects retain parameters; PSD effect descriptors are not round-tripped |
| Smart filter stacks | Stored preview where present | Rendered preview | Native supported adjustment stacks remain editable; full Photoshop filter descriptors unavailable |
| PSD work paths, actions, plugins, specialist metadata | Original source only | No | Native work paths are preserved in native files, not PSD resources |
| PNG | Browser decoder | Yes | Correct document dimensions and alpha tested. Browser color pipeline; explicit 16-bit PNG input rejected |
| JPEG | Browser decoder | Yes | RGB/8, quality control; export composites transparency over white |
| WebP | Browser decoder | Yes when encoder available | Correct MIME checked; alpha preserved; quality control |
| GIF / BMP | Browser decoder | No | GIF first frame only; no animation editing |
| TIFF / RAW / PSB | No | No | No silent conversion |
| CMYK / Lab / multichannel PSD | Rejected | No | Header checked before decode; original not silently converted |
| 16/32-bit PSD | Rejected | No | Header checked before decode; 8-bit conversion is not described as lossless |
| Embedded ICC profile transforms | No | No | Complete imported file bytes retained in native format; preview/export uses browser sRGB. No calibrated or proofed color claim |

## Native project boundary

The native envelope carries `format: "lope-image"` and `version: 1`. Tiled bytes and selection bytes are encoded explicitly. Parsing checks format, dimensions, nesting, layer IDs, transform validity, surface/tile bounds and decoded byte budgets.

“Lossless native” means this engine's state can be saved and reopened without flattening or quantizing it further. It does not mean a Photoshop document has been fully interpreted. The complete source PSD or raster file remains available inside the native project. Placed files additionally retain their original bytes on the embedded layer.

Undo/redo entries and named history snapshots are session state and are not serialized. Browser-local recovery persists full retained undo/redo history, snapshots, all open tabs and per-tab views in an independent session journal. The original-file bytes are represented in the model and native file, but a dedicated Extract Original UI is not yet supplied.

## Conversion behavior

PSD import warns about identified unsupported features before the document is accepted. For formats the engine cannot edit honestly, such as non-RGB or high-depth PSD, it rejects the input. PSD export presents a concrete compatibility report before the user chooses a destination or downloads the copy. Native Save stays separate from PSD Save a Copy and raster Export As.

Rasterizing shapes, embedded objects, effects or filters for a PSD copy leaves the open native document unchanged. Text metadata, masks and adjustment descriptors are written separately rather than flattening the whole PSD. Updated previews are generated by the browser/worker renderer, including a merged document image.

## Validation status

The engine suite checks a writer/reader round trip containing raster pixels, a mask, Multiply, opacity, fill, editable horizontal text and a brightness adjustment. The browser suite additionally runs the worker export path and checks a real PSD header, and validates PNG decoding/dimensions/alpha. GPU/Canvas blend tests are independent of file structure tests.

**No authorized Photoshop installation was available to validate the exported PSD in Photoshop.** ag-psd round-trip acceptance is not a claim of Photoshop acceptance or complete visual equivalence. Its text writer can cause Photoshop to request text preview updates; font metrics and profile interpretation also need application-side validation.
