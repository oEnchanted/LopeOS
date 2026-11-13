# LopeOS runtime

LopeOS Terminal uses xterm.js and `node-pty` inside the user's dedicated Linux
container. A trusted Node control plane runs a small agent with `docker exec -i`
and carries validated input, resize and output frames over its pipes.
The agent creates the real controlling PTY; Docker's CLI does not reserve any
interactive detach keys on this pipe transport. Bash (or zsh) performs all
command parsing and execution. The runtime never
executes user commands in a host shell. Files, Text Editor, browser transfers,
and shell commands share `/home/lope` in that container.

## Host isolation

Execution now requires the verified gVisor runtime and exact mount/namespace/
credential policy. The public host installer includes gVisor setup and a real
in-sandbox PTY smoke check. See [runtime-isolation.md](runtime-isolation.md) for
what is enforced, upgrade behavior, and the live host-canary test. Missing or
unsafe isolation disables execution rather than selecting a fallback.

## Public visitors

For the intended Windows + Caddy website, use the automatic visitor runtime in
[windows-hosting.md](windows-hosting.md). It creates private Linux workspaces
automatically using an HttpOnly cookie. No visitor installs, tokens, account
creation, or manually registered principals are needed. The manual registry
setup below remains an operator/private API mode.

## Compatibility and current verification

The compatibility promise is **Linux/Unix with GNU utilities**: real quoting,
globbing, environment variables, redirection, pipelines, scripts, exit statuses,
signals, and shell job control. The image intentionally includes Bash, zsh,
coreutils, grep, sed, awk, find, tar, git, curl, Python 3, Node 22, less, and
vim-tiny. macOS executables, frameworks, BSD flags/output, GUI applications,
full Vim plugins, arbitrary device forwarding, and WebContainers are outside
this promise. Networking is disabled by the supplied sandbox policy; git/curl
can operate on local resources. External egress and workspace HTTP previews
need a separately authenticated, restricted gateway.

This development host has no Docker executable. The isolated Linux acceptance
suite has therefore **not been run here**. Local verification covers actual
native PTY execution in a temporary test directory, actual filesystem workers,
HTTP/WebSocket authentication, ownership, origin checks, backpressure, replay,
and browser transfer contracts. Native PTY tests run on the development host
only as test fixtures; they are not a runtime fallback or Linux compatibility
certification. Alternate-screen bytes and resize dimensions are checked;
visual correctness/responsiveness in the desktop, less, and vim still require
the live Linux/browser checks below. The product displays an unavailable state
when its Linux workspace cannot be reached.

## Integration

`docs/runtime-contract.md` publishes the Agent 1/3/4 handoff. Shared SDK exports
remain `fileService`, `terminalService`, and `runtimeRequest` from
`packages/runtime-client/src`. The richer `RuntimeClient` API supports parsed
output acknowledgements, binary files, create-only writes, moves, identity, and
session enumeration. `configureRuntime({baseUrl, getToken})` accepts the shared
identity provider. Tokens remain in memory, never a URL or browser storage.

The terminal component accepts `{context: AppContext}` and registers commands
for New/Close Tab, Find, Copy, Paste, and Clear Scrollback. Use its manifest's
menus. Shell shortcut capture handlers must ignore events originating inside
`[data-terminal-input]`; ordinary Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+R, Ctrl+F,
Ctrl+L, and application function keys belong to the terminal. Terminal's own
Mod+Shift+T/W/F/C/V shortcuts are explicit UI actions. Unmounting a view detaches;
AppContext's before-close hook kills its shells when the user closes a window.

## Local startup

Use Node 22+ and a **Linux Docker host**. The control plane can run on that Linux
host or connect to it through a privately authenticated Docker context. Docker
Desktop alone does not run the host ext4 provisioning script; use a Linux VM
when developing on macOS. No container or host shell is silently substituted
when that infrastructure is absent.

