import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RuntimeError } from './config.js';

export const SANDBOX_RUNTIME = 'lope-sandbox';
export const SANDBOX_POLICY = '2';
export const RUNTIME_ARGUMENTS = Object.freeze([
  '--network=none', '--directfs=false', '--host-uds=none', '--host-fifo=none',
  '--character-device-policy=emulated-only', '--inode-numbers=virtual',
]);
const deny = () => { throw new RuntimeError('ISOLATION', 'Workspace isolation could not be verified. Execution is disabled.', 503); };
const empty = value => value == null || (Array.isArray(value) ? value.length === 0 : typeof value === 'object' && Object.keys(value).length === 0);
const exactList = (value, allowed) => Array.isArray(value) && value.length === allowed.length && [...value].sort().every((v, i) => v === [...allowed].sort()[i]);
const positive = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value);
export function homeSource(stateDirectory, principal) {
  if (!identifier(principal?.workspaceId) || !identifier(principal?.userId) || !identifier(principal?.container) || typeof stateDirectory !== 'string' || !path.posix.isAbsolute(stateDirectory) || stateDirectory === '/' || /[\x00-\x1f,]/.test(stateDirectory) || path.posix.normalize(stateDirectory) !== stateDirectory) deny();
  return path.posix.join(stateDirectory, 'homes', principal.workspaceId);
}
export function assertRuntime(runtimes) {
  const runtime = runtimes?.[SANDBOX_RUNTIME];
  if (!runtime || !['/usr/bin/runsc', '/usr/local/bin/runsc'].includes(runtime.path) || !exactList(runtime.runtimeArgs, RUNTIME_ARGUMENTS) || !empty(runtime.options) || !empty(runtime.Options) || runtime.runtimeType || runtime.Type) deny();
}
export function assertSandbox(info, principal, { stateDirectory = '/var/lib/lopeos', allowStopped = false } = {}) {
  const source = homeSource(stateDirectory, principal), c = info?.HostConfig, image = info?.Config;
  if (!c || !image || !/^[a-f0-9]{64}$/.test(info.Id) || typeof info.State?.StartedAt !== 'string' || (!allowStopped && info.State?.Running !== true)) deny();
  const labels = image.Labels || {};
  if (!empty(image.Annotations) || Object.keys(labels).some(key => /^(dev\.gvisor\.|io\.gvisor\.|io\.kubernetes\.|io\.containerd\.)/.test(key))) deny();
  if (image.User !== '1000:1000' || image.Hostname !== 'lope' || image.Domainname !== '' || labels['lope.user'] !== principal.userId || labels['lope.workspace'] !== principal.workspaceId || labels['lope.storage-limited'] !== 'true' || labels['lope.sandbox-policy'] !== SANDBOX_POLICY) deny();
  if (c.Runtime !== SANDBOX_RUNTIME || c.ReadonlyRootfs !== true || c.Privileged || !exactList(c.CapDrop, ['ALL']) || !empty(c.CapAdd) || !exactList(c.SecurityOpt, ['no-new-privileges'])) deny();
  // Reject namespace joins as well as literal "host" mode. Never inherit host topology.
  if (c.NetworkMode !== 'none' || c.PidMode !== '' || c.IpcMode !== 'private' || c.UTSMode !== '' || c.CgroupnsMode !== 'private' || c.UsernsMode !== '') deny();
  for (const key of ['Devices', 'DeviceRequests', 'DeviceCgroupRules', 'GroupAdd', 'VolumesFrom', 'Binds', 'Links', 'ExtraHosts', 'Sysctls', 'Annotations', 'PortBindings']) if (!empty(c[key])) deny();
  if (c.PublishAllPorts || c.OomKillDisable || !positive(c.Memory, 2 * 1024 ** 3) || c.MemorySwap !== c.Memory || !positive(c.NanoCpus, 2e9) || !positive(c.PidsLimit, 256) || !positive(c.ShmSize, 64 * 1024 * 1024) || c.LogConfig?.Type !== 'none') deny();
  if (!exactList(c.Dns, ['127.0.0.1']) || !exactList(c.DnsSearch, ['.']) || !exactList(c.DnsOptions, ['ndots:0'])) deny();
  if (!Array.isArray(c.Ulimits) || !c.Ulimits.some(x => x.Name === 'core' && x.Soft === 0 && x.Hard === 0) || !c.Ulimits.some(x => x.Name === 'nproc' && x.Soft > 0 && x.Soft <= 128 && x.Hard >= x.Soft && x.Hard <= 128) || !c.Ulimits.some(x => x.Name === 'nofile' && x.Soft > 0 && x.Soft <= 2048 && x.Hard >= x.Soft && x.Hard <= 2048)) deny();
  const tmp = c.Tmpfs;
  if (!tmp || Object.keys(tmp).length !== 1 || typeof tmp['/tmp'] !== 'string') deny();
  const options = tmp['/tmp'].split(',');
  if (!['rw', 'nosuid', 'nodev', 'size=67108864', 'mode=1777'].every(x => options.includes(x)) || options.some(x => !['rw', 'nosuid', 'nodev', 'size=67108864', 'mode=1777'].includes(x))) deny();
  if (!Array.isArray(info.Mounts)) deny();
  const networks = info.NetworkSettings?.Networks;
  if (!networks || !exactList(Object.keys(networks), ['none']) || !empty(info.NetworkSettings.Ports) || !empty(image.ExposedPorts)) deny();
  if (networks.none.IPAddress || networks.none.GlobalIPv6Address || networks.none.Gateway || networks.none.IPv6Gateway) deny();
  const home = info.Mounts.filter(m => m.Destination === '/home/lope');
  if (home?.length !== 1 || home[0].Type !== 'bind' || home[0].Source !== source || home[0].RW !== true || home[0].Propagation !== 'rprivate') deny();
  for (const mount of info.Mounts) if (mount.Destination !== '/home/lope' && !(mount.Type === 'tmpfs' && mount.Destination === '/tmp')) deny();
  if (!empty(c.Mounts)) {
    if (c.Mounts.length !== 1) deny();
    const m = c.Mounts[0];
    if (m.Type !== 'bind' || m.Source !== source || m.Target !== '/home/lope' || m.ReadOnly || !['rprivate', undefined, ''].includes(m.BindOptions?.Propagation)) deny();
  }
  if (!empty(image.Volumes)) deny();
  // Image metadata only. No host env, proxy credentials, preload hooks or gateway secrets.
  const permitted = new Set(['PATH', 'HOME', 'TERM', 'LANG', 'NODE_VERSION', 'YARN_VERSION']);
  if (!Array.isArray(image.Env)) deny();
  const seen = new Set();
  for (const entry of image.Env) {
    if (typeof entry !== 'string') deny();
    const n = entry.indexOf('='), key = entry.slice(0, n), value = entry.slice(n + 1);
    if (n <= 0 || !permitted.has(key) || seen.has(key)) deny(); seen.add(key);
    if ((key === 'PATH' && value !== '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin') || (['NODE_VERSION', 'YARN_VERSION'].includes(key) && !/^\d+\.\d+\.\d+$/.test(value))) deny();
    if ((key === 'HOME' && value !== '/home/lope') || (key === 'TERM' && value !== 'xterm-256color') || (key === 'LANG' && value !== 'C.UTF-8')) deny();
  }
  if (!seen.has('HOME') || !seen.has('TERM')) deny();
  return info.Id;
}
export async function quarantine(info, principal, docker) {
  if (info?.State?.Running && /^[a-f0-9]{64}$/.test(info.Id) && info.Config?.Labels?.['lope.user'] === principal.userId && info.Config?.Labels?.['lope.workspace'] === principal.workspaceId) {
    await docker(['kill', '--signal', 'KILL', info.Id], undefined, { timeout: 5000, maxBytes: 4096 }).catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'entry') {
      const binary = process.argv[3]; if (!['/usr/bin/runsc', '/usr/local/bin/runsc'].includes(binary)) deny();
      process.stdout.write(JSON.stringify({ path: binary, runtimeArgs: RUNTIME_ARGUMENTS }));
    } else {
      let raw = ''; for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 256 * 1024) deny(); }
      if (process.argv[2] === 'runtime') assertRuntime(JSON.parse(raw));
      else if (process.argv[2] === 'container') assertSandbox(JSON.parse(raw)[0], { userId: process.argv[3], workspaceId: process.argv[4], container: process.argv[5] }, { stateDirectory: process.argv[6], allowStopped: process.argv[7] === '--stopped' });
      else deny();
    }
  } catch { process.stderr.write('Sandbox policy verification failed; no workspace command was executed.\n'); process.exitCode = 1; }
}
