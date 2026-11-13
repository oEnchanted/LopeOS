# Lope Browser worker

Requires Node 24+ and a maintained installed Chromium/Chrome. `node services/browser/server.mjs` starts the loopback development worker on port 4175 with an isolated normal profile in `.browser-data`. The Vite `/api/browser` proxy reads its private `.runtime/browser-token`; no bearer is sent to the frontend.

With no Selkies service, only engine control works and the UI explicitly reports that the interactive surface is unavailable. Chrome's sandbox and website security stay enabled. There is no screenshot-polling renderer. Local development is not a multi-user deployment.

For the streamed browser, build and run the Linux worker using `infra/`. See `docs/browser.md` for dependencies, exact streaming settings, transport, ownership, storage, network policy, test results, integration and known limitations.

`npm --prefix services/browser test` runs security/contract tests. To run real Chromium engine tests, set `LOPE_TEST_CHROMIUM=1`; on Linux set `CHROMIUM_EXECUTABLE` if needed. Tests never disable Chromium's sandbox. The Selkies media acceptance suite is separately opt-in and requires the Linux runtime.