1. Install shared dependencies through Agent 1's package manager. The runtime
   package declares `ws` and `node-pty` (also used by native agent tests); Terminal needs `@xterm/xterm`,
   `@xterm/addon-fit`, and `@xterm/addon-search`. Alternatively install the runtime
   package alone with `npm install --prefix services/runtime`. The image builds its own Linux node-pty in a separate build stage using its
   checked-in npm lockfile. Native compilation for host test fixtures can require
   Python, make, and a C++ toolchain. Run
   `node services/runtime/prepare-native.js` after a root install; it repairs a
   missing execute bit on node-pty's installed spawn helper.
2. On the Linux Docker host, provision the local user's sandbox:

   ```sh
   sudo bash services/runtime/install-sandbox-linux.sh
   sudo bash services/runtime/provision-linux.sh local local lope-local
   ```

   This builds the image and creates a 512 MiB ext4 disk image, loop-mounts it at
   `/var/lib/lopeos/homes/local`, and mounts that home alone into `lope-local`.
   The image enforces capacity for shell writes as well as API writes. The
   container gets 1 CPU, 512 MiB RAM (no extra swap), 128 processes, 64 MiB `/tmp`,
   32 MiB shared memory, and 2,048 file descriptors per process. Its root is
   read-only, all capabilities are dropped, no-new-privileges is enabled, and
   networking is disabled. It runs as uid/gid 1000 with Docker's init process.
3. Start `node services/runtime/server.mjs`. Without a supplied registry this
   prepares `.runtime/token` and `.runtime/principals.json` privately (directory
   0700, files 0600). It prints the listening URL, **never the token**. The default
   local registry maps user `local` to workspace `local` and `lope-local`.
4. Start Agent 1's web development server at its configured origin. Its `/api`
   proxy must target `http://127.0.0.1:4174`, set `ws: true`, and inject the local
   token as an Authorization header in **both** `proxyReq` and `proxyReqWs`.
   Preserve the browser's Origin header. The terminal auto-connects through that
   proxy. For a direct connection, inject `configureRuntime` and an in-memory
   credential; exact origins must be configured at the runtime.

For runtime-only tests independent of the desktop:

```sh
node services/runtime/prepare-native.js
node --test services/runtime/*.test.js
```

The HTTP/WS tests bind temporary loopback ports; restrictive development
sandboxes may require permission to bind localhost. The Docker acceptance tests
report skipped unless explicitly enabled. `.runtime` must remain ignored by Git.

## Identity and deployment configuration

Private/operator API mode starts `node services/runtime/server.js` with an explicit
`LOPE_PRINCIPALS_FILE`. It does not generate production credentials. The private
JSON registry is an array, with unique `userId`, `workspaceId`, and `container`:

```json
[
  { "userId": "alice", "workspaceId": "alice-home", "container": "lope-alice" },
  { "userId": "bob", "workspaceId": "bob-home", "container": "lope-bob" }
]
```

Provision each container with the same IDs using the Linux script. For local
static authentication add `tokenHash` containing SHA-256 of a random token with
at least 256 bits of entropy, optionally `expiresAt` (Unix seconds). Keep the
plaintext only in the private dev proxy or shared authentication gateway.
There is no anonymous endpoint returning a credential and no client-selected
workspace/host-path parameter.

