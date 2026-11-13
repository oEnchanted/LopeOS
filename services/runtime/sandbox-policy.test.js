import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSandbox, assertRuntime, homeSource, RUNTIME_ARGUMENTS, SANDBOX_RUNTIME } from './sandbox-policy.js';
import { daemonConfiguration } from './configure-runsc.js';
import { DockerWorkspace, dockerEnvironment } from './docker.js';

const owner = { userId: 'alice', workspaceId: 'alice-home', container: 'lope-alice' };
export function safeContainer() {
  return {
    Id: 'a'.repeat(64), State: { Running: true, StartedAt: '2026-11-12T00:00:00Z' },
    Config: { User: '1000:1000', Hostname: 'lope', Domainname: '', Labels: { 'lope.user': owner.userId, 'lope.workspace': owner.workspaceId, 'lope.storage-limited': 'true', 'lope.sandbox-policy': '2' }, Env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'NODE_VERSION=22.0.0', 'HOME=/home/lope', 'TERM=xterm-256color'] },
    HostConfig: { Runtime: SANDBOX_RUNTIME, ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], NetworkMode: 'none', PidMode: '', IpcMode: 'private', UTSMode: '', CgroupnsMode: 'private', UsernsMode: '', Memory: 536870912, MemorySwap: 536870912, NanoCpus: 1e9, PidsLimit: 128, ShmSize: 33554432, LogConfig: { Type: 'none' }, Dns: ['127.0.0.1'], DnsSearch: ['.'], DnsOptions: ['ndots:0'], Ulimits: [{ Name: 'core', Soft: 0, Hard: 0 }, { Name: 'nofile', Soft: 2048, Hard: 2048 }, { Name: 'nproc', Soft: 128, Hard: 128 }], Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=67108864,mode=1777' } },
    NetworkSettings: { Networks: { none: {} }, Ports: {} },
    Mounts: [{ Type: 'bind', Source: '/var/lib/lopeos/homes/alice-home', Destination: '/home/lope', RW: true, Propagation: 'rprivate' }],
  };
}
const runtimes = () => ({ [SANDBOX_RUNTIME]: { path: '/usr/bin/runsc', runtimeArgs: [...RUNTIME_ARGUMENTS] } });
const rejected = mutate => { const value = safeContainer(); mutate(value); assert.throws(() => assertSandbox(value, owner), { code: 'ISOLATION' }); };
test('a sandbox is accepted only with its exact private home, gVisor runtime and complete isolation policy', () => {
  assert.equal(assertSandbox(safeContainer(), owner), 'a'.repeat(64)); assertRuntime(runtimes());
  assert.equal(homeSource('/var/lib/lopeos', owner), '/var/lib/lopeos/homes/alice-home');
  assert.throws(() => homeSource('/', owner), { code: 'ISOLATION' });
  assert.throws(() => homeSource('/var/lib/lopeos', { ...owner, workspaceId: '../other' }), { code: 'ISOLATION' });
  rejected(x => { x.HostConfig.Runtime = 'runc'; }); rejected(x => { delete x.Config.Labels['lope.sandbox-policy']; });
});
test('host roots, Windows drives, socket mounts, shared propagation and extra volumes are rejected', () => {
  for (const source of ['/', '/etc', '/home/alice', '/mnt/c', '/var/lib/lopeos/control', '/var/lib/lopeos/homes/bob-home']) rejected(x => { x.Mounts[0].Source = source; });
  for (const destination of ['/host', '/mnt/c', '/var/run/docker.sock', '/proc', '/sys', '/dev']) rejected(x => { x.Mounts.push({ Type: 'bind', Source: '/', Destination: destination, RW: false, Propagation: 'rprivate' }); });
  rejected(x => { x.Mounts[0].Propagation = 'rshared'; }); rejected(x => { x.Mounts[0].Type = 'volume'; });
  rejected(x => { x.HostConfig.Binds = ['/:/host:ro']; }); rejected(x => { x.HostConfig.VolumesFrom = ['other']; });
  rejected(x => { x.HostConfig.Mounts = [{ Type: 'bind', Source: '/', Target: '/home/lope' }]; });
});
test('host and other-container namespaces, network routes, devices and privileges are rejected', () => {
  for (const mode of ['host', 'container:another']) {
    for (const key of ['PidMode', 'IpcMode', 'UTSMode', 'CgroupnsMode', 'NetworkMode', 'UsernsMode']) rejected(x => { x.HostConfig[key] = mode; });
  }
  rejected(x => { x.HostConfig.Devices = [{ PathOnHost: '/dev/sda', PathInContainer: '/dev/sda' }]; });
  rejected(x => { x.HostConfig.DeviceCgroupRules = ['a *:* rwm']; }); rejected(x => { x.HostConfig.DeviceRequests = [{ Driver: 'nvidia' }]; });
  rejected(x => { x.HostConfig.Privileged = true; }); rejected(x => { x.HostConfig.CapAdd = ['SYS_ADMIN']; });
  rejected(x => { x.Config.User = '0'; }); rejected(x => { x.HostConfig.GroupAdd = ['docker']; });
  rejected(x => { x.HostConfig.SecurityOpt.push('seccomp=unconfined'); });
  rejected(x => { x.Config.Labels['dev.gvisor.flag.network'] = 'host'; });
  rejected(x => { x.HostConfig.Annotations = { 'io.kubernetes.cri.sandbox-id': 'another' }; });
  rejected(x => { x.HostConfig.ExtraHosts = ['host.docker.internal:host-gateway']; });
  rejected(x => { x.HostConfig.PortBindings = { '22/tcp': [{ HostPort: '2222' }] }; });
});
test('host credentials, DNS topology, resource-limit removal and runtime bypass flags are rejected', () => {
  for (const secret of ['LOPE_AUTH_SECRET=secret', 'AWS_ACCESS_KEY_ID=secret', 'DOCKER_HOST=unix:///run/docker.sock', 'NODE_OPTIONS=--require=/host/code.js', 'PYTHONPATH=/host', 'HTTP_PROXY=http://internal:3128']) rejected(x => { x.Config.Env.push(secret); });
  rejected(x => { x.Config.Hostname = 'windows-server-private-name'; }); rejected(x => { x.HostConfig.Dns = ['192.168.1.1']; });
  rejected(x => { x.HostConfig.DnsSearch = ['private.corp']; }); rejected(x => { x.HostConfig.Memory = 0; x.HostConfig.MemorySwap = 0; });
  rejected(x => { x.NetworkSettings.Networks.bridge = { IPAddress: '172.17.0.2' }; });
  for (const key of ['Memory', 'MemorySwap', 'NanoCpus', 'PidsLimit', 'ShmSize']) rejected(x => { delete x.HostConfig[key]; });
  rejected(x => { x.HostConfig.PidsLimit = 0; }); rejected(x => { x.HostConfig.Ulimits = []; });
  for (const extra of ['--network=host', '--host-uds=all', '--directfs=true', '--host-fifo=open', '--disable-seccomp', '--inode-numbers=passthrough']) {
    const value = runtimes(); value[SANDBOX_RUNTIME].runtimeArgs.push(extra); assert.throws(() => assertRuntime(value), { code: 'ISOLATION' });
  }
  assert.throws(() => assertRuntime({}), { code: 'ISOLATION' });
});
test('unsafe containers are quarantined and no exec or host-shell fallback is attempted', async () => {
  const calls = [], unsafe = safeContainer(); unsafe.Mounts[0].Source = '/';
  const runtime = new DockerWorkspace({ async docker(args) { calls.push(args); return args[0] === 'inspect' ? JSON.stringify([unsafe]) : JSON.stringify(runtimes()); } });
  await assert.rejects(runtime.file(owner, { op: 'read', path: '/' }), { code: 'ISOLATION' });
  assert.equal(calls.filter(a => a[0] === 'exec').length, 0);
  assert.deepEqual(calls.find(a => a[0] === 'kill'), ['kill', '--signal', 'KILL', unsafe.Id]);
  const missing = new DockerWorkspace({ async docker(args) { calls.push(args); return args[0] === 'inspect' ? JSON.stringify([safeContainer()]) : '{}'; } });
  await assert.rejects(missing.terminal(owner, '0'.repeat(32), { cwd: '/', shell: 'bash', cols: 80, rows: 24 }), { code: 'ISOLATION' });
  assert.equal(calls.filter(a => a[0] === 'exec').length, 0);
});
test('validated execution is pinned to an immutable container ID and probes before serving files', async () => {
  const calls = [], safe = safeContainer();
  const runtime = new DockerWorkspace({ async docker(args) { calls.push(args); if (args[0] === 'inspect') return JSON.stringify([safe]); if (args[0] === 'info') return JSON.stringify(runtimes()); if (args.includes('/usr/local/lib/lope-isolation-probe.py')) return '{"ok":true}'; if (args.includes('/usr/local/lib/lope-fs.py')) return '{"ok":true,"result":{"size":0}}'; return ''; } });
  assert.deepEqual(await runtime.file(owner, { op: 'stat', path: '/' }), { size: 0 });
  const execs = calls.filter(a => a[0] === 'exec');
  assert.equal(execs.length, 3); assert.ok(execs.every(a => a.includes(safe.Id) && !a.includes(owner.container)));
  assert.ok(execs[0].includes('/usr/local/lib/lope-isolation-probe.py')); assert.ok(execs[2].includes('/usr/local/lib/lope-fs.py'));
});
test('daemon setup preserves unrelated Docker settings while replacing unsafe sandbox overrides', () => {
  const next = daemonConfiguration({ 'log-level': 'warn', runtimes: { runc: { path: 'runc' }, [SANDBOX_RUNTIME]: { path: '/wrong', runtimeArgs: ['--network=host'] } } }, '/usr/bin/runsc');
  assert.equal(next['log-level'], 'warn'); assert.deepEqual(next.runtimes.runc, { path: 'runc' }); assertRuntime(next.runtimes);
});
test('Docker CLI child environment does not inherit control-plane credentials', () => {
  const previous = process.env.LOPE_AUTH_SECRET; process.env.LOPE_AUTH_SECRET = 'test-control-secret';
  try { assert.equal(dockerEnvironment().LOPE_AUTH_SECRET, undefined); assert.deepEqual(Object.keys(dockerEnvironment()).filter(k => k.startsWith('LOPE_')), []); }
  finally { if (previous === undefined) delete process.env.LOPE_AUTH_SECRET; else process.env.LOPE_AUTH_SECRET = previous; }
});

test('failed in-sandbox checks quarantine the container before any file request runs', async () => {
  const calls = [];
  const runtime = new DockerWorkspace({ async docker(args) { calls.push(args); if (args[0] === 'inspect') return JSON.stringify([safeContainer()]); if (args[0] === 'info') return JSON.stringify(runtimes()); if (args.includes('/usr/local/lib/lope-isolation-probe.py')) return '{"ok":false}'; return ''; } });
  await assert.rejects(runtime.file(owner, { op: 'read', path: '/' }), { code: 'ISOLATION' });
  assert.ok(calls.some(a => a[0] === 'kill')); assert.ok(!calls.some(a => a.includes('/usr/local/lib/lope-fs.py')));
});
