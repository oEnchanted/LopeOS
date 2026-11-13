# LopeOS account service

This service stores LopeOS accounts and synced data on the hosting server. Every
account has **1,000,000,000 bytes (1 GB)** of free storage. Using the desktop without
an account remains supported. Cloud authentication is independent of the runtime
visitor cookie and does not grant terminal or host access.

## Development

`npm run dev` starts the account service on loopback port 4176 alongside Vite and
the workspace runtime. `npm run dev:accounts` starts it independently. Vite proxies
`/api/accounts/*` before its generic runtime route. Data defaults to `.accounts-data`
in the working directory; it is ignored by version control and denied by Vite.

Run `npm run test:accounts` for HTTP integration tests using temporary directories.
Tests cover credentials, cookies, isolation, restart persistence, quota races,
checksums, revision conflicts, staged uploads, origin checks, and storage locks.

## Automatic Windows hosting

Pushes to `main` install/update this service through the Windows deployment workflow.
The runner needs administrator rights; the account process itself runs as Local
Service in an at-startup scheduled task named `LopeOS Accounts`. Node and source
live under `C:/LopeOS/accounts`; persistent account and LopeDrive data lives under
`C:/LopeOS/accounts-data`, outside website releases. Deployment verifies local
and public `/api/accounts/session` responses. See [Windows deployment](../../docs/github-windows-deployment.md).

## Manual production hosting

Run a **single instance** of `node services/accounts/server.mjs` with Node 24 or
later under your service manager. It requires no third-party packages. Use these
environment variables:

```sh
NODE_ENV=production
LOPE_ACCOUNTS_ORIGINS=https://your-lopeos-domain.example
LOPE_ACCOUNTS_DATA=/var/lib/lopeos-accounts
LOPE_ACCOUNTS_PORT=4176
LOPE_ACCOUNTS_TRUST_PROXY=1
```

Create the data directory for the dedicated service user with mode 0700. Keep it
outside the web document root and on a persistent volume. Serve the built `dist`
over HTTPS and reverse proxy `/api/accounts/*` to `127.0.0.1:4176`, preserving Origin
and Cookie headers and response Set-Cookie. Do not inject shared Authorization
headers. The Windows Caddy template in `services/runtime/windows/Caddyfile` includes
this route before `/api/*`. The existing runtime host installer does not install
the account service: start it separately on the hosting machine, or within WSL
with loopback forwarding. Rebuild and restart services after updating the source.

When `LOPE_ACCOUNTS_TRUST_PROXY=1`, an exact single-IP X-Forwarded-For header is
trusted **only from loopback** for rate limits. Configure the proxy to overwrite
that header with the client IP. Without this option, requests use the direct peer
IP; a proxy's users would share its sign-in rate limit. Do not expose port 4176
directly to the internet. Multiple exact origins may be comma-separated; wildcard
origins are not supported. Production refuses non-HTTPS origins.

Back up the entire data directory as a coherent snapshot. Stop the service or use
an atomic filesystem snapshot while taking a backup. Registry and manifest writes
use atomic replacement and flushing; uploaded blobs are verified before commit.
An exclusive `.lock` file prevents multiple quota writers. Graceful shutdown
removes it. After an unclean shutdown, confirm the old process has stopped before
removing a stale `.lock` and restarting. Do not share this storage between running
replicas; a multi-instance deployment needs a transactional database/object store.

No live hosting or DNS changes are performed by adding this service. Disk capacity,
availability, TLS, service startup, and server backups remain host responsibilities.

## Authentication and storage contract

All endpoints are below `/api/accounts`. Mutations require an Origin matching the
configured website. Auth/manifest mutations use `application/json`. Sessions use
random opaque 256-bit tokens in HttpOnly, SameSite=Lax cookies; production adds
Secure and the `__Host-` prefix. Only SHA-256 token hashes are stored, with a 30-day
expiry and at most 20 active sessions per account. Passwords use salted scrypt
(N=32768, r=8, p=1) and constant-time verification. Passwords must have 12–1,024
characters. Account names use 1–32 lower-case ASCII letters, numbers, underscores,
or hyphens, beginning with a letter; system names are reserved. Display names have
1–64 characters. Registration and login are rate limited by account name and IP.

| Method and route | Request / response |
| --- | --- |
| POST `/register` | `{accountName,displayName,password}` → authenticated session |
| POST `/login` | `{accountName,password}` → authenticated session |
| GET `/session` | `{account:null\|{id,accountName,displayName,createdAt},quotaBytes,usedBytes}` |
| POST `/logout` | `{}` → revokes current session and clears its cookie |
| GET `/manifest` | `{revision,entries,quotaBytes,usedBytes}` |
| PUT `/blobs/:hash` | Raw bytes; verifies lower-case SHA-256 hex; returns `{hash,size,quotaBytes,usedBytes}` |
| GET `/blobs/:hash` | Authenticated owner’s raw bytes |
| PUT `/manifest` | `{baseRevision,entries}` → next revision and storage totals |
| POST `/cleanup` | `{}` → deletes unreferenced staged uploads; never published data |

Each manifest entry is `{key,hash,size,modifiedAt}`, where `modifiedAt` is an ISO
timestamp and key is an opaque, unique string (up to 2,048 characters, no control
characters). Keys never become filesystem paths. Each blob is limited to 64 MiB;
larger user files must be chunked by the client. Manifest JSON is limited to 24 MiB
and 100,000 entries. Multiple entries can reference the same blob without paying
for duplicate bytes. Account data is isolated by server-owned UUID directories.

Errors are `{error:{code,message}}`. Common statuses are 401 for an expired session,
409 `REVISION_CONFLICT` for a concurrent manifest update, 400 `MISSING_BLOB` for
missing staged content, and 413 `QUOTA_EXCEEDED` for full storage. Merge after a
revision conflict; never overwrite a manifest without its current base revision.
Verify downloaded checksums in the client before applying content locally.
Send `X-Lope-Account: <expected-account-id>` on storage requests. The service rejects
a mismatched cookie with 409 `SESSION_CHANGED`, preventing an in-flight sync from
using a different account after another tab changes the shared browser cookie.

The quota includes committed content **and staged uploads**. Staged bytes expire
after one hour if unpublished; abandoned uploads can be removed with `/cleanup`.
Only invoke explicit cleanup when this device has no pending uploads. Another
device can be uploading concurrently and should retry a resulting `MISSING_BLOB`.
Committing a manifest retains recent unreferenced uploads from other devices and
removes old blobs replaced or deleted from the previous manifest. Uploading a new
version needs free quota for the new bytes until commit; at capacity, first remove
unneeded synced items or clear abandoned staging. No upload can exceed the quota,
including simultaneous requests.

The initial service uses username/password sign-in without email or password
recovery. It does not promise end-to-end encryption; configure disk encryption and
server backups on the host. Authentication secrets and temporary runtime identities
must never be included in workspace sync records.
