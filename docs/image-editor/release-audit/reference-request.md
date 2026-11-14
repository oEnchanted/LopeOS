# Reference evidence required before identity certification

The retained project contract is **Photoshop CS6 Standard, Windows, English, dark Essentials**. The audit does not adopt the 28.0/macOS fallback because the project already names a target. The original product prompt is not independently preserved here; the recorded contract is in `../reference-inventory.md`, `../cs6-comparison.md`, and `../cs6-inventory.json`.

The archived [official CS6 manual](https://help.adobe.com/archive/en/photoshop/cs6/photoshop_reference.pdf) was downloaded from Adobe during this audit. Its February 2013 cover, 757 pages, and SHA-256 are recorded in `reference-manifest.json`. Printed page 34 covers the workspace, 41 panels and controls, 45–50 tools and pointers, and 170 layer-mask editing. The manual contains separately labelled Extended and Creative Cloud content, which does not silently become part of CS6 Standard.

Adobe's [current release notes](https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html) do identify November 2026 as version 28.0. They also name Relight, Quick Compare, Generative restyle, and updated Remove behavior. This confirms the fallback statement in the assignment; it does not change the established baseline.

The existing `../reference/adobe-workspace-2026.jpg` remains unmodified. The [current workspace documentation](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/workspace-overview.html) describes the application bar, options, tools, panels, and document area. Its image does not establish a CS6 build, Windows scale, typography, matched fixture, or reset panel configuration. It cannot support a valid overlay or a one-pixel verdict.

Supply captures or authorized interactive access with the following conditions recorded:

1. CS6 Standard exact version/build and Windows version; the language; the exact dark Interface theme swatch; UI font size; Windows display scaling; screen resolution; client-area bounds; display pixel ratio; GPU setting; workspace reset procedure; cursor preferences; tool-switch preference; ruler units; document profile; and document zoom.
2. A permission-cleared fixture shared with this editor: transparent pixels, nested groups, multiple blend modes, a raster mask and clipping stack, editable multiline Unicode type, shapes/paths, adjustments, effects, and embedded Smart Objects. Record the original file hash. Capture reset Essentials with that exact fixture and active layer/tool, scroll/pan, selection and panel state.
3. Every top-level menu and submenu in document and no-document conditions, plus active/inactive target cases. Open each tool flyout, options family, panel menu, context menu, preference, taskspace, and dialog. Include hover, keyboard focus, pressed, selected, disabled, expanded, loading, empty, success, and failed states when those exist.
4. Documented modal focus and return, Escape/Enter, numeric validation/scrubbing, gesture cancellation, masks, transformations, docking, workspace persistence, and text editing. Still captures cannot establish these behaviors alone; include interaction recordings or allow authorized testing.
5. Same-fixture captures at the chosen reference client size. At 1440×900, 1920×1080, and the supported 740×500 minimum, observe reference resize behavior. Do not stretch the reference to create a nominal match. Browser runs must record actual effective CSS dimensions at 100%, 125%, and 200% zoom separately from DPR.
6. Adobe-side reopen of exported layered PSD, with the supported layers, mask targets, text, blends, opacity/fill, alpha, dimensions, profile, and appearance checked. A native `.lopeimage` reopen or reusing the same PSD writer/reader cannot establish independent Adobe interoperability.

Until this evidence exists, paired Adobe/implementation screenshots, 50% overlays, difference images, exact anchors, and font measurements remain **UNVERIFIED**. No masks/exclusions have been invented for missing or defective UI. The provided implementation captures can support behavior and layout inspection only.

The task also requires both Photoshop and Lightroom/shared-UI audit owners to validate one final integrated build. A private app fixture does not establish native workspace permissions, real shell menu focus, a deployed runtime, or the other owner's sign-off.

## Inventory provenance

Run `node tests/image-editor/release-inventory.mjs` from the repository root to regenerate `ui-inventory.csv` and `inventory-summary.json` from the current sources. The script reads the current menu model and JSX declarations; it carries forward the 120 known command IDs and 125 historical feature families and records the current source hashes. It uses Node's TypeScript stripping and the installed Vite React plugin's Babel parser. The run in this audit used Node 26.12.1, `@babel/parser` 7.29.14, and `@vitejs/plugin-react` 6.3.0. It does not run a browser or declare functional passes.

The inventory separates known missing/partial features (`FAIL`) from unknown reference behavior (`UNVERIFIED`). `NOT_APPLICABLE` is reserved for CS6 Extended and post-CS6 scope determinations. Shipped modern extensions also have separate functional rows, so their availability is not excused by being outside the historical target. Source controls with dynamic labels keep their expression in the inventory; they are not claimed as labels observed in a browser.

The existing 125-family comparison explicitly says it is not exhaustive. This new source inventory enumerates known implementation surfaces and preserves required unknowns; it cannot claim a complete inventory of every absent Adobe command or preference without reference access. The release report must retain this limitation and must not turn historical results into passes on the final build.
