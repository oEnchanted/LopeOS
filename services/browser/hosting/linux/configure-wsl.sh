#!/usr/bin/env bash
# Enable systemd only in the selected browser distro, preserving other WSL settings.
set -euo pipefail
[[ $EUID = 0 ]] || { echo 'Run WSL configuration as root.' >&2; exit 1; }
if [[ $(cat /proc/1/comm) = systemd ]]; then exit 0; fi
python3 - <<'PY'
from pathlib import Path
import configparser
path = Path('/etc/wsl.conf')
source = path.read_text() if path.exists() else ''
config = configparser.ConfigParser()
config.read_string(source)
if not config.has_section('boot'):
    config.add_section('boot')
config.set('boot', 'systemd', 'true')
if path.exists():
    backup = Path('/etc/wsl.conf.before-lope-browser')
    if not backup.exists():
        backup.write_text(source)
with path.open('w') as output:
    config.write(output, space_around_delimiters=False)
PY
echo 'Systemd is configured; the selected browser distro needs a WSL restart.'
