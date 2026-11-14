# Lope Browser

## Hosted account integration — November 13, 2026

The account-aware gateway and Windows/WSL host installers are now implemented in
[`services/browser/hosting`](../services/browser/hosting/README.md). Public worker
leases are bound to the verified Lope Account and device identity; passwords and
vault keys are never sent to the browser worker. Hosted downloads enter LopeDrive
through the client FileService, where the account's existing encryption/sync flow
handles them. Only explicitly selected upload bytes leave the client. Remote
website content/cookies are processed by Chromium on the server and are separate
from end-to-end encrypted LopeDrive.

The production runner confirmed that WSL/Docker were missing. With explicit user
approval, [WSL2 prerequisites were enabled](https://github.com/oEnchanted/LopeOS/actions/runs/43523844957)
with automatic rebooting disabled. The user has now restarted Windows. The runner
returned online without administrator privileges, so the
[post-restart setup attempt](https://github.com/oEnchanted/LopeOS/actions/runs/43529045006)
stopped before installation. It needs to be started from Administrator PowerShell
before WSL package/Ubuntu/Docker setup can continue. Caddy's existing HTTP 503
browser route has not been changed. Real Selkies media verification and public
activation remain pending. The earlier engine/transport
reference below records the implementation history; it does not mean the public
browser is operational yet.

Lope Browser has a Chromium control worker, a React application integrated into the LopeOS shell, and a Selkies 2.2.1 streaming adapter. **The Linux streaming vertical slice has not been run in this environment. This is not a verified production browser release.** The development host is macOS, has Chrome 157.0.8103.78, and has no Docker, Linux display server or Selkies installation. The UI reports a missing interactive stream explicitly; it never substitutes screenshot polling or embeds destination websites in iframes.

## Running the local engine and UI

Use Node 24 or newer and the repository's installed dependencies. Start the web UI and browser worker separately:

```sh
npm run dev:web
node services/browser/server.mjs
```

The development worker listens on `127.0.0.1:4175`. It finds installed Google Chrome on macOS or `/usr/bin/chromium` on Linux. Override with `CHROMIUM_EXECUTABLE=/absolute/path/to/chromium`. It creates a dedicated `.browser-data` profile, never opens the user's personal browser profile, and stores a random bearer in `.runtime/browser-token` with mode 0600. Vite's `/api/browser` HTTP/WS proxy injects it server-side. This loopback convenience proxy is not a multi-user authentication gateway.

With no Selkies runtime, real engine navigation/storage commands work but no website surface is rendered in LopeOS. The browser offers **Open in host browser** as an explicit action. It does not silently redirect. A frontend-only deployment cannot provide the remote engine or media transport.

## Architecture and integration

```text
LopeOS browser chrome ── authenticated HTTP/SSE ── per-owner browser worker
        │                                              │
        │                                 private anonymous CDP pipe
        │                                              │
        └─ authenticated trusted Selkies frame ── top-level Chromium pages
                    video / audio / input                  │
                                                validating public egress proxy
                                                          │
                                                ordinary website origins
```

Only the trusted Selkies core is framed, at `/api/browser/stream/selkies/`. Websites load as normal top-level pages inside Chromium. Website TLS, origin isolation, cookies, CSP and service workers remain Chromium's responsibility. Certificate failures are not bypassed. Chromium starts without sandbox-disabling or web-security-disabling flags; DevTools travels on inherited pipe descriptors, with no published debugging port.

The exported `browserApplication` manifest registers `lope.browser`, supplies File/Edit/View/History/Bookmarks/Window/Help contributions and declares HTTP/HTTPS protocols. The shell registry consumes it, the default Dock includes it, and LopeOS's URL service launches it with `launchArgs.url`. These defaults apply inside LopeOS. The component uses shared Button, Toolbar, Popover and Dialog components; the shell supplies the window frame. Tabs require custom content because the shared Tabs component has no close/pin/reorder interface.

See [browser-integration.md](browser-integration.md) and `packages/browser-client/src/contracts.ts` for the richer contracts. `createBrowserService()` implements Agent 1's compatibility BrowserService using engine state. Its legacy `download(path)` method directs callers to the real downloads panel; downloads are initiated by websites and imported on completion, not by fetching an arbitrary URL with host credentials.

The worker manages one owner's persistent normal context and up to three incognito contexts. A private context is separate from the normal cookie/storage partition. Only one session is displayed at a time on this owner's remote desktop. A second concurrent viewing client for the same owner sees the same desktop; independent concurrent displays need separate workers. Never share one worker between different users.

## Implemented controls

- Engine-backed create/close/switch/duplicate/pin/reorder/reopen tabs, with normal-session URL/order/pin/selection restore. Website-created targets are attached as they are; they are not recreated, so opener relationships survive. Closed-tab reopening restores the URL, not the former JavaScript heap or complete engine history.
- URL/search parsing with HTTP/HTTPS scheme validation, credential-bearing URL rejection, configurable DuckDuckGo/Google/Bing, local history/bookmark suggestions, ASCII host display and engine-provided title/address/loading/back/forward state.
- Back/forward/reload/stop/start, bookmarks and history, download progress/cancel/failure/Show in Files, intercepted upload choosers, find, viewport scale, PDF generation and a user-requested DevTools command.
- New-tab search/favorites; explicit disconnected, engine crash, certificate and navigation failure states; permission information for the current origin; host-browser fallback.
- Visible actions for shortcuts reserved by the host browser. Available keyboard events are scoped to the focused app or trusted streaming frame; tab ordering also has keyboard-accessible move actions. Shared dialogs provide focus management.

Viewport zoom uses CDP page scaling and reads the actual visual viewport scale back from Chromium. It is not native desktop reflow zoom: Chromium may clamp zoom-out at the page's minimum scale. Site styles are never rewritten. Find currently uses Chromium's `window.find`, whose matching and selection behavior differ from the native find dialog. PDF generation was tested in headless Chrome; headed Linux behavior and interactive print dialogs remain unverified. The request for DevTools uses `Target.openDevTools` and depends on the deployed Chromium version.

Favicon metadata is read from the engine. Cached supported raster icons can be returned as bounded data URLs; the host never fetches website favicon URLs itself. An unavailable icon falls back to a neutral globe.

## Streaming choice and verified upstream interfaces

Selkies **2.2.1**, published November 4, 2026, was checked against its [release](https://github.com/selkies-project/selkies/releases/tag/2.2.1), [core API](https://github.com/selkies-project/selkies/blob/2.2.1/addons/selkies-web-core/README.md), [settings source](https://github.com/selkies-project/selkies/blob/2.2.1/src/selkies/settings.py), [container workflow](https://github.com/selkies-project/selkies/blob/2.2.1/.github/workflows/images.yaml), and [HTTP implementation](https://github.com/selkies-project/selkies/blob/2.2.1/src/selkies/stream_server.py). This source review establishes the integration API, not a successful runtime test.

The adapter uses the supported WebSocket transport, bundled media decoder/input client, same-origin `postMessage`, `pipelineStatusUpdate`, `setMute` and `resetResolutionToWindow`. Selkies owns pointer mapping, display resize, keyboard/modifier handling, touch, clipboard transport and decoded audio/video. LopeOS does not send input to periodically refreshed screenshots. Only the expected frame window and exact origin may send status messages to the parent.

The gateway must support long-lived WebSocket upgrades, streaming HTTP/SSE without buffering, and a valid HTTPS secure context. The chosen WebSocket path does not require TURN or public UDP media ports. The optional upstream WebRTC transport has not been integrated or tested here; adding it requires its own ICE/TURN and firewall validation.

The [noVNC project](https://github.com/novnc/noVNC) was evaluated as a fallback: it supplies VNC input/display/resize/clipboard, but does not provide the audio path needed by this design. No noVNC fallback is shipped or advertised as equivalent media support.

## Linux deployment

`services/browser/infra/Dockerfile` layers distribution Chromium, an unprivileged kiosk window manager, Node and the worker onto the pinned Selkies release's Debian base. `entrypoint.sh` prepares writable s6 service definitions in temporary storage. The image removes setuid/setgid elevation paths and uses Chromium's user-namespace sandbox. The browser profile is mounted separately from the terminal workspace; no Docker socket or terminal home is mounted.

The image and Kubernetes example are **not built or run here**. Before rollout, verify package/image availability, resolve image digests, update Chromium from the distribution's security repository, and run the release gate below. Do not assume the Selkies base is an isolation boundary by itself. The cluster kernel, seccomp/AppArmor profile and container runtime must permit the Chromium user-namespace sandbox. If it fails, repair that runtime configuration; do not add `--no-sandbox`, privileged mode or host networking.

```sh
docker build -f services/browser/infra/Dockerfile -t lope-browser .
```

`infra/worker.example.yaml` documents the required deployment topology: one owner per worker and profile volume, non-root execution, read-only root, dropped capabilities, no service-account token, bounded CPU/memory/ephemeral storage, ingress only from the authenticated gateway, and public-web egress with private/special ranges excluded. Provision an owner-specific profile PVC separately, with encryption and quota. Apply equivalent restrictions for the actual cloud/VPC/service/metadata CIDRs and verify that the chosen CNI enforces them. Set a per-container PID limit in the node/runtime configuration; Kubernetes does not expose one in an ordinary PodSpec.

The worker's public egress proxy rejects private, loopback, link-local, metadata, mapped IPv6 and non-web-port destinations. It validates every DNS answer and connects to the checked numeric IP, avoiding DNS rebinding between validation and connection. Redirects and WebSocket connections pass through the same validation. Chromium's loopback proxy bypass is disabled, and non-proxied WebRTC UDP is disabled. These application controls complement the mandatory OS network boundary; they do not replace it.

The authenticated gateway must choose the worker from the signed-in user's server-side identity, strip client-supplied worker credentials, inject that owner's bearer on HTTP **and** WebSocket upgrades, preserve/validate the host Origin, and never proxy another owner's session. Worker IDs supplied by the client must not select arbitrary containers. The example intentionally does not implement the shell's production identity provider or multi-user worker provisioner.

Selkies binds only loopback and has its own independent random Basic-auth password, supplied by the worker proxy. LopeOS cookies and worker credentials are stripped before proxying to it. Its administrative token/switch routes are blocked from the client proxy. Destination websites never receive either credential. Camera/microphone forwarding, arbitrary command execution and Selkies file transfers are disabled; transfers use the selected-file bridge instead. The stream origin must equal the LopeOS origin for the core messaging API.

Recommended starting allocation, not a benchmark: 1 requested / 4 maximum vCPUs, 2–4 GiB RAM plus up to 1 GiB shared memory, 2–4 GiB ephemeral staging, and quota-limited persistent profile storage per owner. Complex sites or software encoding can need more. GPU encoding requires separate device-specific testing and constrained device exposure. Transport bitrate, concurrent viewers, resolution and tab count determine actual cost.

## Configuration

| Variable | Purpose |
| --- | --- |
| `LOPE_BROWSER_TOKEN` | Random per-owner worker bearer, at least 32 characters; required by production entry point |
| `LOPE_BROWSER_BIND`, `LOPE_BROWSER_PORT` | Default `127.0.0.1`, `4175`; bind externally only behind the gateway |
| `LOPE_BROWSER_ORIGINS`, `LOPE_BROWSER_HOSTS` | Exact allowed LopeOS origins and worker-facing hostnames |
| `LOPE_BROWSER_DATA` | Private profile/state/staging root; production `/profiles/normal` |
| `CHROMIUM_EXECUTABLE` | Maintained browser binary; Chromium sandbox stays enabled |
| `LOPE_BROWSER_HEADLESS` | Engine-only development/testing; false for the streamed X11 kiosk |
| `SELKIES_URL` | Private local HTTP endpoint, e.g. `http://127.0.0.1:8080` |
| `SELKIES_BASIC_AUTH_USER`, `SELKIES_BASIC_AUTH_PASSWORD` | Separate upstream credential, never returned to the frontend |
| `SELKIES_SUBFOLDER` | Must be `/api/browser/stream` for the packaged route layout |
| `SELKIES_ALLOWED_ORIGINS` | Exact external LopeOS origin; no wildcard |
| `LOPE_RUNTIME_TRANSFER_URL` | Optional owner-authorized Agent 2 HTTP service origin |
| `LOPE_RUNTIME_TRANSFER_TOKEN` or `_TOKEN_FILE` | Runtime-audience credential for this owner, server-side only |
| `LOPE_BROWSER_IDLE_MS` | Default 30-minute idle shutdown; `0` disables |

## Files, persistence and cleanup

The delivered adapter in `src/files.mjs` uses Agent 2's `services/runtime/browser-bridge.js`. It resolves the session server-side, reads downloads only within that session's staging boundary, uses no-follow regular-file reads, checks size limits, and performs exclusive upload writes. Agent 2 authorizes workspace operations using the owner's runtime credential. Completed downloads use create-only `/Downloads` writes with collision handling. Show in Files uses the returned workspace path. Uploads materialize only an explicitly selected workspace file or a file the user chooses from their device.

Workspace transfers are limited to **8 MiB**, matching Agent 2. Device uploads are limited to **32 MiB**; browser downloads to **256 MiB** and 100 records per session. A failed workspace import retains the staged download for explicit Save to device. Successful imports delete the staging copy. The worker itself cannot list arbitrary host files, and workspace APIs are never exposed to destination pages.

Normal Chromium cookies, IndexedDB, localStorage and service-worker state live in the private browser profile. Browser history/bookmarks/open-tab metadata are persisted separately in that same private root with restricted permissions. Normal metadata restore stores tab URLs rather than full navigation stacks. Browsing URLs, titles, cookies, CDP payloads and input are not logged. Profile encryption at rest and backups are the deployment operator's responsibility.

Private sessions use incognito browser contexts. Explicit End session and the shell's window-close lifecycle dispose the context and remove private transfer staging and in-memory state. Page unload attempts cleanup, and a lost SSE subscriber gets a 60-second reconnect grace before disposal. Already saved workspace/device downloads remain. Private browsing does not hide activity from websites, the network operator, LopeOS infrastructure or memory inspection.

Clear browsing data deletes all profile data, tabs, history, bookmarks and staging for the normal worker and restarts its engine; existing private sessions are ended too. Clearing a private session replaces its isolated context. Saved workspace files are untouched. Browser crash/restart does not restore private contexts.

The metadata channel reconnects with bounded exponential backoff. Snapshots carry an engine generation and monotonic revision so reconnecting to a restarted engine accepts fresh state. A stopped engine exposes Restart browser, which reloads normal tabs/profile state and ends private sessions. The stream uses Selkies' reconnect behavior and has a visible reconnect control after a 15-second startup timeout. Real keyboard/pointer/wheel activity renews the worker idle lease. Idle shutdown closes Chromium and disposes private contexts. Production supervision must honor idle termination rather than instantly respawn an unused worker: coordinate pod reclamation with the gateway/orchestrator; the example s6 supervisor by itself restarts failed services and is not a full idle-worker scheduler.

## Tested capability matrix

Evidence: local Chrome **157.0.8103.78**, Node **26.12.1**, macOS, November 12, 2026. Automated engine tests use a real HTTP fixture and a real sandboxed Chrome process, not a mocked DOM. Stream HTTP/WS tests use an instrumented upstream to verify proxy behavior; they do not prove Selkies media playback.

| Capability | Evidence / current status |
| --- | --- |
| Normal JS browsing and forms | Passed local engine form submission, Unicode insertion, DOM updates, title/address updates, same-document history, back/forward and redirect assertions |
| Cookies, localStorage, IndexedDB | Passed real engine reads/writes, normal restart persistence and clear-data removal |
| Service workers | Passed real registration and ready lifecycle; no interception that disables service workers |
| WebSockets | Passed real browser message receipt through the validating egress proxy |
| Popups / OAuth | Popup attachment and `window.opener` passed; actual external OAuth providers not tested |
| Uploads / downloads | Passed chooser interception, selected content upload and completed download bytes; owner-authorized shared workspace adapter contract passed; live Docker workspace transfer not run |
| Audio codecs | WAV playback and currentTime advancement passed in engine; remote audible output and Opus transport not run |
| Video codecs | VP8/WebM recording and playback passed in engine; remote motion, H.264/AAC, AV1 and other codecs not verified |
| DRM / protected video | Not implemented or tested; no Widevine provisioned; use host-browser fallback |
| WebGL / GPU | Not verified; depends on runtime/GPU configuration; no performance claim |
| WebRTC website calls | Not verified; non-proxied UDP restricted, device forwarding disabled; restrictive egress can prevent calls |
| Passkeys / security keys | No local authenticator/security-key forwarding; unsupported in this integration |
| Camera / microphone / location / notifications / clipboard API | Origin-specific information is visible; engine permissions denied. No live permission-request/consent-forwarding bridge is implemented. Use host browser for these device APIs |
| Clipboard and IME through stream | Explicit text paste insertion passed; upstream clipboard/IME/modifier transport source reviewed, live host-clipboard and real OS IME not run |
| Zoom / find / PDF | Engine viewport scaling and selected-text find checked; PDF header checked in headless Chrome; headed print/DevTools not verified |
| Stream transport / resize / scaling | HTTP/WS authorization, header stripping, administrative-route blocking and byte relay passed; actual Selkies media, pointer coordinates and XRandR/kiosk resize not run |
| Extensions | No extension installation UI or supported extension bridge; unsupported |
| Accessibility | Shared keyboard-accessible chrome/dialogs and explicit host fallback delivered; no remote page accessibility-tree bridge; local screen readers cannot inspect remote page semantics |
| Isolation / multi-user runtime | Auth/origin/session/file-path and IP/DNS guards tested; Kubernetes/container, sandbox-on-Linux and live cross-user boundary not run |

Run:

```sh
node --test services/browser/tests/security.test.mjs
LOPE_TEST_CHROMIUM=1 node --test services/browser/tests/*.test.mjs
npm run build
```

The full streamed vertical slice remains a release gate. Execute [streaming.acceptance.md](../services/browser/tests/streaming.acceptance.md) against the real Linux worker before marking media, input, resize, audio, transfer or production compatibility complete. Device permission bridging, a production identity/provisioning gateway, remote accessibility semantics and the deployment acceptance results remain outstanding.
