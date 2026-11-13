# Agent 2: current runtime handoff

The intended public deployment is Windows + Caddy, with the real Linux execution
service in Ubuntu WSL2 on the same host. Visitors receive a private workspace
automatically through a signed HttpOnly cookie. No visitor installation, runtime
token, account, or manually registered principal is required.

## Delivered

- xterm Terminal with independent PTYs, tabs, search, clipboard, resize, raw and
  binary input, reconnect/reattach, bounded replay, and parsed-output ACKs.
- Mandatory gVisor sandbox with exact host-boundary verification and no fallback.
- Non-root sandbox-resident node-pty agent with bounded stream backpressure.
- Shared FileService with binary/text transfers, atomic/create-only saves,
  versions/conflicts, safe descriptor paths, shell-change notifications, quotas,
  and browser transfer adapter.
- Automatic visitor identity, persistent private assignment, lazy workspace
  provisioning/resume, active/retained capacity caps, idle stop, and retention
  cleanup that revokes identity before deleting its workspace.
- Same-origin cookie authentication for HTTP/WS, exact Origin checks, bounded
  bootstrap payloads, hashed-IP admission limits, and no shared public bearer.
- Windows Caddy template, PowerShell host configurator/startup task, and Linux
  service installer. Home filesystems are mounted before containers resume.

## Shared integration

The existing registry consumes terminalApplication with AppContext. The SDK's
fileService and terminalService remain compatible. RuntimeClient bootstraps guest
access automatically on first request and coalesces concurrent application
startup. Private single-user dev proxies may retain their injected token; public
Caddy routes must preserve each visitor's cookie and inject no shared token.

Agent 4's BrowserFileBridge adapter remains available. Browser/Chromium hosting
must resolve the same visitor identity on the server while maintaining separate
per-visitor profiles; never expose a shared browser profile/token publicly.

## Validation

- Combined runtime/application unit suite: 47 passed, 3 live Linux/gVisor tests skipped.
- Security regressions cover host-drive/socket binds, shared namespaces, devices,
  credential/DNS leaks, runtime overrides, failed probes and immutable-ID execution.
- Public host installation now checks gVisor visibility and an actual sandbox PTY
  before enabling the service. These host checks remain unexecuted on this Mac.
- Terminal/runtime-client TypeScript and full production build: passed.
- Provisioning/removal/installer Bash syntax: passed.
- Chromium smoke: passed first-visit automatic startup, actual PTY pipeline,
  Terminal→Files→Text Editor→Terminal, refresh reattachment, and two-browser
  isolation. Uses disposable native PTY/filesystem fixtures; no Linux/container
  compatibility certification is claimed from that browser run.
- Windows, WSL2, PowerShell, Caddy, Docker image/quota and actual cross-container
  checks cannot run on this macOS host and remain deployment acceptance work.

See docs/windows-hosting.md for the intended Windows deployment and
services/runtime/visitor-browser.mjs for the reproducible browser check.

The full host boundary, upgrade behavior, limits and real host-canary test are
documented in docs/runtime-isolation.md. Older policy containers are rejected
and stopped when owned; their persistent home images are preserved.
