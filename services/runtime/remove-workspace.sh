#!/usr/bin/env bash
# Retention cleanup for a server-generated anonymous workspace only.
set -euo pipefail
[[ $(uname -s) = Linux && $EUID = 0 ]] || exit 1
user_id=${1:?}; workspace_id=${2:?}; container_name=${3:?}
[[ $user_id =~ ^guest-[a-f0-9]{32}$ && $workspace_id = "$user_id" && $container_name = "lope-$user_id" ]] || exit 1
state_dir=${LOPE_STATE_DIR:-/var/lib/lopeos}
[[ $state_dir = /* && $state_dir != / && $state_dir != *','* ]] || exit 1
docker info >/dev/null
if docker inspect "$container_name" >/dev/null 2>&1; then
  [[ $(docker inspect --format '{{index .Config.Labels "lope.workspace"}}' "$container_name") = "$workspace_id" ]] || exit 1
  docker rm --force "$container_name" >/dev/null
fi
workspace_home="$state_dir/homes/$workspace_id"
if mountpoint -q "$workspace_home"; then umount "$workspace_home"; fi
if [[ -d $workspace_home ]]; then rmdir "$workspace_home"; fi
rm -f -- "$state_dir/images/$workspace_id.ext4"
