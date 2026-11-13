# Agent 3 QA findings for shared owners

## Addressed during application integration

- Stable settings snapshots: calculator history caused repeated renders/unmounts;
  shared parsed-value cache fixes useSyncExternalStore identity.
- Commands: shared registry now scopes each window's commands and menus/shortcuts
  resolve the active window. The two-editor integration test passes in Chromium.
- Shared Dialog/Select/EmptyState/Input ref support now exist and build succeeds.
- Files binary upload/download and atomic Save As now use Agent 2's adapter.
- Personal wallpapers, Dock preferences, accent settings, and the weather bridge
  have been connected to Shell.
- Agent 3 fixed Files dialog key propagation, editor saved-path restoration,
  Browser Show in Files path/selection, and calculator native text editing.

## Remaining shared checks / requests

1. Dark accent contrast: Shell's inline `--accent: #167bac` overrides the shared
   dark palette's `#79c8ed`. Open Weather in dark appearance: its attribution,
   forecast precipitation, and selected controls use dark blue on dark surfaces.
   Please provide semantic `--accent-text` (readable on surfaces) and
   `--on-accent` (readable on accent fills), including arbitrary custom colors.
   Shared primary buttons still have hardcoded blue gradients. Agent 3 will use
   the semantic foreground tokens when available. Contrast must be measured
   before claiming WCAG conformance.
2. Shell `openFile` initially dispatched every file to defaults.text. Please use
   registry associations and reject unsupported types clearly. HTML/link opening
   needs Agent 4's scoped preview URL support; do not pass arbitrary host paths.
3. PerfectHue credit currently hardcodes `https://perfecthue.com/wallpapers/`.
   Preserve manifest `creditURL` (or sourceURL) in the visible lowercase link.
   No actual PerfectHue asset is approved or bundled; credit rendering can only
   be tested using explicitly labelled synthetic metadata until permission.
4. Full-runtime integration cannot execute on this host without Docker and a
   running Linux workspace. Browser downloads additionally need BrowserFileBridge
   and an allowed deterministic attachment endpoint. Agent 3's live tests are
   explicitly skipped by default, and contract fixtures are test-only.
5. FileService currently exposes no connection-status subscription. Existing
   views report failures on reads/mutations/retry, but cannot immediately show a
   runtime disconnection unless invalidation/read occurs. Expose shared status if
   an immediate persistent desktop warning is required.
6. Avoid statically importing Weather's default UI in Shell just for the bridge;
   a separate bridge module keeps the Weather application entry lazy.
7. **WebKit focus trap fails**: run
   `npx playwright test -c tests/integration/playwright.config.ts --project=webkit -g 'active menus'`.
   Open Files → New folder, focus Name, then press Tab repeatedly. WebKit's native
   Tab behavior can skip buttons and move focus outside the dialog. Shared Dialog
   currently only traps when focus is at the first/last DOM control. Handle every
   Tab explicitly: preventDefault, determine the active index among enabled
   controls, and focus the next/previous control modulo the list length. This
   preserves the same order regardless of Safari's native button-tabbing setting.
   Chromium passes the current trap; WebKit exposes this shared UI gap.

Reproduce application/visual journeys with
`npx tsc -p tests/integration/tsconfig.apps.json && npx vite build --config tests/integration/vite.qa.config.ts && npx playwright test -c tests/integration/playwright.config.ts`.
The runner snapshots the production bundle in memory to avoid edits/HMR affecting
ongoing QA. Traces and screenshots are under tests/integration/results; the
curated viewport captures are under tests/integration/screenshots.

A final root TypeScript check is separately recorded in `tests/integration/workspace-typecheck.log`; its failures are in concurrent Writer/Image Editor work. The Agent 3 scoped check and isolated production QA bundle pass. The full available-engine matrix is 47 passing, one shared WebKit modal-focus failure, and four live-runtime skips. Firefox could not open a profile; see `tests/integration/firefox-launch.json`.
