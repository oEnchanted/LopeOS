import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createRuntime } from './server.js';
import { ManagedWorkspaces } from './managed.js';
import { Visitors } from './visitors.js';

export async function startPublicRuntime(env = process.env) {
  const config = loadConfig({ ...env, LOPE_PUBLIC_VISITORS: '1' });
  const number = (key, fallback, min, max) => { const n = Number(env[key] || fallback); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}`); return n; };
  const secure = env.LOPE_VISITOR_SECURE_COOKIE !== '0';
  if (!secure && config.origins.some(o => !['localhost', '127.0.0.1', '[::1]'].includes(new URL(o).hostname))) throw new Error('Public visitor cookies require HTTPS.');
  const stateDirectory = env.LOPE_STATE_DIR || '/var/lib/lopeos';
  if (!path.isAbsolute(stateDirectory) || /[\n\r,]/.test(stateDirectory) || stateDirectory === '/') throw new Error('Invalid runtime state directory.');
  const visitors = await Visitors.open({ directory: path.join(stateDirectory, 'control'), secure, retentionMs: number('LOPE_GUEST_RETENTION_DAYS', 30, 1, 365) * 86400000, maxVisitors: number('LOPE_MAX_VISITORS', 128, 1, 4096) });
  config.resolvePrincipal = subject => visitors.findPrincipal(subject); config.trustProxy = env.LOPE_TRUST_PROXY === '1';
  const workspace = new ManagedWorkspaces({ stateDirectory, image: env.LOPE_WORKSPACE_IMAGE || 'lope-workspace:local', storageMb: number('LOPE_STORAGE_MB', 512, 128, 2048), maxActive: number('LOPE_MAX_ACTIVE', 8, 1, 128), idleMs: number('LOPE_WORKSPACE_IDLE_MS', 900000, 60000, 86400000) });
  const runtime = createRuntime(config, workspace, visitors);
  let maintaining = false;
  const maintenance = setInterval(async () => {
    if (maintaining) return; maintaining = true;
    try {
      await visitors.expire(async owner => { await runtime.closeOwner(owner); await workspace.remove(owner); });
      await workspace.idle([...visitors.records.values()].filter(r => !r.deleting).map(r => r.principal), runtime.isConnected, runtime.closeOwner);
    } catch { console.error('Workspace maintenance will retry; no expired identity is reused.'); }
    finally { maintaining = false; }
  }, 30000); maintenance.unref();
  const close = runtime.close;
  runtime.close = async () => { clearInterval(maintenance); await close(); await visitors.serial(() => visitors.save()); };
  await new Promise((resolve, reject) => { runtime.server.once('error', reject); runtime.server.listen(config.port, config.host, resolve); });
  return runtime;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Run the public workspace service inside the host WSL2/Linux environment using the supplied service installer.');
    const runtime = await startPublicRuntime();
    console.log('LopeOS visitor runtime listening on loopback. Guest workspaces are automatic.');
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (stopping) return; stopping = true; const deadline = setTimeout(() => process.exit(1), 10000); await runtime.close(); clearTimeout(deadline); process.exit(0); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