For shared authentication with Browser, the trusted identity gateway should
issue distinct short-lived audience credentials. This runtime accepts HS256
JWTs with header `alg=HS256, typ=JWT`, `aud=lope-runtime`, configured `iss`, a
registered `sub`, required `exp` no more than one hour away, and optional `nbf`.
Workspace selection always comes from the server registry, regardless of JWT
claims or request parameters. Share identity verification at the gateway;
Browser must validate its own audience and run in a separate sandbox. JWT
signing keys and Docker access must never enter either execution sandbox.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOPE_PRINCIPALS_FILE` | required for `server.js` | Private registry, loaded at startup. Dev entry generates its local registry if omitted. |
| `LOPE_AUTH_SECRET` | unset | At least 32 bytes; enables HS256 gateway JWT verification. |
| `LOPE_AUTH_ISSUER` | `lope-gateway` | Exact JWT issuer. |
| `LOPE_RUNTIME_HOST` | `127.0.0.1` | Bind address; expose remotely only behind TLS and an authenticated gateway. |
| `LOPE_RUNTIME_PORT` | `4174` | HTTP and WS listener, 1..65535. |
| `LOPE_ALLOWED_ORIGINS` | localhost/127.0.0.1, ports 5173 and 4173 | Comma-separated exact origins; no wildcards. WS always requires an allowed Origin. Authenticated nonbrowser HTTP can omit Origin. |
| `LOPE_SHELL` | `bash` | `zsh` selects zsh; all other values select Bash. |
| `LOPE_MAX_SESSIONS` | `8` | Per-user cap, including pending creations and retained exited sessions; 1..16. |
| `LOPE_DETACHED_MS` | `900000` | Detached/retained-exit lifetime; 1,000..86,400,000 ms. |
| `LOPE_STATE_DIR` | `/var/lib/lopeos` | Linux provisioning script only; private persistent disk-image directory. |
| `LOPE_STORAGE_MB` | `512` | Provisioning only; new home image capacity, 128..2048 MiB. Filesystem metadata consumes part of it. Existing images are never resized automatically. |
| `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, Docker TLS variables | Docker CLI defaults | Trusted control-plane Docker configuration; never passed into the shell environment. |
| `LOPE_ACCEPTANCE` | unset | `1` enables actual Linux/Docker acceptance tests. |
| `LOPE_TEST_TOKEN_A` | private local dev token file | Test user's credential; only used by the opt-in suite. |
| `LOPE_TEST_TOKEN_B` | unset | A distinct registered/provisioned user; required to run actual cross-user acceptance. |

A production service requires a long-running Node process, a compatible native
node-pty build inside the workspace image, a private Docker connection, persistent mounted home images,
TLS/WSS at the gateway, WebSocket upgrades preserved, and no response buffering
on the WS route. Use one control-plane process per workspace pool; session and
subscription state live in that process. Horizontal replicas require explicit
session routing/leases and are not implemented. An example systemd unit is
`services/runtime/lope-runtime.service`.

Configure persistent mounts before container startup after host reboot. For a
local workspace, an `/etc/fstab` entry can use the actual provisioned paths:

```text
/var/lib/lopeos/images/local.ext4 /var/lib/lopeos/homes/local ext4 loop,nodev,nosuid 0 0
```

Arrange Docker/container startup after these mounts. Starting a container against
an unmounted home directory loses the quota/persistence boundary. Verify mounts
with `findmnt` before starting the runtime. Back up the image while the container
is stopped and filesystem is unmounted, or use filesystem-consistent snapshots.
The supplied verifier checks labels/ownership, container limits, dropped
capabilities, read-only root, mount destinations, and network/namespace policy;
storage labels attest administrator provisioning, not cryptographic proof of a
quota. Do not label an ordinary unbounded home as storage-limited.

## Sessions and bounded output

Every tab has its own real shell, PTY, environment and working directory. `cwd`
in API session records is the **launch directory**; subsequent `cd` is managed
by that shell. Completion and history come from Bash/zsh. Bash appends history
after each command and merges it at the prompt; zsh uses incremental history.
History lives in `.bash_history` / `.zsh_history` under persistent home, with
10,000 in-memory entries and Bash's 20,000-line file cap. A user may change these
normal shell settings; commands still running at an abrupt crash may not yet
have been appended.

A transport disconnect detaches without killing the shell. Automatic reconnect
uses backoff and the same session ID, with the last parsed-output cursor. A
page refresh restores that tab's session IDs from sessionStorage (IDs only,
scoped by workspace/window). Other available sessions can be selected explicitly
with Resume Existing Shell. One connection owns a shell's input at a time; a
new attachment disconnects the previous viewer. Detached shells expire after
15 minutes by default. Exited shells retain bounded output for that lifetime.
Explicit tab close, and desktop window close through AppContext, kill the Unix
job-control session plus descendants carrying its inherited session marker.
Window unmount/refresh only detaches. Idle expiration follows the same cleanup.

Running sessions are temporary. Graceful runtime shutdown closes them; first
workspace access after a control-plane restart reaps stale session records.
A container/host restart clears all running processes and temporary `/tmp`.
The service cannot reattach to a PTY from a prior control-plane process. An
intentionally daemonized program that both leaves its Unix session and removes
the inherited marker is outside per-tab cleanup and lasts until the container
stops. This is not a persistent process hosting facility. Home files and shell
history survive service, container, and browser restarts.

