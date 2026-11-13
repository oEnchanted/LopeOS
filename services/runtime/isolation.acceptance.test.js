import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { DockerWorkspace } from './docker.js';
import { loadConfig, authenticate } from './config.js';

// Run on the provisioned Linux/WSL2 Docker host, against a dedicated test workspace.
// Canaries are disposable dummy data, never real host secrets.
test('Linux/gVisor: a real terminal cannot reach host canaries, processes, services or credentials', { skip: process.env.LOPE_ACCEPTANCE !== '1', timeout: 60000 }, async t => {
  assert.equal(process.platform, 'linux', 'Run the host-canary check on the Linux/WSL2 Docker host.');
  const config = loadConfig(), token = process.env.LOPE_TEST_TOKEN_A || (await fs.readFile(new URL('../../.runtime/token', import.meta.url), 'utf8')).trim();
  const owner = authenticate(token, config), workspace = new DockerWorkspace({ stateDirectory: config.stateDirectory });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lope-host-canary-'));
  await fs.chmod(directory, 0o755); // Deliberately readable if a boundary is broken.
  const nonce = randomBytes(24).toString('hex'), marker = 'LOPE_HOST_PROCESS_' + nonce;
  const file = path.join(directory, 'host-only.txt'); await fs.writeFile(file, nonce, { mode: 0o644 });
  const previous = process.env.LOPE_HOST_ONLY_SECRET; process.env.LOPE_HOST_ONLY_SECRET = nonce;
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', marker], { stdio: 'ignore', env: { PATH: process.env.PATH } });
  const service = http.createServer((req, res) => res.end(nonce));
  let terminal; const id = randomBytes(16).toString('hex');
  t.after(async () => {
    try { if (terminal) await workspace.closeTerminal(owner, id); }
    finally {
      terminal?.kill(); sentinel.kill();
      if (service.listening) await new Promise(resolve => { service.close(resolve); service.closeAllConnections(); });
      await fs.rm(directory, { recursive: true, force: true });
      if (previous === undefined) delete process.env.LOPE_HOST_ONLY_SECRET; else process.env.LOPE_HOST_ONLY_SECRET = previous;
    }
  });
  await new Promise((resolve, reject) => { service.once('error', reject); service.listen(0, '127.0.0.1', resolve); });
  terminal = await workspace.terminal(owner, id, { cwd: '/', cols: 100, rows: 30, shell: 'bash' });
  let output = ''; terminal.onData(value => { output = (output + value).slice(-65536); }); terminal.onExit(() => {});
  const data = JSON.stringify({ file, marker, port: service.address().port, state: config.stateDirectory });
  const script = `import os,pathlib,socket,json\nq=json.loads(${JSON.stringify(data)})\nassert os.getuid()==1000\nassert 'LOPE_HOST_ONLY_SECRET' not in os.environ\nfor candidate in [q['file'], '/proc/1/root'+q['file'], '/host'+q['file']]:\n try: pathlib.Path(candidate).read_bytes()\n except OSError: pass\n else: raise AssertionError('Host-only file was visible')\nlink=pathlib.Path('/home/lope/.isolation-${id}')\ntry:\n link.symlink_to(q['file'])\n try: link.read_bytes()\n except OSError: pass\n else: raise AssertionError('Symlink crossed the sandbox boundary')\nfinally: link.unlink(missing_ok=True)\nfor process in pathlib.Path('/proc').iterdir():\n if not process.name.isdigit(): continue\n try: command=(process/'cmdline').read_bytes()\n except OSError: continue\n assert q['marker'].encode() not in command, 'Host-only process was visible'\nconnection=socket.socket();connection.settimeout(1)\ntry: assert connection.connect_ex(('127.0.0.1',q['port'])) != 0, 'Host loopback service was reachable'\nfinally: connection.close()\nmounts=pathlib.Path('/proc/self/mountinfo').read_text()\nfor outside in [q['state']+'/control', '/var/lib/docker/', '/run/desktop/', 'drvfs']:\n assert outside not in mounts, 'Host mount details were visible'\nfor outside in ['/mnt/c', '/mnt/d', '/mnt/wsl', '/run/docker.sock', '/var/run/docker.sock', '/dev/kvm', '/init']:\n assert not os.path.lexists(outside), 'Host path was exposed'\nprint('LOPE_ISOLATION_OK',flush=True)\n`;
  terminal.write(`python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(script).toString('base64')}"))'\r`);
  const deadline = Date.now() + 15000;
  while (!/\r\nLOPE_ISOLATION_OK\r\n/.test(output) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.match(output, /\r\nLOPE_ISOLATION_OK\r\n/, 'The host-boundary checks must pass inside the actual terminal.');
  assert.equal(await fs.readFile(file, 'utf8'), nonce, 'The host-only file must remain unchanged.');
});
