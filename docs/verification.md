# Verification — 12 November 2026

## Running services

- Desktop: http://127.0.0.1:5173/ — verified HTTP 200 and rendered in Chromium.
- Workspace API: http://127.0.0.1:4174/ — authenticated through Vite. Operations report `UNAVAILABLE` because this host has no Docker/Linux workspace.
- Browser worker: http://127.0.0.1:4175/ — gateway health reports ready, Chromium 157.0.8103.78, streaming false. The service owner started this worker; its streaming deployment remains separate.

## Checks completed

TypeScript and the Vite production build pass. Nine Node tests pass: authentication and ownership, HTTP/WebSocket restrictions, bounded terminal output/replay, real native PTY transport, filesystem worker conflict/atomic/binary behavior, calculator arithmetic, and document-change handling. The native transport and filesystem fixtures are tests; they do not substitute for a running Linux container.

`tests/shell/desktop.mjs` passed against the rendered local desktop with no JavaScript page errors. It verifies pointer dragging, minimize/Dock restore, maximize/restore, search, calculation, theme/wallpaper/transparency settings, keyboard menus, unsaved-document close guards, and persisted layout/preferences. It captures 1440×900, 1920×1080, and 390×844 views, plus overlapping windows and an open menu on the dark wallpaper.

`tests/shell/sdk.mjs` passed: Example Notes launches from its manifest and invokes a contextual menu command without shell changes; two editors keep independent close guards; keyboard window movement works.

Two additional app-owner integration tests passed in Chromium with the explicit contract-runtime fixture: Save As uses the shared dialog/atomic creation and survives reload; active commands follow separate editor windows and modal focus stays contained. These are mocked service-contract checks, not a claim of Docker/browser-transfer end-to-end acceptance.

## Interaction measurements

macOS arm64, headless Chromium, foreground page, device scale 1, 1440×900. Animation-frame intervals were sampled while automated input dragged a window and hovered Dock items. These numbers measure frame scheduling in this environment, not a physical-display GPU benchmark.

| Interaction | Samples | Median | 95th percentile | Frames over 33.4 ms |
| --- | ---: | ---: | ---: | ---: |
| Window drag | 124 | 16.7 ms | 16.8 ms | 0 |
| Dock hover | 114 | 16.7 ms | 16.7 ms | 0 |

Raw results are in `screenshots/verification.json`; the PNGs were visually inspected. Narrow mode shows one focused window and a horizontally scrollable Dock; application search remains available.

## Remaining limits

Real Files/Terminal/browser-transfer journeys need the isolated Linux workspace. Remote website pixels and input need Selkies streaming. Browser capability/runtime validation belongs to the browser owner. Cross-browser and real Safari acceptance have not been established by Agent 1's checks. Other conversations continue to own the application/service implementations, so later edits should rerun the relevant checks.

PerfectHue assets remain excluded pending app-bundling permission. The original Tidal wallpaper and its dark variant are shipped instead.
