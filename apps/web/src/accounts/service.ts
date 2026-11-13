import { EncryptedVault, credentials, recoveryCredentials, type VaultEnvelope } from './encryption';
import { useSyncExternalStore } from 'react';
import { preferences } from '../../../../packages/sdk/src/preferences';
import { captureData, digest, applyRecord, conflictKey, validateLogicalKey, type LocalItem } from './data';
import { EMPTY_HASH, entryMap, manifestsEqual, mergeEntries, normalizeFileTopology, type SyncEntry } from './merge';

export interface CloudUser { id: string; accountName: string; displayName: string; createdAt: string }
export interface CloudAccountState {
  encryption: 'none' | 'locked' | 'unlocked';
  account: CloudUser | null;
  status: 'guest' | 'idle' | 'syncing' | 'offline' | 'error';
  error: string | null;
  usedBytes: number; quotaBytes: number; totalBytes: number; transferredBytes: number;
  etaSeconds: number | null; lastSyncedAt: string | null;
  currentFile: string | null; message: string | null; conflicts: number;
  workspaceAvailable: boolean; pendingChanges: boolean;
}
interface Session { vault?: VaultEnvelope | null; recoveryKey?: string; account: CloudUser | null; quotaBytes: number; usedBytes: number }
interface Manifest { revision: number; entries: SyncEntry[]; quotaBytes: number; usedBytes: number }
interface Baseline { id: string; entries: SyncEntry[]; lastSyncedAt: string | null }
const OWNER_KEY = 'lope.cloud.owner.v1', SIGNOUT_KEY = 'lope.cloud.signout-pending.v1', BASE_DB = 'lope.cloud.sync.v1';
const initialState: CloudAccountState = { encryption: 'none', account: null, status: 'guest', error: null, quotaBytes: 1_000_000_000, usedBytes: 0, totalBytes: 0, transferredBytes: 0, etaSeconds: null, lastSyncedAt: null, currentFile: null, message: null, conflicts: 0, workspaceAvailable: true, pendingChanges: false };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Account sync is temporarily unavailable.';
class AccountError extends Error { constructor(message: string, public status = 0, public code = '') { super(message); } }
async function baselineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('accounts', { keyPath: 'id' });
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); }; req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Account sync storage is in use by another LopeOS tab.'));
  });
}
async function readBaseline(id: string): Promise<Baseline> {
  const db = await baselineDB();
  try { return await new Promise((resolve, reject) => { const req = db.transaction('accounts').objectStore('accounts').get(id); req.onsuccess = () => resolve(req.result ?? { id, entries: [], lastSyncedAt: null }); req.onerror = () => reject(req.error); }); }
  finally { db.close(); }
}
async function writeBaseline(value: Baseline): Promise<void> {
  const db = await baselineDB();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('accounts', 'readwrite'); tx.objectStore('accounts').put(value); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
}
async function lock<T>(name: string, task: () => Promise<T>): Promise<T> {
  if (typeof globalThis.navigator?.locks?.request === 'function') return navigator.locks.request(name, task);
  return task();
}
function validateSession(value: Session): Session {
  if (!value || !Number.isFinite(value.quotaBytes) || value.quotaBytes <= 0 || !Number.isFinite(value.usedBytes) || value.usedBytes < 0 || value.account && (typeof value.account.id !== 'string' || typeof value.account.accountName !== 'string' || typeof value.account.displayName !== 'string')) throw new Error('The account server returned an invalid response.');
  return value;
}

