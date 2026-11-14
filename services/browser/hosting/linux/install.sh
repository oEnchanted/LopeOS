#!/usr/bin/env bash
# Run by the Windows/WSL host installer, or directly by a Linux operator.
set -euo pipefail
[[ $(uname -s) = Linux && $EUID = 0 ]] || { echo 'Run inside Linux/Ubuntu WSL as root.' >&2; exit 1; }
source_dir=${1:?Pass the reviewed source directory}
for tool in docker node systemctl iptables flock mkfs.ext4 losetup findmnt mountpoint; do command -v "$tool" >/dev/null || { echo "Missing browser prerequisite: $tool" >&2; exit 1; }; done
[[ $(node -p 'Number(process.versions.node.split(".")[0]) >= 24') = true ]] || { echo 'Node 24 or newer is required inside WSL.' >&2; exit 1; }
[[ $(docker context inspect --format '{{.Endpoints.docker.Host}}') = unix:///var/run/docker.sock ]] || { echo 'Use the local Linux Docker Engine.' >&2; exit 1; }
[[ $(docker info --format '{{.OperatingSystem}}') != *'Docker Desktop'* ]] || { echo 'Use Docker Engine inside Ubuntu WSL, not Docker Desktop.' >&2; exit 1; }
install -d -m 700 /opt/lope-browser /etc/lope-browser /var/lib/lope-browser /var/lib/lope-browser/profiles
install -m 700 "$source_dir/services/browser/hosting/linux/prepare-profile.sh" /opt/lope-browser/prepare-profile.sh
install -m 700 "$source_dir/services/browser/hosting/linux/prepare-network.sh" /opt/lope-browser/prepare-network.sh
install -m 700 "$source_dir/services/browser/hosting/linux/check-network.sh" /opt/lope-browser/check-network.sh
node "$source_dir/services/browser/hosting/linux/make-seccomp.mjs" "$source_dir/services/browser/hosting/linux/docker-default-seccomp.json" /etc/lope-browser/seccomp.json
chmod 600 /etc/lope-browser/seccomp.json
bash /opt/lope-browser/prepare-network.sh
# Curated build context: credentials, account data and browsing profiles are never sent to Docker.
build_context=$(mktemp -d /var/tmp/lope-browser-build.XXXXXX)
trap 'rm -rf "$build_context"' EXIT
mkdir -p "$build_context/services/browser" "$build_context/services/runtime" "$build_context/packages/browser-client"
cp -R "$source_dir/services/browser/src" "$source_dir/services/browser/infra" "$build_context/services/browser/"
cp -R "$source_dir/packages/browser-client/src" "$build_context/packages/browser-client/"
cp "$source_dir/services/runtime/browser-bridge.js" "$source_dir/services/runtime/config.js" "$build_context/services/runtime/"
docker build --pull -f "$build_context/services/browser/infra/Dockerfile" -t lope-browser:local "$build_context"
# Reapply only the browser bridge's policy after Docker/WSL restarts.
cat > /etc/systemd/system/lope-browser-network.service <<'SERVICE'
[Unit]
Description=Lope Browser isolated public-web network
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash /opt/lope-browser/prepare-network.sh
[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload
systemctl enable lope-browser-network.service
systemctl restart lope-browser-network.service
printf 'Browser image, namespace seccomp policy, bounded profiles and egress network are prepared.\n'
