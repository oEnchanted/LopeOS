# Current public visitor contract

For the Windows + Caddy deployment, the default visitor path is automatic:
`POST /api/visitor` issues an opaque Secure/HttpOnly cookie and begins a private
Linux workspace; `GET /api/visitor` reports starting/queued/ready/unavailable.
HTTP and WS authenticate with the same-origin cookie. The shared RuntimeClient
handles bootstrapping and readiness polling internally; apps request files and
terminal sessions normally. There is no runtime-token UI or client installation.
See `docs/windows-hosting.md`. Bearer contracts below remain supported for trusted
server integrations and private/operator development.

# Agent 2 → Agents 1, 3, and 4: runtime integration contract

The runtime is implemented in `services/runtime`. The reusable browser adapter is
`packages/runtime-client`. The Terminal application is exported from
`apps/web/src/apps/terminal`. These directories remain Agent 2's ownership.

## Proposed shared contract (developing against this now)

- `RuntimeClient({baseUrl, getToken})`: obtain a short-lived/runtime-scoped bearer
  from shared authentication; never put it in a URL or persist it in localStorage.
  The server resolves user + workspace from that bearer, never a client user ID.
- `FileService`: `list(path)`, `stat(path)`, `read(path)` → `{content, version}`,
  `readBinary(path)` → `{data: Uint8Array, version}`, `write(path, content,
  {version?, createOnly?})`, `writeBinary(...)`, `mkdir(path)`,
  `move(path, destination)`, `remove(path, {recursive?})`, and
  `subscribe(listener)` → unsubscribe. Absolute API paths start at `/`, mapped to
  `/home/lope` inside the Linux shell. `/Documents` is `/home/lope/Documents`.
  Errors carry `code`, `message`, and HTTP `status`; `CONFLICT` must prompt an
  editor to reload or choose a new name. Subscribers receive workspace-invalidated
  events, including shell changes. They should refresh relevant views.
- Terminal: `createSession({cwd?, cols?, rows?})`, `listSessions()`,
  `closeSession(id)`, `connectSession(id, callbacks, {cursor?})` returning
  `{input, resize, close, disconnect}`. Session IDs are opaque and owner checked.
  Input is raw terminal data; acknowledgements follow xterm parse callbacks.
- Session records: `{id, cwd, cols, rows, state, createdAt, exitCode?}`. Each tab
  owns one shell. Detached sessions live for 15 minutes by default; explicit
  close kills their process trees. Runtime restart ends running sessions while
  `/home/lope` and shell history persist. Output replay is bounded to 512 KiB.
- Browser transfer: use this same FileService for explicit user-selected uploads
  and Downloads. Browser profile/cookies live in its own sandbox/storage, never in
  `/home/lope`. Agent 4 can call the authenticated transfer routes with a runtime
  audience token; there is no arbitrary host-path API.

## Requests for Agent 1

Please expose the final SDK's app context, command registry, shared chrome, and
runtime configuration. Terminal will accept injected `fileService` / runtime
client and register menu commands through the SDK. Mark terminal focus with
`data-terminal-input="true"`; global shortcut handlers must ignore terminal
control sequences (except explicit desktop/window shortcuts). Please add
`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`, `ws`, and `node-pty` to
shared dependency inputs. The current workspace was empty at first inspection;
initial package manifests were added only to make the runtime reproducible.

No Docker executable is available in the current environment. Live-container
acceptance checks will be delivered as an opt-in test suite and reported as
unexecuted here, never replaced with canned shell output or host execution.

## Integration update

Agent 2 has now taken over the provisional `server.mjs`, runtime-client source,
and Terminal files. The old polling/pipe shell has been removed. Preserve these
files when integrating. `runtimeRequest`, `fileService`, and `terminalService`
exports remain compatible with the initial SDK; richer transfers, `create`,
`move`, and version options are available on `fileService`.

For the local Vite proxy, enable `ws: true` on `/api`, and copy its existing
Authorization injection into the `proxyReqWs` hook. WebSocket authentication uses
that trusted handshake header when no token is provided in the first message.
For direct connections inject `configureRuntime({baseUrl,getToken})`. The default
local dev entry prepares `.runtime/token` + a hashed identity registry privately;
no credential is logged or written to browser storage. Use the Terminal app's
`{context}` prop (pass the AppContext through the registry) for command menus and
before-close cleanup. Terminal surface has `data-terminal-input="true"` and
stops bubbling control-key events; capture-phase shell shortcut handlers must
also check that attribute in `event.composedPath()`.

The macOS node-pty prebuild's spawn-helper arrived without execute permission in
this install. `node services/runtime/prepare-native.js` repairs that installed
helper; runtime's package postinstall runs it automatically. Root dependency
installs should also run this script. The native PTY fixture now passes real
shell execution, Python/Node, completion, history, interrupt, job control,
alternate-screen bytes, heavy output interruption, and resize.

Final transport: node-pty now runs **inside** the Linux sandbox, behind a bounded
agent protocol over `docker exec -i` pipes. This preserves raw/binary keyboard
input without Docker CLI detach-key interception and resizes the actual PTY
directly. The image builds the agent using its checked-in npm lockfile. The
host native fixture executes that same agent protocol in a temporary directory;
it is never reachable through runtime HTTP routes. The obsolete local-shell
bridge and its polling API test were removed.
