# Application QA — November 12, 2026

> Import-error follow-up: the actual development desktop and Image Editor now
> load without a Vite overlay, and the regular `npm run build` passes. The Image
> Editor entry and stylesheet are now present and its registration is restored.
> Settings' missing stylesheet, browser capability guards, and weather cache
> action were fixed. `tests/shell/import-overlay.mjs` passed six checks against
> port 5173 with no JavaScript errors. The matrix below records the earlier frozen
> QA bundle; it is not a new regression run of the expanded Settings/Image Editor.


The five Agent 3 applications and the executable SDK template are implemented.
The scoped TypeScript check and production QA bundle pass. The final available-
engine matrix has **47 passing checks, 1 failing shared-UI check, and 4 skipped
live-runtime checks**. This includes 39 passing browser journeys/scenarios and
8 Node logic checks repeated under the two engine configurations.

| Engine | Browser checks passed | Node logic checks | Failed | Live-runtime skipped |
| --- | ---: | ---: | ---: | ---: |
| Chromium 158.0.8127.18 | 20 | 4 | 0 | 2 |
| Playwright WebKit 27.2 | 19 | 4 | 1 | 2 |
| Firefox 159 / build 1572 | 0 — launch unavailable | Not counted in final matrix | No page executed | Not executed |
| Installed Safari | Not tested | — | — | — |

WebKit is automated engine coverage, **not** a real Safari session. Firefox's
matching downloaded engine exits with `Could not find profile folder` before
page creation; a dedicated temporary profile root and the previously cached
Firefox build 1543 fail the same way. Evidence is retained in
`../tests/integration/firefox-launch.json`. No Firefox application result is
claimed.

## What was exercised

- Files: navigation/breadcrumbs, list/grid, folder creation, rename, move, binary
  upload and device download, information, confirmed deletion, shared invalidation.
- Text Editor: opening from Files, editing/save/Save As, version conflicts,
  undo/redo, literal replace, unsaved close guard, and saved-file restoration.
- Calculator: keyboard expressions, decimal precision, invalid arithmetic,
  history persistence/reuse, visible focus, and global shortcuts from the input.
- Settings: appearance/accent/accessibility across open applications, reload
  persistence, personal wallpaper validation/metadata, and unchanged wallpaper
  after an invalid import. Dock and default-app controls use shared preferences.
- Weather: a shared widget/app request, units and manual location, attribution,
  loading/failure/offline/cache state, request deduplication, cooldown, and backoff.
  A separate live smoke check successfully fetched and rendered real Open-Meteo
  conditions for Denver. Deterministic suite screenshots use provider fixtures.
- Shell integration: Dock launch, pointer move/resize, minimize/restore, keyboard
  window movement, active menus, and independent commands in two editors.
- SDK example: actual manifest/entry registration, contextual commands, shared
  dialog, preferences, and filesystem access. No shell/window markup is copied.

The contract suite runs real shell/application/client code with an explicitly
test-only HTTP/WebSocket runtime fixture. It does not execute bash or prove a
Linux or Browser download. A separate opt-in suite covers those real journeys.

## Screenshots and visual review

The 62-image screenshot set covers all five apps at 1440×900, 1920×1080, and 390×844,
with bright/dark backgrounds in Chromium and WebKit. Filenames identify the CSS
viewport, theme, engine, and application. WebKit retains its device scale of 2,
so its PNG pixel dimensions are twice the CSS viewport dimensions. Credit
captures use synthetic approved metadata and a one-pixel test image; no
PerfectHue artwork is included.

Representative captures:

| View | Screenshot |
| --- | --- |
| Files, bright 1920×1080 | [Chromium](../tests/integration/screenshots/1920x1080-light-chromium-files.png) |
| Settings, bright 1440×900 | [WebKit](../tests/integration/screenshots/1440x900-light-webkit-settings.png) |
| Weather, dark 390×844 | [WebKit](../tests/integration/screenshots/390x844-dark-webkit-weather.png) |
| Editor, dark 390×844 | [Chromium](../tests/integration/screenshots/390x844-dark-chromium-editor.png) |
| Calculator, dark 390×844 | [WebKit](../tests/integration/screenshots/390x844-dark-webkit-calculator.png) |
| Lowercase bottom-right credit | [Synthetic metadata fixture](../tests/integration/screenshots/credit-metadata-fixture-webkit.png) |

Representative captures were inspected for clipping, stable reading surfaces,
dark/light text, narrow controls, focus, and layering. The viewport tests check
for document-level horizontal overflow and uncaught page errors. App surfaces
use shared theme tokens. Weather attribution and last-updated time remain in
the visible footer. Disabled actions track current selection and busy state.

## Remaining gaps and owner handoff

1. **Shared Dialog / WebKit Tab containment fails.** WebKit can skip native
   buttons when tabbing, bypassing a trap that only handles the first/last DOM
   control. Chromium's equivalent passes. Reproduction and a reviewable patch
   are in [the owner handoff](agent-3-qa-findings.md) and
   [shared-dialog-webkit.patch](patches/shared-dialog-webkit.patch). The patch
   passes `git apply --check`; it has not been applied to Agent 1's package.
2. **Linux and browser-transfer acceptance is unexecuted.** This host has no
   Docker workspace. The full Terminal → Files → Editor → Terminal journey and
   Browser → Downloads journey require the real runtimes, BrowserFileBridge,
   and a deterministic allowed attachment endpoint. They are explicitly skipped.
3. **Firefox, real Safari, and assistive-technology sessions remain open.**
   Keyboard paths, accessible names/roles, and focus are automated. VoiceOver
   and other screen readers were not manually exercised. This is not a WCAG
   conformance certification.
4. **Shared palette/registry follow-ups remain.** Arbitrary custom accent
   foreground contrast and registry-based opening of unsupported/HTML files need
   the shared owners' completion. App content links and selected text now fall
   back to readable text tokens. Preserve manifest credit URLs in the shell.
   Actual PerfectHue assets remain excluded until redistribution permission.
5. **Workspace-wide build is affected by concurrent sibling work.** The final
   root TypeScript run reports Writer API/type errors and an Image Editor entry
   still being created. Agent 3's scoped check and isolated QA production bundle
   pass. The QA registration list includes the real SDK example and excludes
   those unfinished sibling extensions; it does not replace shell internals.
6. Shared filesystem connection status is not exposed to apps. Reads/mutations
   report disconnection and permit retry, but an idle open view cannot announce
   a disconnect immediately without a new invalidation/read.

## Evidence and reproduction

- [Machine-readable result summary](application-qa-results.json)
- Full retained report: `../tests/integration/report/index.html`
- Full final matrix JSON: `../tests/integration/final-results.json`
- Runtime fixtures, commands, and opt-in prerequisites:
  [integration README](../tests/integration/README.md)
- Application behavior and session semantics:
  [application-behavior.md](application-behavior.md)
- Future application instructions:
  [template README](../packages/app-template/README.md)

The last keyboard readiness/shortcut check passed in both available engines.
The extra visual pass passed all 12 cases and captures each application as the foreground window.
Later concurrent source changes require their owners to rerun the applicable
checks; these results describe the frozen production QA bundle used here.
