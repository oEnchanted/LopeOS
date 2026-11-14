# Release report — general OS

## Decision: **NOT READY**

This covers the OS shell and shared platform at the tested snapshot (`ec4599f` plus the working tree at about 17:00 MST on 13 Nov 2026, plus this audit's changes). It is not a security certification, and app internals were not audited.

### Blockers

1. **OS-16 (High): production security headers are missing.** Live `lopeos.online` can be framed by any site and sends no CSP, HSTS, Permissions-Policy or COOP. A locally validated patch is ready (`patches/caddy-security-headers.patch`). It needs the runtime/deployment owner to apply and deploy it, followed by a check of the deployed response headers.
2. **Essential checks not yet run:** contrast over wallpapers, 200% zoom, screen reader, performance and leaks, multi-tab, and Firefox. These are recorded as UNVERIFIED in `coverage.csv`, not as passes.

### Fixed in this audit (15)

Desktop-bricking state corruption (OS-01–03), blank page on chunk failure (OS-04), dead app retry (OS-05), cross-window/shell command reach (OS-06), OS-impersonating notifications (OS-07), stale-window dialogs (OS-08), orphaned file-dialog promises (OS-09), unbounded windows (OS-10), wallpaper CSS beacon (OS-11), WebKit focus-trap escape (OS-12), Dock swallowing global shortcuts (OS-13), stacking mismatch (OS-14), and the manifest-driven credit link (OS-15). Each has a regression check that fails before the fix and passes after it in Chromium; all 16 checks pass in WebKit after the fixes.

### Residual (non-blocking)

OS-17 (CSP script-src is report-only until apps validate), OS-18 (release plugin masks build errors), OS-19 (apps share one trust domain by design), OS-20 (per-name sign-in lockout), OS-21 (focus-trap timing flake), OS-22 (possible dead "desktop items" toggle after a concurrent change).

New merges by other agents require re-running `tests/os-audit/os-regressions.mjs` (Chromium and WebKit) and the unit suite.