export class CloudAccountService {
  private state = initialState;
  private vault: EncryptedVault | null = null;
  private envelope: VaultEnvelope | null = null;
  private upgrading = false;
  private listeners = new Set<() => void>();
  private initialized: Promise<void> | null = null;
  private generation = 0;
  private controllers = new Set<AbortController>();
  private xhrs = new Set<XMLHttpRequest>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | null = null;
  private authBusy = false;
  private resetting = false;
  private applying = false;
  private startedAt = 0;
  private completedBytes = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<CloudAccountState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private invalidate() {
    this.generation++; clearTimeout(this.timer);
    for (const c of this.controllers) c.abort(); this.controllers.clear();
    for (const xhr of this.xhrs) xhr.abort(); this.xhrs.clear();
  }
  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch('/api/accounts' + path, { ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(this.envelope ? { 'X-Lope-Encryption': '1' } : {}), ...(this.state.account && /^\/(manifest|blobs|cleanup)/.test(path) ? { 'X-Lope-Account': this.state.account.id } : {}), ...init.headers } });
      const payload = await res.json().catch(() => { throw new AccountError('The account service is unavailable. Your files remain on this device.', res.status); });
      if (!res.ok) throw new AccountError(payload.error?.message || 'The account request failed.', res.status, payload.error?.code);
      return payload as T;
    } catch (error) {
      if (error instanceof AccountError) throw error;
      if (controller.signal.aborted) throw new AccountError('The account request was interrupted. Local changes are safe and will retry.', 0, 'INTERRUPTED');
      throw new AccountError('Cannot connect to LopeOS accounts. Local changes will sync when the connection returns.');
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
  private assertCurrent(generation: number, id: string) { if (generation !== this.generation || this.state.account?.id !== id || this.resetting) throw new AccountError('Sync session changed.', 0, 'CANCELLED'); }
  private progress(bytes: number) {
    const transferredBytes = Math.min(this.state.totalBytes, this.completedBytes + bytes), elapsed = (performance.now() - this.startedAt) / 1000;
    const rate = elapsed > 0.2 ? transferredBytes / elapsed : 0;
    this.update({ transferredBytes, etaSeconds: rate > 0 ? Math.ceil(Math.max(0, this.state.totalBytes - transferredBytes) / rate) : null });
  }
  private async upload(entry: SyncEntry, bytes: Uint8Array): Promise<void> {
    const plainSize = entry.size;
    if (this.vault) { const encrypted = await this.vault.encryptBlob(entry, bytes); entry = encrypted.entry; bytes = encrypted.bytes; }

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest(); this.xhrs.add(xhr);
      const finish = (error?: Error) => { this.xhrs.delete(xhr); error ? reject(error) : resolve(); };
      xhr.open('PUT', '/api/accounts/blobs/' + entry.hash); xhr.setRequestHeader('Content-Type', 'application/octet-stream'); if (this.envelope) xhr.setRequestHeader('X-Lope-Encryption', '1'); if (this.upgrading) xhr.setRequestHeader('X-Lope-Encryption-Upgrade', '1'); if (this.state.account) xhr.setRequestHeader('X-Lope-Account', this.state.account.id); xhr.timeout = 120_000;
      xhr.upload.onprogress = event => this.progress(Math.min(entry.size, event.loaded));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) finish();
        else { let value; try { value = JSON.parse(xhr.responseText); } catch {} finish(new AccountError(value?.error?.message || 'This file could not be uploaded.', xhr.status, value?.error?.code)); }
      };
      xhr.onerror = () => finish(new AccountError('Connection lost while uploading. Your local copy is safe.'));
      xhr.onabort = () => finish(new AccountError('Upload interrupted.', 0, 'CANCELLED'));
      xhr.ontimeout = () => finish(new AccountError('Upload timed out. Your local copy is safe and will retry.'));
      xhr.send(bytes.slice().buffer);
    });
    this.completedBytes += plainSize; this.progress(0);
  }
  private async download(entry: SyncEntry): Promise<Uint8Array> {
    const plainEntry = entry;
    const decryptingVault = this.vault;
    if (decryptingVault) entry = decryptingVault.remoteEntry(entry);
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch('/api/accounts/blobs/' + entry.hash, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { ...(this.state.account ? { 'X-Lope-Account': this.state.account.id } : {}), ...(this.envelope ? { 'X-Lope-Encryption': '1' } : {}) } });
      if (!response.ok) { const error = await response.json().catch(() => null); throw new AccountError(error?.error?.message || 'A cloud file could not be downloaded.', response.status, error?.error?.code); }
      if (!response.body) throw new Error('The account server returned an empty download.');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let count = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        count += part.value.byteLength;
        if (count > entry.size) { await reader.cancel(); throw new Error('A cloud file has an invalid size.'); }
        chunks.push(part.value); this.progress(count);
      }
      if (count !== entry.size) throw new Error('A cloud file download was incomplete.');
      const bytes = new Uint8Array(count); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (await digest(bytes) !== entry.hash) throw new Error('A cloud file failed its integrity check. Your local copy has not been replaced.');
      this.completedBytes += plainEntry.size; this.progress(0); return decryptingVault ? await decryptingVault.decryptBlob(plainEntry, bytes) : bytes;
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
  initialize(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = (async () => {
      const changed = () => { if (!this.applying && this.state.account) { this.update({ pendingChanges: true }); this.schedule(1800); } };
      window.addEventListener('lope:preferences-updated', changed);
      window.addEventListener('lope:files-changed', changed);
      window.addEventListener('storage', event => { if (event.key === 'lope.reset.pending.v1' && event.newValue) { void this.suspendForReset().catch(() => {}); return; } if (event.key === OWNER_KEY || event.key === SIGNOUT_KEY) { this.invalidate(); this.vault?.destroy(); this.vault = null; void this.resume(); } else if (event.key?.startsWith('lope.') && !event.key.startsWith('lope.cloud.')) changed(); });
      window.addEventListener('online', () => { void this.resume(); });
      window.addEventListener('offline', () => { if (this.state.account) this.update({ status: 'offline', error: 'You’re offline. Changes will sync when you reconnect.' }); });
      window.addEventListener('lope:reset-requested', () => { void this.suspendForReset().catch(() => {}); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.schedule(500); });
      this.interval = setInterval(() => this.schedule(0), 30_000);
      await this.resume();
    })();
    return this.initialized;
  }
  private async resume(): Promise<void> {
    if (this.authBusy || this.resetting) return;
    const generation = this.generation;
    try {
      if (localStorage.getItem(SIGNOUT_KEY)) { await this.api('/logout', { method: 'POST', body: '{}' }); localStorage.removeItem(SIGNOUT_KEY); this.vault?.destroy(); this.vault = null; this.envelope = null; this.update({ ...initialState }); return; }
      const session = validateSession(await this.api<Session>('/session'));
      if (this.resetting || this.authBusy || generation !== this.generation) return;
      if (!session.account) { this.invalidate(); this.vault?.destroy(); this.vault = null; this.envelope = null; this.update({ ...initialState }); return; }
      this.accept(session);
      this.schedule(50);
    } catch (error) { if (generation === this.generation && !this.resetting) this.update({ status: this.state.account ? 'offline' : 'guest', error: errorMessage(error) }); }
  }
  private accept(session: Session) {
    if (!session.account) throw new Error('The account server did not create a session.');
    const owner = localStorage.getItem(OWNER_KEY);
    if (owner && owner !== session.account.id) throw new AccountError('This device still contains another LopeOS account’s data. Use a separate browser profile, or reset this device in Settings before signing into a different account.', 409, 'DEVICE_OWNER');
    localStorage.setItem(OWNER_KEY, session.account.id);
    this.envelope = session.vault ?? null;
    if (!this.envelope || this.vault?.id !== this.envelope.id) { this.vault?.destroy(); this.vault = null; }
    this.update({ encryption: this.envelope ? this.vault ? 'unlocked' : 'locked' : 'none', account: session.account, status: 'idle', error: null, quotaBytes: session.quotaBytes, usedBytes: session.usedBytes, pendingChanges: true });
  }
  async register(input: { accountName: string; displayName: string; password: string }): Promise<string> {
    if (localStorage.getItem(OWNER_KEY)) throw new Error('This device already contains account data. Use a separate browser profile for another account.');
    const created = await EncryptedVault.create(input.accountName, input.password);
    try {
      await this.authenticate('/register', { ...input, password: created.password, credentialVersion: 1, vault: created.envelope, recoveryProof: created.recoveryProof }, created.vault);
      return created.recoveryKey;
    } catch (error) { created.vault.destroy(); throw error; }
  }
  async signIn(accountName: string, password: string): Promise<void> {
    const auth = await credentials(accountName, password); auth.wrapping.fill(0);
    await this.authenticate('/login', { accountName, password: auth.password, credentialVersion: 1 }, undefined, password);
  }
  private async authenticate(path: string, input: unknown, vault?: EncryptedVault, password?: string): Promise<void> {
    if (this.authBusy) throw new Error('An account request is already in progress.');
    if (this.state.account) throw new Error('Sign out before signing into an account.');
    this.authBusy = true; this.invalidate();
    try {
      await lock('lope.account.authentication', async () => {
        if (localStorage.getItem(SIGNOUT_KEY)) { await this.api('/logout', { method: 'POST', body: '{}' }); localStorage.removeItem(SIGNOUT_KEY); }
        const session = validateSession(await this.api<Session>(path, { method: 'POST', body: JSON.stringify(input) }));
        try {
          if (!session.vault) throw new Error('The server did not enable end-to-end encryption. Update the account service.');
          this.vault = vault ?? await EncryptedVault.unlock(session.vault, session.account!.accountName, password!);
          this.accept(session);
        } catch (error) { this.vault?.destroy(); this.vault = null; await this.api('/logout', { method: 'POST', body: '{}' }).catch(() => {}); throw error; }
      });
      window.dispatchEvent(new Event('lope:cloud-signed-in'));
    } catch (error) { this.update({ ...initialState, error: errorMessage(error) }); throw error; }
    finally { this.authBusy = false; }
    this.schedule(50);
  }
  async unlock(password: string) {
    if (!this.state.account || !this.envelope) throw new Error('Sign in to your encrypted account first.');
    const generation = this.generation, accountId = this.state.account.id;
    const session = validateSession(await this.api<Session>('/session'));
    if (generation !== this.generation || session.account?.id !== accountId || !session.vault) throw new Error('Your session changed. Sign in again.');
    const vault = await EncryptedVault.unlock(session.vault, session.account.accountName, password);
    if (generation !== this.generation || this.state.account?.id !== accountId) { vault.destroy(); throw new Error('Your session changed. Sign in again.'); }
    this.vault?.destroy(); this.vault = vault; this.accept(session); this.schedule(0);
  }
  async recover(accountName: string, recoveryKey: string, password: string) {
    if (password.length < 12) throw new Error('Use a password with at least 12 characters.');
    const proof = await recoveryCredentials(recoveryKey); proof.wrapping.fill(0);
    const { vault: envelope } = await this.api<{ vault: VaultEnvelope }>('/recovery-info', { method: 'POST', body: JSON.stringify({ accountName, recoveryProof: proof.proof }) });
    const vault = await EncryptedVault.recover(envelope, recoveryKey);
    try {
      const secured = await vault.rewrap(accountName, password);
      await this.api('/recover', { method: 'POST', body: JSON.stringify({ accountName, password: secured.password, credentialVersion: 1, recoveryKey: proof.proof, recoveryProof: secured.recoveryProof, vault: secured.envelope }) });
      return { recoveryKey: secured.recoveryKey };
    } finally { vault.destroy(); }
  }
  async replaceRecoveryKey(password: string) {
    if (!this.state.account || !this.envelope) throw new Error('Enable encryption first.');
    const vault = await EncryptedVault.unlock(this.envelope, this.state.account.accountName, password);
    try {
      const secured = await vault.rewrap(this.state.account.accountName, password);
      await this.api('/recovery-key', { method: 'POST', body: JSON.stringify({ accountName: this.state.account.accountName, password: secured.password, credentialVersion: 1, recoveryProof: secured.recoveryProof, vault: secured.envelope }) });
      this.envelope = secured.envelope;
      return { recoveryKey: secured.recoveryKey };
    } finally { vault.destroy(); }
  }
  /** Explicit legacy upgrade: the old password is sent once to authenticate the old account. */
  async upgradeEncryption(accountName: string, password: string, newPassword: string): Promise<{ recoveryKey: string }> {
    if (!newPassword || newPassword.length < 12 || newPassword === password) throw new Error('Choose a new password of at least 12 characters, different from your old password, so the legacy server never receives your encryption password.');
    if (this.authBusy) throw new Error('Wait for the current account request.');
    this.authBusy = true; this.invalidate();
    let created: Awaited<ReturnType<typeof EncryptedVault.create>> | undefined;
    try {
      return await lock('lope.account.authentication', () => lock('lope.account.sync', async () => {
        const session = validateSession(await this.api<Session>('/login', { method: 'POST', body: JSON.stringify({ accountName, password }) }));
        if (session.vault) throw new Error('This account is already encrypted. Sign in normally.');
        this.accept(session);
        const manifest = await this.api<Manifest>('/manifest');
        created = await EncryptedVault.create(accountName, newPassword);
        this.upgrading = true;
        for (const entry of [...new Map(manifest.entries.map(entry => [entry.hash, entry])).values()]) {
          this.update({ message: 'Encrypting existing cloud files…', currentFile: entry.key });
          const plain = await this.download(entry);
          const encrypted = await created.vault.encryptBlob(entry, plain);
          await this.upload(encrypted.entry, encrypted.bytes);
        }
        const entries = await created.vault.encodeManifest(manifest.entries);
        await this.api('/upgrade', { method: 'POST', body: JSON.stringify({ accountName, password, newPassword: created.password, vault: created.envelope, recoveryProof: created.recoveryProof, baseRevision: manifest.revision, entries }) });
        const signedIn = validateSession(await this.api<Session>('/login', { method: 'POST', body: JSON.stringify({ accountName, password: created.password, credentialVersion: 1 }) }));
        this.vault = created.vault; this.accept(signedIn);
        return { recoveryKey: created.recoveryKey };
      }));
    } catch (error) { created?.vault.destroy(); this.update({ error: errorMessage(error) }); throw error; }
    finally { this.upgrading = false; this.authBusy = false; this.schedule(50); }
  }
  async signOut(): Promise<void> {
    if (!this.state.account && !localStorage.getItem(OWNER_KEY) && !localStorage.getItem(SIGNOUT_KEY)) { this.invalidate(); this.update({ ...initialState }); return; }
    if (this.authBusy) throw new Error('Wait for the current account request to finish.');
    this.vault?.destroy(); this.vault = null; this.envelope = null;
    localStorage.setItem(SIGNOUT_KEY, '1');
    this.authBusy = true; this.invalidate();
    try {
      await lock('lope.account.authentication', () => this.api('/logout', { method: 'POST', body: '{}' }));
      localStorage.removeItem(SIGNOUT_KEY);
      this.update({ ...initialState, message: 'Signed out. Files and settings remain on this device.' });
      window.dispatchEvent(new Event('lope:cloud-signed-out'));
    } catch (error) { this.update({ status: 'error', error: 'Could not sign out of the account server. Sync is paused. ' + errorMessage(error) }); throw error; }
    finally { this.authBusy = false; }
  }
  async suspendForReset(): Promise<void> {
    this.vault?.destroy(); this.vault = null; this.envelope = null;
    this.resetting = true; this.invalidate(); clearInterval(this.interval);
    if (this.state.account || localStorage.getItem(OWNER_KEY)) await this.api('/logout', { method: 'POST', body: '{}' });
    this.update({ ...initialState });
  }
  private schedule(delay: number) {
    if (!this.state.account || this.resetting || this.authBusy || this.state.encryption !== 'unlocked' || localStorage.getItem(SIGNOUT_KEY)) return;
    clearTimeout(this.timer); this.timer = setTimeout(() => { void this.syncNow().catch(() => {}); }, delay);
  }
  async syncNow(): Promise<void> {
    if (!this.state.account || this.resetting || this.authBusy || this.state.encryption !== 'unlocked' || localStorage.getItem(SIGNOUT_KEY)) return;
    if (this.active) return this.active;
    const id = this.state.account.id, generation = this.generation;
    this.active = lock('lope.account.sync', () => this.sync(id, generation));
    try { await this.active; } finally { this.active = null; }
  }
  private async sync(id: string, generation: number): Promise<void> {
    const check = () => this.assertCurrent(generation, id);
    try {
      check();
      if (!navigator.onLine) throw new AccountError('You’re offline. Changes will sync when you reconnect.');
      this.update({ status: 'syncing', error: null, currentFile: null, totalBytes: 0, transferredBytes: 0, etaSeconds: null, message: 'Checking account data…' });
      const session = validateSession(await this.api<Session>('/session')); check();
      if (session.account?.id !== id) { this.invalidate(); this.vault?.destroy(); this.vault = null; this.envelope = null; this.update({ ...initialState, error: 'Your account session changed. Sign in again to resume syncing.' }); return; }
      const saved = await readBaseline(id), base = entryMap(saved.entries);
      if (!this.vault || !session.vault || session.vault.id !== this.vault.id) throw new Error('Unlock your encrypted files before syncing.');
      const vault = this.vault;
      const wireManifest = await this.api<Manifest>('/manifest'); check();
      const manifest = { ...wireManifest, entries: await vault.decodeManifest(wireManifest.entries) }; check();
      const remote = entryMap(manifest.entries); for (const key of remote.keys()) validateLogicalKey(key);
      if (!Number.isSafeInteger(manifest.revision) || manifest.revision < 0) throw new Error('The account manifest revision is invalid.');
      const captured = await captureData(message => this.update({ message }), check, id); check();
      const local = new Map([...captured.items].map(([key, item]) => [key, item.entry]));
      const available = (key: string) => !captured.unavailable.some(prefix => prefix.endsWith(':') || prefix.endsWith(',') ? key.startsWith(prefix) : key === prefix);
      const plan = normalizeFileTopology(mergeEntries(base, local, remote, available)), sources = new Map<string, LocalItem>(captured.items);
      for (const conflict of plan.conflicts) {
        const source = captured.items.get(conflict.key), key = conflictKey(conflict.key, conflict.hash);
        const entry = { ...conflict, key }, occupied = plan.entries.get(key);
        if (occupied && occupied.hash !== entry.hash && !plan.conflicts.some(item => item.key === occupied.key && item.hash === occupied.hash)) plan.conflicts.push(occupied);
        plan.entries.set(key, entry); if (source?.entry.hash === entry.hash) sources.set(key, { entry, read: source.read });
        // A user file called Conflicts may itself need preservation. Array
        // iteration includes conflicts appended by this normalization pass.
        normalizeFileTopology(plan);
      }
      normalizeFileTopology(plan);
      for (const entry of plan.entries.values()) if (entry.key.includes(':directory:') && entry.hash === EMPTY_HASH && !sources.has(entry.key)) sources.set(entry.key, { entry, read: async () => new Uint8Array() });
      const remoteHashes = new Set([...remote.values()].map(entry => entry.hash));
      const uploads = [...plan.entries.values()].filter(entry => !remoteHashes.has(entry.hash) && sources.get(entry.key)?.entry.hash === entry.hash);
      // Reuse a staged object only after successful PUT; the server verifies its hash.
      const uniqueUploads = [...new Map(uploads.map(entry => [entry.hash, entry])).values()];
      const downloads = [...plan.entries.values()].filter(entry => available(entry.key) && local.get(entry.key)?.hash !== entry.hash);
      const totalBytes = uniqueUploads.reduce((n, e) => n + e.size, 0) + downloads.reduce((n, e) => n + e.size, 0);
      this.completedBytes = 0; this.startedAt = performance.now();
      this.update({ totalBytes, transferredBytes: 0, conflicts: plan.conflicts.length, workspaceAvailable: !captured.unavailable.includes('workspace:'), pendingChanges: !manifestsEqual(local, plan.entries), message: 'Syncing files, settings, and apps…' });
      // Download and validate immediately before each application; avoid holding the
      // entire 1 GB account in browser memory at once. Commit cloud state first.
      for (const entry of uniqueUploads) {
        check(); this.update({ currentFile: entry.key, message: 'Uploading to LopeDrive…' });
        const bytes = await sources.get(entry.key)!.read(); check();
        if (bytes.byteLength !== entry.size || await digest(bytes) !== entry.hash) throw new AccountError('A file changed during sync. Its latest version will sync on the next pass.', 409, 'LOCAL_CHANGED');
        check(); await this.upload(entry, bytes); check();
      }
      let committed = manifest;
      if (!manifestsEqual(plan.entries, remote)) {
        committed = await this.api<Manifest>('/manifest', { method: 'PUT', body: JSON.stringify({ baseRevision: manifest.revision, entries: await vault.encodeManifest([...plan.entries.values()]) }) }); check();
      }
      // Save the server baseline before application so interrupted downloads resume
      // as remote changes rather than treating absent local files as deletions.
      // Baseline is finalized only for records successfully present on this device.
      const nextBase = new Map(base);
      this.applying = true;
      const appliedKeys: string[] = [];
      const changes = [...new Set([...local.keys(), ...plan.entries.keys()])].filter(key => available(key) && local.get(key)?.hash !== plan.entries.get(key)?.hash);
      changes.sort((a, b) => {
        const deletingA = !plan.entries.has(a), deletingB = !plan.entries.has(b);
        if (deletingA !== deletingB) return deletingA ? -1 : 1;
        const depthA = a.split('/').length, depthB = b.split('/').length;
        if (depthA !== depthB) return deletingA ? depthB - depthA : depthA - depthB;
        return deletingA ? b.length - a.length : a.length - b.length;
      });
      let deferred = false;
      for (const key of changes) {
        check(); const desired = plan.entries.get(key); this.update({ currentFile: key, message: desired ? 'Restoring account data to this device…' : 'Updating synced files…' });
        let bytes: Uint8Array | null = null;
        if (desired) {
          bytes = await this.download(desired); check();
          if (bytes.byteLength !== desired.size || await digest(bytes) !== desired.hash) throw new Error('A file changed during sync. Its local version was preserved.');
        }
        if (await applyRecord(key, bytes, local.get(key)?.hash, check)) {
          appliedKeys.push(key);
          if (desired) nextBase.set(key, desired); else nextBase.delete(key);
        } else deferred = true;
      }
      for (const [key, entry] of plan.entries) if (available(key) && local.get(key)?.hash === entry.hash) nextBase.set(key, entry);
      for (const key of base.keys()) if (available(key) && !local.has(key) && !plan.entries.has(key)) nextBase.delete(key);
      const lastSyncedAt = new Date().toISOString();
      await writeBaseline({ id, entries: [...nextBase.values()], lastSyncedAt }); check();
      if (appliedKeys.length) window.dispatchEvent(new CustomEvent('lope:account-sync-applied', { detail: { keys: appliedKeys } }));
      this.update({ status: captured.warnings.length ? 'error' : 'idle', error: captured.warnings.length ? captured.warnings.slice(0, 3).join(' ') : null, usedBytes: committed.usedBytes, quotaBytes: committed.quotaBytes, transferredBytes: totalBytes, etaSeconds: null, lastSyncedAt, currentFile: null, pendingChanges: deferred || captured.warnings.length > 0, message: deferred ? 'New local changes are waiting for the next sync.' : plan.conflicts.length ? `${plan.conflicts.length} conflicting version${plan.conflicts.length === 1 ? '' : 's'} preserved in LopeDrive/Conflicts.` : captured.warnings.length ? 'Available data synced; some files are waiting.' : 'Files, settings, and apps are up to date.' });
      if (deferred) this.schedule(1800);
    } catch (error) {
      if (generation !== this.generation || this.resetting) return;
      const offline = error instanceof AccountError && (error.status === 0 || error.status >= 500);
      this.update({ status: offline ? 'offline' : 'error', error: errorMessage(error), etaSeconds: null, pendingChanges: true, currentFile: null });
      if (error instanceof AccountError && ['REVISION_CONFLICT', 'LOCAL_CHANGED'].includes(error.code)) this.schedule(2000);
      throw error;
    } finally { this.applying = false; }
  }
}
export const cloudAccount = new CloudAccountService();
export const useCloudAccount = () => useSyncExternalStore(cloudAccount.subscribe, cloudAccount.getSnapshot, cloudAccount.getSnapshot);