Replay retains at most **512 KiB per shell**, evicting whole output chunks.
Cursors count UTF-16 units (not bytes). At most about 64 Ki UTF-16 units await
client acknowledgement; the client acknowledges only in xterm's write callback.
The service pauses its sandbox output stream at that window or WS high-water
mark. The agent pauses node-pty when its bounded stdout stream applies
backpressure, allowing pressure to reach the shell's PTY. Keyboard input, including Ctrl+C, remains
available while reads are paused. Detached output drops its oldest tail instead
of growing memory or blocking forever. Scrollback is capped at 5,000 lines;
input messages are bounded and pastes cap at 32,768 characters. HTTP/WS payloads,
concurrency, session counts, and request/message rates are bounded.

If replay has expired the UI resets its emulator and visibly reports the gap.
A retained tail is **not a screen snapshot**; an alternate-screen application
may require Ctrl+L or its own redraw command. Lossless replay across arbitrary
outages and process persistence across control-plane restart are not promised.

## Filesystem and transfers

API paths are rooted at virtual `/`, mapped to `/home/lope`. The explicit
`/home/lope/...` alias is accepted for terminal-to-app handoffs. Parent traversal,
NULs, oversized names, symlinked components, and special-file reads are rejected.
Workers use no-follow directory/file descriptors rather than a check-then-open
realpath scheme. Symlinks can be listed and unlinked/moved as links; their targets
cannot be read/written through FileService, even when inside home. The shell
itself has ordinary Linux symlink behavior inside its own sandbox. Rootfs is
immutable and contains no control-plane secrets or another user's home.

The service supports metadata, text and binary reads/writes, directories,
rename/move without overwriting destinations, recursive deletion, user uploads,
downloads, and subscriptions. Transfers cap at 8 MiB; large files still work
through normal shell tools. A directory listing caps at 10,000 entries; snapshots
cap at 100,000 entries and 64 directory levels. Errors are structured as
`{error:{code,message}}` with HTTP 400/401/403/404/409/413/415/429/503/507 as appropriate.
`GET /api/fs/read?encoding=base64&path=...` returns bytes encoded as base64;
the default text route and FileService.read reject invalid UTF-8/binary controls
with `BINARY` (415), instead of silently replacing bytes. No-space/quota failures are reported as `NO_SPACE` (507).

Atomic saves write a sibling temporary file, fsync its content, preserve the
existing permission bits, then atomically replace and fsync the parent. A
SHA-256 version of the bytes read is used for optimistic saves. API operations
are serialized per workspace. Stale editor versions are rejected with CONFLICT;
create-only uses an atomic link operation so concurrent creators cannot
silently overwrite one another. The worker also checks inode/timestamps just
before replacement. Arbitrary shell programs do not participate in editor
locks: POSIX offers no atomic compare-and-swap replacement against an
uncooperative shell writer. A shell write in the final check/rename interval
can still win/lose that race. Applications must surface version conflicts and
external-change notifications; this is not collaborative-editing isolation.

API mutations invalidate Files/Editor subscribers immediately. Shell changes
are detected by a bounded descriptor-based metadata snapshot roughly every
1.5 seconds while subscribers exist; events invalidate the workspace rather
than enumerate every filesystem operation. Reconnect also invalidates cached
views. Watcher errors are explicit protocol events; the richer client accepts
an error callback. There is no recursive OS watcher silently missing newly
created directories. Snapshot change detection is eventual, not a lossless
filesystem audit log.

Agent 4's server adapter is `services/runtime/browser-bridge.js`. It conforms to
BrowserFileBridge and requires injected `resolveSession`, `readStagedDownload`,
and `writeStagedUpload` capabilities. Ownership and runtime credentials must be
resolved server-side against the browser request identity. Download filenames
are validated and imported create-only into `/Downloads`; collisions get a
bounded numeric prefix. Uploads transfer only the selected workspace file.
Staging callbacks must enforce the browser session's private staging boundary,
no-follow/exclusive file access, cancellation and the 8 MiB cap. The adapter
never opens arbitrary host paths. Browser profiles/cookies remain in Agent 4's
separate storage and are never mounted here. That adapter is delivered and
contract-tested; wiring it into Chromium is Agent 4's handoff.

