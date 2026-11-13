# LopeOS application SDK

Applications render content; the shell provides the title bar, window state, Dock, global menus, and focus management. Contracts live in `packages/contracts/src/index.ts`; React helpers live in `packages/sdk/src/index.tsx`.

## Add an application

Copy `packages/app-template`, give its manifest a unique ID, and add the exported manifest to `shell/extensions.ts`. A manifest declares `contractVersion:1`, a lazy `entry`, name, icon, description, minimum/default dimensions, optional menus, commands, associations, protocols, and lifecycle hooks. No shell component changes are required. The Example Notes manifest is already searchable in the development build and demonstrates this integration path.

```tsx
export const manifest: AppManifest = {
  contractVersion: 1,
  id: 'example.notes', name: 'Notes', icon: 'editor',
  description: 'A space for a thought.',
  entry: () => import('./Notes'),
  defaultSize: { width: 700, height: 520 },
  minSize: { width: 340, height: 320 },
  menus: [{ label: 'File', items: ['notes.save'] }],
};
```

The entry default-exports a React component accepting `{context: AppContext}`. `useApp()` reads the same context through the shell's AppProvider. Context supplies `windowId`, `launchArgs`, shared services, and lifecycle callbacks.

## Commands and lifecycle

Register namespaced commands using `useCommand` or `context.services.commands.register`, and unsubscribe on cleanup. The shell scopes registrations to each window automatically. Static application IDs such as `editor.save` are safe in multiple windows; the active window's registration handles its menus and shortcuts. `Mod+S` means Command on macOS or Control elsewhere. Editable controls and terminal control sequences keep their normal behavior.

Use `lifecycle.setTitle` for document titles. Register `onBeforeClose` (or `useBeforeClose`) to return a boolean or a promise resolving to one. Return false to preserve a dirty document. Close affects a window; quitting runs every close guard and then the manifest's `onQuit`. Remove event subscriptions, timers, and scoped commands in component cleanup.

## Shared services

- `files`: workspace paths, optimistic versions, atomic create and binary-transfer capabilities, invalidation subscriptions. Handle `CONFLICT` without discarding input. The runtime is responsible for enforcing paths and ownership.
- `terminal` and `browser`: compatibility adapters to the service owners' richer APIs. Browser transfers and streaming still depend on their runtime deployment.
- `settings`: stable cached snapshots and subscriptions. Keys are namespaced per app; shell appearance keys are documented in architecture.md.
- `dialogs.openFile` and `saveFile`: return a workspace path or null. Applications perform their own read/write and conflict checks.
- `openFile`, `openURL`, `launch`: open the registered app. HTTP/HTTPS defaults to `lope.browser`.
- `notify`: transient desktop messages. `statusItems.register`: menu-bar controls with cleanup.

The runtime adapter additionally supports structured error codes, binary transfers, and atomic create-only writes. Capabilities beyond text I/O are optional in the base contract so an application can clearly report an unavailable service instead of using an unsafe fallback.

## UI and testing

Use `packages/ui` and the shared CSS variables. All glass must follow the [LopeOS glass standard](design-system.md#materials): use `.glass` for outer surfaces and `.glass-inset` for nested tiles, or consume the `--glass-*` tokens from `packages/ui/src/glass.css`. Do not create app-specific glass tint, blur, reflection, or shadow recipes. Glass inherits the OS theme and accessibility fallbacks; `data-glass-tone="dark"` or `"light"` is available for deliberately themed surfaces. Keep reading/editing content opaque. Do not draw a second window title bar. Check keyboard access, dark appearance, narrow layouts, unavailable services, and unsaved changes. Use accessible labels; shell windows expose `data-window-id` and `data-app-id`. `tests/shell/desktop.mjs` verifies the shell in a real Chromium browser; runtime tests are separate from container acceptance tests.
