# Agent 4 handoff

Lope Browser implementation is in `apps/web/src/apps/browser`, `packages/browser-client`, and `services/browser`. `docs/browser.md` is the operations/compatibility reference.

Shared integration is wired: registry consumes `browserApplication`, default Dock includes `lope.browser`, HTTP/HTTPS launch args are handled, seven menu groups register shared commands, shared dialogs manage focus, and file transfers use Agent 2's delivered `createBrowserFileBridge` with owner/session-bound staging callbacks. The canonical gateway path/port is `/api/browser` → 4175. Vite denies browser profile and credential files from HTTP and `/@fs` serving.

The previous screenshot-polling service/UI have been removed. Current rendering is an authenticated, same-origin Selkies core frame controlling top-level remote Chromium pages; no arbitrary website is framed. Engine state comes over private CDP pipes. Websites pass through a DNS-pinned public-web egress proxy, with OS-level network restrictions still required.

Local verification uses real sandboxed Chrome 157.0.8103.78 on macOS. The browser tests cover JS forms, Unicode input, storage/service workers/WebSockets, history/redirects/popups/opener identity, tab operations, files, VP8/WAV engine playback, PDF/find/scale, profile restore/clear, private cleanup, auth/origin/egress guards, proxy HTTP/WS credential stripping, and component interaction. The browser-specific TypeScript check and startup-script syntax checks pass.

The final browser suite passed **7/7**, with no skips; `services/browser/tests/verification.json` records the evidence. The repository build passed earlier in this session, before concurrent Writer/Image Editor work appeared; the latest whole-repository check is blocked by in-progress `apps/web/src/apps/writer` imports/types and a missing `apps/web/src/apps/image-editor/index` import. Browser-specific typechecking passes independently with `node node_modules/typescript/bin/tsc --noEmit -p services/browser/tsconfig.json`.

The Linux/Selkies vertical slice is not verified: this host has no Docker/Linux display stack. Infra files are delivered as unrun deployment examples. No actual external OAuth provider, remote audio/video/resize/IME/clipboard, hardware forwarding, production owner provisioning or accessibility-tree bridge is claimed complete. `services/browser/tests/streaming.acceptance.md` is the explicit release gate. Device APIs are denied and the UI offers Open in host browser.

Startup: `npm run dev:web` and `node services/browser/server.mjs`. The engine-only local worker explicitly reports unavailable interactive streaming; a static deployment cannot replace the Linux service. Profiles are separate from workspace storage, credentials are server-side, and no browser sandbox/TLS/web-security bypass is used.
