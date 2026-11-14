import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { HostingError } from './identity.mjs';

export function execute(file, args, { input, timeout = 30000, maxBytes = 131072 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let ended = false, size = 0; const chunks = [];
    const finish = (error, value) => { if (ended) return; ended = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new HostingError(503, 'HOST_TIMEOUT', 'The browser host operation timed out.')); }, timeout);
    child.on('error', () => finish(new HostingError(503, 'HOST_UNAVAILABLE', 'The isolated browser host is unavailable.')));
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) { child.kill(); finish(new Error('Host response exceeded its limit.')); } else chunks.push(chunk); });
    // Docker stderr can contain environment values. Never log or return it to a client.
    child.stderr.on('data', () => {}); child.stdin.on('error', () => {}); child.stdin.end(input);
    child.on('exit', code => code === 0 ? finish(null, Buffer.concat(chunks).toString('utf8').trim()) : finish(new HostingError(503, 'HOST_OPERATION', 'The browser host could not complete this operation.')));
  });
}

/** Trusted host-side allocator. Browser requests cannot supply commands, paths, images or tokens. */
export class DockerBrowserAllocator {
  constructor({ directory, image = 'lope-browser:local', distro, deploymentId = 'lopeos', run = execute, request = fetch }) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,180}$/.test(image) || !/^[a-z0-9-]{1,40}$/.test(deploymentId) || (distro && !/^[a-zA-Z0-9_.-]+$/.test(distro))) throw new Error('Invalid browser host configuration.');
    Object.assign(this, { directory: resolve(directory), image, distro, deploymentId, run, request });
  }
  host(file, args, options) {
    return this.distro ? this.run('wsl.exe', ['--distribution', this.distro, '--user', 'root', '--exec', file, ...args], options) : this.run(file, args, options);
  }
  docker(args, options) { return this.host('docker', args, options); }
  async verify() {
    const context = await this.docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
    if (context !== 'unix:///var/run/docker.sock') throw new Error('Use local Docker Engine inside Linux/WSL, not a remote daemon.');
    const network = JSON.parse(await this.docker(['network', 'inspect', 'lope-browser-public']));
    if (network[0]?.Options?.['com.docker.network.bridge.enable_icc'] !== 'false' || network[0]?.Options?.['com.docker.network.bridge.name'] !== 'lope-browser0' || network[0]?.EnableIPv6) throw new Error('The browser egress network has not been prepared.');
    await this.host('bash', ['/opt/lope-browser/check-network.sh']);
    // Remove only our stale workers. Their bearer credentials die with this gateway.
    const stale = await this.docker(['ps', '-aq', '--filter', `label=lope.browser.gateway=${this.deploymentId}`]);
    for (const name of stale.split(/\s+/).filter(Boolean)) if (/^[a-f0-9]{12,64}$/.test(name)) await this.docker(['rm', '-f', name]);
  }
  async create({ id, ownerKey, origin }) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(ownerKey) || new URL(origin).origin !== origin) throw new Error('Invalid worker assignment.');
    const profile = await this.host('bash', ['/opt/lope-browser/prepare-profile.sh', ownerKey]);
    if (profile !== `/var/lib/lope-browser/profiles/${ownerKey}/home`) throw new Error('The browser host returned an invalid profile boundary.');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const token = randomBytes(32).toString('hex'), password = randomBytes(32).toString('hex');
    const name = 'lope-browser-' + id;
    const envFile = join(this.directory, id + '.env');
    await writeFile(envFile, [
      `LOPE_BROWSER_TOKEN=${token}`, `SELKIES_BASIC_AUTH_PASSWORD=${password}`,
      `LOPE_BROWSER_ORIGINS=${origin}`, `SELKIES_ALLOWED_ORIGINS=${origin}`,
      `SELKIES_SUBFOLDER=/api/browser/stream/${id}`, `LOPE_BROWSER_STREAM_PATH=/api/browser/stream/${id}`,
      'LOPE_BROWSER_IDLE_MS=0', 'LOPE_BROWSER_HOSTS=127.0.0.1,localhost',
      // Disk-backed profile volume: uploads up to 1 GB and downloads up to 256 MiB do not fit the in-memory /tmp.
      'LOPE_BROWSER_TRANSFERS=/profiles/transfers',
      // Larger audio buffers: without realtime scheduling, small PipeWire/Pulse
      // periods underrun while video encoding uses the CPU, which chops sound.
      'PULSE_LATENCY_MSEC=60', 'PIPEWIRE_LATENCY=1024/48000',
    ].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    try {
      const linuxEnv = this.distro ? await this.host('wslpath', ['-a', envFile]) : envFile;
      const args = ['run', '-d', '--name', name, '--label', `lope.browser.gateway=${this.deploymentId}`, '--label', `lope.browser.owner=${ownerKey}`,
        '--user', '1000:1000', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--security-opt', 'seccomp=/etc/lope-browser/seccomp.json', '--network', 'lope-browser-public', '--dns', '1.1.1.1', '--ipc', 'private', '--cgroupns', 'private',
        '--cpus', '3', '--memory', '2g', '--memory-swap', '2g', '--pids-limit', '512', '--shm-size', '512m',
        '--ulimit', 'core=0:0', '--ulimit', 'nofile=4096:4096', '--ulimit', 'nproc=512:512',
        '--tmpfs', '/tmp:rw,nosuid,nodev,size=536870912,mode=1777', '--tmpfs', '/home/ubuntu:rw,nosuid,nodev,size=134217728,uid=1000,gid=1000,mode=700',
        // Docker mounts tmpfs noexec unless asked. s6 runs the copied service scripts from
        // here; /tmp itself (including downloaded files) stays non-executable.
        '--tmpfs', '/tmp/lope-services:rw,exec,nosuid,nodev,size=16777216,uid=1000,gid=1000,mode=700',
        '--mount', `type=bind,source=${profile},target=/profiles`, '--publish', '127.0.0.1::4175', '--env-file', linuxEnv, this.image];
      await this.docker(args, { timeout: 60000 });
      const ports = JSON.parse(await this.docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', name]));
      const port = ports?.['4175/tcp']?.find(binding => binding.HostIp === '127.0.0.1')?.HostPort;
      if (!/^\d{1,5}$/.test(port ?? '') || +port < 1024 || +port > 65535) throw new Error('The browser worker did not publish a loopback control port.');
      const url = `http://127.0.0.1:${port}`;
      const until = Date.now() + 90000;
      while (Date.now() < until) {
        try {
          const response = await this.request(url + '/api/browser/health', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000), redirect: 'error' });
          if (response.ok && (await response.json()).streaming) {
            const client = await this.request(url + `/api/browser/stream/${id}/`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000), redirect: 'error' });
            const ready = client.ok && (client.headers.get('content-type') ?? '').includes('text/html');
            await client.body?.cancel();
            if (ready) return { name, token, url, ownerKey };
          }
        } catch { /* Wait for the display/audio/Chromium services; never disable sandboxing. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new HostingError(503, 'STARTUP', 'Your isolated browser could not start. The host needs a working Chromium sandbox and streaming display.');
    } catch (error) { await this.docker(['rm', '-f', name]).catch(() => {}); throw error; }
    finally { await rm(envFile, { force: true }); }
  }
  async destroy(worker) {
    if (!/^lope-browser-[a-f0-9-]{36}$/.test(worker.name)) throw new Error('Invalid browser worker.');
    await this.docker(['stop', '--time', '10', worker.name], { timeout: 20000 }).catch(() => {});
    await this.docker(['rm', '-f', worker.name]);
  }
}
