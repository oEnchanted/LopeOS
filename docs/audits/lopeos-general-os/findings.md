# Findings — general OS

Severity is the impact on LopeOS users (security impact in brackets). Reproduction = check ID in `tests/os-audit/os-regressions.mjs`; each check asserts the correct behaviour. Chromium before/after: `evidence/os-regressions-chromium-baseline.json` (4 pass, 10 fail; kbd-01 recorded separately) → `evidence/os-regressions-chromium-fixed.json` (16 pass). WebKit after: 16 pass.

## Repaired

| ID | Surface | Defect (before) | Fix | Check |
| --- | --- | --- | --- | --- |
| OS-01 | Session restore | A restored window with a non-string title (or other malformed fields) blanked the whole desktop on every boot (React #31). Account sync only checks that the layout is an array, so one bad record propagated to every device. **High** | `restoredWindow()` rebuilds each record: unique safe id, string title, valid state, bounded stacking, plain-object args | state-01 |
| OS-02 | Dock / launch | Non-array `lope.history.recentApps.v1` crashed the Dock during render (blank desktop). **High** | `readHistory` returns the fallback when the stored shape differs | state-02 |
| OS-03 | Notification centre | Malformed history entries crashed the shell when Notifications opened. **Medium** | History entries require string title and message | state-03 |
| OS-04 | Boot | A failed `Shell` chunk download left a blank white page with no way out. **Medium** | `BootBoundary` in `main.tsx`: readable alert with Reload and "Reset window layout and reload" (documents and settings kept) | life-02 |
| OS-05 | App lifecycle | "Try again" after an app chunk failed was a dead control (rejected `React.lazy` is cached). WebKit also keeps the failed module for the document's lifetime. **Medium** | Retry recreates the lazy entry and remounts. Download failures also offer "Reload LopeOS", which runs every unsaved-changes guard first | life-01 |
| OS-06 | Command registry | An app's scoped `commands.get/execute` fell through to the global registry, so it could run other windows' commands and `shell.signOut`/`shell.close`/`shell.quit`. **Medium** [policy] | Scoped registry resolves only its own window's commands (no app relied on the fallthrough) | app-01 |
| OS-07 | Notifications | Toasts showed the LopeOS mark and no sender, so an app could post "LopeOS Security: re-enter your password". **Medium** [UI spoofing] | Toasts and history name the sending app with its icon | app-05 |
| OS-08 | App lifecycle | A closed window's retained context could still open an OS file dialog and register commands. **Low** | Context is marked dead on unmount; dialogs reject and registration is ignored | app-06 |
| OS-09 | File dialogs | A second `openFile`/`saveFile` replaced the open dialog, leaving the first caller's promise pending forever (a stuck Save). **Medium** | Single-flight broker rejects the second request with a clear error | (code review) |
| OS-10 | Window manager | No limit on windows: one app looping `launch()` opened 200 editor windows. **Medium** [availability] | Cap of 32 windows (including ⌘N) with a throttled notice | app-04 |
| OS-11 | Wallpaper | A persisted or synced personal wallpaper `data:` URL could add `url()` layers that fetch remote hosts (beacon). **Low** [privacy] | Only plain base64 raster data URLs reach CSS | state-04 |
| OS-12 | Spotlight, file dialog | The focus trap only wrapped at the edges; in WebKit the first Tab left Spotlight. **Medium** [a11y] | Every Tab moves focus explicitly (`SearchPanel.tsx`, shell trap) | a11y-01, a11y-02 |
| OS-13 | Dock | The Dock's key handler stopped propagation of every key, so ⌘/Ctrl K, ⌘W and Alt+F10 did nothing after launching an app from the Dock. **Medium** | Only Dock navigation keys are consumed | kbd-01 |
| OS-14 | Session restore | Equal restored stacking made the menu bar's active app differ from the window painted on top. **Low** | Stable stacking renumbering on restore | state-01 |
| OS-15 | Wallpaper credit | Credit link hard-coded instead of using the manifest `creditURL` (same URL today). **Low** | Uses `wallpaper.creditURL`; credit verified visible and topmost at bottom right | ui-01 |

## Open

| ID | Surface | Issue | Severity | Owner / blocker |
| --- | --- | --- | --- | --- |
| OS-16 | Hosting headers | **Live `https://lopeos.online` sends no CSP, frame-ancestors/X-Frame-Options, HSTS, Permissions-Policy or COOP** (curl, 13 Nov 2026 23:30 UTC). The site can be framed by any origin. Patch: `patches/caddy-security-headers.patch`. Validated locally: framing blocked, no page errors, suite 16/16 under the headers. | **High** | Runtime/deployment owner must apply and deploy (coordination rule for header config); then verify headers on the deployed site |
| OS-17 | CSP | The script/connect/img policy is proposed as **Report-Only**. OS flows produced zero violations, but app flows (Image Editor ONNX runtime from jsdelivr, Writer/SuperDoc PDF worker on cdnjs, Lightroom codecs, Movie Maker) are unvalidated. Report-only is not an enforced control. | Medium | App owners validate under report-only, then promote to enforced |
| OS-18 | Build tooling | `scripts/release-plugin.ts` `closeBundle` throws ENOENT when bundling failed, masking the real compile error (seen at baseline) | Low | OS owner (file dirty with another agent's change; not edited) |
| OS-19 | App isolation | Built-in apps share the shell's trust domain; app permission toggles are policy only | Info | Document in Settings/SDK; real isolation would need per-app origins/iframes |
| OS-20 | Accounts | The per-account-name sign-in limit (15 per 15 min) lets anyone temporarily lock a named account out of sign-in | Low | Accounts owner (trade-off; consider a soft delay plus per-IP limit) |
| OS-21 | Focus trap | A Tab pressed within milliseconds of the file dialog mounting can escape it (the key listener re-registers after commit). Flaky 1 of 3 runs. | Low | OS owner |
| OS-22 | Desktop | A concurrent 16:57 change removed the desktop icons; Settings' "desktop items" toggle may now be a dead control | Low | Owner of that change |

## App handoffs (not fixed here)

- **Image Editor**: portrait AI loads ONNX Runtime modules from `cdn.jsdelivr.net` (sha256-pinned, good). An enforced `script-src` needs self-hosting or `blob:`; verify under the report-only policy.
- **Writer**: SuperDoc telemetry is explicitly disabled in the bundle (`telemetry:{enabled:false}`), confirmed. The bundled PdfViewer references a cdnjs pdf.js worker; confirm it is unreachable or self-host it before enforcing CSP.
- **Deployment owner**: after applying OS-16, run `node --test tests/updates/caddy-template.test.mjs` and re-run `curl -I https://lopeos.online/`.
