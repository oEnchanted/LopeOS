#!/usr/bin/env bash
# Run on the Linux Docker host. This creates a real, persistent size-limited home.
set -euo pipefail
if [[ $(uname -s) != Linux || $EUID != 0 ]]; then
  echo 'Run this provisioning script as root on the Linux Docker host.' >&2; exit 1
fi
user_id=${1:-local}
workspace_id=${2:-local}
container_name=${3:-lope-local}
storage_mb=${LOPE_STORAGE_MB:-512}
state_dir=${LOPE_STATE_DIR:-/var/lib/lopeos}
for identifier in "$user_id" "$workspace_id" "$container_name"; do
  [[ $identifier =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$ ]] || { echo 'Invalid identifier' >&2; exit 1; }
done
[[ $storage_mb =~ ^[0-9]+$ && $storage_mb -ge 128 && $storage_mb -le 2048 ]] || { echo 'LOPE_STORAGE_MB must be 128..2048' >&2; exit 1; }
[[ $state_dir = /* && $state_dir != / && $state_dir != *','* ]] || { echo 'Invalid LOPE_STATE_DIR' >&2; exit 1; }
for tool in node docker truncate mkfs.ext4 mount mountpoint findmnt losetup; do command -v "$tool" >/dev/null; done
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
docker info --format '{{json .Runtimes}}' | node "$script_dir/sandbox-policy.js" runtime
mkdir -p "$state_dir/images" "$state_dir/homes"
chmod 700 "$state_dir" "$state_dir/images" "$state_dir/homes"
image="$state_dir/images/$workspace_id.ext4"
workspace_home="$state_dir/homes/$workspace_id"
mkdir -p "$workspace_home"
if [[ ! -f $image ]]; then
  temporary_image="$image.new"
  truncate -s "${storage_mb}M" "$temporary_image"
  chmod 600 "$temporary_image"
  mkfs.ext4 -q -m 0 "$temporary_image"
  mv -f "$temporary_image" "$image"
fi
if ! mountpoint -q "$workspace_home"; then mount -o loop,nodev,nosuid "$image" "$workspace_home"; fi
[[ $(findmnt -n -o FSTYPE --target "$workspace_home") == ext4 ]] || { echo 'Expected the dedicated ext4 home mount' >&2; exit 1; }
mounted_device=$(findmnt -n -o SOURCE --target "$workspace_home")
[[ $mounted_device =~ ^/dev/loop[0-9]+$ && $(findmnt -n -o FSROOT --target "$workspace_home") = / ]] || { echo 'Home must be the dedicated quota image.' >&2; exit 1; }
losetup --json --output BACK-FILE "$mounted_device" | node --input-type=module -e 'import fs from "node:fs"; const v=JSON.parse(fs.readFileSync(0,"utf8")); if(v.loopdevices?.length !== 1 || fs.realpathSync(v.loopdevices[0]["back-file"]) !== fs.realpathSync(process.argv[1])) process.exit(1)' "$image"
chown --no-dereference 1000:1000 "$workspace_home"
chmod 700 "$workspace_home"
for directory in Documents Downloads Projects; do
  if [[ ! -e $workspace_home/$directory && ! -L $workspace_home/$directory ]]; then mkdir "$workspace_home/$directory"; chown --no-dereference 1000:1000 "$workspace_home/$directory"; fi
done
if docker inspect "$container_name" >/dev/null 2>&1; then
  if [[ ${LOPE_REUSE_CONTAINER:-0} = 1 ]]; then
    docker inspect "$container_name" | node "$script_dir/sandbox-policy.js" container "$user_id" "$workspace_id" "$container_name" "$state_dir" --stopped
    docker start "$container_name" >/dev/null
    exit 0
  fi
  echo 'Container already exists. Configuration is immutable; stop/remove it explicitly to reprovision.' >&2; exit 1
fi
runtime_image=${LOPE_WORKSPACE_IMAGE:-lope-workspace:local}
if [[ ${LOPE_SKIP_BUILD:-0} != 1 ]]; then docker build -t "$runtime_image" "$script_dir"; fi
labels=()
if [[ ${LOPE_MANAGED_PUBLIC:-0} = 1 ]]; then labels+=(--label lope.managed=public); fi
docker run -d --name "$container_name" --init --restart no \
  --runtime lope-sandbox --hostname lope --ipc private --cgroupns private \
  --user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges \
  --cpus 1 --memory 512m --memory-swap 512m --pids-limit 128 \
  --ulimit nofile=2048:2048 --ulimit core=0:0 --ulimit nproc=128:128 --network none \
  --dns 127.0.0.1 --dns-search . --dns-option ndots:0 --log-driver none \
  --tmpfs /tmp:rw,nosuid,nodev,size=67108864,mode=1777 --shm-size 32m \
  --mount "type=bind,source=$workspace_home,target=/home/lope" \
  --label "lope.user=$user_id" --label "lope.workspace=$workspace_id" \
  --label lope.sandbox-policy=2 --label lope.storage-limited=true "${labels[@]}" "$runtime_image" >/dev/null
docker inspect "$container_name" | node "$script_dir/sandbox-policy.js" container "$user_id" "$workspace_id" "$container_name" "$state_dir"
printf 'Workspace %s for %s is running in %s. Home capacity is %s MiB.\n' "$workspace_id" "$user_id" "$container_name" "$storage_mb"
printf 'Persistent image: %s\nAfter reboot mount it at %s before starting Docker containers.\n' "$image" "$workspace_home"
