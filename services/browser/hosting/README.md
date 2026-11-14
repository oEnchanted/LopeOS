# Account-aware Caddy browser hosting

The public gateway is `hosting/main.mjs`, on Windows loopback port **4177**. It verifies the existing Lope Account HttpOnly cookie against the local account service on 4176. Guests receive a separate signed HttpOnly browser cookie. A per-account/per-device HMAC determines profile ownership; neither client-supplied user IDs nor the internal worker session name `normal` can select a profile.

Public session IDs and stream paths are random, owner-checked leases. HTTP, metadata streams, file transfers and WebSocket upgrades all verify the owner. Account changes cannot redirect an in-flight request into another account's worker. Revoked account sessions close their streams and workers within five seconds; an account-service outage fails closed. Idle workers stop after thirty minutes. Normal website state persists in the owner's separate profile; private contexts and staged transfers do not persist in that profile.

## Encryption boundary

The gateway receives only the session cookie and the public account identifier returned by the account server. A worker receives a fresh worker token, fresh Selkies credential, hashed ownership label and allowed site origin. Passwords, recovery keys, vault master keys, wrapping keys and decrypted LopeDrive manifests are never passed to it.

Remote Chromium must process the websites it opens, including website sign-in cookies. These server-side browser profiles are **not** the account's end-to-end encrypted LopeDrive and are explicitly excluded from account sync. Protect host storage/backups separately. The About panel explains this distinction.

Completed downloads enter `/LopeDrive/Downloads` through the client FileService, with create-only collision handling. Existing cloud sync encrypts those files and names on the client. Uploads read only explicitly selected client files and send their selected bytes to the website, with an explicit explanation in the chooser. No vault key is sent with a selected file. Files up to 64 MiB can enter LopeDrive; selected uploads total at most 32 MiB.

## Windows/WSL installation sequence

The Windows runner must own the Ubuntu WSL distribution and have administrator rights for host installation. Caddy and Accounts stay on Windows. Only the isolated rendering workers run under Docker Engine inside Ubuntu WSL. Docker Desktop and remote Docker daemons are rejected.

1. `windows/Inspect-LopeBrowserHost.ps1` performs reviewed, read-only prerequisite checks.
2. `windows/Prepare-LopeBrowserWSL.ps1` enables Windows WSL/Virtual Machine Platform features with **NoRestart**. If Windows requires a restart it stops and reports that checkpoint. It never restarts Windows or changes Caddy. The user must choose the restart time.
3. After restart, run `windows/Install-LopeBrowserPrerequisites.ps1` under the elevated runner's Windows account. It installs Ubuntu 24.04 WSL2, enables systemd only in that distro, and installs Docker Engine, verified official Node 24 binaries, iptables, and ext4/loop filesystem tools. It may restart that WSL distro; it never restarts Windows or changes Caddy. The manual workflow downloads only the reviewed setup scripts from its exact commit. See the official [WSL instructions](https://learn.microsoft.com/en-us/windows/wsl/install) and [Ubuntu Docker Engine instructions](https://docs.docker.com/engine/install/ubuntu/).
4. From an elevated PowerShell under that account, run the reviewed installer:

```powershell
.\services\browser\hosting\windows\Install-LopeBrowser.ps1 `
  -SiteOrigin https://lopeos.online -Distro Ubuntu-24.04
```

The installer prepares the Linux image/network and registers the `LopeOS Browser` startup task. Code and a private identity key live outside frontend releases, under `M:/LopeOS/browser` and `M:/LopeOS/browser-host-data`. A failed gateway startup restores its previous task configuration. It refuses to take over an unrelated process on port 4177. It does not enable the public route yet.

5. Run the real streaming gate in `../tests/streaming.acceptance.md`. Confirm the Chromium sandbox inside the container, real media input/output and resize, account/guest isolation, and selected-file round trips. A healthy static stream client is not evidence of working audio/video.
6. Once the runtime is verified, run `windows/Enable-LopeBrowser.ps1 -SiteOrigin https://lopeos.online`. It prepares and validates a Caddy candidate, atomically replaces the live configuration, checks public health, and updates the persistent template. Failure restores the old live configuration. Other hostnames, Accounts, runtime routes and release roots are preserved. Custom preexisting browser routes require review and are never silently replaced.

Caddy automatically proxies WebSocket upgrades. The browser route additionally uses `flush_interval -1` for immediate metadata/media delivery and `stream_close_delay` for configuration reloads. No shared development bearer is injected by Caddy; account/visitor authentication is performed by the gateway. No new public ports are needed beyond HTTPS.

## Isolation and storage

The worker runs as UID/GID 1000, with a read-only root, all host capabilities dropped, no-new-privileges, private IPC/cgroups, 3 CPUs, 2 GiB RAM, 512 PIDs, bounded temporary/shared memory and a loopback-only published control port. No debugging TCP port, terminal workspace, Docker socket, or account data directory is mounted into Chromium.

The dedicated `lope-browser-public` network disables communication between workers. Its host firewall blocks private/special addresses and all outbound ports except public TCP 80/443 and DNS to the selected resolver. A dedicated INPUT rule also rejects new worker connections to the WSL host itself, while allowing replies to host-initiated control connections. DNS-pinned application egress remains enabled as a second layer. The firewall update fails closed while its dedicated rules are replaced. Operator-specific public infrastructure/metadata ranges should also be restricted where applicable.

`prepare-profile.sh` creates a 2 GiB ext4 loop filesystem per owner, with noexec/nosuid/nodev and strict ownership. Up to 100 profiles are kept. At capacity, the least recently used profile idle for over seven days with no running browser is reclaimed; otherwise allocation fails explicitly. Chromium's disk cache is capped at 150 MB per profile, and profiles mount with discard so deleted data frees disk space. Profiles remain after idle shutdown so normal website sessions can resume. Retention/backup policy is a host responsibility; do not delete profile images while mounted or in use.

The seccomp generator starts with Docker's default restrictions at pinned upstream commit `f862455628f78f84c937e967e4a03902fb1dee11` and permits the clone/setns/unshare/chroot calls required by Chromium's own namespace sandbox. It retains the other default restrictions and clone3 fallback. The upstream license is included. If kernel/AppArmor policy blocks Chromium sandbox creation, repair that narrowly scoped host policy; do not add `--no-sandbox` or disable website security.

## Current production checkpoint

On November 13, 2026, the user-approved [runner inspection](https://github.com/oEnchanted/LopeOS/actions/runs/43523167899) confirmed Accounts HTTP 200, no installed WSL subsystem, no Docker command and no browser gateway. Public `/api/browser/health` returned the existing explicit Caddy HTTP 503. The user then approved prerequisite installation without an automatic reboot. [Preparation completed successfully](https://github.com/oEnchanted/LopeOS/actions/runs/43523844957): both Windows features were enabled and Windows reported a required restart. The user subsequently restarted Windows. The runner returned online without elevation, and [the next attempt](https://github.com/oEnchanted/LopeOS/actions/runs/43529045006) stopped at the administrator check before installing anything. Restart the runner from Administrator PowerShell, then run the prepared Ubuntu prerequisites workflow. Caddy is unchanged. Ubuntu/Docker installation, live browser activation and media verification are pending; local test results are not a claim that the live browser is operational.
