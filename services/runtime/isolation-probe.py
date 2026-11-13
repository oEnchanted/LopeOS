"""Non-secret in-sandbox defense checks. Never supplied host credentials or data."""
import json
import os
import pathlib
import socket
import sys

errors = []
if os.getuid() != 1000 or os.getgid() != 1000: errors.append('identity')
if socket.gethostname() != 'lope': errors.append('hostname')
for name in ['/host', '/mnt/c', '/mnt/d', '/run/desktop', '/mnt/wsl', '/init', '/var/run/docker.sock', '/run/docker.sock', '/run/containerd/containerd.sock', '/dev/kvm', '/dev/mem', '/dev/sda', '/etc/lopeos', '/var/lib/lopeos/control', '/proc/sys/fs/binfmt_misc/WSLInterop']:
    if os.path.lexists(name): errors.append('outside-path')
try:
    mounts = pathlib.Path('/proc/self/mountinfo').read_text()
    if any(value in mounts for value in ['/var/lib/docker/', '/var/lib/lopeos/', '/run/desktop/', 'drvfs', 'C:\\', 'D:\\']): errors.append('mount-disclosure')
except OSError: errors.append('mount-view')
try:
    devices = [p for p in pathlib.Path('/sys/class/block').iterdir()]
    if devices: errors.append('host-block-devices')
except FileNotFoundError: pass
# With two independent network-none boundaries, host/LAN/metadata endpoints have no route.
for address in ['169.254.169.254', '192.0.2.1']:
    connection = socket.socket(); connection.settimeout(0.15)
    try:
        if connection.connect_ex((address, 80)) == 0: errors.append('external-network')
    finally: connection.close()
print(json.dumps({'ok': not errors, 'checks': sorted(set(errors))}))
sys.exit(0 if not errors else 1)
