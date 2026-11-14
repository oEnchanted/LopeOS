#!/usr/bin/env bash
set -euo pipefail
[[ $EUID = 0 && ${1-} =~ ^[a-f0-9]{64}$ ]] || exit 1
profile_root=/var/lib/lope-browser/profiles
mkdir -p "$profile_root"; chmod 700 "$profile_root"
exec 9>/var/lib/lope-browser/profile.lock
flock 9
profile="$profile_root/$1"
[[ ! -L "$profile" ]] || exit 1
if [[ ! -d "$profile" ]]; then
  count=$(find "$profile_root" -mindepth 1 -maxdepth 1 -type d -printf . | wc -c)
  [[ $count -lt 32 ]] || { echo 'Browser profile capacity has been reached.' >&2; exit 1; }
  mkdir -m 700 "$profile"
fi
image="$profile/profile.ext4"
if [[ ! -f "$image" ]]; then
  [[ ! -e "$image" ]] || exit 1
  truncate -s 2G "$image"; chmod 600 "$image"
  mkfs.ext4 -q -m 0 "$image"
fi
[[ ! -L "$image" ]] || exit 1
mkdir -p "$profile/home"
if ! mountpoint -q "$profile/home"; then
  mount -o loop,nosuid,nodev,noexec "$image" "$profile/home"
fi
device=$(findmnt -n -o SOURCE --target "$profile/home")
[[ "$device" = /dev/loop* && $(losetup -n -O BACK-FILE "$device") = "$image" ]] || exit 1
chown 1000:1000 "$profile/home"; chmod 700 "$profile/home"
touch "$profile/last-used"
printf '%s\n' "$profile/home"
