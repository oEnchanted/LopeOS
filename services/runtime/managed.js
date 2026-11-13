import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DockerWorkspace, runDocker } from './docker.js';
import { RuntimeError } from './config.js';
import { assertSandbox, quarantine } from './sandbox-policy.js';

function provisionCommand(script, principal, config) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', [fileURLToPath(new URL(script, import.meta.url)), principal.userId, principal.workspaceId, principal.container], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH, DOCKER_HOST: 'unix:///var/run/docker.sock', LOPE_STATE_DIR: config.stateDirectory, LOPE_STORAGE_MB: String(config.storageMb), LOPE_WORKSPACE_IMAGE: config.image, LOPE_SKIP_BUILD: '1', LOPE_MANAGED_PUBLIC: '1', LOPE_REUSE_CONTAINER: '1' },
    });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new RuntimeError('UNAVAILABLE', 'Your workspace could not start. Please try again shortly.', 503)); }, 90000);
    child.on('error', () => { clearTimeout(timer); reject(new RuntimeError('UNAVAILABLE', 'Your workspace could not start. Please try again shortly.', 503)); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new RuntimeError('UNAVAILABLE', 'Your workspace could not start. Please try again shortly.', 503)); });
  });
}
/** Runs on the operator's Linux/WSL2 host, never on a visitor's computer. */
export class ManagedWorkspaces extends DockerWorkspace {
  constructor(config, { docker = runDocker, provision = provisionCommand } = {}) { super({ stateDirectory: config.stateDirectory, docker }); this.config = config; this.docker = docker; this.provision = provision; this.jobs = new Map(); this.lastUse = new Map(); this.admissions = Promise.resolve(); }
  status(owner) { const job = this.jobs.get(owner.container); return { state: job?.state || 'starting', message: job?.error?.message }; }
  begin(owner) { this.ready(owner).catch(() => {}); return this.status(owner); }
  async ready(owner) {
    this.lastUse.set(owner.container, Date.now());
    const existing = this.jobs.get(owner.container);
    if (existing?.state === 'ready') {
      try { return await super.ready(owner); } catch { this.jobs.delete(owner.container); }
    }
    if (existing?.promise && existing.state === 'starting') return existing.promise;
    if (existing?.retryAt > Date.now()) throw existing.error;
    const job = { state: 'starting' }; this.jobs.set(owner.container, job);
    const result = this.admissions.catch(() => {}).then(async () => {
      let info;
      try { [info] = JSON.parse(await this.docker(['inspect', owner.container], undefined, { maxBytes: 128 * 1024 })); }
      catch { await this.docker(['image', 'inspect', this.config.image], undefined, { maxBytes: 128 * 1024 }); }
      if (info) {
        try { assertSandbox(info, owner, { stateDirectory: this.stateDirectory, allowStopped: true }); }
        catch (error) { await quarantine(info, owner, this.docker); throw error; }
      }
      if (!info?.State.Running) {
        const active = (await this.docker(['ps', '--filter', 'label=lope.managed=public', '--format', '{{.ID}}'], undefined, { maxBytes: 32768 })).trim().split('\n').filter(Boolean).length;
        if (active >= this.config.maxActive) throw new RuntimeError('CAPACITY', 'Your workspace is waiting for available server capacity…', 503);
        await this.provision('./provision-linux.sh', owner, this.config);
      }
      const containerId = await super.ready(owner); job.state = 'ready'; return containerId;
    });
    job.promise = result; this.admissions = result;
    try { return await result; }
    catch (error) { job.state = error.code === 'CAPACITY' ? 'queued' : 'unavailable'; job.error = error.code === 'CAPACITY' ? error : new RuntimeError('UNAVAILABLE', 'Your workspace is temporarily unavailable. Please try again shortly.', 503); job.retryAt = Date.now() + 3000; throw job.error; }
  }
  async idle(owners, isConnected, closeOwner) {
    for (const owner of owners) {
      if (isConnected(owner) || Date.now() - (this.lastUse.get(owner.container) || 0) < this.config.idleMs || this.jobs.get(owner.container)?.state === 'starting') continue;
      const action = this.admissions.catch(() => {}).then(async () => {
        if (isConnected(owner) || Date.now() - (this.lastUse.get(owner.container) || 0) < this.config.idleMs) return;
        await closeOwner(owner);
        try { await this.docker(['stop', '--time', '2', owner.container], undefined, { timeout: 10000, maxBytes: 4096 }); } catch { return; }
        this.jobs.delete(owner.container); this.checks.delete(owner.container); this.reaped.delete(owner.container);
      });
      this.admissions = action; await action;
    }
  }
  async remove(owner) {
    await this.provision('./remove-workspace.sh', owner, this.config);
    this.jobs.delete(owner.container); this.lastUse.delete(owner.container); this.checks.delete(owner.container); this.reaped.delete(owner.container);
  }
}
