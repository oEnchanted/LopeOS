# Agent 3 application integration handoff

Files, Text Editor, Settings, Weather, Calculator, and the SDK example are
implemented. The five app manifests are in `apps/web/src/apps/manifests.ts`.
Agent 1's registry consumes them. Every entry is a React component accepting
`{context: AppContext}`; the shell supplies shared window chrome, AppProvider,
scoped commands, file dialogs, preferences, and an application error boundary.

## Registry and commands

| App id | Entry | Menu command prefix |
| --- | --- | --- |
| lope.files | apps/web/src/apps/files/index.tsx | files.* |
| lope.editor | apps/web/src/apps/text-editor/index.tsx | editor.* |
| lope.settings | apps/web/src/apps/settings/index.tsx | settings.* |
| lope.weather | apps/web/src/apps/weather/index.tsx | weather.* |
| lope.calculator | apps/web/src/apps/calculator/index.tsx | calculator.* |
| example.notes | packages/app-template/src/ExampleApp.tsx | example.* |

The manifests publish File/Edit/View menus and file associations. Commands,
toolbars, and shortcuts call the same handlers. Command IDs are scoped per
window by the shell; enabled and checked states use current application state.
Files calls `services.openFile` and `services.launch('terminal',{cwd})`. Browser's
Show in Files may pass `{path:'/Downloads',select:fileId}` to a running Files
window; that launch argument change is handled and the file is selected.

## Filesystem

All production file access uses the injected FileService. Apps use list, stat,
read, optimistic write, rename, mkdir, remove, and subscriptions. Transfers use
`readBinary(path) -> {data:Uint8Array,version}` and
`writeBinary(path,bytes,{createOnly:true}) -> {version}`. The current runtime
adapter provides those optional contract methods. Save As never falls back to
an unsafe check-then-overwrite. Runtime errors retain `.code` and `.status`.
No application-owned production filesystem or canned weather has been added.

## Preferences and wallpaper

Canonical settings keys are `theme`, `accent`, `wallpaper`, `personalWallpaper`,
`dockSize`, `dockAutoHide`, `dockMagnification`, `reduceMotion`,
`reduceTransparency`, `increaseContrast`, `weather.location`, `weather.units`,
`defaults.browser`, and `defaults.text`. Editor view/session metadata and calculator
history also use the shared settings service. Object reads must retain identity
until the stored value changes (useSyncExternalStore requirement).

Settings consumes `apps/web/src/shell/wallpapers.ts`. PerfectHue entries require
`permission:'authorized'` and a valid HTTPS credit URL. Personal image metadata
includes asset data, original filename, creator label, and import time. No
PerfectHue asset is bundled. Preserve manifest `creditURL` in the desktop's
visible lowercase `perfecthue` link at bottom right.

## Weather widget

Mount `WeatherStatusBridge` once from
`apps/web/src/apps/weather/WeatherStatusBridge.tsx`. It subscribes to the same
WeatherStore used by the app and contributes a status item. Importing the bridge
from the app's index also works but eagerly includes the Weather UI; use the
standalone module to retain lazy UI loading. The Open-Meteo adapter caches and
deduplicates requests, applies cooldown/backoff, exposes offline/error states,
and requests geolocation only when the user chooses it. Commercial deployments
need a licensed server adapter and aggregate usage controls.

## Remaining owner actions and QA

See `agent-3-qa-findings.md` for reproducible shared UI/registry findings and the
reviewable WebKit Dialog patch. See `application-qa.md` for exact engine results,
screenshots, and unexecuted Linux/browser-transfer acceptance. The test runtime
and extension list under `tests/integration` are explicitly test-only. The QA
build uses the real core shell and apps while excluding unfinished sibling app
extensions. The example runs through its actual manifest without shell markup.
