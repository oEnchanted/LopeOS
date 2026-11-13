import readline from 'node:readline';
import pty from 'node-pty';

/** Runs inside the user's Linux container. stdout is protocol data only. */
export function startAgent({ command, args, cwd, env, cols, rows, input = process.stdin, output = process.stdout }) {
  const terminal = pty.spawn(command, args, { name: 'xterm-256color', cwd, env, cols, rows });
  let exiting = false, stdoutBlocked = false;
  const send = value => {
    if (output.destroyed) return;
    if (!output.write(JSON.stringify(value) + '\n')) { stdoutBlocked = true; terminal.pause(); }
  };
  const data = terminal.onData(value => send({ type: 'data', data: value }));
  const exit = terminal.onExit(({ exitCode, signal }) => {
    exiting = true; send({ type: 'exit', exitCode, signal });
    lines.close(); input.pause(); output.end();
  });
  output.on('drain', () => { if (stdoutBlocked && !exiting) { stdoutBlocked = false; terminal.resume(); } });
  output.on('error', () => { try { terminal.kill(); } catch {} });
  // Each line is bounded by the control plane; defend this private boundary too.
  let size = 0;
  input.on('data', chunk => {
    size += chunk.length;
    const last = chunk.lastIndexOf(10);
    if (last >= 0) size = chunk.length - last - 1;
    if (size > 24576) { try { terminal.kill(); } catch {} input.destroy(); }
  });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on('line', line => {
    try {
      if (line.length > 24576) throw new Error();
      const m = JSON.parse(line);
      if (m.type === 'input' && typeof m.data === 'string' && m.data.length <= 8192) terminal.write(m.data);
      else if (m.type === 'input-binary' && typeof m.data === 'string' && m.data.length <= 10924 && m.data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(m.data)) {
        const bytes = Buffer.from(m.data, 'base64'); if (bytes.length > 8192) throw new Error(); terminal.write(bytes);
      }
      else if (m.type === 'resize' && Number.isInteger(m.cols) && m.cols >= 2 && m.cols <= 500 && Number.isInteger(m.rows) && m.rows >= 1 && m.rows <= 200) terminal.resize(m.cols, m.rows);
      else if (m.type === 'close') terminal.kill();
      else throw new Error();
    } catch { try { terminal.kill(); } catch {} }
  });
  lines.on('close', () => { if (!exiting) { try { terminal.kill(); } catch {} } });
  send({ type: 'ready' });
  return { terminal, dispose() { data.dispose(); exit.dispose(); lines.close(); } };
}
