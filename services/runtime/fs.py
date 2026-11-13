"""Bounded filesystem RPC worker; all path operations are relative to no-follow FDs.

The service invokes this immutable file as uid 1000 inside its owner's container.
It never receives or resolves host paths. The CLI has no configurable root.
"""
import base64
import contextlib
import ctypes
import errno
import hashlib
import json
import os
import secrets
import stat
import sys
import time

MAX_TRANSFER = 8 * 1024 * 1024
MAX_ENTRIES = 10000
MAX_COPY_BYTES = 1024 * 1024 * 1024

class FsError(Exception):
    def __init__(self, code, message): self.code, self.message = code, message

def parts(path):
    if not isinstance(path, str) or '\0' in path or len(path) > 4096:
        raise FsError('INVALID', 'Invalid workspace path.')
    if path == '/home/lope' or path.startswith('/home/lope/'):
        path = path[len('/home/lope'):]
    values = [x for x in path.split('/') if x and x != '.']
    if any(x == '..' or len(x.encode()) > 255 for x in values):
        raise FsError('FORBIDDEN', 'Parent traversal is not allowed.')
    return values

class FileSystem:
    def __init__(self, root='/home/lope'): self.root = root

    @contextlib.contextmanager
    def directory(self, values, create=False):
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for name in values:
                if create:
                    try: os.mkdir(name, mode=0o755, dir_fd=fd)
                    except FileExistsError: pass
                next_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd); fd = next_fd
            yield fd
        finally: os.close(fd)

    @contextlib.contextmanager
    def parent(self, values):
        if not values: raise FsError('FORBIDDEN', 'This operation cannot modify the workspace root.')
        with self.directory(values[:-1]) as fd: yield fd, values[-1]

    def info(self, fd, name, path):
        s = os.stat(name, dir_fd=fd, follow_symlinks=False)
        kind = 'directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else 'symlink' if stat.S_ISLNK(s.st_mode) else 'other'
        return {'name': name, 'path': path, 'type': kind, 'size': s.st_size, 'modifiedAt': s.st_mtime * 1000}

    def read_at(self, parent, name):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode): raise FsError('INVALID', 'Only regular files can be transferred.')
            if before.st_size > MAX_TRANSFER: raise FsError('LIMIT', 'The file exceeds the 8 MiB transfer limit.')
            data = bytearray()
            while True:
                chunk = os.read(fd, min(65536, MAX_TRANSFER + 1 - len(data)))
                if not chunk: break
                data.extend(chunk)
                if len(data) > MAX_TRANSFER: raise FsError('LIMIT', 'The file exceeds the 8 MiB transfer limit.')
            after = os.fstat(fd)
            if (before.st_mtime_ns, before.st_ctime_ns, before.st_size) != (after.st_mtime_ns, after.st_ctime_ns, after.st_size):
                raise FsError('CONFLICT', 'The file changed while being read. Retry the operation.')
            return bytes(data), after
        finally: os.close(fd)

    def stamp(self, s): return (s.st_ino, s.st_mtime_ns, s.st_ctime_ns, s.st_size)

    def remove_at(self, parent, name, recursive=False, depth=0, cleanup=False):
        s = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if not stat.S_ISDIR(s.st_mode): os.unlink(name, dir_fd=parent); return
        if recursive:
            if depth >= 64: raise FsError('LIMIT', 'Directory nesting exceeds the operation limit.')
            # Only private copy staging trees use this: preserved read-only modes
            # must not prevent cleanup after a failed copy.
            if cleanup: os.chmod(name, 0o700, dir_fd=parent, follow_symlinks=False)
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                names = os.listdir(fd)
                if len(names) > MAX_ENTRIES: raise FsError('LIMIT', 'Directory exceeds the operation limit.')
                for child in names: self.remove_at(fd, child, True, depth + 1, cleanup)
            finally: os.close(fd)
        os.rmdir(name, dir_fd=parent)

    def rename_exclusive(self, source_fd, source, dest_fd, dest):
        libc = ctypes.CDLL(None, use_errno=True)
        if hasattr(libc, 'renameat2'):
            result = libc.renameat2(source_fd, source.encode(), dest_fd, dest.encode(), 1) # RENAME_NOREPLACE
        elif hasattr(libc, 'renameatx_np'):
            result = libc.renameatx_np(source_fd, source.encode(), dest_fd, dest.encode(), 4) # RENAME_EXCL
        else: raise FsError('IO_ERROR', 'Atomic non-overwriting rename is unavailable.')
        if result:
            n = ctypes.get_errno(); raise OSError(n, os.strerror(n))

    def storage(self):
        with self.directory([]) as fd: s = os.fstatvfs(fd)
        return {'totalBytes': s.f_blocks * s.f_frsize,
                'usedBytes': (s.f_blocks - s.f_bfree) * s.f_frsize,
                'availableBytes': s.f_bavail * s.f_frsize,
                'scope': 'runtime-volume'}

    def copy_at(self, source, name, target, new, budget, depth=0):
        budget['entries'] += 1
        if depth >= 64 or budget['entries'] > MAX_ENTRIES:
            raise FsError('LIMIT', 'A copy supports up to 10,000 entries and 64 directory levels.')
        if time.monotonic() > budget['deadline']:
            raise FsError('LIMIT', 'This copy took too long. Copy fewer items at a time.')
        s = os.stat(name, dir_fd=source, follow_symlinks=False)
        if not (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)):
            raise FsError('FORBIDDEN', 'Copies support regular files and folders only. Links and special files cannot be copied.')
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        if stat.S_ISDIR(s.st_mode): flags |= os.O_DIRECTORY
        src = os.open(name, flags, dir_fd=source)
        try:
            before = os.fstat(src)
            if self.stamp(before) != self.stamp(s):
                raise FsError('CONFLICT', 'An item changed while copying. Try again.')
            if stat.S_ISDIR(before.st_mode):
                names = os.listdir(src)
                if len(names) + budget['entries'] > MAX_ENTRIES:
                    raise FsError('LIMIT', 'A copy supports up to 10,000 entries.')
                os.mkdir(new, 0o700, dir_fd=target)
                dst = os.open(new, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=target)
                try:
                    for child in names: self.copy_at(src, child, dst, child, budget, depth + 1)
                    os.fchmod(dst, before.st_mode & 0o777)
                    os.utime(dst, ns=(before.st_atime_ns, before.st_mtime_ns))
                    os.fsync(dst)
                finally: os.close(dst)
            else:
                if budget['bytes'] + before.st_size > MAX_COPY_BYTES:
                    raise FsError('LIMIT', 'A single copy supports up to 1 GiB of file data.')
                dst = os.open(new, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=target)
                try:
                    while True:
                        if time.monotonic() > budget['deadline']:
                            raise FsError('LIMIT', 'This copy took too long. Copy fewer items at a time.')
                        data = os.read(src, 1024 * 1024)
                        if not data: break
                        budget['bytes'] += len(data)
                        if budget['bytes'] > MAX_COPY_BYTES:
                            raise FsError('LIMIT', 'A single copy supports up to 1 GiB of file data.')
                        chunk = memoryview(data)
                        while chunk:
                            written = os.write(dst, chunk)
                            if not written: raise FsError('IO_ERROR', 'The copied file could not be written.')
                            chunk = chunk[written:]
                    os.fchmod(dst, before.st_mode & 0o777)
                    os.utime(dst, ns=(before.st_atime_ns, before.st_mtime_ns))
                    os.fsync(dst)
                finally: os.close(dst)
            if self.stamp(os.fstat(src)) != self.stamp(before):
                raise FsError('CONFLICT', 'An item changed while copying. Try again.')
        finally: os.close(src)

    def copy(self, values, destination):
        # Build privately, then publish the complete result with an atomic,
        # non-overwriting rename. Failed copies never expose a partial target.
        with self.parent(values) as (src, name), self.parent(destination) as (dst, new):
            try: os.stat(new, dir_fd=dst, follow_symlinks=False)
            except FileNotFoundError: pass
            else: raise FsError('CONFLICT', 'The destination already exists.')
            temp = '.lope-copy-' + secrets.token_hex(16)
            os.mkdir(temp, 0o700, dir_fd=dst)
            stage = os.open(temp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dst)
            try:
                self.copy_at(src, name, stage, 'item', {'entries': 0, 'bytes': 0, 'deadline': time.monotonic() + 10})
                self.rename_exclusive(stage, 'item', dst, new)
                os.fsync(dst)
            finally:
                try: self.remove_at(stage, 'item', True, cleanup=True)
                except FileNotFoundError: pass
                finally: os.close(stage)
                os.rmdir(temp, dir_fd=dst)

    def snapshot(self):
        h = hashlib.sha256(); count = 0
        def walk(fd, prefix, depth):
            nonlocal count
            if depth > 64: raise FsError('LIMIT', 'Snapshot nesting limit exceeded.')
            for name in sorted(os.listdir(fd)):
                count += 1
                if count > 100000: raise FsError('LIMIT', 'Snapshot entry limit exceeded.')
                try:
                    s = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    h.update(repr((prefix + name, s.st_mtime_ns, s.st_ctime_ns, s.st_size, s.st_mode)).encode())
                    if stat.S_ISDIR(s.st_mode):
                        child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                        try: walk(child, prefix + name + '/', depth + 1)
                        finally: os.close(child)
                except (FileNotFoundError, NotADirectoryError): pass # A concurrent shell mutation; next poll observes it.
        with self.directory([]) as fd: walk(fd, '', 0)
        return h.hexdigest()

    def execute(self, q):
        op = q.get('op'); values = parts(q.get('path', '/')); path = '/' + '/'.join(values)
        if op == 'snapshot': return self.snapshot()
        if op == 'storage': return self.storage()
        if op == 'list':
            with self.directory(values) as fd:
                names = sorted(os.listdir(fd))
                if len(names) > MAX_ENTRIES: raise FsError('LIMIT', 'Use the shell to inspect directories over 10,000 entries.')
                entries = []
                for name in names:
                    try: entries.append(self.info(fd, name, path.rstrip('/') + '/' + name))
                    except FileNotFoundError: pass
                return entries
        if op == 'stat':
            with self.directory(values[:-1]) as fd: return self.info(fd, values[-1] if values else '.', path)
        if op == 'read':
            with self.parent(values) as (fd, name): data, _ = self.read_at(fd, name)
            return {'data': base64.b64encode(data).decode(), 'version': hashlib.sha256(data).hexdigest()}
        if op == 'write':
            if not isinstance(q.get('data'), str): raise FsError('INVALID', 'Expected base64 file content.')
            data = base64.b64decode(q['data'], validate=True)
            if len(data) > MAX_TRANSFER: raise FsError('LIMIT', 'The file exceeds the 8 MiB transfer limit.')
            expected = q.get('version')
            if expected is not None and (not isinstance(expected, str) or len(expected) != 64): raise FsError('INVALID', 'Invalid file version.')
            with self.parent(values) as (fd, name):
                previous = None
                try:
                    previous = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if not stat.S_ISREG(previous.st_mode): raise FsError('FORBIDDEN', 'Only regular files can be replaced.')
                    if q.get('createOnly'): raise FsError('CONFLICT', 'A file already exists at this path.')
                except FileNotFoundError: pass
                if expected is not None:
                    if previous is None: raise FsError('CONFLICT', 'The file was deleted.')
                    old, previous = self.read_at(fd, name)
                    if hashlib.sha256(old).hexdigest() != expected: raise FsError('CONFLICT', 'The file changed. Reload it before saving.')
                temp = '.lope-save-' + secrets.token_hex(16)
                target = os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                try:
                    with os.fdopen(target, 'wb') as stream:
                        stream.write(data); stream.flush(); os.fchmod(stream.fileno(), (previous.st_mode & 0o777) if previous else 0o644); os.fsync(stream.fileno())
                    if expected is not None:
                        try: current = os.stat(name, dir_fd=fd, follow_symlinks=False)
                        except FileNotFoundError: raise FsError('CONFLICT', 'The file was deleted while saving.')
                        if self.stamp(current) != self.stamp(previous): raise FsError('CONFLICT', 'The file changed while saving.')
                    if q.get('createOnly'):
                        os.link(temp, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
                    else: os.replace(temp, name, src_dir_fd=fd, dst_dir_fd=fd)
                    os.fsync(fd)
                finally:
                    try: os.unlink(temp, dir_fd=fd)
                    except FileNotFoundError: pass
                result = self.info(fd, name, path); result['version'] = hashlib.sha256(data).hexdigest(); return result
        if op == 'mkdir':
            if q.get('recursive'):
                with self.directory(values, create=True): pass
            else:
                with self.parent(values) as (fd, name): os.mkdir(name, mode=0o755, dir_fd=fd)
            return self.execute({'op': 'stat', 'path': path})
        if op in ('move', 'copy'):
            destination = parts(q.get('destination'))
            if not values or not destination: raise FsError('FORBIDDEN', 'This operation cannot modify the workspace root.')
            if destination[:len(values)] == values:
                raise FsError('INVALID', 'Choose a destination outside the source item.')
            if op == 'copy': self.copy(values, destination)
            else:
                with self.parent(values) as (src, name), self.parent(destination) as (dst, new):
                    self.rename_exclusive(src, name, dst, new)
                    os.fsync(src); os.fsync(dst)
            return self.execute({'op': 'stat', 'path': '/' + '/'.join(destination)})
        if op == 'delete':
            expected = q.get('version')
            if expected is not None and (not isinstance(expected, str) or len(expected) != 64): raise FsError('INVALID', 'Invalid file version.')
            with self.parent(values) as (fd, name):
                if expected is not None:
                    old, previous = self.read_at(fd, name)
                    if hashlib.sha256(old).hexdigest() != expected: raise FsError('CONFLICT', 'The file changed before deletion. Local changes were preserved.')
                    current = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if self.stamp(current) != self.stamp(previous): raise FsError('CONFLICT', 'The file changed before deletion.')
                self.remove_at(fd, name, q.get('recursive') is True)
            return None
        raise FsError('INVALID', 'Unknown filesystem operation.')

def respond(worker, q):
    try: return {'ok': True, 'result': worker.execute(q)}
    except FsError as e: return {'ok': False, 'error': {'code': e.code, 'message': e.message}}
    except Exception as e:
        code = 'CONFLICT' if isinstance(e, FileExistsError) else 'NOT_FOUND' if isinstance(e, FileNotFoundError) else 'FORBIDDEN' if isinstance(e, PermissionError) or getattr(e, 'errno', None) in (errno.ELOOP, errno.ENOTDIR) else 'NO_SPACE' if getattr(e, 'errno', None) in (errno.ENOSPC, errno.EDQUOT) else 'INVALID' if isinstance(e, (ValueError, KeyError, TypeError)) else 'IO_ERROR'
        return {'ok': False, 'error': {'code': code, 'message': {'CONFLICT': 'The destination already exists.', 'NOT_FOUND': 'The file or directory does not exist.', 'FORBIDDEN': 'This path cannot be accessed.', 'NO_SPACE': 'Workspace storage is full.', 'INVALID': 'Invalid filesystem request.', 'IO_ERROR': 'The filesystem operation failed.'}[code]}}

if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(12 * 1024 * 1024 + 1)
        if len(raw) > 12 * 1024 * 1024: raise ValueError()
        request = json.loads(raw)
        print(json.dumps(respond(FileSystem(), request)))
    except Exception: print(json.dumps({'ok': False, 'error': {'code': 'INVALID', 'message': 'Invalid filesystem request.'}}))
