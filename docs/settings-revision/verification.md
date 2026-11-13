# Interface and Settings verification

Verified locally on November 12, 2026. The correct development application is **LopeOS** at `http://127.0.0.1:5173/`. An unrelated Portfolio Vite process previously occupied that port; only that identified process was stopped. LopeOS was started from this folder and its actual browser title, Dock, wallpaper, and Settings were inspected before reopening it.

## Delivered interface

- Neutral light and graphite dark materials, translucent window/sidebar chrome, fine glass rims, vivid window controls, and stable reading surfaces.
- Distinct original SVG application artwork with recognizable silhouettes, real icon variants and folder color, a refined floating Dock, compact menu bar, and clearer shared controls.
- Authorized PerfectHue **Aurora Glass & Bubbles** light/dark original PNGs, locally served. The exact lowercase `perfecthue` desktop credit links to the creator, clears all Dock positions/sizes, and disappears for original/uploaded artwork. [Provenance and authorization](wallpaper-credits.md).
- A functional Welcome launcher with plain copy; compact Settings with searchable navigation, grouped rows, live previews and 15 implemented categories. [Behavior and conditional features](supported-settings.md).
- One validated settings store with migrations, scoped persistence, import preview, safe reset and honest storage-failure status. Browser permission lifecycle, local capture Stop controls, app policies and data controls match [the inspected information map](data-map.md).

## Visual evidence

Captures use matching CSS viewport sizes, the original archived baseline build, and an immutable current production preview. Runtime HTTP requests are replaced with explicit unavailable responses for these screenshots; they do not demonstrate a working Linux container or browser video stream.

| View | Before | After |
|---|---|---|
| Desktop, 1440×900 | [Before](before-desktop-1440.png) | [After](after-desktop-1440.png) |
| Settings, 1440×900 | [Before](before-settings-1440.png) | [After](after-settings-1440.png) |
| Desktop, 1920×1080 | [Before](before-desktop-1920.png) | [After](after-desktop-1920.png) |
| Settings, 1920×1080 | [Before](before-settings-1920.png) | [After](after-settings-1920.png) |
| Dark appearance | — | [Dark](after-dark-1440.png), [Privacy](after-privacy-dark-1440.png) |
| Increased contrast / reduced transparency | — | [Capture](after-contrast-1440.png) |
| Narrow windows | — | [523 px Settings window](after-settings-small-window.png), [390 px viewport](after-settings-390.png), [720 px viewport](after-settings-720.png) |
| Actual 200% browser zoom | — | [Capture](after-browser-zoom-200.png) |
| Shared desktop surfaces | — | [Clear desktop](after-desktop-clear-1440.png), [quick controls](after-quick-controls.png), [search](after-search.png), [menus](after-menu.png), [notifications](after-notifications.png) |
| Preserved editor styles | — | [Writer](after-writer-scope.png), [Image Editor](after-image-editor-scope.png) |

Visual review found and fixed a production-only CSS issue: placing the prefixed backdrop declaration last allowed optimization to discard Chromium’s standard property. The prefixed form now precedes the standard form. The built-app test checks for actual computed blur, and refreshed screenshots show blurred overlapping windows instead of readable content leaking through chrome. The active window becomes opaque during pointer movement to bound compositing work.

## Behavior checks

**16/16 Settings checks passed**, with no skipped or flaky tests. [Machine report](test-results.json).

Coverage includes every category opening without permission prompts; search/navigation; validated import/reset and shared quick-control persistence; storage failure; unsupported APIs; denied capture; live synthetic camera track stop; pending location cancellation; screen-capture preview suppression; DND/history deletion; scaled Dock/window behavior; keyboard access to hidden chrome; file API policy; unsaved-work guards; legacy migration and credential rejection; approved wallpaper decode, attribution, upload persistence and right-Dock clearance.

**6/6 existing file/window regression checks passed.** [Report](file-window-regressions.json). Files creates, moves, renames, uploads, downloads, and deletes through the actual runtime-client adapter against a deterministic HTTP/WebSocket fixture. Text Editor opens/saves, handles undo/replace, rejects conflicting writes, preserves unsaved work and restores saved paths. Calculator history, pointer/keyboard window management, active menus, multiple editor windows, and modal focus also pass. The fixture was updated to return the runtime’s required identity handshake before opening file events; no product authentication was bypassed.

Writer and Image Editor were opened inside the shell. Computed font, color, background, and corner values in their internal toolbars/panels remained identical after changing the shell to dark appearance, a different accent and 150% shared text size. No page errors. [Exact protected surfaces](editor-scope.json). This is a shared-style isolation check, not a repeat of the editors’ full engine suites.

## Accessibility and browser coverage

Chromium 158 and WebKit 27.2 passed light/dark switching, keyboard menu access and 390 px layout checks with no page errors. [Browser/contrast report](accessibility.json), [desktop accessibility tree](accessibility-tree-desktop.txt), [390 px tree](accessibility-tree-390.txt).

Selected-label contrast is 4.71:1 with the default accent. Measured secondary text is at least 5.19:1 in light appearance and 6.59:1 in dark appearance. Measurements use computed foreground and alpha-composited ancestor fills; they exclude decorative gradients and do not certify every possible personal wallpaper/accent combination. Accent foreground adapts between light and dark ink.

Actual Chromium tab zoom was set to 2 using an isolated test extension/profile. The 1440×900 browser became a 720×450 CSS viewport with DPR 2; Settings was 702 px wide with the same scroll width. This was not simulated with CSS transforms. [Zoom report](browser-zoom.json). The small-window/390/720 checks also report no horizontal overflow in Settings. [Layout report](visual-verification.json).

ARIA snapshots, keyboard focus/navigation and contrast were checked. **Physical VoiceOver/NVDA speech output was not tested.** Firefox could not launch on this host (“Could not find profile folder”) with both default and explicit temporary profiles; Firefox support remains unverified rather than reported as passing.

## Performance and build limits

[Frame timings](performance.json) measure idle and repeated pointer drags at each effects setting. The [combined visual run](visual-verification.json) also exercises resize and Dock hover. These are headless animation-frame samples, not a physical-GPU benchmark or a 60 fps guarantee. Reduced motion, reduced transparency and lower effects remain available; hidden-page timers and capture cleanup are covered in implementation.

The final full **`npm run build` passed** (TypeScript and Vite). The application entry graph and shared packages also passed `npx tsc --noEmit -p tests/settings/tsconfig.scope.json`, and the standalone Vite bundle passed. Existing large editor-engine chunk and Weather import warnings remain. [Build record](build-verification.json). The live port was separately inspected in a real browser; [server verification](live-server.json) records its LopeOS title, active wallpaper, Settings heading, computed window blur and page errors.

The runtime API and Chromium worker are listening locally, but Docker is absent and Selkies streaming is not configured. Files/Terminal cannot be claimed to have a live Linux workspace, and remote browser media cannot be claimed to stream. Their unavailable states are shown honestly. Device chooser behavior and native notification delivery still depend on the user’s browser, hardware, and explicit consent.

Measured at 1440×900: idle median/p95 16.7/16.7 ms; high-effects drag 16.7/33.3 ms; balanced drag 16.7/16.8 ms; low-effects drag 16.7/16.7 ms. The combined drag/resize/Dock run had median 16.7 ms and p95 33.4 ms, so the report does not claim every interaction stays at 60 fps.
