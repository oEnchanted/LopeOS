# LopeOS application behavior

The five apps consume the shell's contracts, SDK, UI controls, settings, file
dialogs, application registry, and runtime filesystem. Application manifests live
in `apps/web/src/apps/manifests.ts`; the shared registry adapts their IDs. There
is no application-owned production filesystem.

## Files

Home maps to the Linux workspace root `/home/lope`; `/Documents` and `/Downloads`
use the same persistent volume as Terminal. List and grid, breadcrumbs, folder
history, name/date/size sorting, search, multi-selection (Shift/Command/Control),
keyboard navigation, create, rename, move, delete, upload, download, and information
all use the injected FileService. Uploads are create-only and limited to 8 MB by
the shared transfer service. Conflicts leave existing contents intact. Deletion
requires confirmation and is permanent. Move reports partial failures and reloads
the directory; successful earlier items remain moved.

File opening belongs to the shell registry. “Open in Terminal” passes a workspace
directory as `cwd`. Browser's “Show in Files” may pass `path` and `select`, including
to an existing Files window. Files refreshes on shared filesystem invalidations.
Download to the user's device uses a temporary Blob URL, revoked after use.

## Text Editor

Text is decoded as UTF-8 through the shared filesystem. Existing-file saves use
the version read with the document. Save As uses atomic create-only writes and
an explicit replace dialog for an existing destination; replacements retain
optimistic checks. Conflicts preserve the local document, report the change, and
offer Reload or Save As. A clean open file refreshes after external writes;
dirty files retain their edits. Deleted files offer Save As.

Undo/redo is limited to 200 snapshots. Find wraps and supports case sensitivity;
replace treats both query and replacement literally. The dirty indicator is based
on exact comparison with the last acknowledged save. Toolbar, menus, and keyboard
shortcuts share action handlers. The shared close lifecycle supports Save,
Discard, or Cancel; the browser also receives an unsaved-work beforeunload guard.

The shell persists its window layout. Each editor stores only the current saved
file path in the shared settings under its window ID, and rereads that file after
reload. Unsaved document contents, selections, find state, and undo history are
not restored. New untitled documents restore blank. Missing files show an error.
No unsaved work is claimed to be crash-safe.

## Settings and wallpaper

Preferences apply immediately through the shared SettingsService. Appearance,
accent, wallpapers, Dock size/hide/magnify, reduced motion/transparency, contrast,
weather location/units, and application defaults use the same persistent store.
Defaults govern LopeOS links/files. Only installed handlers are selectable.

Wallpaper entries come from Agent 1's manifest. Pending assets are never displayed
or downloaded by the picker. PerfectHue requires explicit `authorized` permission
and a valid HTTPS PerfectHue credit URL; the shell displays lowercase `perfecthue`
at desktop bottom right. The original LopeOS wallpapers are the only bundled
collection at delivery. No PerfectHue wallpaper was downloaded or redistributed.
Creator/source metadata is preserved. Personal JPEG/PNG/WebP/AVIF files up to 2 MB
are validated, stored in the shared preferences, and retain filename/import time.

## Weather

The provider adapter implements Open-Meteo current model conditions and a five-day
forecast with city/postal-code geocoding. The shared WeatherStore supplies both
the app and the menu-bar widget, deduplicates pending requests, caches by
coordinates/units for 15 minutes, and enforces cooldown/exponential error backoff.
It makes no automatic geolocation request. “Use my location” is a deliberate
action; manual selection remains available if access is declined.

Cache is memory-only, so stale conditions can remain visible after a network
failure during a session; a new offline page load shows an unavailable state.
Cached data is explicitly labelled and includes its last update time. Loading,
provider failure, offline state, attribution, Celsius/Fahrenheit, humidity,
wind, and apparent temperature are represented. Requests have a 12-second timeout.

Open-Meteo's public endpoint is configured for this noncommercial developer
preview. Commercial distribution requires a licensed server adapter, including
deployment-wide usage control. API keys must remain on that server. Client
cooldowns alone do not enforce a deployment's aggregate plan limits.

Sources checked November 12, 2026: [Forecast API](https://open-meteo.com/en/docs),
[Geocoding](https://open-meteo.com/en/docs/geocoding-api),
[Open-Meteo terms](https://open-meteo.com/en/terms),
[PerfectHue licensing](https://perfecthue.com/wallpapers/licensing/).
Weather attribution links to Open-Meteo and CC BY 4.0; search credits GeoNames.

## Calculator

A bounded recursive-descent parser evaluates numbers, parentheses, unary signs,
addition, subtraction, multiplication, division, and postfix percent. It does not
execute JavaScript. Decimal input is represented as exact BigInt fractions during
arithmetic; the display rounds to 15 significant digits. Percent means division
by 100. Division by zero, invalid tokens, excessive length/nesting, and out-of-range
exponents report errors. The last 40 successful calculations persist as history.
Results can be reused or copied; the expression also supports normal text entry.
