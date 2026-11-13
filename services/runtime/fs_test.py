import base64
import concurrent.futures
import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('lope_fs', pathlib.Path(__file__).with_name('fs.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class FileServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name); self.worker = module.FileSystem(str(self.root))
    def call(self, op, path='/', **kw): return module.respond(self.worker, {'op': op, 'path': path, **kw})
    def write(self, path, content, **kw): return self.call('write', path, data=base64.b64encode(content).decode(), **kw)
    def read(self, path):
        result = self.call('read', path); self.assertTrue(result['ok'], result)
        return base64.b64decode(result['result']['data']), result['result']['version']
    def test_real_binary_directory_rename_and_delete(self):
        self.assertTrue(self.call('mkdir', '/Documents')['ok'])
        data = bytes(range(256)) + '你好 🌙'.encode()
        saved = self.write('/Documents/a.bin', data, createOnly=True)
        self.assertTrue(saved['ok'], saved); self.assertEqual(self.read('/Documents/a.bin')[0], data)
        renamed = self.call('move', '/Documents/a.bin', destination='/Documents/b.bin')
        self.assertTrue(renamed['ok'], renamed)
        self.assertEqual(self.call('list', '/Documents')['result'][0]['name'], 'b.bin')
        self.assertTrue(self.call('delete', '/Documents', recursive=True)['ok'])
        self.assertFalse((self.root / 'Documents').exists())
    def test_editor_conflict_with_a_shell_write(self):
        self.write('/shared.txt', b'from terminal')
        old, version = self.read('/shared.txt')
        subprocess.run(['/bin/sh', '-c', 'printf "changed by shell" > shared.txt'], cwd=self.root, check=True)
        result = self.write('/shared.txt', b'editor overwrites', version=version)
        self.assertEqual(result['error']['code'], 'CONFLICT')
        self.assertEqual(self.read('/shared.txt')[0], b'changed by shell')
        _, latest = self.read('/shared.txt')
        self.assertTrue(self.write('/shared.txt', b'saved by editor', version=latest)['ok'])
        self.assertEqual((self.root / 'shared.txt').read_text(), 'saved by editor')
        self.assertFalse(list(self.root.glob('.lope-save-*')))
    def test_sync_delete_preserves_concurrent_edits(self):
        self.write('/synced.txt', b'cloud version')
        _, version = self.read('/synced.txt')
        self.write('/synced.txt', b'new local edit')
        result = self.call('delete', '/synced.txt', version=version)
        self.assertEqual(result['error']['code'], 'CONFLICT')
        self.assertEqual(self.read('/synced.txt')[0], b'new local edit')
        _, current = self.read('/synced.txt')
        self.assertTrue(self.call('delete', '/synced.txt', version=current)['ok'])
        self.assertFalse((self.root / 'synced.txt').exists())
    def test_atomic_create_race_and_rename_no_overwrite(self):
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda i: self.write('/collision.txt', str(i).encode(), createOnly=True), range(12)))
        self.assertEqual(sum(x['ok'] for x in results), 1)
        self.write('/other.txt', b'keep me')
        result = self.call('move', '/collision.txt', destination='/other.txt')
        self.assertEqual(result['error']['code'], 'CONFLICT')
        self.assertEqual(self.read('/other.txt')[0], b'keep me')
    def test_traversal_symlink_and_special_file_rejection(self):
        outside = tempfile.TemporaryDirectory(); self.addCleanup(outside.cleanup)
        pathlib.Path(outside.name, 'secret').write_text('outside')
        (self.root / 'escape').symlink_to(outside.name)
        (self.root / 'file-link').symlink_to(pathlib.Path(outside.name, 'secret'))
        for path in ['/../secret', 'a/../../secret', '/escape/secret', '/file-link']:
            self.assertIn(self.call('read', path)['error']['code'], ('FORBIDDEN', 'NOT_FOUND'))
        self.assertEqual(self.write('/escape/new', b'no')['error']['code'], 'FORBIDDEN')
        self.assertEqual(self.write('/file-link', b'no')['error']['code'], 'FORBIDDEN')
        self.assertFalse(pathlib.Path(outside.name, 'new').exists())
        os.mkfifo(self.root / 'fifo')
        self.assertEqual(self.call('read', '/fifo')['error']['code'], 'INVALID')
        self.assertEqual(self.call('delete', '/')['error']['code'], 'FORBIDDEN')
        # Recursive deletion unlinks a symlink rather than traversing its target.
        self.call('mkdir', '/nested'); (self.root / 'nested/link').symlink_to(outside.name)
        self.assertTrue(self.call('delete', '/nested', recursive=True)['ok'])
        self.assertEqual(pathlib.Path(outside.name, 'secret').read_text(), 'outside')
    def test_shell_changes_affect_snapshot_and_home_alias(self):
        before = self.call('snapshot')['result']
        subprocess.run(['/bin/sh', '-c', 'mkdir shell; printf hello > shell/new.txt'], cwd=self.root, check=True)
        self.assertNotEqual(before, self.call('snapshot')['result'])
        self.assertEqual(self.read('/home/lope/shell/new.txt')[0], b'hello')
    def test_bounded_transfer_and_existing_mode(self):
        self.write('/run.sh', b'exit 0\n'); (self.root / 'run.sh').chmod(0o750)
        self.assertTrue(self.write('/run.sh', b'exit 1\n')['ok'])
        self.assertEqual((self.root / 'run.sh').stat().st_mode & 0o777, 0o750)
        with open(self.root / 'large', 'wb') as stream: stream.truncate(module.MAX_TRANSFER + 1)
        self.assertEqual(self.call('read', '/large')['error']['code'], 'LIMIT')
        self.assertEqual(self.call('write', '/bad', data='%%%')['error']['code'], 'INVALID')

    def test_storage_reports_the_runtime_volume(self):
        result = self.call('storage')
        self.assertTrue(result['ok'], result)
        info = result['result']; actual = os.statvfs(self.root)
        self.assertEqual(info['scope'], 'runtime-volume')
        self.assertEqual(info['totalBytes'], actual.f_blocks * actual.f_frsize)
        self.assertGreaterEqual(info['usedBytes'], 0)
        self.assertGreaterEqual(info['availableBytes'], 0)
        self.assertLessEqual(info['usedBytes'] + info['availableBytes'], info['totalBytes'])

    def test_recursive_copy_preserves_bytes_metadata_and_source(self):
        self.call('mkdir', '/source/nested', recursive=True)
        data = bytes(range(256)) * 33000 # Server-side copies exceed the browser transfer limit.
        original = self.root / 'source/nested/large.bin'; original.write_bytes(data)
        original.chmod(0o640); os.utime(original, ns=(1700000000000000000, 1700000000000000000))
        result = self.call('copy', '/home/lope/source', destination='/copy')
        self.assertTrue(result['ok'], result)
        copied = self.root / 'copy/nested/large.bin'
        self.assertEqual(copied.read_bytes(), data)
        self.assertEqual(original.read_bytes(), data)
        self.assertEqual(copied.stat().st_mode & 0o777, 0o640)
        self.assertEqual(copied.stat().st_mtime_ns, original.stat().st_mtime_ns)
        self.assertFalse(list(self.root.glob('.lope-copy-*')))

    def test_copy_never_overwrites_and_rejects_self_descendant_or_root(self):
        self.write('/source.txt', b'source'); self.write('/keep.txt', b'keep')
        result = self.call('copy', '/source.txt', destination='/keep.txt')
        self.assertEqual(result['error']['code'], 'CONFLICT')
        self.assertEqual(self.read('/keep.txt')[0], b'keep')
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda _: self.call('copy', '/source.txt', destination='/race.txt'), range(12)))
        self.assertEqual(sum(x['ok'] for x in results), 1)
        self.assertEqual(self.read('/race.txt')[0], b'source')
        self.call('mkdir', '/folder')
        for op in ['copy', 'move']:
            for source, target in [('/folder', '/folder/inside'), ('/folder', '/home/lope/folder'), ('/', '/new'), ('/source.txt', '/')]:
                self.assertFalse(self.call(op, source, destination=target)['ok'])
        self.assertTrue((self.root / 'folder').is_dir())
        self.assertFalse(list(self.root.glob('.lope-copy-*')))

    def test_failed_copy_cleans_staging_and_never_follows_links(self):
        outside = tempfile.TemporaryDirectory(); self.addCleanup(outside.cleanup)
        secret = pathlib.Path(outside.name, 'secret'); secret.write_text('outside')
        self.call('mkdir', '/source/readonly', recursive=True)
        self.write('/source/readonly/a.txt', b'first')
        (self.root / 'source/readonly').chmod(0o555)
        self.addCleanup(lambda: (self.root / 'source/readonly').chmod(0o755))
        (self.root / 'source/link').symlink_to(secret)
        result = self.call('copy', '/source', destination='/failed')
        self.assertEqual(result['error']['code'], 'FORBIDDEN')
        self.assertFalse((self.root / 'failed').exists())
        self.assertFalse(list(self.root.glob('.lope-copy-*')))
        self.assertEqual(secret.read_text(), 'outside')
        os.mkfifo(self.root / 'fifo')
        self.assertEqual(self.call('copy', '/fifo', destination='/fifo-copy')['error']['code'], 'FORBIDDEN')
        self.assertFalse(list(self.root.glob('.lope-copy-*')))

    def test_copy_detects_concurrent_source_changes_and_cleans_limits(self):
        self.write('/changing.txt', b'old')
        read = os.read; changed = False
        def concurrent_read(fd, count):
            nonlocal changed
            data = read(fd, count)
            if data and not changed:
                changed = True; (self.root / 'changing.txt').write_bytes(b'new content')
            return data
        with patch.object(module.os, 'read', concurrent_read):
            result = self.call('copy', '/changing.txt', destination='/copy.txt')
        self.assertEqual(result['error']['code'], 'CONFLICT')
        self.assertFalse((self.root / 'copy.txt').exists())
        self.call('mkdir', '/many'); self.write('/many/a', b'one'); self.write('/many/b', b'two')
        with patch.object(module, 'MAX_ENTRIES', 2):
            self.assertEqual(self.call('copy', '/many', destination='/too-many')['error']['code'], 'LIMIT')
        with patch.object(module, 'MAX_COPY_BYTES', 2):
            self.assertEqual(self.call('copy', '/changing.txt', destination='/too-large')['error']['code'], 'LIMIT')
        self.assertFalse((self.root / 'too-many').exists())
        self.assertFalse((self.root / 'too-large').exists())
        self.assertFalse(list(self.root.glob('.lope-copy-*')))

if __name__ == '__main__': unittest.main()
