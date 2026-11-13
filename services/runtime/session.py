"""Start/close one controlling-terminal session, within the user's container."""
import fcntl
import json
import os
import pathlib
import re
import signal
import sys
import subprocess
import termios
import time

mode = sys.argv[1]
registry = pathlib.Path('/tmp/lope-sessions')
registry.mkdir(mode=0o700, exist_ok=True)
if mode == 'reap':
    for record in registry.iterdir():
        if re.fullmatch('[a-f0-9]{32}', record.name): subprocess.run([sys.executable, '-I', __file__, 'close', record.name], check=True)
    raise SystemExit(0)
session_id = sys.argv[2]
if not re.fullmatch('[a-f0-9]{32}', session_id): raise SystemExit('Invalid session ID')
record = registry / session_id

def process_session(pid):
    try:
        text = pathlib.Path('/proc/%d/stat' % pid).read_text()
        fields = text.rsplit(')', 1)[1].split()
        return int(fields[3]), fields[19] # session ID and starttime (PID reuse guard)
    except (FileNotFoundError, ProcessLookupError): return None

if mode == 'start':
    # The sandbox node-pty agent supplies a real PTY; make the shell's job-control session explicit.
    if os.getsid(0) != os.getpid(): os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    pid = os.getpid()
    identity = process_session(pid)
    fd = os.open(record, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream: json.dump({'pid': pid, 'session': os.getsid(0), 'start': identity[1]}, stream)
    cwd = sys.argv[3]
    values = [x for x in cwd.split('/') if x]
    if any(x in ('.', '..') for x in values): raise SystemExit('Invalid working directory')
    fd = os.open('/home/lope', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for value in values:
            child = os.open(value, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
        os.fchdir(fd)
    finally: os.close(fd)
    shell = '/bin/zsh' if sys.argv[4] == 'zsh' else '/bin/bash'
    env = {'HOME': '/home/lope', 'USER': 'lope', 'LOGNAME': 'lope', 'SHELL': shell, 'PATH': '/usr/local/bin:/usr/bin:/bin', 'TERM': 'xterm-256color', 'LANG': 'C.UTF-8', 'COLORTERM': 'truecolor', 'LOPE_TERMINAL_SESSION': session_id}
    os.execve(shell, [shell, '-i'], env)
elif mode == 'close':
    try:
        fd = os.open(record, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as stream: entry = json.load(stream)
    except FileNotFoundError: raise SystemExit(0)
    # Session IDs are not reused while any member survives. If the shell still
    # exists, also verify its start time before signaling descendants.
    original = process_session(entry['pid'])
    if original is not None and original != (entry['session'], entry['start']): raise SystemExit('Stale session')
    def members():
        result = []
        for path in pathlib.Path('/proc').iterdir():
            try: owned = path.name.isdigit() and path.stat().st_uid == os.getuid()
            except FileNotFoundError: continue
            if owned:
                pid = int(path.name); identity = process_session(pid)
                try: tagged = ('LOPE_TERMINAL_SESSION=' + session_id).encode() in (path / 'environ').read_bytes().split(b'\0')
                except (FileNotFoundError, PermissionError, ProcessLookupError): tagged = False
                if identity and (identity[0] == entry['session'] or tagged) and pid != os.getpid(): result.append(pid)
        return result
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid in members():
            try: os.kill(pid, sig)
            except ProcessLookupError: pass
        if sig == signal.SIGTERM: time.sleep(0.15)
    record.unlink(missing_ok=True)
else: raise SystemExit('Invalid operation')
