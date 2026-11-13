import { startAgent } from './protocol.js';
const [id, cwd, shell, colsText, rowsText] = process.argv.slice(2), cols = Number(colsText), rows = Number(rowsText);
if (!/^[a-f0-9]{32}$/.test(id) || typeof cwd !== 'string' || !['bash', 'zsh'].includes(shell) || !Number.isInteger(cols) || cols < 2 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 200) process.exit(64);
try {
  startAgent({ command: '/usr/bin/python3', args: ['-I', '/usr/local/lib/lope-session.py', 'start', id, cwd, shell], cwd: '/home/lope', env: { HOME: '/home/lope', USER: 'lope', LOGNAME: 'lope', PATH: '/usr/local/bin:/usr/bin:/bin', TERM: 'xterm-256color', LANG: 'C.UTF-8' }, cols, rows });
} catch { process.stderr.write('The sandbox PTY could not start.\n'); process.exitCode = 70; }
