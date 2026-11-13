import { spawn } from 'node:child_process';
import { PtyTransport } from './pty-transport.js';
import { RuntimeError } from './config.js';
import { assertRuntime, assertSandbox, quarantine } from './sandbox-policy.js';

export function dockerEnvironment() {
  return Object.fromEntries(['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
}

export function runDocker(args, input, { timeout = 15000, maxBytes = 13 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], env: dockerEnvironment() });
    const output = [], errors = []; let size = 0, errorSize = 0, done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new RuntimeError('UNAVAILABLE', 'Workspace operation timed out.', 503)); }, timeout);
    child.on('error', () => finish(new RuntimeError('UNAVAILABLE', 'Docker is unavailable. Start the isolated workspace runtime.', 503)));
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) { child.kill('SIGKILL'); finish(new RuntimeError('LIMIT', 'Workspace response exceeds the transfer limit.', 413)); } else output.push(chunk); });
    child.stderr.on('data', chunk => { if (errorSize < 4096) { errors.push(chunk); errorSize += chunk.length; } });
    child.on('close', code => code === 0 ? finish(null, Buffer.concat(output).toString('utf8')) : finish(new RuntimeError('UNAVAILABLE', 'The isolated workspace is unavailable or the operation could not run.', 503)));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
export class DockerWorkspace {
  constructor({ stateDirectory = '/var/lib/lopeos', docker = runDocker } = {}) { this.stateDirectory = stateDirectory; this.docker = docker; this.checks = new Map(); this.reaped = new Map(); }
  async ready(principal) {
    const cached = this.checks.get(principal.container);
    if (cached && Date.now() - cached.time < 5000) return cached.promise;
    const promise = this.verify(principal);
    this.checks.set(principal.container, { time: Date.now(), promise });
    try { return await promise; } catch (error) { this.checks.delete(principal.container); throw error; }
  }
  async inspect(p, allowStopped = false) {
    const [raw, runtimes] = await Promise.all([
      this.docker(['inspect', p.container], undefined, { maxBytes: 128 * 1024 }),
      this.docker(['info', '--format', '{{json .Runtimes}}'], undefined, { maxBytes: 32768 }),
    ]);
    const [info] = JSON.parse(raw);
    try { assertRuntime(JSON.parse(runtimes)); assertSandbox(info, p, { stateDirectory: this.stateDirectory, allowStopped }); }
    catch (error) { await quarantine(info, p, this.docker); throw error; }
    return info;
  }
  async verify(p) {
    const info = await this.inspect(p), generation = `${info.Id}:${info.State.StartedAt}`;
    if (this.reaped.get(p.container) !== generation) {
      // Both programs are immutable image files. Nothing is executed before policy validation.
      try {
        const result = JSON.parse(await this.docker(['exec', '--user', '1000:1000', info.Id, 'python3', '-I', '/usr/local/lib/lope-isolation-probe.py'], undefined, { maxBytes: 4096 }));
        if (result.ok !== true) throw new Error('Isolation probe failed.');
        await this.docker(['exec', '--user', '1000:1000', info.Id, 'python3', '-I', '/usr/local/lib/lope-session.py', 'reap']);
      } catch {
        await quarantine(info, p, this.docker);
        throw new RuntimeError('ISOLATION', 'Workspace isolation could not be verified. Execution is disabled.', 503);
      }
      this.reaped.set(p.container, generation);
    }
    return info.Id;
  }
  async file(p, request) {
    const id = await this.ready(p);
    const raw = await this.docker(['exec', '-i', '--user', '1000:1000', id, 'python3', '-I', '/usr/local/lib/lope-fs.py'], JSON.stringify(request));
    let result;
    try { result = JSON.parse(raw); } catch { throw new RuntimeError('UNAVAILABLE', 'Invalid workspace filesystem response.', 503); }
    if (!result.ok) {
      const status = { NOT_FOUND: 404, CONFLICT: 409, FORBIDDEN: 403, LIMIT: 413, NO_SPACE: 507, INVALID: 400, IO_ERROR: 500 }[result.error.code] || 500;
      throw new RuntimeError(result.error.code, result.error.message, status);
    }
    return result.result;
  }
  async terminal(p, id, options) {
    const containerId = await this.ready(p);
    const child = spawn('docker', ['exec', '-i', '--user', '1000:1000', containerId, '/usr/local/bin/node', '/opt/lope-pty/main.js', id, options.cwd, options.shell, String(options.cols), String(options.rows)], { stdio: ['pipe', 'pipe', 'pipe'], env: dockerEnvironment() });
    try { return await new PtyTransport(child).ready; }
    catch (error) { await this.closeTerminal(p, id).catch(() => {}); throw error; }
  }
  async closeTerminal(p, id) {
    const info = await this.inspect(p, true);
    if (!info.State.Running) return;
    await this.docker(['exec', '--user', '1000:1000', info.Id, 'python3', '-I', '/usr/local/lib/lope-session.py', 'close', id], undefined, { timeout: 5000, maxBytes: 4096 });
  }
}
