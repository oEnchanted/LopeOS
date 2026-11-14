# Threat model — general OS

## Actual security model

- **One trust domain for built-in apps.** Every app is a same-origin React component, loaded with `React.lazy` into the shell's JavaScript realm. There are no app iframes, no per-app origins and no message channels. Anything an app can do, any other same-origin script can do, including importing `fileService` directly or writing `localStorage`.
- The per-app **file access** and **app launch** toggles, and the window-scoped command registry, are **policy that keeps well-behaved apps in their lane**. They are not isolation against hostile code. `shell/filePolicy.ts` already says this. Real authority sits on the servers (runtime cookie/token authentication, account sessions).
- The only external-content frame is Lope Browser's same-origin Selkies surface. Remote websites run in remote Chromium and are never framed into the shell.

## Assets

User files (runtime workspace, LopeDrive), account credentials/session cookie and the E2EE vault key, preferences and layouts, clipboard history (memory only), notification and search history, personal wallpaper, cached releases (service worker), and optional local-AI model caches.

## Trust boundaries and threats considered

| Boundary | Threat | Status |
| --- | --- | --- |
| Persisted/synced state → shell | Damaged or hostile `lope.session.layout.v1`, histories or personal wallpaper crash the boot or inject CSS | Fixed (OS-01–03, OS-11) |
| App → shell services | Cross-window command execution, shell session commands, OS-impersonating notifications, stale contexts, launch and dialog storms | Fixed as policy (OS-06–10); same-origin bypass remains inherent |
| Network → boot | A failed chunk download blanks the desktop or leaves dead retry controls | Fixed (OS-04, OS-05) |
| Foreign site → LopeOS | Clickjacking/framing, missing HSTS, unrestricted feature delegation | **Open**: patch validated, not deployed (OS-16) |
| Injected script → shell | XSS without a script-src CSP | **Open**: report-only proposed (OS-17); no `dangerouslySetInnerHTML`/`innerHTML`/`eval` sinks in OS code |
| Browser → account server | CSRF, session fixation, brute force, cross-account blob access | Reviewed: exact Origin allowlist, `sec-fetch-site`, `SameSite=Lax`, `__Host-`/`Secure` in production, scrypt, timing-safe compare, per-IP and per-name limits, owner-scoped blobs. Residual: per-name lockout (OS-20) |
| Release server → service worker | Tampered or mismatched release assets | Reviewed: validated manifest, sha256-verified assets, explicit activation, `/api` never cached (unit tests pass) |

Not applicable: OS-level `postMessage` app channels (none exist). The only `postMessage` uses are the shell's own workers and the release service worker, all same-origin.