## Terminal security

Output is sent as terminal text to xterm, never interpreted as HTML. OSC 52 is
consumed without accessing the clipboard. Link activation accepts http/https
only and requires a user event with noopener/noreferrer. No escape sequence
can invoke the command registry, shared filesystem, or privileged UI services.
Clipboard read/write is an explicit user gesture; browser permissions may deny
it. xterm's own selection and standard paste remain available. Server-issued
messages, session IDs, sizes, cursor acknowledgements, and origins are validated.
The first WS message authenticates using an in-memory bearer or the dev proxy's
trusted Authorization handshake header; it has a five-second timeout. JWT
expiry is checked on messages and periodic heartbeats.

Docker access is privileged control-plane authority, even for a service account
in the docker group. Do not expose the daemon, mount its socket inside a user
workspace, mount host homes, forward service credentials into shell env, or
reuse the shell container for Chromium. Users get only their own container and
home. Use a dedicated, patched execution host/VM with the mandatory gVisor policy.
The boundary and its residual limits are documented in runtime-isolation.md;
ordinary container namespaces alone are not accepted by this implementation.

## Reproducible acceptance

On a provisioned Linux host, start from a dedicated test workspace. Export the
private principal registry path and credentials without placing them in source
or command arguments. Then run:

```sh
LOPE_ACCEPTANCE=1 node --test services/runtime/acceptance.test.js
```

With `LOPE_TEST_TOKEN_A` and a different `LOPE_TEST_TOKEN_B`, both provisioned,
the suite runs actual shell/file/script, history/completion, Ctrl+C/Ctrl+Z,
foreground/background jobs, less/vim, resize, output-load, reattachment,
shell→editor-API→shell, refresh-equivalent reads, and cross-user denials. The
second-user check is explicitly skipped when no second credential is configured.
Test names containing Linux/Docker are never represented as passing when skipped.
The tests create uniquely named temporary workspace directories and remove them.

Finish these desktop/infrastructure checks with the real stack:

1. Create a file in Terminal. Open it through Files, edit/save it in Text Editor,
   and `cat` it from the same terminal. Verify external-change/conflict UI.
2. Resize less/vim repeatedly, then run `yes` and Ctrl+C. Confirm correct display,
   functioning input, and a responsive Dock/window manager during heavy output.
3. Disconnect/reconnect and refresh within the detach lifetime, then after it.
   Check the visible truncated-replay state and expired-session state.
4. Refresh LopeOS, restart the service/container, and verify files and completed
   history persist while the documented process lifetime policy holds.
5. Use two real principals and separate containers to verify cross-user session,
   file, transfer and subscription denial. Confirm forbidden WS origins fail.
6. In a disposable quota volume, fill `/home/lope` with shell output and verify
   ENOSPC and API `NO_SPACE` without filling the host disk; remove only that test
   filler afterward. Inspect cgroup CPU, RAM, PIDs, and tmpfs limits.

References: [xterm flow control](https://xtermjs.org/docs/guides/flowcontrol/),
[xterm security](https://xtermjs.org/docs/guides/security/),
[node-pty](https://github.com/microsoft/node-pty), and
[Docker run](https://docs.docker.com/reference/cli/docker/container/run/).

### Verification recorded in this workspace

- Current runtime/application unit suite: 47 passed, 3 live Linux/gVisor tests skipped.
- Terminal/runtime-client scoped TypeScript and full production build: passed.
- Python worker tests and provisioning/removal/installer shell syntax: passed.
- Chromium browser flow: passed automatic guest startup without tokens, actual
  PTY pipeline execution, Files/Editor sharing, terminal readback, refresh
  reattachment, and isolation between two browser contexts. This used disposable
  native PTY/filesystem fixtures, not Linux containers.
- Windows/Caddy/WSL2 and Docker are absent here. The supplied host deployment is
  prepared but not activated or certified on Windows. Real image/quota and
  container acceptance remain explicit host checks.
