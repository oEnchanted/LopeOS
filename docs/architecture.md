# LopeOS architecture — shared contract 1.0

Agent 1 owns the shell, shared packages, root configuration, and integration. Other conversations are actively editing the app and service directories; preserve their ownership. The local desktop is at http://127.0.0.1:5173. Root package inputs and pnpm-lock.yaml are coordinated here.

`packages/contracts/src/index.ts` exports the versioned application contracts. `AppManifest` declares an ID, lazy component, size bounds, commands, menus, associations, protocols, and lifecycle. The shell's registry adapts the supplied manifests to stable `lope.*` IDs; `text-editor` maps to `lope.editor`. Application bodies render inside shared window chrome with an `AppContext`. SDK hooks are in `packages/sdk/src`.

`WindowState` persists bounds, restore bounds, stacking, state, application, and launch arguments. Closing removes one window; quitting removes the application's windows and running indicator. A before-close handler may resolve asynchronously to cancel either action. Window menu actions and keyboard accelerators use the same command registry. Application command registrations are scoped per window by the shell, so multiple documents can coexist.

Successful editor reads/writes update the window's persisted `restoreArgs.path`, independently of live launch arguments. This restores saved documents after reload without reloading an active draft while a save completes. Unsaved Text Editor drafts are protected by close guards during the session. Word and Image Editor additionally maintain their own browser-local recovery stores; those stores are separate from the shell’s saved-path restoration.

`SharedServices` includes files, terminal, browser, commands, settings, notifications, dialogs, URL opening, launches, and status registration. Runtime adapters come from `packages/runtime-client/src`; browser adapters come from `apps/web/src/apps/browser/service.ts`. Agent-owned richer runtime/browser contracts remain documented in `docs/runtime-contract.md` and `docs/browser-integration.md`. The adapter contract is version 1; service transport details remain owned by those agents.

Shared preferences use the typed, validated version 2 schema in `packages/contracts/src/preferences.ts` and one `PreferenceStore` in `packages/sdk/src/preferences.ts`. Settings, quick controls, shell, and SDK settings access share this store. Persistence is `lope.preferences.v2` in this browser; legacy `lope.<key>` values and `reducedTransparency` migrate. App preferences, histories, document restore pointers, and uploaded wallpaper have separate namespaces. Imports are validated and previewed, exports exclude credentials, and storage failures retain session-only values with an explicit status. See [the information map](settings-revision/data-map.md) for retention and deletion boundaries.

HTTP/HTTPS opening uses the registered browser default with `launchArgs.url`. File dialogs return workspace paths and never host paths. Write conflicts are represented by runtime errors with code `CONFLICT`; applications must offer reload/save-as instead of silently overwriting. File subscriptions invalidate relevant listings, including shell writes. Terminal retains opaque server sessions and uses authenticated WebSocket transport.

## Local integration

Vite listens on loopback port 5173. `/api` proxies to the runtime on 4174 and injects the private `.runtime/token` on HTTP and WebSocket handshakes. Browser routing follows Agent 4's gateway when available; a desktop start page remains usable without the Linux streaming backend. Credentials stay out of browser storage and logs.

Current runtime requires a Linux container; Docker is not present on this host. File and terminal integration can show honest unavailable states while the desktop, Settings, Calculator, and Weather run. Do not silently substitute an unrestricted host shell for that runtime.

## Wallpaper permissions

`shell/wallpapers.ts` is the wallpaper manifest. The project owner explicitly confirmed permission to bundle PerfectHue on November 12, 2026. Aurora Glass & Bubbles Light and Dark are original 3840×2160 PNGs served locally; see [asset provenance](settings-revision/wallpaper-credits.md). A one-time migration restores the temporary Tidal/After hours fallback to PerfectHue while preserving personal uploads and subsequent choices. Pending assets remain excluded. For an authorized active PerfectHue asset, the shell renders the exact lowercase `perfecthue` link at the bottom right, below app windows and clear of the Dock. Tidal/After hours are original LopeOS artwork and have no PerfectHue credit.
