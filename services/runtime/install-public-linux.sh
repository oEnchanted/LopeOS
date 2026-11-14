#!/usr/bin/env bash
# Operator installation inside Ubuntu WSL2 or a Linux host. Visitors do nothing.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
[[ $(uname -s) = Linux && $EUID = 0 ]] || { echo 'Run this installer as root inside Ubuntu/WSL2.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=linux-node-toolchain.sh
. "$script_dir/linux-node-toolchain.sh"
lope_linux_node_toolchain
site_origin=${1:?Pass the exact https:// website origin}
source_dir=${2:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}
# npm builds node-pty from source on Linux; install its toolchain once.
if ! command -v make >/dev/null || ! command -v g++ >/dev/null || ! command -v python3 >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential python3
fi
for command in docker systemctl tar mountpoint mkfs.ext4 losetup findmnt; do command -v "$command" >/dev/null || { echo "Install the host prerequisite: $command" >&2; exit 1; }; done
# Check exactly, without letting an operator-supplied origin enter shell code.
node --input-type=module -e 'const u = new URL(process.argv[1]); if (u.protocol !== "https:" || u.origin !== process.argv[1]) process.exit(1)' "$site_origin"
[[ $(docker context inspect --format '{{.Endpoints.docker.Host}}') = unix:///var/run/docker.sock ]] || { echo 'Use Docker Engine installed inside this WSL distribution.' >&2; exit 1; }
[[ $(docker info --format '{{.OperatingSystem}}') != *'Docker Desktop'* ]] || { echo 'Use Ubuntu Docker Engine, not the separate Docker Desktop daemon.' >&2; exit 1; }
[[ $(ps -p 1 -o comm=) = systemd ]] || { echo 'Enable systemd for this WSL2 distribution, then restart it.' >&2; exit 1; }
install_dir=/opt/lopeos-runtime
mkdir -p "$install_dir" /etc/lopeos /var/lib/lopeos/control
chmod 700 /etc/lopeos /var/lib/lopeos /var/lib/lopeos/control
# Keep native dependencies and persistent visitor data separate from source updates.
tar --exclude='node_modules' --exclude='test' --exclude='*.test.js' --exclude='__pycache__' -cf - -C "$source_dir/services/runtime" . | tar -xf - -C "$install_dir"
cd "$install_dir"
"$LOPE_NODE_EXE" "$LOPE_NPM_CLI" install --omit=dev --no-audit --no-fund
bash "$install_dir/install-sandbox-linux.sh"
docker build -t lope-workspace:local .
# Verify PTYs actually work under gVisor before enabling visitor execution.
docker run --rm --runtime lope-sandbox --hostname lope --read-only \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --network none --ipc private --cgroupns private \
  --cpus 1 --memory 512m --memory-swap 512m --pids-limit 128 \
  --ulimit core=0:0 --ulimit nproc=128:128 --ulimit nofile=2048:2048 \
  --tmpfs /tmp:rw,nosuid,nodev,size=67108864,mode=1777 \
  lope-workspace:local node /usr/local/lib/lope-sandbox-smoke.cjs
# Existing allocation limits may be edited in this host-only environment file.
if [[ ! -f /etc/lopeos/visitors.env ]]; then
  umask 077
  cat > /etc/lopeos/visitors.env <<ENV
LOPE_ALLOWED_ORIGINS=$site_origin
LOPE_RUNTIME_HOST=127.0.0.1
LOPE_RUNTIME_PORT=4174
LOPE_STATE_DIR=/var/lib/lopeos
LOPE_MAX_ACTIVE=8
LOPE_MAX_VISITORS=128
LOPE_STORAGE_MB=512
LOPE_GUEST_RETENTION_DAYS=30
LOPE_TRUST_PROXY=1
ENV
else
  echo 'Preserving /etc/lopeos/visitors.env; ensure its origin matches the Caddy site.'
fi
cat > /etc/systemd/system/lope-visitor-runtime.service <<SERVICE
[Unit]
Description=LopeOS automatic visitor Linux workspaces
After=docker.service network-online.target
Requires=docker.service
# Never give up restarting; the public desktop depends on this service.
StartLimitIntervalSec=0

[Service]
Type=simple
# Trusted allocator: creates quota filesystems and isolated non-root containers.
User=root
WorkingDirectory=$install_dir
EnvironmentFile=/etc/lopeos/visitors.env
ExecStart="$LOPE_NODE_EXE" $install_dir/public-server.js
Restart=always
RestartSec=3
TimeoutStopSec=15
MemoryMax=768M
TasksMax=256

[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload
systemctl enable lope-visitor-runtime.service
systemctl restart lope-visitor-runtime.service
printf 'Visitor runtime installed. Caddy on Windows should proxy /api/* to 127.0.0.1:4174.\n'
