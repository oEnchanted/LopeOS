#!/usr/bin/env bash
# Install the browser host tools inside the dedicated Ubuntu WSL distribution.
# This script never changes Windows features, restarts Windows, or edits Caddy.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
[[ $(uname -s) = Linux && $EUID = 0 ]] || { echo 'Run inside Ubuntu WSL as root.' >&2; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[[ ${ID:-} = ubuntu && ${VERSION_ID:-} = 24.04 ]] || { echo 'This installer requires Ubuntu 24.04 LTS.' >&2; exit 1; }
[[ $(cat /proc/1/comm) = systemd ]] || { echo 'Enable systemd for this WSL distribution before installing Docker.' >&2; exit 1; }
[[ -z ${DOCKER_HOST:-} || $DOCKER_HOST = unix:///var/run/docker.sock ]] || { echo 'Refusing an external Docker endpoint.' >&2; exit 1; }
[[ -z ${DOCKER_CONTEXT:-} || $DOCKER_CONTEXT = default ]] || { echo 'Use the default local Docker context.' >&2; exit 1; }
for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
  if [[ $(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true) = installed ]]; then
    echo "Conflicting existing package requires an operator check: $package" >&2
    exit 1
  fi
done
if command -v docker >/dev/null; then
  [[ $(docker context inspect --format '{{.Endpoints.docker.Host}}') = unix:///var/run/docker.sock ]] || { echo 'Refusing an external Docker context.' >&2; exit 1; }
fi
# Do not start a preconfigured daemon that would expose its root control API.
if [[ -f /etc/docker/daemon.json ]] && grep -Eq 'tcp://|"tlsverify"[[:space:]]*:[[:space:]]*false' /etc/docker/daemon.json; then
  echo 'Existing Docker daemon endpoint configuration requires an operator check.' >&2; exit 1
fi
if systemctl cat docker.service 2>/dev/null | grep -q 'tcp://'; then
  echo 'Existing Docker service TCP endpoint requires an operator check.' >&2; exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl jq xz-utils tar iptables util-linux e2fsprogs systemd-sysv
install -d -m 0755 /etc/apt/keyrings
docker_key=$(mktemp)
trap 'rm -f "$docker_key"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 3 https://download.docker.com/linux/ubuntu/gpg -o "$docker_key"
install -m 0644 "$docker_key" /etc/apt/keyrings/docker.asc
docker_source=$(mktemp)
cat > "$docker_source" <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
if [[ -f /etc/apt/sources.list.d/docker.sources ]] && ! cmp -s "$docker_source" /etc/apt/sources.list.d/docker.sources; then
  rm -f "$docker_source"
  echo 'Existing Docker apt source differs from the reviewed official repository.' >&2; exit 1
fi
install -m 0644 "$docker_source" /etc/apt/sources.list.d/docker.sources
rm -f "$docker_source"
apt-get update
apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin
systemctl enable --now docker.service
[[ $(docker context inspect --format '{{.Endpoints.docker.Host}}') = unix:///var/run/docker.sock ]] || { echo 'Docker must use the local Unix socket.' >&2; exit 1; }
[[ $(docker info --format '{{.OperatingSystem}}') != *'Docker Desktop'* ]] || { echo 'Use the local Ubuntu Docker Engine.' >&2; exit 1; }
[[ ! -L /var/run/docker.sock && $(stat -c '%a' /var/run/docker.sock) = 660 ]] || { echo 'Docker socket must have mode 660.' >&2; exit 1; }
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  case $(dpkg --print-architecture) in amd64) node_arch=x64;; arm64) node_arch=arm64;; *) echo 'Unsupported Node binary architecture.' >&2; exit 1;; esac
  node_temp=$(mktemp -d)
  trap 'rm -f "$docker_key"; rm -rf "$node_temp"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 3 https://nodejs.org/dist/index.json -o "$node_temp/index.json"
  node_version=$(jq -er 'first(.[] | select(.version | test("^v24\\.[0-9]+\\.[0-9]+$")) | select(.lts != false)) | .version' "$node_temp/index.json")
  [[ $node_version =~ ^v24\.[0-9]+\.[0-9]+$ ]] || { echo 'Could not select an official Node 24 LTS release.' >&2; exit 1; }
  node_archive="node-$node_version-linux-$node_arch.tar.xz"
  for file in SHASUMS256.txt "$node_archive"; do
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 3 "https://nodejs.org/dist/$node_version/$file" -o "$node_temp/$file"
  done
  awk -v archive="$node_archive" '$2 == archive {print; found=1} END {if (!found) exit 1}' "$node_temp/SHASUMS256.txt" > "$node_temp/node.sha256"
  (cd "$node_temp" && sha256sum --check node.sha256)
  install -d -m 0755 /opt/lope-browser-node
  tar -xJf "$node_temp/$node_archive" -C /opt/lope-browser-node --no-same-owner
  node_target="/opt/lope-browser-node/node-$node_version-linux-$node_arch/bin/node"
  chmod -R go-w "/opt/lope-browser-node/node-$node_version-linux-$node_arch"
  if [[ -e /usr/local/bin/node || -L /usr/local/bin/node ]]; then
    [[ -L /usr/local/bin/node && $(readlink /usr/local/bin/node) = /opt/lope-browser-node/*/bin/node ]] || { echo 'Existing /usr/local/bin/node requires an operator check.' >&2; exit 1; }
  fi
  ln -sfn "$node_target" /usr/local/bin/node
fi
node --version
docker version --format 'Docker Engine {{.Server.Version}}'
systemctl is-active docker.service
printf 'Ubuntu browser prerequisites are installed. No Windows restart or Caddy changes were performed.\n'
