import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RuntimeError } from './config.js';

/** Anonymous identity is an opaque HttpOnly cookie; assignments stay server-side. */
export class Visitors {
  static async open({ directory, secure = true, retentionMs = 30 * 86400000, maxVisitors = 128, now = Date.now }) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 }); await fs.chmod(directory, 0o700);
    const keyFile = path.join(directory, 'visitor-key');
    let secret;
    try { secret = await fs.readFile(keyFile); }
    catch (e) { if (e.code !== 'ENOENT') throw e; secret = randomBytes(32); await fs.writeFile(keyFile, secret, { mode: 0o600, flag: 'wx' }); }
    if (secret.length !== 32) throw new Error('Invalid visitor signing key.');
    await fs.chmod(keyFile, 0o600);
    let records = [];
    try { records = JSON.parse(await fs.readFile(path.join(directory, 'visitors.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!Array.isArray(records) || records.length > maxVisitors) throw new Error('Invalid visitor registry.');
    const v = new Visitors({ directory, secure, retentionMs, maxVisitors, now, secret });
    const keys = new Set();
    for (const record of records) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(record.id) || !/^[a-f0-9]{32}$/.test(record.key) || !Number.isFinite(record.createdAt) || !Number.isFinite(record.lastSeen)) throw new Error('Invalid visitor registry entry.');
      if (v.records.has(record.id) || keys.has(record.key)) throw new Error('Duplicate visitor assignment.');
      keys.add(record.key); record.principal = v.principal(record.key); v.records.set(record.id, record);
    }
    return v;
  }
  constructor(options) { Object.assign(this, options); this.records = new Map(); this.queue = Promise.resolve(); this.buckets = new Map(); this.savedAt = 0; }
  principal(key) { return { userId: `guest-${key}`, workspaceId: `guest-${key}`, container: `lope-guest-${key}` }; }
  get cookieName() { return this.secure ? '__Host-lope-visitor' : 'lope-visitor'; }
  sign(value) { return createHmac('sha256', this.secret).update(value).digest('base64url'); }
  authenticate(cookies = '') {
    const value = cookies.split(';').map(x => x.trim()).find(x => x.startsWith(this.cookieName + '='))?.slice(this.cookieName.length + 1);
    if (!value || !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value)) throw new RuntimeError('UNAUTHENTICATED', 'Your workspace session has expired.', 401);
    const [id, signature] = value.split('.'), expected = this.sign(id);
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new RuntimeError('UNAUTHENTICATED', 'Your workspace session has expired.', 401);
    const record = this.records.get(id);
    if (!record || record.lastSeen + this.retentionMs <= this.now() || record.deleting) throw new RuntimeError('UNAUTHENTICATED', 'Your workspace session has expired.', 401);
    record.lastSeen = this.now();
    if (this.now() - this.savedAt > 300000 && !this.flushPending) {
      this.flushPending = true; this.serial(() => this.save()).catch(() => {}).finally(() => { this.flushPending = false; });
    }
    return record;
  }
  serial(fn) { const result = this.queue.catch(() => {}).then(fn); this.queue = result; return result; }
  async save() {
    const file = path.join(this.directory, 'visitors.json'), temp = file + '.tmp-' + randomBytes(12).toString('hex');
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify([...this.records.values()].map(({ id, key, createdAt, lastSeen, deleting }) => ({ id, key, createdAt, lastSeen, ...(deleting ? { deleting: true } : {}) })))); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temp, file);
      const directory = await fs.open(this.directory, 'r'); try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    this.savedAt = this.now();
  }
  cookie(record) { return `${this.cookieName}=${record.id}.${this.sign(record.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(this.retentionMs / 1000)}${this.secure ? '; Secure' : ''}`; }
  async obtain(cookies, address) {
    try { const record = this.authenticate(cookies); return { record, created: false }; } catch (e) { if (e.code !== 'UNAUTHENTICATED') throw e; }
    return this.serial(async () => {
      // No unauthenticated client can select somebody else's workspace or container.
      const fingerprint = this.sign(address), now = this.now();
      const bucket = this.buckets.get(fingerprint) || { credits: 5, time: now };
      bucket.credits = Math.min(5, bucket.credits + (now - bucket.time) / 360000); bucket.time = now;
      this.buckets.set(fingerprint, bucket);
      if (this.buckets.size > 4096) for (const [key, item] of this.buckets) if (now - item.time > 3600000) this.buckets.delete(key);
      if (this.buckets.size > 8192 || bucket.credits < 1) throw new RuntimeError('RATE_LIMIT', 'Please wait before creating another workspace.', 429);
      if (this.records.size >= this.maxVisitors) throw new RuntimeError('CAPACITY', 'Workspaces are busy. Please try again shortly.', 503);
      bucket.credits--;
      const record = { id: randomBytes(32).toString('base64url'), key: randomBytes(16).toString('hex'), createdAt: now, lastSeen: now };
      record.principal = this.principal(record.key); this.records.set(record.id, record);
      try { await this.save(); } catch (e) { this.records.delete(record.id); throw e; }
      return { record, created: true };
    });
  }
  findPrincipal(subject) { const record = [...this.records.values()].find(r => r.principal.userId === subject && !r.deleting && r.lastSeen + this.retentionMs > this.now()); return record?.principal; }
  async expire(removeWorkspace) {
    if (this.expiring) return; this.expiring = true;
    try {
      for (const [id, record] of [...this.records]) {
        if (!record.deleting && record.lastSeen + this.retentionMs > this.now()) continue;
        await this.serial(async () => { record.deleting = true; await this.save(); }); // Revoke before deletion.
        await removeWorkspace(record.principal);
        await this.serial(async () => { this.records.delete(id); await this.save(); });
      }
    } finally { this.expiring = false; }
  }
}
