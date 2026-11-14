# Verification — general OS audit

Host: macOS (Darwin 27.2, arm64), Node 26.12.1, pnpm 10.32.1, Playwright 1.65.0 with Chromium 158.0.8127.18 (headless) and WebKit 27.2 (Playwright build 2388). ASVS reference: OWASP ASVS 5.0.0, used by chapter. Requirement IDs were **not** re-verified against the source document in this session, so none are quoted.

## Builds

| Command | Start of audit | End of audit |
| --- | --- | --- |
| `npx tsc --noEmit` | FAIL (`movie-maker/index.tsx:123`, `spreadsheet/index.tsx:73`, active app work) | PASS |
| `npx vite build` (full) | FAIL (same; the real error was masked by the release plugin's ENOENT, OS-18) | PASS (scratch outDir) |
| `npx vite build -c tests/os-audit/vite.os.config.ts` | PASS | PASS |

## Unit suite (`test:unit` file set)

Baseline: 265 tests, 260 pass, 0 fail, 5 skipped. End: 287 tests (other agents added some), 281 pass, 0 fail, 6 skipped (live Linux/gVisor).

## OS regression suite

```sh
LOPE_AUDIT_OUT=<dir> npx vite build -c tests/os-audit/vite.os.config.ts
LOPE_AUDIT_BUILD=<dir> LOPE_AUDIT_PORT=4191 node tests/os-audit/serve.mjs                       # plain
LOPE_AUDIT_BUILD=<dir> LOPE_AUDIT_PORT=4192 LOPE_AUDIT_HEADERS=1 node tests/os-audit/serve.mjs  # proposed headers
LOPE_AUDIT_URL=http://127.0.0.1:4191 LOPE_AUDIT_BROWSER=chromium|webkit node tests/os-audit/os-regressions.mjs
LOPE_AUDIT_URL=http://127.0.0.1:4192 node tests/os-audit/headers-browser.mjs
```

| Run | Result | Evidence |
| --- | --- | --- |
| Chromium, baseline build | 4 pass / 10 fail; kbd-01 fails separately | `evidence/os-regressions-chromium-baseline.json`, `-baseline-kbd.json` |
| Chromium, fixed build | **16 / 16** | `evidence/os-regressions-chromium-fixed.json` |
| WebKit, fixed build | **16 / 16** | `evidence/os-regressions-webkit-fixed.json` |
| Chromium, fixed build + proposed headers | 15 / 16 (a11y-02 timing flake; passed 2 of 2 reruns), earlier full run 16 / 16 | `evidence/os-regressions-chromium-headers.json` |
| WebKit, baseline build | **Inconclusive**: navigations to the baseline server never fired `load` in WebKit (cause not determined) | `evidence/os-regressions-webkit-baseline.json` |
| Firefox | **Not tested**: Playwright Firefox 1572 (and cached 1543) exits with "Could not find profile folder" on this host, also outside the command sandbox | — |

Fault injection uses real `503 no-store` responses from the audit server. Playwright `route.abort` was rejected for this purpose because WebKit caches inspector-blocked loads per page, and the stale WebKit build 2359 also failed to refetch. Both were harness artifacts.

## Header validation (Chromium)

Proposed enforced CSP plus report-only CSP plus HSTS, X-Frame-Options, Permissions-Policy, COOP and CORP: the desktop boots; Weather, Files, Lope Browser and the Settings panes open; there are no page errors and no Permissions-Policy warnings. A foreign-origin iframe is refused (`frame-ancestors 'self'`). The only report-only report was that framing probe. Two script steps failed (Spotlight after launching Lope Browser, and Control Center toggle labels). Both also fail without headers and remain to be investigated; they are not header regressions. Third-party requests in this run were answered with synthetic data, and the only one observed was `api.open-meteo.com` (weather status item).

## Production check (read-only)

`curl -I https://lopeos.online/` and `/lope-sw.js` at 2026-11-13 23:30 UTC returned only `x-content-type-options: nosniff` and `referrer-policy: strict-origin-when-cross-origin`.

## Not performed

Deployment, contrast measurement over wallpapers, 200% zoom, screen-reader checks, performance/leak measurement, multi-tab/profile concurrency, offline service-worker update in a real browser (unit-tested only), and live runtime/browser streaming (no Docker/Linux on this host).
