# Software updates

Production builds keep a complete LopeOS application release in this browser. After the initial cache finishes, navigation and application assets use the installed release even when the server publishes a newer build. Software Update checks the published manifest periodically and when the browser reconnects or returns to the foreground. Users can defer an update and continue using their installed version, or choose to download and install it.

The update screen uses the black reset-screen treatment, the LopeOS mark, a progress bar, release details, and download progress. The shell checks applications for unsaved work before installation. Application updates preserve accounts, preferences, documents, and local recovery data. Remote workspace files, remote browsing, weather, and other network services still require their respective connections; caching the OS does not make those services work offline.

Before downloading, the update screen refreshes and validates the approved release, checks the cache worker and available browser storage, and compares the release's model catalog with the running app. Each check, verification, and installation stage stays visible for at least one second, followed by a brief restart pause. Overall progress reserves its final portion for verification and installation and reaches 100% only after the release commits. Reset cancels pending pauses and checks before they can continue installation.

Release manifests include optional model fingerprints for Spotlight AI, photo denoise, and portrait cutouts, derived from their configured models and runtimes. The model check reports catalog changes without downloading weights or deleting existing models. It does not search upstream providers for newer models. Older manifests without model metadata, unavailable catalogs, and model checks exceeding 15 seconds display an informational result and allow the OS update to continue. Browser storage estimates are advisory when unavailable or when the worker may reclaim older releases; actual cache quota and file verification remain enforced by the worker.

## Release generation and deployment

Run `npm run build`. `scripts/release-plugin.ts` writes `dist/__lope/version.json` after Vite has written both bundled files and copied public assets. The manifest contains the LopeOS version, a unique build identifier and release time, the total decoded byte size, and every included file's URL, size, and SHA-256 digest. Deploy the complete `dist` directory, including `lope-sw.js` and `__lope/version.json`, over HTTPS (localhost also works).

Publish deployments atomically where possible: upload all assets before publishing the new version manifest and HTML. Give `/__lope/version.json` and `/lope-sw.js` a `Cache-Control: no-cache` or `no-store` response header at the host/CDN. Manifest checks and update asset downloads request uncached responses, but a CDN configured to ignore those directives can delay discovery. A deployment that replaces only some files fails verification and leaves the installed version available for retry. Every distinct release must have a distinct build identifier; rebuilding generates one automatically even if `package.json` has not changed.

Published versions increase with every deployment. The deploy workflow sets `LOPE_RELEASE_NUMBER` to its run number, and the build replaces the patch number of the `package.json` version with it (`0.1.0` becomes `0.1.57`). Change the major or minor number in `package.json` for larger releases. Local builds without `LOPE_RELEASE_NUMBER` keep the `package.json` version. Re-running the same workflow run reuses its number, so publish a fresh run rather than a re-run when clients should see a new version.

The build also runs the worker's own release validation on the generated manifest and fails if any published file would be refused. Installed clients keep their current worker until every LopeOS tab closes, so new public files must fit its existing allowlist: `index.html`, `assets/`, `wallpapers/`, `photos/`, or a root icon or manifest file. Import other media from application code so Vite emits it under `assets/` with a content hash.

All bundled application chunks, CSS, WebAssembly emitted into `assets`, wallpapers, sample photos, and other public UI files are included. Optional `/models` AI downloads are excluded: they retain their existing separate installation and cache lifecycle. Source maps, metadata under `/__lope`, and the service-worker script itself are also excluded. Reported release size is decoded file bytes, which is also the cache requirement; HTTP compression can make network transfer smaller. Unchanged files are verified and reused from the installed cache, so the actual download can be smaller than the full release.

The update protocol supports root deployments, matching the application's existing absolute asset URLs. Vite development mode does not register the production cache, so normal hot reload remains available. Test caching through a production build served by `npm run preview` or a production host.

Keep server APIs compatible with older cached clients while those releases remain supported. The software cache versions the browser application; it does not pin remote services to an older deployment.

## Storage and installation

`public/lope-sw.js` stores complete releases under `lope.os.release.v1:<build>` and a committed-release pointer under `lope.os.metadata.v1`. A staged release becomes installable only after every file has been downloaded or reused and verified. Updating the committed pointer is the installation commit; interrupted downloads and invalid files never change it. Download concurrency is bounded to four files. Storage quota failures preserve the installed release and display a retryable error.

Existing open tabs keep their release's assets through durable client pins. New navigation opens the committed release. Old release caches are removed during a later download only when no open client needs them; the installed release is always retained. Unknown URLs and `/api`, update metadata, the worker, and optional models bypass the application cache. If an installed file is evicted, a network replacement is accepted only when it matches the installed digest. A newer server file is never silently substituted into the old release.

Browser site-data clearing, private browsing limits, or storage eviction can remove the cached release. Cache availability is checked when the client initializes, and matching published files can repair an incomplete installed cache. A user can always reset LopeOS through its existing factory reset flow, which removes LopeOS caches along with its other local data.

The worker's message protocol is version 1. Worker script changes use the browser's normal waiting lifecycle rather than taking control of open tabs automatically. Keep future app releases compatible with the active protocol; a changed worker script takes over once existing controlled tabs close. Software release activation and service-worker script activation are intentionally separate.

## Verification

`node --test tests/updates/*.test.mjs tests/updates/*.test.ts` covers consent-gated activation, cached/offline navigation, per-tab release pinning, reused-asset byte counts, corrupt and invalid releases, missing cached files, cache repair, reused build identifiers, cancellation during the final cache write, storage quota failures with retry, model catalog comparisons, and cancellable preflight checks. The browser tests in `tests/updates` exercise the actual worker and application against changing deployments, including visible phase order, pacing, model changes, and insufficient storage before downloading.

Run `npm run test:updates` to build and run both suites. The browser fixture serves two distinct releases and checks offline startup, postponing an update, multiple tabs, successful installation without clearing user data, failure recovery, and unsaved-document decisions.

Screenshots: [update prompt](software-updates/software-update-prompt.png), [Software Update settings](software-updates/software-update-settings.png), and [download progress](software-updates/software-update-progress.png).
