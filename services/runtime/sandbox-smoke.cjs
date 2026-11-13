// Host installation probe, executed only inside a disposable gVisor container.
const { spawnSync } = require('node:child_process');
const probe = spawnSync('/usr/bin/python3', ['-I', '/usr/local/lib/lope-isolation-probe.py'], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
try { if (probe.status !== 0 || JSON.parse(probe.stdout).ok !== true) throw new Error(); }
catch { process.stderr.write('Sandbox visibility checks failed. Execution remains disabled.\n'); process.exit(1); }
const pty = require('/opt/lope-pty/node_modules/node-pty');
if (process.getuid() !== 1000 || process.getgid() !== 1000) process.exit(1);
let output = '', finished = false;
const child = pty.spawn('/bin/bash', ['--noprofile', '--norc', '-i'], {
  name: 'xterm-256color', cols: 80, rows: 24, cwd: '/tmp',
  env: { HOME: '/home/lope', PATH: '/usr/local/bin:/usr/bin:/bin', TERM: 'xterm-256color', LANG: 'C.UTF-8', PS1: 'sandbox> ' },
});
const timer = setTimeout(() => { child.kill(); process.exitCode = 1; }, 10000);
child.onData(data => { output = (output + data).slice(-8192); });
child.onExit(({ exitCode }) => {
  if (finished) return; finished = true; clearTimeout(timer);
  if (exitCode === 0 && /\r\nLOPE_SANDBOX_PTY_OK\r\n/.test(output)) process.stdout.write('Sandbox PTY smoke passed.\n');
  else process.exitCode = 1;
});
child.write("printf '\\nLOPE_SANDBOX_PTY_OK\\n'; exit\r");
