import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, access, realpath, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./linux-node-toolchain.sh', import.meta.url));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function fixture(t, { bundled = true, systemNpm = false, platform = 'linux', version = '24.15.0' } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lope Linux toolchain ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nativeBin = path.join(root, 'node24', 'bin'), systemBin = path.join(root, 'system-bin'), windowsBin = path.join(root, 'Windows Node');
  await Promise.all([nativeBin, systemBin, windowsBin].map(directory => mkdir(directory, { recursive: true })));
  const nativeNode = path.join(nativeBin, 'node'), prelude = path.join(root, 'linux-fixture.cjs'), marker = path.join(root, 'windows-npm-ran');
  // Emulate Linux metadata while executing the real Node interpreter on macOS too.
  await writeFile(prelude, `Object.defineProperty(process, 'platform', { value: process.env.LOPE_FIXTURE_PLATFORM });
Object.defineProperty(process.versions, 'node', { value: process.env.LOPE_FIXTURE_VERSION });
Object.defineProperty(process, 'execPath', { value: process.env.LOPE_FIXTURE_NODE });
`);
  await writeFile(nativeNode, `#!/bin/sh\nexec ${quote(process.execPath)} --require ${quote(prelude)} "$@"\n`, { mode: 0o755 });
  await symlink(nativeNode, path.join(systemBin, 'node'));
  await writeFile(path.join(windowsBin, 'npm'), '#!/bin/sh\nprintf windows > "$LOPE_FIXTURE_MARKER"\nexit 91\n', { mode: 0o755 });
  const npmCli = bundled ? path.join(nativeBin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js') : path.join(root, 'system-npm', 'npm-cli.js');
  if (bundled || systemNpm) {
    await mkdir(path.dirname(npmCli), { recursive: true });
    await writeFile(npmCli, `const { spawnSync } = require('node:child_process');
if (process.argv[2] === '--version') console.log('11.0.0');
else {
  const lifecycle = spawnSync('node', ['--eval', 'process.stdout.write(process.platform + ":" + process.execPath)'], { encoding: 'utf8' });
  if (lifecycle.status !== 0) process.exit(lifecycle.status || 1);
  console.log(JSON.stringify({ platform: process.platform, node: process.execPath, args: process.argv.slice(2), lifecycle: lifecycle.stdout, searchPath: process.env.PATH }));
}
`);
    if (systemNpm) await symlink(npmCli, path.join(systemBin, 'npm'));
  }
  const run = () => spawnSync('/bin/bash', ['-c', `set -euo pipefail
. "$1"
lope_linux_node_toolchain "$2"
"$LOPE_NODE_EXE" "$LOPE_NPM_CLI" install --omit=dev --no-audit --no-fund
`, 'lope-toolchain-test', helper, systemBin], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${windowsBin}:${process.env.PATH}`, LOPE_FIXTURE_PLATFORM: platform, LOPE_FIXTURE_VERSION: version, LOPE_FIXTURE_NODE: nativeNode, LOPE_FIXTURE_MARKER: marker },
  });
  return { run, nativeBin, nativeNode, marker, windowsBin };
}

test('a Linux node symlink recovers its bundled npm and excludes inherited Windows npm', async t => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const installed = JSON.parse(result.stdout);
  assert.equal(installed.platform, 'linux');
  assert.equal(installed.node, f.nativeNode);
  assert.equal(installed.lifecycle, `linux:${f.nativeNode}`, 'npm lifecycle scripts must resolve the same native Node');
  assert.deepEqual(installed.args, ['install', '--omit=dev', '--no-audit', '--no-fund']);
  assert.equal(installed.searchPath.split(':')[0], f.nativeBin);
  assert.equal(installed.searchPath.includes(f.windowsBin), false);
  await assert.rejects(access(f.marker), { code: 'ENOENT' });
});

test('a distribution npm CLI runs with the verified Linux Node when no bundled npm exists', async t => {
  const f = await fixture(t, { bundled: false, systemNpm: true });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).node, f.nativeNode);
  await assert.rejects(access(f.marker), { code: 'ENOENT' });
});

test('Windows npm cannot satisfy a missing Linux npm prerequisite', async t => {
  const f = await fixture(t, { bundled: false });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Install native Linux npm alongside Node/);
  await assert.rejects(access(f.marker), { code: 'ENOENT' });
});

for (const [name, options] of [['Windows Node', { platform: 'win32' }], ['Node 22', { version: '22.21.0' }]]) {
  test(`${name} is rejected before npm installation`, async t => {
    const f = await fixture(t, options);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires native Linux Node 24\+/);
    assert.equal(result.stdout, '');
    await assert.rejects(access(f.marker), { code: 'ENOENT' });
  });
}
