# Terminal isolation boundary

The terminal executes inside a mandatory gVisor sandbox. Its `/` is a private
Linux image; `/home/lope` is that visitor's persistent quota filesystem. `cd ..`
and absolute paths remain inside that Linux environment. Windows drives, the
hosting account's directories, WSL integration, other workspaces, host processes,
Docker sockets, and host network services are not exposed to terminal commands.
The website's automatic visitor flow is unchanged; visitors install nothing.

## Enforced policy

`services/runtime/sandbox-policy.js` is the common policy for container creation,
reuse, filesystem access, terminal startup, and cleanup. An `ISOLATION` failure
refuses execution. A running container with matching workspace/user ownership
labels is stopped immediately when its configuration is found unsafe. There is
no fallback to a host shell or a standard `runc` container.

The controller checks:

- The dedicated `lope-sandbox` runtime and its exact gVisor arguments. External
  networking, direct filesystem access by the Sentry, host Unix sockets, host
  FIFOs, and host character-device passthrough are disabled. Inodes are virtual.
  Runtime arguments cannot add overrides or bypasses.
- UID/GID 1000, all capabilities dropped, no-new-privileges, a read-only image,
  and no setuid/setgid executables in that image.
- Private PID, IPC, UTS and cgroup namespaces. Host namespace joins and joins to
  another container are rejected. Shared-sandbox annotations are rejected.
- One exact persistent bind source for that owner, mounted at `/home/lope`
  with private propagation. Extra volumes, bind mounts, Windows drives,
  container inheritance and device passthrough are rejected. The provisioner
  verifies that home is the expected loop-backed quota image before use.
- No external network, published ports, host aliases, LAN DNS, or inherited
  search domains. The sandbox's loopback is its own, not Windows/WSL loopback.
- A generic hostname and an allowlist of image environment metadata. Runtime
  credentials, cloud keys, proxy credentials, host PATH, and preload hooks are
  rejected. Docker CLI child processes also receive a restricted environment;
  that environment is never forwarded to the shell.
- CPU, memory, process, file-descriptor, core-dump and temporary-storage limits.

Execution uses the immutable container ID returned by inspection, so replacing a
container name cannot redirect a verified operation into another environment.
Before enabling a container generation, an immutable in-sandbox probe checks
for exposed host paths/devices, mount-path disclosure and external networking.
The probe receives no host secrets. A failed probe stops the container and
blocks filesystem/terminal requests. The public host installer additionally
runs a disposable gVisor visibility/PTY smoke check before enabling its service.

The filesystem API also independently rejects traversal and symlinked
components using descriptor-relative, no-follow operations. A symlink created
by a shell has ordinary Linux behavior within the gVisor root; it cannot name a
Windows or host file that is absent from that root. Explicit user uploads copy
selected bytes into the workspace; no host upload path is exposed to the shell.

## Host installation and upgrades

The Windows host still runs Caddy. Its Ubuntu WSL2 runtime host installs the
official signed gVisor release package and matching sidecars using
`services/runtime/install-sandbox-linux.sh`. The existing public installer calls
that step automatically, installs only the named `lope-sandbox` runtime entry,
and preserves unrelated Docker configuration. It does not change Docker's
default runtime for other applications. See [Windows hosting](windows-hosting.md).

An old container without policy version 2 is refused and, if running, stopped.
Recreate that LopeOS container with the updated provisioner; its persistent home
image must be retained. Removing a container does not require deleting its home
image. Do not change runtime names or relax the policy to reuse an old container.
If the WSL kernel cannot run gVisor or its PTYs, installation fails; no weaker
execution environment is enabled. A compatible Linux VM on the Windows host is
an alternative deployment location for the same service.

The Docker daemon, gVisor binaries and controller are trusted operator
components. Their configuration and keys must stay outside all workspaces.
The controller needs host authority to provision quota filesystems and
containers; terminal users never receive that authority or its API.

## Verification and limits

Regression tests reject host-root/drive/socket binds, wrong-home binds, shared
namespaces, devices, extra networks, credential injection, resource-limit
removal, runtime overrides and failed probes. They verify rejection happens
before user execution, owned unsafe containers are stopped, and actual exec
calls use the inspected container ID.

`services/runtime/isolation.acceptance.test.js` is a real-host canary check. On
the provisioned Linux/WSL2 Docker host, with a dedicated registered test workspace
and the same credential settings as the existing acceptance suite, run:

```sh
LOPE_ACCEPTANCE=1 node --test services/runtime/isolation.acceptance.test.js
```

It creates disposable, readable dummy data and a sentinel process/service on the
host, then checks through an actual PTY that direct paths, `/proc/1/root`,
symlinks, process listing, inherited credentials, host loopback and mount details
cannot reach those canaries. It verifies the host file remains unchanged and
cleans up its fixtures. It never reads genuine host secrets. The normal Linux
acceptance suite must also pass under gVisor for shell/tool compatibility.

Current combined runtime/application verification reports 47 passed and 3 live
Linux/gVisor tests skipped. The production build and script syntax checks pass.
Affected visitor/isolation tests were also rerun after the final changes.

This Mac has no Docker, gVisor or WSL2. Configuration/behavior tests can run here;
the real host-canary, Linux compatibility, quota and Windows deployment checks
remain explicitly unexecuted. A test fixture using a native PTY does not certify
this isolation boundary.

This policy prevents configured access to host resources. It is not a proof
against every future runtime/kernel vulnerability or hardware side channel;
CPU architecture/features and timing are not an information-theoretic secret.
The supported guarantee concerns filesystem, process, device, credential and
network access through the enforced boundary. Keep the host/runtime patched and
verify the actual deployment. gVisor's own
[security model](https://gvisor.dev/docs/architecture_guide/security/) describes
these limits; its [filesystem](https://gvisor.dev/docs/user_guide/filesystem/)
and [networking](https://gvisor.dev/docs/user_guide/networking/) guides document
the isolation settings used here.
