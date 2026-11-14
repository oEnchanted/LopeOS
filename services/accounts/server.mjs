import http from 'node:http';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { isIP } from 'node:net';
import { availableParallelism, cpus, freemem, totalmem } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const QUOTA_BYTES = 1_000_000_000;
export const UNLOCKED_QUOTA_BYTES = 25_000_000_000;
// "Unlock 25 GB" code. This repository is public, so only a salted scrypt hash is stored.
const STORAGE_UNLOCK = { salt: '0a9be21c4765937d9be07dd4561a1ed4', hash: '0b48bf2bc34eacf74e6ed2dea403d1980821811ea554e432e1d45ba29d07646d' };
const gigabytes = bytes => `${Math.round(bytes / 1e9)} GB`;
export const MAX_BLOB_BYTES = 1024 * 1024 * 1024 + 28;
// Sessions slide: each visit renews the full window, so only 90 idle days sign a device out.
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_RENEW_MS = 24 * 60 * 60 * 1000;
const STAGING_MS = 60 * 60 * 1000;
const PRESENCE_MS = 90 * 1000;
const presencePattern = /^[A-Za-z0-9_-]{16,64}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const accountPattern = /^[a-z][a-z0-9_-]{0,31}$/;
const reserved = new Set(['guest', 'shared', 'root', 'system', 'admin', 'administrator', 'everyone', 'nobody']);
const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const newRecoveryKey = () => randomBytes(24).toString('hex').match(/.{6}/g).join('-');
const recoveryDigest = key => digest(String(key).replace(/[-\s]/g, '').toLowerCase());
const publicAccount = ({ id, accountName, displayName, createdAt }) => ({ id, accountName, displayName, createdAt });
class ServiceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ServiceError(status, code, message); };
const execFileAsync = promisify(execFile);
let darwinAvailable = null, darwinAvailableAt = 0;
/** Bytes of memory available for new work. macOS reports only never-used pages as free, so add reclaimable inactive pages there. */
async function availableMemory() {
  if (process.platform !== 'darwin') return freemem();
  if (darwinAvailable !== null && Date.now() - darwinAvailableAt < 2_000) return darwinAvailable;
  try {
    const { stdout } = await execFileAsync('/usr/bin/vm_stat', [], { timeout: 2_000 });
    const pages = name => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)`, 'm').exec(stdout)?.[1]);
    const bytes = (pages('free') + pages('inactive')) * Number(/page size of (\d+) bytes/.exec(stdout)?.[1]);
    darwinAvailable = Number.isFinite(bytes) ? bytes : freemem();
  } catch { darwinAvailable = freemem(); }
  darwinAvailableAt = Date.now();
  return darwinAvailable;
}
async function syncDirectory(directory) {
  let folder;
  try { folder = await open(directory, 'r'); await folder.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EACCES'].includes(error.code)) throw error; }
  finally { await folder?.close(); }
}
async function atomicJSON(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  // Flush the rename too, so a committed registry/manifest survives a power loss.
  await syncDirectory(dirname(path));
}
async function jsonBody(req, limit = 16 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'CONTENT_TYPE', 'Send a JSON request.');
  const chunks = []; let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) { req.resume(); fail(413, 'REQUEST_TOO_LARGE', 'This request is too large.'); }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail(400, 'INVALID_JSON', 'Send a valid JSON object.'); }
}
function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function validateVault(value) {
  if (!value || value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.id) || !/^[a-f0-9]{120}$/.test(value.passwordWrap) || !/^[a-f0-9]{120}$/.test(value.recoveryWrap)) fail(400, 'INVALID_VAULT', 'A valid encrypted key envelope is required.');
  return { version: 1, id: value.id, passwordWrap: value.passwordWrap, recoveryWrap: value.recoveryWrap };
}
function validateProof(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(400, 'INVALID_PROOF', 'An encrypted recovery credential is required.'); return value; }
function requireEncrypted(entries) { if (entries.some(entry => !/^e2ee:[a-f0-9]+$/.test(entry.key))) fail(400, 'ENCRYPTION_REQUIRED', 'This account only accepts encrypted file metadata.'); }
function validateManifest(value) {
  if (!Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0 || !Array.isArray(value.entries) || value.entries.length > 100_000) fail(400, 'INVALID_MANIFEST', 'The sync manifest is invalid.');
  const keys = new Set();
  return value.entries.map(entry => {
    if (!entry || typeof entry.key !== 'string' || !entry.key.length || entry.key.length > 16384 || /[\x00-\x1f\x7f]/.test(entry.key)
      || keys.has(entry.key) || !hashPattern.test(entry.hash) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_BLOB_BYTES
      || typeof entry.modifiedAt !== 'string' || !Number.isFinite(Date.parse(entry.modifiedAt))) fail(400, 'INVALID_MANIFEST', 'The sync manifest contains an invalid or duplicate entry.');
    keys.add(entry.key);
    return { key: entry.key, hash: entry.hash, size: entry.size, modifiedAt: entry.modifiedAt };
  });
}

/** One process owns this directory. Never mount it under the static web root. */
export async function createAccountServer(options = {}) {
  const directory = resolve(options.directory ?? process.env.LOPE_ACCOUNTS_DATA ?? '.accounts-data');
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origins = options.origins ?? (process.env.LOPE_ACCOUNTS_ORIGINS || (production ? '' : 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173')).split(',').map(value => value.trim()).filter(Boolean);
  if (!origins.length || origins.some(value => { try { const url = new URL(value); return url.origin !== value || (production && url.protocol !== 'https:'); } catch { return true; } })) throw new Error('Configure LOPE_ACCOUNTS_ORIGINS with exact HTTPS website origins for production.');
  const quotaBytes = options.quotaBytes ?? QUOTA_BYTES;
  // Accounts that redeemed an unlock code keep a larger quota in the registry.
  const quotaFor = account => { const stored = account ? registry.accounts.find(value => value.id === account.id)?.quotaBytes : undefined; return Number.isSafeInteger(stored) && stored > 0 ? stored : quotaBytes; };
  const trustProxy = options.trustProxy ?? process.env.LOPE_ACCOUNTS_TRUST_PROXY === '1';
  const cookieName = production ? '__Host-lope-account' : 'lope-account';
  const cookie = (token, maxAge = SESSION_MS / 1000) => `${cookieName}=${token}; Path=${production ? '/' : '/api/accounts'}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // A single writer keeps registration, quotas and compare-and-swap commits atomic.
  const lockPath = join(directory, '.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)); }
  catch (error) { throw new Error(`Account storage is locked or unavailable: ${directory}. Stop any existing service before removing a stale .lock file.`, { cause: error }); }
  const registryPath = join(directory, 'registry.json');
  let registry;
  try {
    try { registry = JSON.parse(await readFile(registryPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; registry = { version: 1, accounts: [], sessions: {} }; await atomicJSON(registryPath, registry); }
    if (registry.version !== 1 || !Array.isArray(registry.accounts) || !registry.sessions || typeof registry.sessions !== 'object'
      || registry.accounts.some(account => !/^[a-f0-9-]{36}$/.test(account.id) || !accountPattern.test(account.accountName) || !hashPattern.test(account.passwordHash) || !/^[a-f0-9]{32}$/.test(account.salt))
      || new Set(registry.accounts.map(account => account.accountName)).size !== registry.accounts.length
      || Object.entries(registry.sessions).some(([hash, session]) => !hashPattern.test(hash) || !session || !Number.isSafeInteger(session.expiresAt) || !registry.accounts.some(account => account.id === session.accountId))) throw new Error('Invalid account registry.');
    // No upload can still be active under this exclusive lock after a restart.
    for (const account of registry.accounts) {
      const location = join(directory, account.id, 'blobs');
      for (const name of await readdir(location).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
        if (/^[a-f0-9-]+\.upload$/.test(name)) await unlink(join(location, name));
      }
    }
  } catch (error) { await lock.close(); await unlink(lockPath); throw new Error('Account storage could not be read; existing data was preserved.', { cause: error }); }
  let registryQueue = Promise.resolve(), authActive = 0, active = 0, closing = false;
  const queues = new Map(), buckets = new Map();
  function serial(key, task) {
    const previous = queues.get(key) ?? { promise: Promise.resolve(), count: 0 };
    if (previous.count >= 12) fail(429, 'BUSY', 'Account storage is busy. Try again shortly.');
    const entry = { count: previous.count + 1, promise: previous.promise.catch(() => {}).then(task) };
    queues.set(key, entry);
    return entry.promise.finally(() => { const current = queues.get(key); current.count--; if (current === entry) queues.delete(key); });
  }
  function saveRegistry(task) {
    const result = registryQueue.catch(() => {}).then(async () => {
      const next = structuredClone(registry);
      const value = await task(next);
      await atomicJSON(registryPath, next); registry = next;
      return value;
    });
    registryQueue = result; return result;
  }
  function rate(key, capacity, duration, store = buckets) {
    const now = Date.now(), bucket = store.get(key);
    if (!bucket && store.size >= 10_000) {
      for (const [name, value] of store) if (value.until <= now) store.delete(name);
      if (store.size >= 10_000) fail(429, 'RATE_LIMIT', 'The account service is busy. Please try again later.');
    }
    if (bucket && bucket.until > now) { if (bucket.count >= capacity) fail(429, 'RATE_LIMIT', 'Too many attempts. Please try again later.'); bucket.count++; }
    else store.set(key, { until: now + duration, count: 1 });
  }
  function clientAddress(req) {
    const direct = req.socket.remoteAddress ?? 'unknown', forwarded = req.headers['x-forwarded-for'];
    return trustProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct) && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : direct;
  }
  // Desktop server widget: aggregate host load and anonymous presence, held in memory only.
  const presenceMs = options.presenceMs ?? PRESENCE_MS;
  const presence = new Map(), presenceByAddress = new Map(), hostBuckets = new Map();
  let presencePrunedAt = 0, cpuBaseline = null, cpuPercent = null, cpuSampledAt = 0, cpuPending = null;
  const cpuTimes = () => cpus().reduce((sum, core) => {
    const { user, nice, sys, idle, irq } = core.times;
    return { idle: sum.idle + idle, total: sum.total + user + nice + sys + idle + irq, at: sum.at };
  }, { idle: 0, total: 0, at: Date.now() });
  async function processorLoad() {
    if (cpuPercent !== null && Date.now() - cpuSampledAt < 1500) return cpuPercent;
    cpuPending ??= (async () => {
      // Load is a delta between samples; a missing or stale baseline gets a short window of its own.
      if (!cpuBaseline || Date.now() - cpuBaseline.at > 15_000) { cpuBaseline = cpuTimes(); await delay(250); }
      const current = cpuTimes(), total = current.total - cpuBaseline.total;
      cpuPercent = total > 0 ? Math.min(100, Math.max(0, 100 * (1 - (current.idle - cpuBaseline.idle) / total))) : null;
      cpuBaseline = current; cpuSampledAt = current.at;
    })().finally(() => { cpuPending = null; });
    await cpuPending;
    return cpuPercent;
  }
  function forgetPresence(id, entry) {
    presence.delete(id);
    const remaining = (presenceByAddress.get(entry.address) ?? 1) - 1;
    if (remaining > 0) presenceByAddress.set(entry.address, remaining); else presenceByAddress.delete(entry.address);
  }
  function markPresent(id, address, account) {
    const now = Date.now(), existing = presence.get(id);
    if (existing) { existing.seen = now; existing.accountId = account?.id ?? null; return; }
    // Bounded: one address, or a flood of invented identifiers, cannot grow this without limit.
    const full = () => presence.size >= 5_000 || (presenceByAddress.get(address) ?? 0) >= 24;
    if (now - presencePrunedAt > 5_000 || full()) {
      presencePrunedAt = now;
      for (const [key, entry] of presence) if (entry.seen + presenceMs <= now) forgetPresence(key, entry);
    }
    if (full()) return;
    presence.set(id, { seen: now, address, accountId: account?.id ?? null });
    presenceByAddress.set(address, (presenceByAddress.get(address) ?? 0) + 1);
  }
  function onlineCounts() {
    const now = Date.now(), accounts = new Set();
    let guests = 0;
    // A person signed in on several devices counts once; each guest browser counts once.
    for (const entry of presence.values()) if (entry.seen + presenceMs > now) { if (entry.accountId) accounts.add(entry.accountId); else guests++; }
    return { people: guests + accounts.size, signedIn: accounts.size };
  }
  const accountDir = account => join(directory, account.id);
  const blobPath = (account, hash) => join(accountDir(account), 'blobs', hash);
  async function readManifest(account) {
    const current = registry.accounts.find(value => value.id === account.id);
    if (current?.vault) return current.encryptedManifest ?? { revision: 0, entries: [] };
    try {
      const saved = JSON.parse(await readFile(join(accountDir(account), 'manifest.json'), 'utf8'));
      const entries = validateManifest({ baseRevision: saved.revision, entries: saved.entries });
      return { revision: saved.revision, entries };
    } catch (error) { if (error.code === 'ENOENT') return { revision: 0, entries: [] }; throw error; }
  }
  async function blobInventory(account) {
    const location = join(accountDir(account), 'blobs');
    const files = await readdir(location).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const result = new Map();
    for (const hash of files.filter(name => hashPattern.test(name))) { const info = await stat(join(location, hash)); result.set(hash, { size: info.size, modified: info.mtimeMs }); }
    return result;
  }
  async function collect(account, { allStaged = false, previous = [] } = {}) {
    const manifest = await readManifest(account), retained = new Set(manifest.entries.map(entry => entry.hash)), retired = new Set(previous.map(entry => entry.hash));
    const inventory = await blobInventory(account);
    for (const [hash, info] of inventory) if (!retained.has(hash) && (allStaged || retired.has(hash) || Date.now() - info.modified > STAGING_MS)) {
      await unlink(blobPath(account, hash)); inventory.delete(hash);
    }
    return [...inventory.values()].reduce((sum, info) => sum + info.size, 0);
  }
  async function summary(account) {
    const usedBytes = account ? await serial(account.id, async () => [...(await blobInventory(account)).values()].reduce((sum, info) => sum + info.size, 0)) : 0;
    return { account: account ? publicAccount(account) : null, vault: account?.vault ?? null, quotaBytes: quotaFor(account), usedBytes };
  }
  const sessionToken = req => String(req.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  /** Extend an active session at most once a day so restoring LopeOS keeps the device signed in. */
  async function renew(req, res, account) {
    const token = sessionToken(req), hash = token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
    const current = hash ? registry.sessions[hash] : null;
    if (!current || current.accountId !== account.id || current.expiresAt - Date.now() > SESSION_MS - SESSION_RENEW_MS) return;
    let renewed = false;
    await saveRegistry(next => {
      const session = next.sessions[hash];
      if (!session || session.accountId !== account.id || session.expiresAt <= Date.now()) return;
      session.expiresAt = Date.now() + SESSION_MS; renewed = true;
    });
    if (renewed) res.setHeader('Set-Cookie', cookie(token));
  }
  function identity(req, required = true) {
    const token = sessionToken(req);
    const session = token && /^[a-f0-9]{64}$/.test(token) ? registry.sessions[digest(token)] : null;
    const account = session && session.expiresAt > Date.now() ? registry.accounts.find(value => value.id === session.accountId) : null;
    if (!account && required) fail(401, 'SIGN_IN_REQUIRED', 'Sign in to your LopeOS account to sync.');
    return account ?? null;
  }
  function assertSession(req, account) {
    const current = identity(req);
    if (current.id !== account.id) fail(409, 'SESSION_CHANGED', 'Your session changed. Sign in again.');
    if (current.vault && req.headers['x-lope-encryption'] !== '1') fail(409, 'ENCRYPTION_REQUIRED', 'Unlock this encrypted account in an updated client.');
  }
  async function establish(res, account) {
    const token = randomBytes(32).toString('hex');
    await saveRegistry(next => {
      if (next.accounts.find(value => value.id === account.id)?.passwordHash !== account.passwordHash) fail(401, 'SESSION_CHANGED', 'Your password changed. Sign in again.');
      for (const [key, value] of Object.entries(next.sessions)) if (value.expiresAt <= Date.now()) delete next.sessions[key];
      // Bound active sessions per account; the oldest session expires first.
      const own = Object.entries(next.sessions).filter(([, value]) => value.accountId === account.id).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      for (const [key] of own.slice(0, Math.max(0, own.length - 19))) delete next.sessions[key];
      next.sessions[digest(token)] = { accountId: account.id, expiresAt: Date.now() + SESSION_MS };
    });
    res.setHeader('Set-Cookie', cookie(token));
  }
  // Complete cleanup after a crash between an atomic encryption upgrade and deleting old plaintext.
  try {
    for (const account of registry.accounts.filter(value => value.vault)) {
      validateVault(account.vault);
      if (account.encryptedManifest) { validateManifest({ baseRevision: account.encryptedManifest.revision, entries: account.encryptedManifest.entries }); requireEncrypted(account.encryptedManifest.entries); }
      await collect(account, { allStaged: true });
      await unlink(join(accountDir(account), 'manifest.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  } catch (error) {
    await lock.close(); await unlink(lockPath);
    throw new Error('Encrypted account storage could not be opened; existing data was preserved.', { cause: error });
  }
  const server = http.createServer({ requestTimeout: 3_600_000, headersTimeout: 15_000, maxHeaderSize: 16 * 1024 }, async (req, res) => {
    active++;
    try {
      if (closing || active > 32) fail(503, 'BUSY', 'The account service is busy. Try again shortly.');
      const url = new URL(req.url, 'http://accounts.invalid');
      if (!url.pathname.startsWith('/api/accounts/')) fail(404, 'NOT_FOUND', 'Account endpoint not found.');
      const origin = req.headers.origin;
      if ((origin && !origins.includes(origin)) || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'ORIGIN', 'This website is not allowed to use the account service.');
      if (!['GET', 'HEAD'].includes(req.method) && !origins.includes(origin)) fail(403, 'ORIGIN', 'An allowed website origin is required.');
      if (req.method === 'GET' && url.pathname === '/api/accounts/session') { const account = identity(req, false); if (account) await renew(req, res, account); return json(res, 200, await summary(account)); }
      if (req.method === 'POST' && url.pathname === '/api/accounts/host') {
        const address = clientAddress(req);
        rate(`host:${address}`, 600, 60_000, hostBuckets);
        const input = await jsonBody(req, 1024);
        if (typeof input.presence !== 'string' || !presencePattern.test(input.presence)) fail(400, 'INVALID_PRESENCE', 'A presence identifier is required.');
        markPresent(input.presence, address, identity(req, false));
        const [percent, available] = await Promise.all([processorLoad(), availableMemory()]), totalBytes = totalmem();
        return json(res, 200, {
          cpu: { percent: percent === null ? null : Math.round(percent * 10) / 10, cores: availableParallelism() },
          memory: { usedBytes: Math.min(totalBytes, Math.max(0, totalBytes - available)), totalBytes },
          online: onlineCounts(),
        });
      }
      if (req.method === 'POST' && ['/api/accounts/register', '/api/accounts/login', '/api/accounts/recover', '/api/accounts/recovery-key', '/api/accounts/recovery-info', '/api/accounts/upgrade'].includes(url.pathname)) {
        const address = clientAddress(req);
        rate(`auth:${address}`, 30, 15 * 60_000);
        if (authActive >= 4) fail(429, 'BUSY', 'Sign-in is busy. Try again shortly.');
        const input = await jsonBody(req, url.pathname.endsWith('/upgrade') ? 32 * 1024 * 1024 : 16 * 1024);
        if (url.pathname.endsWith('/recovery-info')) input.password = '';
        if (typeof input.accountName !== 'string' || input.accountName.trim().length > 32 || typeof input.password !== 'string' || input.password.length > 1024) fail(400, 'INVALID_CREDENTIALS', 'Enter an account name and a password of at most 1,024 characters.');
        const name = input.accountName.trim().toLowerCase();
        rate(`name:${name}`, 15, 15 * 60_000);
        // Body reads yield: reserve a KDF slot only after parsing, then recheck it.
        if (authActive >= 4) fail(429, 'BUSY', 'Sign-in is busy. Try again shortly.');
        authActive++;
        try {
          if (url.pathname.endsWith('/register')) {
            if (input.credentialVersion !== 1 && options.allowLegacyRegistration !== true) fail(400, 'ENCRYPTION_REQUIRED', 'Update LopeOS to create an end-to-end encrypted account.');
            rate(`register:${address}`, 8, 60 * 60_000);
            if (!accountPattern.test(name) || reserved.has(name)) fail(400, 'INVALID_ACCOUNT_NAME', 'Use a name starting with a letter, followed by letters, numbers, hyphens or underscores (up to 32 characters).');
            const displayName = typeof input.displayName === 'string' ? input.displayName.trim().replace(/\s+/g, ' ') : '';
            if (!displayName || displayName.length > 64) fail(400, 'INVALID_DISPLAY_NAME', 'Enter a display name with 1–64 characters.');
            if (input.password.length < 12) fail(400, 'WEAK_PASSWORD', 'Use a password with at least 12 characters.');
            const salt = randomBytes(16).toString('hex');
            const passwordHash = (await derive(input.password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
            const vault = input.credentialVersion === 1 ? validateVault(input.vault) : null;
            if (vault) validateProof(input.password);
            const recoveryKey = vault ? undefined : newRecoveryKey();
            const account = { ...(vault ? { vault, credentialVersion: 1 } : {}), recoveryHash: vault ? recoveryDigest(validateProof(input.recoveryProof)) : recoveryDigest(recoveryKey), id: randomUUID(), accountName: name, displayName, salt, passwordHash, createdAt: new Date().toISOString() };
            await saveRegistry(async next => {
              if (next.accounts.some(value => value.accountName === name)) fail(409, 'ACCOUNT_NAME_TAKEN', 'That account name is already in use.');
              await mkdir(join(accountDir(account), 'blobs'), { recursive: true, mode: 0o700 });
              next.accounts.push(account);
            });
            await establish(res, account); return json(res, 201, { ...await summary(account), recoveryKey });
          }
          const account = registry.accounts.find(value => value.accountName === name);
          if (url.pathname.endsWith('/recovery-info')) {
            const supplied = recoveryDigest(typeof input.recoveryProof === 'string' ? input.recoveryProof : '');
            if (!account?.vault || !account.recoveryHash || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(account.recoveryHash, 'hex'))) fail(401, 'INVALID_RECOVERY', 'The account name or recovery key is incorrect.');
            return json(res, 200, { vault: account.vault });
          }
          if (url.pathname.endsWith('/recover')) {
            if (input.password.length < 12) fail(400, 'WEAK_PASSWORD', 'Use a password with at least 12 characters.');
            const supplied = recoveryDigest(typeof input.recoveryKey === 'string' ? input.recoveryKey : '');
            if (!account?.recoveryHash || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(account.recoveryHash, 'hex'))) fail(401, 'INVALID_RECOVERY', 'The account name or recovery key is incorrect.');
            const salt = randomBytes(16).toString('hex');
            const passwordHash = (await derive(input.password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
            const vault = account.vault ? validateVault(input.vault) : null;
            if (vault) validateProof(input.password);
            if (vault && (vault.id !== account.vault.id || input.credentialVersion !== 1)) fail(400, 'INVALID_VAULT', 'Recovery must preserve the encrypted file key.');
            const recoveryKey = vault ? undefined : newRecoveryKey();
            const recoveryHash = vault ? recoveryDigest(validateProof(input.recoveryProof)) : recoveryDigest(recoveryKey);
            await saveRegistry(next => {
              const current = next.accounts.find(value => value.id === account.id);
              if (current.recoveryHash !== supplied) fail(401, 'INVALID_RECOVERY', 'The account name or recovery key is incorrect.');
              Object.assign(current, { salt, passwordHash, recoveryHash, ...(vault ? { vault } : {}) });
              for (const [key, value] of Object.entries(next.sessions)) if (value.accountId === account.id) delete next.sessions[key];
            });
            return json(res, 200, { recoveryKey });
          }
          if (account?.vault && input.credentialVersion !== 1) fail(400, 'ENCRYPTION_REQUIRED', 'Update LopeOS to sign in to this encrypted account.');
          if (account && !account.vault && input.credentialVersion === 1 && !url.pathname.endsWith('/upgrade')) fail(409, 'LEGACY_ACCOUNT', 'This account needs an encryption upgrade. Use the existing-account upgrade flow.');
          const actual = await derive(input.password, account?.salt ?? '00000000000000000000000000000000', 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
          const expected = Buffer.from(account?.passwordHash ?? '0'.repeat(64), 'hex');
          if (!timingSafeEqual(actual, expected) || !account) fail(401, 'INVALID_CREDENTIALS', 'The account name or password is incorrect.');
          if (url.pathname.endsWith('/upgrade')) {
            if (account.vault) fail(409, 'ALREADY_ENCRYPTED', 'This account is already encrypted. Sign in again.');
            const vault = validateVault(input.vault), recoveryHash = recoveryDigest(validateProof(input.recoveryProof));
            const newPassword = validateProof(input.newPassword);
            const entries = validateManifest(input); requireEncrypted(entries);
            const salt = randomBytes(16).toString('hex');
            const passwordHash = (await derive(newPassword, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
            await serial(account.id, async () => {
              const previous = await readManifest(account), inventory = await blobInventory(account), unique = new Map();
              if (previous.revision !== input.baseRevision) fail(409, 'REVISION_CONFLICT', 'Another device changed your files. Retry the upgrade.');
              for (const entry of entries) { if (inventory.get(entry.hash)?.size !== entry.size) fail(400, 'MISSING_BLOB', 'An encrypted file is missing.'); unique.set(entry.hash, entry.size); }
              if ([...unique.values()].reduce((sum, size) => sum + size, 0) > quotaFor(account)) fail(413, 'QUOTA_EXCEEDED', 'Make room for encryption overhead before upgrading.');
              await saveRegistry(next => {
                const current = next.accounts.find(value => value.id === account.id);
                if (current.vault || current.passwordHash !== account.passwordHash) fail(409, 'SESSION_CHANGED', 'Your account changed. Sign in again.');
                Object.assign(current, { vault, credentialVersion: 1, salt, passwordHash, recoveryHash, encryptedManifest: { revision: previous.revision + 1, entries } });
                for (const [key, value] of Object.entries(next.sessions)) if (value.accountId === account.id) delete next.sessions[key];
              });
              await collect(account, { allStaged: true });
              await unlink(join(accountDir(account), 'manifest.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
            });
            return json(res, 200, { upgraded: true });
          }
          if (url.pathname.endsWith('/recovery-key')) {
            if (identity(req).id !== account.id) fail(403, 'SESSION_CHANGED', 'Sign in to this account first.');
            const vault = account.vault ? validateVault(input.vault) : null;
            if (vault && vault.id !== account.vault.id) fail(400, 'INVALID_VAULT', 'Keep the existing encrypted file key.');
            const recoveryKey = vault ? undefined : newRecoveryKey();
            const recoveryHash = vault ? recoveryDigest(validateProof(input.recoveryProof)) : recoveryDigest(recoveryKey);
            await saveRegistry(next => {
              const current = next.accounts.find(value => value.id === account.id);
              if (current.passwordHash !== account.passwordHash || identity(req).id !== account.id) fail(401, 'SESSION_CHANGED', 'Sign in again.');
              current.recoveryHash = recoveryHash; if (vault) current.vault = vault;
            });
            return json(res, 200, { recoveryKey });
          }
          await establish(res, account); return json(res, 200, await summary(account));
        } finally { authActive--; }
      }
      if (req.method === 'POST' && url.pathname === '/api/accounts/logout') {
        await jsonBody(req);
        const token = String(req.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        if (token) await saveRegistry(next => { delete next.sessions[digest(token)]; });
        res.setHeader('Set-Cookie', cookie('', 0)); return json(res, 200, { account: null, quotaBytes, usedBytes: 0 });
      }
      const account = identity(req);
      // Browser cookies are shared across tabs. A sync that began before another
      // tab changed the cookie must not read or write that different account.
      if (account.vault && req.headers['x-lope-encryption'] !== '1') fail(409, 'ENCRYPTION_REQUIRED', 'Unlock your encrypted account in an updated LopeOS client.');
      const expectedAccount = req.headers['x-lope-account'];
      if (expectedAccount !== undefined && expectedAccount !== account.id) fail(409, 'SESSION_CHANGED', 'Your account session changed. Sign in again before syncing.');
      if (url.pathname === '/api/accounts/storage/unlock' && req.method === 'POST') {
        const input = await jsonBody(req);
        const address = clientAddress(req);
        rate(`unlock:${account.id}`, 10, 15 * 60_000); rate(`unlock-ip:${address}`, 30, 15 * 60_000);
        const code = typeof input.code === 'string' ? input.code.trim() : '';
        if (!code || code.length > 200) fail(400, 'INVALID_CODE', 'Enter an unlock code.');
        if (authActive >= 4) fail(429, 'BUSY', 'The account service is busy. Try again shortly.');
        authActive++;
        let supplied;
        try { supplied = await derive(code, STORAGE_UNLOCK.salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
        finally { authActive--; }
        if (!timingSafeEqual(supplied, Buffer.from(STORAGE_UNLOCK.hash, 'hex'))) fail(403, 'INVALID_CODE', 'That code is not valid.');
        await saveRegistry(next => {
          const current = next.accounts.find(value => value.id === account.id);
          if (current) current.quotaBytes = Math.max(Number.isSafeInteger(current.quotaBytes) ? current.quotaBytes : quotaBytes, UNLOCKED_QUOTA_BYTES);
        });
        return json(res, 200, await summary(account));
      }
      if (url.pathname === '/api/accounts/manifest' && req.method === 'GET') {
        return await serial(account.id, async () => { assertSession(req, account); const manifest = await readManifest(account); json(res, 200, { ...manifest, quotaBytes: quotaFor(account), usedBytes: await collect(account) }); });
      }
      if (url.pathname === '/api/accounts/manifest' && req.method === 'PUT') {
        const input = await jsonBody(req, 24 * 1024 * 1024), entries = validateManifest(input);
        return await serial(account.id, async () => {
          assertSession(req, account);
          const previous = await readManifest(account);
          if (input.baseRevision !== previous.revision) fail(409, 'REVISION_CONFLICT', 'Your account changed on another device. Fetch its latest manifest and merge before retrying.');
          const inventory = await blobInventory(account), unique = new Map();
          for (const entry of entries) {
            if (inventory.get(entry.hash)?.size !== entry.size) fail(400, 'MISSING_BLOB', 'A synced item is missing or has the wrong size. Upload it again before saving.');
            unique.set(entry.hash, entry.size);
          }
          if ([...unique.values()].reduce((sum, size) => sum + size, 0) > quotaFor(account)) fail(413, 'QUOTA_EXCEEDED', `Your ${gigabytes(quotaFor(account))} LopeDrive is full. Free space before syncing more data.`);
          const next = { revision: previous.revision + 1, entries };
          const current = registry.accounts.find(value => value.id === account.id);
          if (current.vault) {
            if (req.headers['x-lope-encryption'] !== '1') fail(409, 'ENCRYPTION_REQUIRED', 'Update LopeOS before syncing this account.');
            requireEncrypted(entries);
            await saveRegistry(registry => { registry.accounts.find(value => value.id === account.id).encryptedManifest = next; });
          } else await atomicJSON(join(accountDir(account), 'manifest.json'), next);
          const usedBytes = await collect(account, { previous: previous.entries });
          return json(res, 200, { ...next, quotaBytes: quotaFor(account), usedBytes });
        });
      }
      if (url.pathname === '/api/accounts/cleanup' && req.method === 'POST') {
        await jsonBody(req);
        return await serial(account.id, async () => { assertSession(req, account); return json(res, 200, { quotaBytes: quotaFor(account), usedBytes: await collect(account, { allStaged: true }) }); });
      }
      const match = /^\/api\/accounts\/blobs\/([a-f0-9]{64})$/.exec(url.pathname);
      if (match && req.method === 'PUT') {
        const hash = match[1];
        return await serial(account.id, async () => {
          assertSession(req, account);
          const used = await collect(account), inventory = await blobInventory(account), present = inventory.has(hash);
          const accountQuota = quotaFor(account), uploadQuota = !account.vault && req.headers['x-lope-encryption-upgrade'] === '1' ? accountQuota * 2 + 2_800_000 : accountQuota;
          const available = present ? MAX_BLOB_BYTES : Math.min(MAX_BLOB_BYTES, uploadQuota - used);
          if (Number(req.headers['content-length'] ?? 0) > available) fail(413, 'QUOTA_EXCEEDED', `This upload exceeds the free space in your ${gigabytes(accountQuota)} LopeDrive or the 1 GB item limit.`);
          const temporary = join(accountDir(account), 'blobs', `${randomUUID()}.upload`), handle = await open(temporary, 'wx', 0o600);
          const checksum = createHash('sha256'); let size = 0;
          try {
            for await (const chunk of req.iterator({ destroyOnReturn: false })) {
              size += chunk.length;
              if (size > available) { req.resume(); fail(413, 'QUOTA_EXCEEDED', `Your ${gigabytes(accountQuota)} LopeDrive is full or this item exceeds 1 GB.`); }
              checksum.update(chunk); await handle.writeFile(chunk);
            }
            if (checksum.digest('hex') !== hash) fail(400, 'HASH_MISMATCH', 'The uploaded item did not match its checksum. Try again.');
            const usedBytes = used - (inventory.get(hash)?.size ?? 0) + size;
            if (usedBytes > uploadQuota) fail(413, 'QUOTA_EXCEEDED', `Your ${gigabytes(accountQuota)} LopeDrive is full. Free space before syncing more data.`);
            await handle.sync(); await handle.close();
            // Replace even an existing hash with the verified upload: retries can
            // repair a damaged stored object without changing its logical entry.
            await rename(temporary, blobPath(account, hash));
            await syncDirectory(dirname(blobPath(account, hash)));
            json(res, 200, { hash, size, quotaBytes: accountQuota, usedBytes });
          } catch (error) { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
        });
      }
      if (match && req.method === 'GET') {
        // A blob is only downloadable from its owning account, even with its hash.
        let handle;
        try { handle = await open(blobPath(account, match[1]), 'r'); }
        catch (error) { if (error.code === 'ENOENT') fail(404, 'NOT_FOUND', 'The synced item was not found.'); throw error; }
        const size = (await handle.stat()).size;
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment' });
        await new Promise((done, reject) => { const stream = handle.createReadStream(); stream.once('error', reject); res.once('close', () => { stream.destroy(); done(); }); stream.pipe(res); });
        return;
      }
      fail(404, 'NOT_FOUND', 'Account endpoint not found.');
    } catch (error) {
      if (!(error instanceof ServiceError)) console.error('Account service request failed:', error.code ?? error.name);
      if (res.headersSent) res.destroy();
      else json(res, error.status ?? 500, { error: { code: error.code && error instanceof ServiceError ? error.code : 'INTERNAL', message: error instanceof ServiceError ? error.message : 'Account storage could not complete this request. Your existing data is preserved.' } });
      req.resume();
    } finally { active--; }
  });
  const dispose = async () => {
    if (closing) return;
    closing = true;
    await new Promise(resolveClose => { server.close(resolveClose); server.closeIdleConnections(); });
    await Promise.allSettled([registryQueue, ...[...queues.values()].map(value => value.promise)]);
    await lock.close(); await unlink(lockPath);
  };
  return { server, dispose, directory };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const service = await createAccountServer();
  const port = Number(process.env.LOPE_ACCOUNTS_PORT ?? 4176);
  service.server.listen(port, '127.0.0.1', () => console.log(`LopeOS accounts listening on http://127.0.0.1:${port}`));
  service.server.once('error', async error => { console.error(error.message); await service.dispose(); process.exitCode = 1; });
  const stop = async () => { await service.dispose(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
