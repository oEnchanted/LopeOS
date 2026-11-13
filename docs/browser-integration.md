# Browser integration handoff

Agent 4 owns the browser component, client, service, infrastructure and tests. No other agents are attached to this session, and the shared packages were empty when work began. This handoff publishes the interfaces immediately for Agent 1 and Agent 2.

The versioned types are in `packages/browser-client/src/contracts.ts`: `BrowserSession`, `BrowserTab`, `BrowserCommand`, `BrowserPermission`, `BrowserTransfer`, `BrowserFileBridge`, and `BrowserShellBridge`.

Agent 1: register exported `browserApplication` from `apps/web/src/apps/browser/index.ts`; app ID `lope.browser`; pin in the default Dock; register HTTP and HTTPS with the LopeOS URL service. The handler must call the mounted component's `onOpenUrl` callback; the setting only affects LopeOS. The application exports File, Edit, View, History, Bookmarks, Window and Help menu contributions. Pass shared UI adapters and the shell bridge to `BrowserApp`. Browser chrome is an app body, not a replacement window manager.

Agent 2: inject server-side `BrowserFileBridge`. `importDownload` is called only after Chromium finishes the file, with a private staging path. Return a workspace file ID for Show in Files. `materializeUpload` must authorize the selected file ID against the session owner, copy only that file to the supplied private staging directory and return its path. Browser profiles must never be mounted in the workspace. The browser worker requires verified ownership, a session-specific bearer credential from the authenticated gateway, and an independent Linux sandbox/network boundary per user/session. Never forward host authentication headers or mount the terminal runtime into the browser.

The client uses an injected authorized fetch function. The gateway must strip browser-facing cookies/headers before proxying to external services and authenticate both HTTP and WebSocket streaming. The streaming frame is the same-origin Selkies core, not a frame of the destination website. Chromium DevTools uses an anonymous local pipe and is never published.

The runtime will report unsupported capabilities rather than imply camera, microphone, location, notification or passkey forwarding. Workspace preview URLs must come from a scoped gateway owned by Agent 2; there is no blanket private-network exception.

## Implemented handoff

The shared interfaces arrived during implementation and are now wired. The shell consumes `browserApplication`, pins it by default and handles HTTP/HTTPS through launch args. Browser menus register commands in the shared registry; shared dialogs supply focus management. `src/files.mjs` wraps Agent 2's delivered `services/runtime/browser-bridge.js` with session validation and restricted staging callbacks.

The canonical development worker port is **4175**, with **`/api/browser`** taking precedence over the runtime's `/api` proxy. Both HTTP and WS upgrades read `.runtime/browser-token` server-side. `node services/browser/server.mjs` supplies a private local development credential. Production `src/main.mjs` requires the gateway-provided per-owner credential. Vite must deny `.runtime`, `.browser-data`, and `services/browser/.data` from static file serving, including `/@fs` access.

See `docs/browser.md` for exact implementation status. Real sandboxed Chrome engine and component tests pass; the Linux/Selkies media vertical slice, real device forwarding, accessibility-tree bridging and production owner provisioning are not complete. Do not present a configured media URL or passing headless tests as a tested streaming browser.
