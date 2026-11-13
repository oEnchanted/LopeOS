# LopeOS

A web desktop with a glass Dock, contextual menus, movable windows, app search, and a shared application SDK.

## Run locally

Requires Node 24+ and pnpm 10.32.1.

```sh
npx pnpm@10.32.1 install
npm run dev
```

Open **http://127.0.0.1:5173/**. `pnpm dev:web` starts only the web desktop. `pnpm dev:runtime` starts the authenticated workspace API on port 4174. Keep all services bound to loopback for local development. Credentials are stored privately under ignored `.runtime/` and injected by Vite; they are not exposed to client JavaScript.

`npm run dev:browser` starts the Chromium worker on 4175 when Chromium is installed. Selkies is still required for website video and input streaming. The web desktop can run without the service backends. LopeDrive works locally without Docker. The workspace folders and Terminal runtime require Docker and a configured isolated Linux workspace; see `docs/runtime-contract.md` and the runtime owner's setup documentation. The Lope Browser service requires its separate Chromium/streaming environment; see `docs/browser-integration.md`. The Vite gateway forwards `/api/accounts` to port 4176, `/api/browser` to port 4175, and the workspace API to port 4174. `npm run dev` starts the account server; `npm run dev:accounts` starts it separately.

This checkout was developed on a Mac without Docker. The web server and authenticated API can run here; Linux workspace operations and the browser's remote video stream require the remaining service setup. Weather uses Open-Meteo and reports network failures or cached conditions visibly.

## Windows + Caddy hosting

The public visitor runtime creates private Linux workspaces automatically using
an HttpOnly cookie. Visitors install nothing and paste no tokens. Caddy on
Windows serves `dist` and proxies `/api` to the managed Ubuntu WSL2 service.
The terminal requires verified gVisor isolation and refuses weaker execution;
see [the host boundary](docs/runtime-isolation.md). The host configurator,
Caddy template, lifecycle behavior and platform checks
are in [Windows hosting](docs/windows-hosting.md).

## Verify

```sh
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:desktop
pnpm test:setup
```

The desktop check requires the local server to be running. Screenshots and timing results are saved in `docs/screenshots/`. Full container acceptance is distinct from UI checks and requires the runtime environment.

On a fresh browser profile, Setup Assistant guides you through appearance, privacy, accessibility, optional local AI downloads, and an optional LopeOS account. Continue without an account, or create one later in Settings → LopeOS Account. Accounts include 1 GB of server storage and automatically sync existing and future LopeOS settings, app preferences, saved layouts, recovery drafts, photo libraries, and files. Files opens **LopeDrive**, a persistent local folder that also syncs while signed in. Storage usage, transferred bytes, current items, time estimates, retries, and incomplete-sync errors appear in Files and Settings. System export/import controls have been replaced with account sync; application document import/export remains available.

See [account sync behavior](docs/accounts.md) and [account server deployment](services/accounts/README.md) for supported data, transfer limits, account isolation, and production hosting. Cloud sign-in uses server-verified passwords and an HttpOnly session cookie. It is separate from the runtime and remote Chromium identities. Signing out stops sync and retains local data.

The Local AI step explains Spotlight chat (Qwen3 1.7B), photo denoise (FFDNet Color), and portrait cutouts (MODNet). Download models individually or together, with progress, transferred bytes, MB/s, cancellation, and retries. Downloads continue while you finish setup and use the same browser caches as the apps. Spotlight requires WebGPU; compatible photo models can still download without it. ComfyUI checkpoints are managed separately in your local ComfyUI installation.

Setup reuses the desktop wallpaper, logo, shared controls, and preferences service. Its chosen preferences stay on the device and join automatic cloud sync when an account is connected. Setup acceptance tests and account/download unit tests run with `pnpm test:setup`. The 28 light/dark desktop/mobile screenshots and verification logs are in `docs/setup-assistant/`. No lint runner is configured in this checkout.

