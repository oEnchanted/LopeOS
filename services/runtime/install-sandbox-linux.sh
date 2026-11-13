#!/usr/bin/env bash
# Operator-only host step; public visitors never install anything.
set -euo pipefail
[[ $(uname -s) = Linux && $EUID = 0 ]] || { echo 'Configure gVisor inside the Linux/WSL2 host as root.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if ! command -v runsc >/dev/null; then
  # Official signed release repository; apt installs runsc and its matching sidecars.
  apt-get update
  apt-get install -y ca-certificates curl gnupg apt-transport-https
  staging=$(mktemp -d)
  trap 'rm -rf -- "$staging"' EXIT
  curl --fail --silent --show-error --location https://gvisor.dev/archive.key -o "$staging/archive.key"
  gpg --batch --yes --dearmor -o "$staging/archive.gpg" "$staging/archive.key"
  install -m 0644 "$staging/archive.gpg" /usr/share/keyrings/gvisor-archive-keyring.gpg
  printf 'deb [arch=%s signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/gvisor.list
  apt-get update
  apt-get install -y runsc
fi
sandbox_binary=$(command -v runsc)
# Fail before activating a runtime that lacks the required isolation features.
mapfile -t sandbox_args < <(cd "$script_dir" && node --input-type=module -e 'import {RUNTIME_ARGUMENTS} from "./sandbox-policy.js"; console.log(RUNTIME_ARGUMENTS.join("\n"))')
[[ ${#sandbox_args[@]} -ge 6 ]] || exit 1
"$sandbox_binary" "${sandbox_args[@]}" --version >/dev/null
node "$script_dir/configure-runsc.js" "$sandbox_binary"
systemctl reload docker
docker info --format '{{json .Runtimes}}' | node "$script_dir/sandbox-policy.js" runtime
printf 'Configured dedicated gVisor runtime with external networking and host socket access disabled.\n'
