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
  if [[ $count -ge 100 ]]; then
    # Reclaim the least recently used profile that has been idle for a week and has no
    # running browser. Validate its loop backing file; never follow links or recurse.
    cutoff=$(( $(date +%s) - 7 * 86400 ))
    while read -r used candidate; do
      [[ $used -lt $cutoff ]] || break
      owner=$(basename "$candidate")
      [[ $owner =~ ^[a-f0-9]{64}$ && ! -L $candidate && ! -L $candidate/home && ! -L $candidate/profile.ext4 ]] || continue
      [[ -z $(docker ps -q --filter "label=lope.browser.owner=$owner") ]] || continue
      if mountpoint -q "$candidate/home"; then
        device=$(findmnt -n -o SOURCE --target "$candidate/home")
        [[ $device = /dev/loop* && $(losetup -n -O BACK-FILE "$device") = "$candidate/profile.ext4" ]] || continue
        umount "$candidate/home" || continue
      fi
      rm -f "$candidate/profile.ext4" "$candidate/last-used"
      rmdir "$candidate/home" "$candidate" 2>/dev/null || continue
      count=$((count - 1)); break
    done < <(for dir in "$profile_root"/*/; do dir=${dir%/}; printf '%s %s\n' "$(stat -c %Y "$dir/last-used" 2>/dev/null || echo 0)" "$dir"; done | sort -n)
  fi
  [[ $count -lt 100 ]] || { echo 'Browser profile capacity has been reached.' >&2; exit 1; }
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
  # discard returns deleted blocks to the sparse image so profiles do not only grow.
  mount -o loop,nosuid,nodev,noexec,discard "$image" "$profile/home"
fi
device=$(findmnt -n -o SOURCE --target "$profile/home")
[[ "$device" = /dev/loop* && $(losetup -n -O BACK-FILE "$device") = "$image" ]] || exit 1
chown 1000:1000 "$profile/home"; chmod 700 "$profile/home"
touch "$profile/last-used"
printf '%s\n' "$profile/home"
