# Lightroom desktop reference inventory

Research date: November 12, 2026. Target: **Lightroom desktop 10.0**, Advanced workspace, dark theme, compact density, default desktop shortcuts. Lightroom Classic 16.0 is a separate application.

The user-supplied assignment defines the acceptance backlog. This inventory records independently checked public reference behavior; it does not claim that LopeOS has already implemented each feature. Implementation status belongs in the capability/parity matrix maintained with the application.

## Evidence and comparison limits

[Adobe's November release notes](https://helpx.adobe.com/lightroom/desktop/introduction/whats-new.html) and [workspace documentation](https://helpx.adobe.com/lightroom/desktop/introduction/customize-lightroom-workspace.html) were dated November 10, 2026 when inspected. Default, Advanced and Classic preset names are confirmed. A full installed application at verified platform/scaling was unavailable. Exact preset configuration, overall dimensions, and font measurements therefore remain unverified.

The two downloaded documentation images in `reference/` were inspected directly. `adobe-edit-histogram.jpg` is a 1920×1241 cropped editing example; it places histogram above the Edit/Auto/B&W/Profile/Light/Curve controls. Its broad neutral surround and narrow right controls inform the composition, but unknown scale prevents treating image pixels as CSS pixels. `adobe-customizable-workspace.jpg` is a 1200×675 stylized illustration and supplies icon hierarchy only. Neither image is a redistributable product asset; both stay outside `public/`.

Initial implementation dimensions must be marked provisional. A future screenshot comparison requires the same full viewport, zoom/UI scale, preset, panel state and selected image. Mask photographic content while evaluating chrome; compare rendered image data independently. No matched pixel-difference result is claimed here.

## Workflow inventory

| Surface | Reference behavior | Source and qualification |
| --- | --- | --- |
| Browsing | Photo Grid preserves aspect ratios; Square Grid presents regular cells. Selection leads into Detail and filmstrip inspection. | [Organization](https://helpx.adobe.com/lightroom/desktop/organize-photos/organize-photos.html), [editing](https://helpx.adobe.com/lightroom/desktop/edit-photos/edit-photos.html) |
| Source navigation | My Photos exposes Cloud and Local. Local accesses device photos without requiring cloud sync. | [Editing](https://helpx.adobe.com/lightroom/desktop/edit-photos/edit-photos.html). LopeOS managed browser storage must be described independently. |
| Detail/edit | A right tool track opens editing; histogram, Profile and grouped controls accompany the active photo. | [Editing](https://helpx.adobe.com/lightroom/desktop/edit-photos/edit-photos.html), inspected screenshot |
| Crop | Crop handles, aspect menu/lock, Straighten, guides, 90° rotation and flips; spacebar permits inspection while cropping. | [Crop and Geometry](https://helpx.adobe.com/lightroom/desktop/edit-photos/crop-rotate-geometry.html), Nov 10, 2026 |
| Masks | Named local adjustments; manual masks and real AI selections are separate tools. Refinements include additive/subtractive components. | [Masking](https://helpx.adobe.com/lightroom/desktop/edit-photos/masking.html), Nov 10, 2026 |
| Presets/profiles | Presets are grouped settings with temporary preview/favorites. Profiles alter the foundation while preserving visible slider values. | [Presets](https://helpx.adobe.com/lightroom/desktop/edit-photos/presets.html), [editing](https://helpx.adobe.com/lightroom/desktop/edit-photos/edit-photos.html) |
| Retouching | Clone copies source pixels; Heal adapts to surroundings; generative removal is a separate model-backed operation. | [Remove](https://helpx.adobe.com/lightroom/desktop/edit-photos/remove-tool.html), Oct 27, 2025; not evidence for newer model eligibility |
| Versions | Named local versions are in the 10.0 inventory. A version stores an independent edit state. | [Release notes](https://helpx.adobe.com/lightroom/desktop/introduction/whats-new.html). Automatic recovery is an additional LopeOS requirement. |
| Comparison | Side-by-side comparison exists, and Survey is specifically listed for November 10.0. | [Release notes](https://helpx.adobe.com/lightroom/desktop/introduction/whats-new.html). Exact Survey layout and synchronized zoom were not directly measured. |
| Import | File selection/review and direct Local editing are distinct paths. | [Add photos](https://helpx.adobe.com/lightroom/desktop/add-import-and-capture-photos/add-photos.html), Apr 24, 2025 |
| Export | Custom export controls include actual encoding choices and output settings. PNG is not listed by the inspected overview and must be a LopeOS extension. | [Export](https://helpx.adobe.com/lightroom/desktop/save-share-and-export/save-share-photos.html), Apr 24, 2025; verify newer eligibility before claiming parity |
| Search/organization | Albums, stacks, keywords, metadata, flags and ratings aid filtering. Color labels can be applied from context/footer/menu and used by smart albums. | [Organization](https://helpx.adobe.com/lightroom/desktop/organize-photos/organize-photos.html), [color labels](https://helpx.adobe.com/lightroom/desktop/organize-photos/color-labels.html) |
| Settings | Workspace theme/density/contrast, panel behavior, control layout, histogram/vectorscope, favorites and shortcut scheme are customizable. | [Workspace](https://helpx.adobe.com/lightroom/desktop/introduction/customize-lightroom-workspace.html). Exact preset defaults remain unverified. |

## Important control inventory

Ranges below are **LopeOS implementation targets from the assignment**, not independently measured Adobe 10.0 numeric bounds. Save all committed edits as recipes; slider drag preview should form one undo entry on commit. Numeric inputs must preserve normal typing shortcuts.

| Control | Location / enabled state | Input / initial state | Keyboard / resulting state | Persistence |
| --- | --- | --- | --- | --- |
| Photo/Square Grid | Bottom view toolbar; library available | Select layout; Photo Grid initially | `G`; changes library layout, keeps selection | Workspace preference |
| Detail/Edit | Bottom/right controls; selected decodable photo | Selected photo and current recipe | `D` Detail, `E` Edit | Selection/workspace; recipe unchanged |
| Exposure | Right Light group; editable selected photo | Target −5…+5 EV, 0 | Arrows/fine modifier/numeric entry; exposure multiplier | Recipe and undo |
| Contrast, Highlights, Shadows, Whites, Blacks | Right Light group | Target −100…100, 0 | Arrows/numeric; real tonal transform | Recipe and undo |
| Temperature/Tint | Right Color group | Relative target −100…100, 0 for decoded RGB; RAW domain must be labeled | Arrows/numeric; white balance | Recipe and undo |
| Vibrance/Saturation | Right Color group | Target −100…100, 0 | Arrows/numeric; chroma transform | Recipe and undo |
| Profile | Above Light; selected editable photo | Original LopeOS profiles, default neutral | Select; rendering basis changes without moving visible sliders | Recipe and undo |
| Auto | Right Edit header; current render available | No invented progress | `Shift+A`; calculate and expose changed sliders | Recipe and undo |
| Curve | Light group, after tonal sliders | Identity endpoints | Add/move/delete points; tonal mapping | Recipe and undo |
| Histogram/clipping | Above editing controls | Computed from current rendering; off initially | `J` clipping overlay; shows actual clipped pixels | View preference; never an edit |
| Crop/aspect | Right Crop tool; decodable selected photo | Full source bounds, unlocked | `C`; handles or numeric coordinates adjust geometry | Recipe and undo |
| Straighten/rotate/flips | Crop group | Target −45…45°, zero; 90° rotation; no flips | Numeric/buttons; transform photo and overlays consistently | Recipe and undo |
| Brush/linear/radial mask | Right mask tool; editable selected photo | Named component, source-relative coordinates | `B`/`L`/`R` desktop controls; paint/drag or numeric alternative | Recipe with mask components |
| Clone/Heal | Right retouch tool; editable selected photo | Separate operation kinds, explicit source | `H` healing; brush target/source | Recipe with immutable source |
| Ratings/flags | Footer/context; selection available | 0 stars, unflagged | `0`–`5`; `Z` pick, `U` unflag, `X` reject | Library metadata transaction |
| Keywords/Info | Right metadata tools; selection available | Original/imported metadata | `K` keywords, `I` info; updates active selection | Library metadata |
| Original comparison | View toolbar; selected photo | Current recipe active | `\\`; toggles original rendering without edit | Transient view state |
| Filmstrip | Bottom Detail region | Visible | `/`; toggles strip only | Workspace preference |
| Export | Top action / File menu; selected photos | Explicit supported encoder and destination | `Shift+E`; queue verified rendered outputs | Job state and output files |

Shortcut evidence: [Adobe desktop defaults](https://helpx.adobe.com/lightroom/desktop/using/keyboard-shortcuts.html), dated June 17, 2025. Browser-reserved combinations need visible alternatives. The default scheme must not silently substitute Classic pick/unflag keys.

## Current-release backlog to retain

The source assignment's matrix must retain November additions including Glow (Bloom/Halation/Diffusion), tethered capture, blemish cleanup, Open Eyes **Early Access**, Survey, grading in masks, generated depth masks, Favorites, vectorscope, Projection, and named Local versions. Their presence in Adobe does not establish an available LopeOS model/service. Semantic search, AI enhancement, HDR merge, panorama, generative expansion/prompt edits/video, sharing, camera-model/codec coverage and high-gamut output all need independently tested execution paths. Do not enable simulated success for missing providers.

## Licensed demonstration assets

Four unchanged JPEG originals are bundled under `public/photos/`, totaling approximately 1.87 MB. All were released into the public domain by Jon Sullivan according to their Wikimedia file pages. The Coast photo is the color-corrected public-domain Wikimedia revision by Dpalma01. Exact source URLs, dimensions, byte sizes and SHA-256 checksums are in `public/photos/credits.json`.

| Asset | Dimensions | Source |
| --- | --- | --- |
| `yosemite.jpg` | 1280×960 | [Yosemite Valley](https://commons.wikimedia.org/wiki/File:Yosemite_valley.jpg) |
| `painted-desert.jpg` | 700×525 | [Painted Desert](https://commons.wikimedia.org/wiki/File:Painted_Desert_2_700px.jpg) |
| `forest.jpg` | 2048×1536 | [Forest Habitat](https://commons.wikimedia.org/wiki/File:Forest_Habitat.jpg) |
| `big-sur.jpg` | 960×1280 | [Big Sur coastline](https://commons.wikimedia.org/wiki/File:Big_sur_ocean_coastlines.jpg) |

These are sample photographs, not private user imports, Adobe reference photographs, or desktop wallpaper credits. Their attribution should appear in help/credits; no attribution needs to be burned into rendered or exported photos.
