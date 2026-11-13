import { RuntimeError } from './config.js';
/** Bounded JSON-line bridge to node-pty inside a workspace, with stream backpressure. */
export class PtyTransport {
  constructor(child) {
    this.child = child; this.pending = ''; this.queued = []; this.queuedBytes = 0; this.dataListener = null; this.exitListener = null; this.exit = null;
    this.ready = new Promise((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => { child.kill(); reject(new RuntimeError('UNAVAILABLE', 'The workspace PTY did not start.', 503)); }, 15000);
      child.on('error', () => { clearTimeout(timeout); reject(new RuntimeError('UNAVAILABLE', 'The isolated workspace transport could not start.', 503)); });
      child.stderr.on('data', () => {}); // Never forward Docker/control-plane diagnostics as shell output.
      child.stdin.on('error', () => {});
      child.stdout.on('data', buffer => {
        this.pending += buffer.toString('utf8');
        if (this.pending.length > 1024 * 1024) { child.kill(); reject(new RuntimeError('UNAVAILABLE', 'Invalid workspace PTY frame.', 503)); return; }
        for (let index; (index = this.pending.indexOf('\n')) >= 0;) {
          const line = this.pending.slice(0, index); this.pending = this.pending.slice(index + 1);
          let m;
          try { m = JSON.parse(line); } catch { child.kill(); reject(new RuntimeError('UNAVAILABLE', 'Invalid workspace PTY response.', 503)); return; }
          if (m.type === 'ready') { ready = true; clearTimeout(timeout); resolve(this); }
          else if (m.type === 'data' && typeof m.data === 'string') {
            if (this.dataListener) this.dataListener(m.data);
            else {
              this.queuedBytes += Buffer.byteLength(m.data);
              if (this.queuedBytes > 512 * 1024) { child.kill(); return; }
              this.queued.push(m.data); child.stdout.pause();
            }
          } else if (m.type === 'exit' && Number.isInteger(m.exitCode)) this.emitExit({ exitCode: m.exitCode, signal: m.signal });
          else { child.kill(); reject(new RuntimeError('UNAVAILABLE', 'Invalid workspace PTY protocol.', 503)); return; }
        }
      });
      // Decode complete Unicode at stream boundaries (JSON may contain terminal Unicode).
      child.stdout.setEncoding('utf8');
      child.on('close', code => {
        clearTimeout(timeout);
        if (!ready) reject(new RuntimeError('UNAVAILABLE', 'The workspace PTY is unavailable.', 503));
        this.emitExit({ exitCode: code ?? 125 });
      });
    });
  }
  emitExit(value) { if (this.exit) return; this.exit = value; this.exitListener?.(value); }
  onData(fn) { this.dataListener = fn; for (const value of this.queued) fn(value); this.queued = []; this.queuedBytes = 0; this.child.stdout.resume(); }
  onExit(fn) { this.exitListener = fn; if (this.exit) fn(this.exit); }
  send(m) { if (this.child.stdin.writable && !this.exit) this.child.stdin.write(JSON.stringify(m) + '\n'); }
  write(data) { this.send({ type: 'input', data }); }
  writeBinary(data) { this.send({ type: 'input-binary', data: data.toString('base64') }); }
  resize(cols, rows) { this.send({ type: 'resize', cols, rows }); }
  pause() { this.child.stdout.pause(); }
  resume() { this.child.stdout.resume(); }
  kill() { this.send({ type: 'close' }); this.child.stdin.end(); const timer = setTimeout(() => { if (this.child.exitCode === null) this.child.kill(); }, 500); timer.unref(); }
}
