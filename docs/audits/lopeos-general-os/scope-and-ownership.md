# General OS audit — scope and ownership

Audit date: 13 November 2026. Auditor session: `lopeos-100-cc` (Claude Code).

## Tested snapshot

- Starting commit: `ec4599f` on `main` (git status: 256 dirty/untracked entries at start, recorded in `evidence/baseline-git-status.txt`; 103 OS-scope file hashes in `evidence/baseline-os-file-hashes.txt`).
- Other agents kept editing during the audit (Movie Maker, Spreadsheet, a new `video-editor`, and a 16:57 change to `Shell.tsx`/`shell.css`/`materials.css` that removed the desktop icons). Results apply to the OS-audit build made from the working tree at about 17:00 MST, plus the changes listed below.
- At the start, the full `tsc`/`vite build` failed on in-progress `apps/movie-maker/index.tsx:123` and `apps/spreadsheet/index.tsx:73`, so OS verification used `tests/os-audit/vite.os.config.ts`. That config uses the real shell and core apps, with sibling extensions swapped for a disposable fixture. By the end, the full `tsc --noEmit` and the full production build both passed.

## In scope (OS-owned)

`apps/web/src/main.tsx`, `apps/web/src/shell/**`, `apps/web/src/setup/**`, `apps/web/src/updates/**`, `apps/web/src/accounts/**`, `apps/web/src/backup/**`, `apps/web/src/apps/settings/**` (Settings as an OS surface), `packages/{contracts,sdk,ui,runtime-client}`, `public/lope-sw.js`, `services/accounts/**`, `scripts/**`, `vite.config.ts`, `index.html`, and the hosting header configuration.

## Out of scope (application internals, not audited or edited)

Writer, Spreadsheet, Image Editor, Lightroom, Movie Maker, video editor, Browser, Terminal, Files, Calculator, Weather, and their engines/services (`packages/*-engine`, `services/browser`, `services/runtime`). Their app code was read only where needed to understand an OS contract.

## Coordination

- The only peer session reachable through `ListAgents` (`lopeos-local-18`) works in a different checkout (`LopeOS Local`). It confirmed it has no edits in this repo, so no live owner was available to coordinate with.
- As a result, the production header change to the runtime-owned `services/runtime/windows/Caddyfile.deploy.template` was **not applied**. It is delivered as a validated patch (`patches/caddy-security-headers.patch`).
- `Shell.tsx` and `Dock.tsx` carried other agents' uncommitted work. I made only targeted hunks, checked the file hash before patching, and preserved their changes (FileDialog extraction, menu ordering, desktop-icon removal, Dock overflow measurement). They are unstaged and uncommitted.

## Files changed by this audit

| Path | Ownership at start | Change |
| --- | --- | --- |
| `apps/web/src/main.tsx` | clean | Top-level boot recovery boundary |
| `apps/web/src/shell/Shell.tsx` | dirty (other agent) | Layout record validation, stacking renumbering, app retry, command scoping, stale-window guards, single-flight dialogs, window cap, notification attribution, Tab trap, `CSS.escape`, manifest credit URL |
| `apps/web/src/shell/SearchPanel.tsx` | clean | Spotlight Tab trap handles every Tab |
| `apps/web/src/shell/Dock.tsx` | became dirty during the audit (other agent) | Dock no longer swallows global shortcuts |
| `apps/web/src/shell/system.ts` | clean | History shape guards |
| `apps/web/src/shell/background.ts` | clean | Strict personal-wallpaper data URL |
| `apps/web/src/shell/desktop-polish.css` | clean | `.toast-source`, `.app-loading-actions` |
| `tests/os-audit/**` | new | Audit build, hostile fixture, servers, regression and header suites |
| `docs/audits/lopeos-general-os/**` | new | This report and its evidence |

No application-internal file was modified.