## Spotlight

Open Spotlight with **⌘/Ctrl K** or the menu bar search icon. The Dock's app launcher opens Applications directly. **⌘/Ctrl Space** also works when the host operating system passes that shortcut to the page. Use **⌘/Ctrl 1–4** for Applications, Files, Actions, and Clipboard; **0** returns to the main input. Arrow keys select a result, Enter opens or copies it, and Escape steps back or closes the panel.

The main input handles calculations such as `15% of 80`, `sqrt(144)`, and `10 km to miles` instantly. Enter copies the answer. File matches open directly; explicit filenames and workspace paths stay in file search. Other text goes to the local AI on Enter, in the same input and panel. Applications launches apps by name or alias. There is no separate Ask category or Spotlight web search.

Clipboard history is opt-in and stores text in this tab's memory, with pinning, full-text search, and deletion. Explicit imports use the browser's clipboard permission; pasting into the shelf works when direct access is unavailable. All items, including pins, follow the retention setting and disappear on reload or sign-out. File search is opt-in and searches authorized workspace names, respecting configured roots and exclusions.

Run `npm run test:spotlight` with the local server running for keyboard, application launching, clipboard permission, file search, and responsive-layout checks. These use isolated browser contexts and clipboard fixtures, without reading your system clipboard.

Spotlight includes an optional small local chat model. Select **Download model** on first use, then type a message in the main input and press Enter. It uses [Qwen3 1.7B](https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC) through [WebLLM](https://webllm.mlc.ai/docs/user/advanced_usage.html), with an initial download of about 1 GB. The model runs in a background worker with WebGPU and thinking mode disabled for direct replies; HTTPS or localhost and a compatible graphics device are required. No API key or chat server is involved. Model downloads contact Hugging Face and the WebLLM runtime host; prompts are not included in those requests.

This compact model handles general questions, ideas, and short drafts, but can still make factual and instruction-following errors. It has no live web access, app control, or access to your files and clipboard. The conversation is kept in memory and only a bounded recent context is sent to the local model. Closing Spotlight stops generation; New chat, sign-out, and reload clear the conversation. Model options can unload graphics memory or remove cached model downloads. Choosing the new model download removes obsolete Spotlight model downloads first. Browser storage may evict the download, and cached weights still need to be loaded into graphics memory when used again.

`npm run test:spotlight:ai` checks the chat UI with deterministic worker fixtures. `LOPE_AI_REAL=1 node tests/shell/spotlight-ai-live.mjs` performs a real model download and GPU inference in an isolated Chromium profile, including offline follow-up replies. It requires the full Chromium browser and available WebGPU hardware, rather than the minimal headless shell. Reports and screenshots are written to `tests/shell/screenshots/`.

## Project map

- `apps/web/src/shell`: desktop, window management, app registry, commands, wallpaper pipeline.
- `apps/web/src/apps`: application-owner implementations.
- `packages/contracts`, `packages/sdk`, `packages/ui`: versioned contracts, React integration, shared controls and visual tokens.
- `packages/app-template`: a working manifest-based SDK example, searchable as Example Notes in development.
- `services/runtime`, `services/browser`: service-owner backends.

See `docs/architecture.md`, `docs/design-system.md`, and `docs/sdk.md` for integration and extension guidance. Approved PerfectHue wallpapers are bundled alongside the original Tidal artwork. See [wallpaper credits](docs/settings-revision/wallpaper-credits.md) and [Settings verification](docs/settings-revision/verification.md).

## Lightroom

Lightroom is LopeOS’s local Lightroom-style library and nondestructive darkroom. Open it from the Dock or search for “Lightroom.” It provides real imports, development, manual masks/retouch, versions, account backup and sync, and JPEG/PNG/TIFF exports. Exact format coverage, setup, evidence and remaining parity gaps are in [the Lightroom handoff](docs/lightroom/README.md).
