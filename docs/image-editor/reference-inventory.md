# Frozen reference and parity inventory

Capture dates: **2026-11-12–13**, America/Denver. Target: **Photoshop desktop on Windows, English, dark Essentials**, with LopeOS outer window chrome. This is independent implementation from public documentation, not Adobe code or assets.

The requested historical feature baseline is **Photoshop CS6 Standard**, researched from Adobe's [February 2013 manual](https://help.adobe.com/archive/en/photoshop/cs6/photoshop_reference.pdf). The [CS6 comparison](cs6-comparison.md) separates Creative Cloud updates, Extended features and modern AI additions. The newer screenshot below informs workspace organization only; it is not evidence of CS6 feature availability.

## Reference provenance and limits

No user-supplied screenshot or authorized Photoshop installation was provided. The primary reference is [Adobe's desktop workspace overview](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/workspace-overview.html), observed with a 2026-11-10 update date, and its [official workspace screenshot](https://helpx-prod.scene7.com/is/image/HelpxProdLoc/ps-desktop-updated-drover-workspace-overview-updated-6?%24pjpeg%24=&jpegSize=200&wid=1200). The screenshot is retained in `reference/adobe-workspace-2026.jpg` for review, with Adobe copyright; it is not loaded by the application.

| Setting | Reference evidence | Frozen implementation capture |
|---|---|---|
| Product | Photoshop **desktop** documentation | LopeOS Image Editor 0.1.0 |
| Edition/build | Not reported by the screenshot; **unverified** | Source in this checkout |
| OS | Requested Windows target; screenshot OS is **not established** | Chromium 158 on macOS/arm64, LopeOS outer chrome |
| Language | English documentation and pictured labels | en-US / English labels |
| Theme/workspace | Dark workspace, current desktop regions; pictured panel configuration is collapsed | Dark Essentials interpretation, expanded panels by default |
| Viewport | Reference image 1200 × 775; workspace occupies approximately x80–1120, y81–696 | 1440 × 900 internal viewport; shell check 1600 × 1000 |
| Display/UI scale | Not reported; cannot infer a Windows scale from this image | Browser DPR 1; UI 100%; browser zoom 100% |
| Document/zoom | Different source artwork; approximately 141.41% is pictured | Original Alpine study, 1440 × 960, canvas 50% |

**A same-fixture, same-build Photoshop screenshot comparison is not verified.** The documentation image uses different artwork and a collapsed panel arrangement, and does not establish Windows menu geometry. No pixel-match score is claimed. The interactive [visual review](visual-comparison.html) shows this limitation and the measured implementation regions.

## Reference inventory

| State/region | Implemented behavior | Evidence and status |
|---|---|---|
| Default Essentials | Menu/options rows, grouped tools, tabs, neutral pasteboard, color/properties/layers stack | `essentials.png`; geometry recorded; exact Photoshop pixel parity unverified |
| Multiple layers | Source, raster, shape, text, mask thumbnails; active target, visibility, locking | Layer structure and browser workflow tests pass |
| Move | Auto-select, layer choice, transform controls, six alignments and distribution | `essentials.png`; engine alignment tests; rotation/shear edge cases remain |
| Brush/Pencil | Size, hardness, mode, opacity, flow, spacing, pressure; square/round distinction | `brush-options.png`, `tool-flyout.png`; opacity/flow pixel tests |
| Selection | Four composition modes, feather, tolerance/contiguous controls | `selection-taskbar.png`; selection-coordinate and coverage tests |
| Crop/straighten | Drag extent, thirds overlay, Enter/Escape, horizon rotation | `crop.png`; source-preserving geometry tests; no perspective crop |
| Type | Direct canvas editing, family, size, faux styles, alignment, color; Character/Paragraph dialog | `type-dialog.png`; save/reopen text test; mixed styles unavailable |
| Free Transform | Scale/rotate handles, numeric dialog, flip, commit/cancel | `transform-dialog.png`; preserved-source reset tested; rotated nonuniform transforms tested with full affine geometry |
| Tool groups | Right-click/hold flyout; Shift-letter cycling | `tool-flyout.png`; tools/shortcuts enumerated in JSON |
| Layers | Real selection, reorder, duplicate/group/hide/lock/mask/blending operations | `mask-target.png`; functional tests and pixel tests |
| Properties | Pixel dimensions, position, scale, rotation, masks, shapes, adjustment values and filter stacks | Rendered control geometry; adjustments preserve pixels |
| Color/Swatches | Saturation/value square, hue slider, color chips and reusable swatches | `color-picker.png`; color inputs drive paint/type state |
| History | Named transactions, undo/redo, selectable entries, session snapshots | `history.png`; history tests pass; history is not saved in native files |
| Channels | Actual RGB/composite channel thumbnails | `channels.png`; RGB inspection plus named saved alpha selections; full channel editing incomplete |
| Paths | Polygonal work paths, draggable anchors, path-to-selection | Implemented; Bézier tangent editing and PSD work-path export unavailable |
| Layer masks | Grayscale coverage, linked/unlinked transforms, target border, Shift-click enable | `mask-target.png`; pixel-target and undo/redo tests pass |
| Adjustments | Fourteen editable types; see CS6 comparison for scope and algorithm limits | Native editable parameters and PSD subset; Photoshop algorithms approximate |
| Color Picker | New/current chips, color input, RGB/hex values, OK/Cancel and focus trap | `color-picker.png`; browser color selection test passes |
| New Document | Preset categories, saved/recent presets, dimensions/resolution, RGB/8, transparent/white | `new-document.png`; saved preset reload/create/delete checked |
| Image Size / Canvas Size | Dimensions, proportions/resolution or anchor, confirmation | `image-size.png`, `canvas-size.png`; crop/resize tests |
| Export | Real preview, format/quality, alpha/matte behavior and PSD loss report | `export.png`; PNG dimensions/alpha and PSD writer tests |
| Docked/collapsed/floating | Panel tabs can move groups, float, dock and resize; width drag and collapse | `floating-panels.png`, `collapsed-panels.png`; saved workspace tests |
| Contextual Task Bar | Selection/type/layer/transform/crop actions; drag, pin, hide, reset position | `selection-taskbar.png`; no generative services simulated |
| Menus | File, Edit, Image, Layer, Type, Select, Filter, View, Plugins, Window, Help | `layer-menu.png`; supported commands share SDK handlers; unsupported entries disabled |

## Per-control records

[`parity-inventory.json`](parity-inventory.json) records the internal menu hierarchy, disabled explanations, registered handlers, shortcuts, tool group membership and the rendered controls' positions, sizes, fonts, colors and enabled states. Commands refer to the matching shared registry handler; tool and option actions are implemented in `tools.tsx`, `CanvasView.tsx` and `index.tsx`. The captured state is explicitly identified rather than treating a disabled sample-layer control as globally unavailable.

Enabled conditions are checked dynamically: document commands require an open document; painting and destructive layer edits require an unlocked applicable target; mask creation requires no existing mask; group fill is disabled; merge requires selected root siblings; source reset requires an embedded layer; smart adjustments require an embedded source; undo/redo follow history. Numeric inputs, text editing and dialogs suppress single-letter tool shortcuts. Connected and advanced unimplemented features remain disabled with an explanation.

## Additional primary sources

- [Customize the toolbar](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/customize-the-toolbar.html) — tool grouping and organization.
- [Contextual Task Bar](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/boost-workflows-with-the-contextual-task-bar.html) — task-dependent actions and position behavior.
- [Nondestructive editing](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/non-destructive-editing-techniques.html) — editable sources and adjustments.
- [Layer opacity and blending](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/set-layer-opacity-and-blending-modes.html) and [blend descriptions](https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html) — fill/effects and group semantics.
- [Brush and Pencil](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html) — separate stroke opacity and deposition flow.
- [Layer masks](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/edit-and-refine-layer-masks.html) and [shortcuts](https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/view-keyboard-shortcuts.html) — targets and tool mappings.
- [Adobe PSD specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/) and [ag-psd](https://github.com/Agamnentzar/ag-psd) — structures and parser limitations.

Documentation supports the intended semantics and organization. Exact control silhouettes, all submenus, timing and numeric Photoshop output still require an authorized, fixed Windows build for verification.
