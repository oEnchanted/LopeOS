import { spawn } from 'node:child_process';

const marker = 'lope-browser-wsl-ready\n';
// An explicitly launched foreground process keeps WSL alive; systemd's Docker
// service alone does not. Reading the caller's pipe also gives this process a
// lifetime bound: normal shutdown sends stop, and a lost parent closes stdin.
// No background Linux child remains after that pipe reaches EOF.
const command = 'trap "exit 0" HUP INT TERM; printf "lope-browser-wsl-ready\\n"; while IFS= read -r line; do [ "$line" != stop ] || exit 0; done';

export async function startWslLifetime({ distro, platform = process.platform, spawnProcess = spawn,
  onUnexpectedExit = () => {}, timeoutMs = 60000, stopTimeoutMs = 10000 } = {}) {
  if (platform !== 'win32' || !distro) return { stop: async () => {} };
  if (!/^[A-Za-z0-9_.-]+$/.test(distro)) throw new Error('Invalid browser WSL distribution.');
  const child = spawnProcess('wsl.exe', ['--distribution', distro, '--user', 'root', '--exec', '/bin/sh', '-c', command],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let stopping = false, closed = false, ready = false, failed = false, output = '', stopPromise;
  let resolveReady, rejectReady;
  const started = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const ended = new Promise(resolve => child.once('close', () => { closed = true; resolve(); }));
  const fail = () => {
    if (failed || stopping) return;
    failed = true;
    const error = new Error('The foreground Lope Browser WSL host stopped.');
    if (!ready) rejectReady(error);
    else onUnexpectedExit(error);
  };
  child.once('error', fail);
  child.once('exit', fail);
  child.stdin.on('error', () => {});
  child.stdout.on('data', chunk => {
    if (ready || failed || stopping) return;
    output += chunk.toString('utf8');
    if (output === marker) { ready = true; resolveReady(); }
    else if (output.length > marker.length || !marker.startsWith(output)) fail();
  });
  const timeout = setTimeout(() => { if (!ready) { failed = true; rejectReady(new Error('The foreground Lope Browser WSL host did not start.')); } }, timeoutMs);
  async function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      if (closed) return;
      // Cooperatively stop the Linux foreground reader before terminating its
      // Windows transport. Unlike killing a bare `wsl sleep infinity`, EOF is
      // itself sufficient to release the Linux process if Windows stops us.
      child.stdin.end('stop\n');
      let timer;
      const completed = await Promise.race([ended.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), stopTimeoutMs); })]);
      clearTimeout(timer);
      if (!completed) { child.kill(); await Promise.race([ended, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]); clearTimeout(timer); }
    })();
    return stopPromise;
  }
  try { await started; return { stop }; }
  catch (error) { await stop(); throw error; }
  finally { clearTimeout(timeout); }
}
