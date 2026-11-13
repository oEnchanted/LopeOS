# Adding a LopeOS application

This is an executable source example, intentionally not pinned to the release
Dock. Register `exampleManifest` from `manifest.ts` in the shared application
registry to run it. The shell supplies its window, AppProvider, and error boundary.

1. Copy this **application directory**, give the manifest a unique reverse-domain
   id, and keep `contractVersion: 1`. Point `entry` to a dynamic import. Register
   the manifest once with Agent 1's registry; file associations and protocols
   belong there, never in another app's click handler.
2. Use `useApp` from `packages/sdk` for services and lifecycle. Import controls
   from `packages/ui`. Use its Toolbar, Sidebar, Button, Input, Select, and Dialog.
   Use shared file dialogs for workspace selection. Request a missing control in
   the shared package instead of implementing a second design system.
3. Contribute menu command IDs in the manifest and register their handlers with
   `useCommand`. Toolbar buttons and menus call the same function. Enabled state
   derives from selection, busy state, and draft validity; checked state derives
   from preferences. Commands must be scoped to the active window by the shell.
4. Use shared settings for preferences, including view options. Settings snapshots
   must retain object identity until a change. Use filesystem subscriptions to
   refresh shell and Browser changes. Treat subscription events as invalidations.
   Unsubscribe and invalidate outstanding requests on unmount.
5. Use optimistic version checks to save existing files. New files use atomic
   `writeBinary(...,{createOnly:true})` (or a future shared atomic create API).
   A conflict preserves the draft. Never silently replace a file. This example
   reports conflicts; the production Text Editor also offers explicit replacement,
   Save As, and a close guard.
6. Keep styles under your application class and use shared tokens such as
   `--surface`, `--text`, `--muted`, `--border`, `--accent`, and `--chrome`. Do not
   copy window markup, shell state, global CSS, or a filesystem implementation.
   Document and form surfaces use `--surface`; navigation uses `--chrome`.
7. Keep loading, empty, error, and success states explicit. Catch async errors in
   the application and preserve input. Render failures are isolated by the shell
   application boundary. A shared service failure must not crash the desktop.
8. Add integration journeys using accessible names. Check keyboard focus, narrow
   windows, dark/light appearance, reduced motion/transparency, and cleanup after
   the window closes. Test against the actual runtime before claiming integration.

The example demonstrates File/Edit/View menus, contextual commands, preferences,
filesystem access, request cleanup, forms, dialogs, and all four content states.
It intentionally does not persist an unsaved quick-note draft. Register a close
guard through `useBeforeClose` when your application holds unsaved work.
