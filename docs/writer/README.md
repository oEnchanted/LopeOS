# LopeOS Writer

Open **Writer** from LopeOS's application launcher, or open a `.docx` from Files. The shell supplies the outer glass window; Writer supplies the opaque, light classic ribbon and document workspace.

## Preferences

Open the gear in Writer, **Writer > Preferences…**, **File > Options**, or **Ctrl/⌘ ,**. The searchable category window follows the LopeOS system theme, including changes made while it is open. Supported settings persist through the SDK and apply without replacing the document or undo history. Settings that require unavailable services have disabled controls and availability reasons.

Preferences uses a compact 800×600 utility layout with readable theme colors, smaller icons and type, and a single close button. All categories fit at normal text size; larger text and smaller windows retain scrolling and keyboard access.

The interface includes ribbon, menu, pane, dialog and Preferences transitions. Reduced motion in LopeOS or on the device overrides application animations.

## Install and verify

```sh
npm ci --prefix packages/document-engine --ignore-scripts
npm run dev:web
```

In another terminal:

```sh
npm run build
node --test tests/writer/package.test.ts
npx playwright test -c tests/writer/playwright.config.ts
node tests/writer/capture.mjs
node tests/writer/preferences-capture.mjs
```

For an isolated regression session during parallel workspace edits, start `npx vite --config tests/writer/vite.config.ts` and run `WRITER_TEST_URL=http://127.0.0.1:5183 npx playwright test -c tests/writer/playwright.config.ts`. This uses a separate dependency cache and disables test-page hot reload.

By default, the browser tests expect the existing Vite server at `http://127.0.0.1:5173`. Their test-only host and binary filesystem contract never enter the production bundle. Actual workspace files require the LopeOS runtime; an unavailable runtime produces a visible error while the document remains open. The shared service currently limits transfers to 8 MiB.

- [Reference baseline](reference-baseline.md)
- [Architecture and licensing](architecture-decision.md)
- [Command inventory and coverage](feature-inventory.md)
- [Microsoft Word feature audit and gaps](word-feature-audit.md)
- [Verification and remaining limitations](parity-report.md)
- [Side-by-side and overlay comparison](visual-comparison.html)
- [Sample three-page PDF](sample-output.pdf)
- [Machine-readable verification](verification.json)

Fixtures in `tests/writer/fixtures` are original, generated OOXML documents. `generate.mjs` rebuilds the source fixtures. Round-trip fixtures are produced by the browser suite. No Windows Word installation was used for the implementation.
