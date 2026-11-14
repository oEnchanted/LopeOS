#!/usr/bin/env bash
# Reports the GPU this host can lend browser workers, as KEY=VALUE lines the
# gateway reads at startup. Read-only: it changes no device, driver or permission.
#   KIND=wsl   WSL2 GPU paravirtualization (/dev/dxg, Mesa's D3D12 driver); renders only.
#              No DRM node is lent: WSL's placeholder node renders nothing, and
#              Selkies' X server would draw a black screen on it.
#   KIND=dri   a Linux DRM render node (Intel/AMD through Mesa, NVIDIA through its toolkit)
#   KIND=none  no usable GPU; workers render and encode on the CPU
set -euo pipefail

# WSL2: Windows shares its GPU through /dev/dxg and maps the vendor's user-mode
# driver into /usr/lib/wsl/drivers. With no vendor driver (a VM with only a
# virtual display adapter), Windows has nothing but its WARP software renderer,
# which is no faster than Chromium's own software path.
if [[ -c /dev/dxg ]]; then
  if [[ -e /usr/lib/wsl/lib/libd3d12.so ]] && compgen -G '/usr/lib/wsl/drivers/*' >/dev/null; then
    echo KIND=wsl
  else
    echo KIND=none
    echo 'REASON=Windows has no GPU driver to share with WSL'
  fi
  exit 0
fi

for node in /dev/dri/renderD*; do
  [[ -c $node ]] || continue
  driver=$(basename "$(readlink -f "/sys/class/drm/$(basename "$node")/device/driver" 2>/dev/null || true)")
  case $driver in
    i915|xe|amdgpu|radeon|nouveau) ;;
    # NVIDIA's user-space driver reaches containers only through its toolkit.
    nvidia*) command -v nvidia-container-cli >/dev/null || continue; driver=nvidia ;;
    *) continue ;;
  esac
  echo KIND=dri
  echo "NODE=$node"
  echo "GID=$(stat -c %g "$node")"
  echo "DRIVER=$driver"
  exit 0
done
echo KIND=none
echo 'REASON=No GPU render node on this host'
