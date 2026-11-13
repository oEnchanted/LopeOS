# Application integration QA

This suite belongs to Agent 3. It tests the real shell, SDK, UI components,
runtime-client adapter, five application bodies, and executable application
template. The HTTP/WebSocket fixture in `contract-runtime-fixture.ts` is test-only;
it is not a production virtual filesystem or a substitute for Linux acceptance.

## Run reproducibly

From the repository root:

```sh
npx tsc --noEmit --project tests/integration/tsconfig.apps.json
npx vite build --config tests/integration/vite.qa.config.ts
npx playwright test --config tests/integration/playwright.config.ts
```

Install the Playwright versions of Chromium, Firefox, and WebKit when absent:

```sh
npx playwright install chromium firefox webkit
```

The QA Vite config uses a **test-only extension registration list**: it includes
the real SDK template and excludes unfinished sibling extensions such as Writer.
All core shell/application/service code is bundled from its actual source. This
lets application QA run while other owners edit unrelated app entry points.
`serve-preview.mjs` snapshots the bundle in memory at startup on loopback port
4176, so subsequent writes/HMR cannot change a test mid-run. This test server has
no production filesystem or runtime proxy.

Reports: `report/index.html`, `results/results.json`, and retained failure traces.
Viewport captures: `screenshots/`, named by dimensions, theme, engine, and app.
The screenshot cases cover 1440×900, 1920×1080, and 390×844 with bright/dark
wallpapers and several applications open. Screenshots use deterministic test
weather/files. `credit-metadata-fixture-*.png` uses synthetic approved metadata
and a one-pixel image, never actual PerfectHue artwork.

An alternate running preview can be selected with `LOPE_QA_URL`. Optional
`LOPE_QA_FIREFOX_PATH` and `LOPE_QA_WEBKIT_PATH` accept installed matching
executable paths. This session installed matching engines under
`/private/tmp/lopeos-agent3-browsers` to avoid changing the user's browser install.

## Real-runtime acceptance (opt-in)

Start the authenticated Vite proxy, Linux workspace, and Browser runtime first.
Use a dedicated QA workspace. The shell journey creates and cleans up one named
QA file; browser acceptance leaves the downloaded fixture in Downloads.

```sh
LOPE_QA_URL=http://127.0.0.1:5173 LOPE_E2E_RUNTIME=1 \
  npx playwright test -c tests/integration/playwright.config.ts live-runtime.spec.ts
```

Browser transfer additionally requires `LOPE_E2E_DOWNLOAD_URL`, a permitted
deterministic URL returning an attachment named `lope-download.txt` (override
with `LOPE_E2E_DOWNLOAD_NAME`). Configure the actual BrowserFileBridge. A test
fixture must not broaden the browser worker's network boundary.

These tests are skipped without those explicit prerequisites. A skipped live
test must never be counted as verified Docker, shell, browser streaming, or
browser-download acceptance. Playwright WebKit coverage is automated WebKit
engine coverage, not testing the installed Safari application.

## Scope and evidence

- `applications.spec.ts`: file operations, editor workflows/conflicts, Save As,
  calculator history, shared settings, weather/widget/cache, failure/retry,
  window operations, active menu commands, and modal focus.
- `accessibility.spec.ts`: keyboard-only search/launch/calculation/menu operation,
  visible focus, and external invalidation of an open Downloads view.
- `wallpaper.spec.ts`: personal image validation/metadata/persistence and visible
  lowercase credit placement with synthetic approved metadata.
- `template.spec.ts`: manifest registration, shared menus/dialogs/preferences,
  and filesystem access from the actual SDK example.
- `logic.spec.ts`: parser rejection/decimal precision, editor preservation, weather
  request deduplication/cooldown/backoff, and wallpaper approval policy. These
  execute in Node even when repeated under the three project configurations.

Accessible roles/names, focus trapping, and keyboard paths are automated checks.
This is not a screen-reader session or a WCAG conformance audit; VoiceOver and real
Safari still need manual verification. See `docs/application-qa.md` for final
results and `docs/agent-3-qa-findings.md` for reproducible owner handoffs.
