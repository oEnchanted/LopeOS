# GitHub updates to Caddy on Windows

The deployment workflow builds LopeOS on GitHub and sends the finished website to
a runner on your Windows server. Caddy serves versioned releases from
`C:/LopeOS/releases`; its services and user data live outside the runner checkout.
The workflow updates the frontend and installs/updates Lope Accounts automatically.
When creating a deployment template from an existing Caddyfile, it replaces the
explicit LopeOS HTTPS site and preserves other domains, including shared aliases.
Imported or ambiguous LopeOS site definitions require a host-provided template.
Linux workspace files still need the separate host setup below.

These instructions assume a private repository, a Windows x64 server, and a real
HTTPS origin such as `https://lope.example.com`. Replace that example throughout.
Windows service startup, WSL networking, and a live deployment still need testing
on your server; they have not been verified on the development Mac.

## 1. Prepare the host and services

Install Caddy at `C:/Caddy/caddy.exe`. Point your domain's DNS records to the server
and allow TCP ports 80 and 443 through the Windows firewall and any router or
hosting firewall. Caddy needs persistent, writable certificate storage under its
service account. See [Caddy's HTTPS requirements](https://caddyserver.com/docs/automatic-https).

For Terminal and workspace folders, follow [Windows host preparation](windows-hosting.md):
Ubuntu WSL2 with systemd, Node 24+, Docker Engine inside that Ubuntu distribution,
and the build/filesystem prerequisites. The host installer configures gVisor.
Docker Desktop's separate daemon is not supported by this allocator. Run the
setup as the Windows user who owns the WSL distribution. After the initial build
in step 2, use an elevated PowerShell in the repository:

```powershell
.\services\runtime\windows\Configure-LopeRuntime.ps1 `
  -SiteOrigin https://lope.example.com -Distro Ubuntu -RegisterStartupTask
```

This installs the runtime on loopback port 4174. For this deployment, use the
release template in step 2 instead of `Caddyfile.windows.generated`, which points
to the checkout's `dist`. Verify the WSL startup task after a Windows reboot.

Lope Accounts is installed by the push workflow. The Windows runner must have
administrator rights to register its startup task and assign directory permissions.
The installer runs the account server as **Local Service**, independently of the
runner, on loopback port 4176. It uses Node 24 from the workflow and copies the
runtime and account code into versioned folders under `C:/LopeOS/accounts`.
Accounts, password hashes, sessions, and LopeDrive sync data remain in
`C:/LopeOS/accounts-data` across releases. Never publish or delete this directory.

The installer gracefully stops its existing task before replacing code, verifies
its local JSON session endpoint, and restores the previous service configuration
if the new process fails to start. It refuses to take over a port occupied by a
manually started server. Logs are at `C:/LopeOS/accounts/logs/service.log`.
The task starts at Windows boot and restarts after failures. A stale lock is removed
only when its recorded process no longer exists; an ambiguous/live lock is retained.

The workflow installs its reviewed frontend publisher, preserves an existing
Caddy template, adds the account route if absent, and verifies the public account
endpoint as well as the frontend. When creating a template, it refuses to replace
a configuration serving other domains. Neither 4176 nor 4174 needs router forwarding.

Lope Browser's public, per-visitor Chromium/Selkies deployment is a separate,
unfinished integration. This workflow does not activate it. See the
[browser integration status](browser-integration.md#implemented-handoff); the
development browser worker's shared credentials/profile are not a public gateway.

## 2. Build and initialize the first release

Use Node 24+ and the repository's pnpm version for the first build. In a trusted
checkout on Windows, run:

```powershell
npm install --global pnpm@10.32.1
pnpm install --frozen-lockfile
pnpm build
```

Complete the runtime/account setup above if you want those features, then prepare
the deployment directories. Run these commands from the repository root. The
`initial` directory must be new so the whole `dist` becomes that release:

```powershell
New-Item -ItemType Directory -Force -Path `
  C:/Caddy, C:/LopeOS/deploy, C:/LopeOS/releases, C:/LopeOS/shared/assets

Copy-Item .\services\runtime\windows\Caddyfile.deploy.template C:/Caddy/Caddyfile.template
Copy-Item .\services\runtime\windows\Deploy-LopeFrontend.ps1 C:/LopeOS/deploy/Deploy-LopeFrontend.ps1

if (Test-Path C:/LopeOS/releases/initial) { throw 'Choose a new release directory.' }
Copy-Item -LiteralPath .\dist -Destination C:/LopeOS/releases/initial -Recurse

& C:/LopeOS/deploy/Deploy-LopeFrontend.ps1 `
  -ReleasePath C:/LopeOS/releases/initial `
  -SiteOrigin https://lope.example.com `
  -CaddyExe C:/Caddy/caddy.exe `
  -Caddyfile C:/Caddy/Caddyfile `
  -CaddyTemplate C:/Caddy/Caddyfile.template `
  -SharedAssetsPath C:/LopeOS/shared/assets `
  -Initialize
```

Keep the template's `__LOPE_SITE_HOST__`, `__LOPE_WEB_ROOT__`, and
`__LOPE_ASSET_ROOT__` placeholders: the script fills them from its arguments.
`-Initialize` requires the target Caddyfile to be absent. It checks release hashes,
copies shared assets, and writes a validated configuration; it does not start
Caddy or perform the HTTPS check. For an existing running Caddy installation,
preserve its current configuration, include its other site blocks in
`Caddyfile.template`, and omit `-Initialize` to perform a normal deployment.

Create and start Caddy's Windows service from elevated PowerShell. Absolute paths
ensure startup does not depend on a working directory:

```powershell
sc.exe create caddy start= auto binPath= "C:\Caddy\caddy.exe run --config C:\Caddy\Caddyfile --adapter caddyfile"
sc.exe start caddy
```

For an existing Caddy service, update its configured command instead of creating
a second service. The service account needs read access to releases, shared
assets, and its configuration. Follow
[Caddy's Windows service instructions](https://caddyserver.com/docs/running#windows-service)
for service management. Keep Caddy's administration endpoint on loopback;
deployment uses it to reload the configuration.

After Caddy has obtained its certificate, verify the initial release:

```powershell
$published = Invoke-RestMethod https://lope.example.com/__lope/version.json
$expected = Get-Content C:/LopeOS/releases/initial/__lope/version.json -Raw | ConvertFrom-Json
if ($published.build -ne $expected.build) { throw 'The published release does not match.' }
Invoke-RestMethod https://lope.example.com/api/accounts/session
```

The account endpoint should return JSON with `account: null` when called without
a session. If the frontend loads but this request fails, finish the account
service setup before testing sign-in.

## 3. Connect the Windows deployment runner

In your private GitHub repository, open **Settings → Actions → Runners → New
self-hosted runner**, select Windows and x64, and follow the generated commands in
`C:/actions-runner`. During configuration, add the `lope-production` label and
choose installation as a Windows service. Use a dedicated Windows runner account with administrator rights; the workflow
needs to register the Local Service startup task and set private directory ACLs. See
[GitHub's runner setup](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)
and [Windows service setup](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application).

The workflow uses Windows PowerShell. Give its service account write access to
`C:/LopeOS/releases`, `C:/LopeOS/shared`, and the deployment configuration
files in `C:/Caddy`, including the ability to create/replace configuration files.
It needs read/execute access to Caddy and the host-installed deployment script.
The workflow updates the publisher and account service from its tested artifact.
The runner requires administrative rights, but does not need WSL workspace access.
Access to Caddy's loopback administration endpoint permits configuration changes;
reserve this runner for trusted production deployment jobs.

Create a GitHub environment named **production**. Add the Actions variable
`LOPE_SITE_ORIGIN` with the exact origin, such as `https://lope.example.com`, without
a trailing slash. You can set it on that environment or on the repository. Limit
the environment to `main`. The workflow expects these runner
labels: `self-hosted`, `Windows`, `X64`, and `lope-production`.

Commit [.github/workflows/deploy-windows.yml](../.github/workflows/deploy-windows.yml)
and the deployment source files to your private repository. Use **Actions → Deploy
LopeOS to Windows → Run workflow** on `main` for the first automated release.
Subsequent pushes to `main` deploy automatically. Do not add pull-request jobs to this production
runner. Publisher and account code changes deploy automatically. Existing customized Caddy
templates are preserved; changes beyond the account route remain host-managed.

## 4. Check updates and roll back

Each deployment verifies the release manifest, retains hashed `/assets` files in
`C:/LopeOS/shared/assets`, validates and reloads Caddy, then checks the published
HTTPS build identifier. A failed activation restores the previous Caddy
configuration. Old release folders and shared assets are retained for rollback
and browsers with an earlier release open.

After deployment, open the public site in a fresh browser session. In an existing
LopeOS session, use **Settings → Software Update** to check and install the new
release; an already cached session can keep using its current version. Test
account creation/sign-in and a saved-file round trip. For the Linux runtime, test
Terminal, workspace Files, two separate browser identities, and recovery after a
host reboot as described in [Windows hosting verification](windows-hosting.md#verification).

To roll back the frontend, choose a retained release and invoke the same script
without `-Initialize`. For example:

```powershell
& C:/LopeOS/deploy/Deploy-LopeFrontend.ps1 `
  -ReleasePath C:/LopeOS/releases/initial `
  -SiteOrigin https://lope.example.com `
  -CaddyExe C:/Caddy/caddy.exe `
  -Caddyfile C:/Caddy/Caddyfile `
  -CaddyTemplate C:/Caddy/Caddyfile.template `
  -SharedAssetsPath C:/LopeOS/shared/assets
```

Keep account storage, `/var/lib/lopeos` workspace homes and visitor identities,
`/etc/lopeos/visitors.env`, and Caddy certificate storage outside release cleanup.
Back them up separately. Frontend rollback does not roll back user data or
backend services. Update backend source and restart services through their host
procedures; rebuilding a workspace image alone does not replace existing visitor
containers. Preserve their home images when planning runtime upgrades.
