/** Versioned browser-only encryption. Never send passwords, master keys or recovery keys to the API. */
import type { SyncEntry } from './merge.ts';
const utf8 = new TextEncoder(), text = new TextDecoder();
const bytes = (value: Uint8Array) => Uint8Array.from(value).buffer;
export const hex = (value: Uint8Array) => Array.from(value, n => n.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => { if (!/^(?:[a-f0-9]{2})+$/.test(value)) throw new Error('Invalid encrypted data.'); return Uint8Array.from(value.match(/../g)!, n => parseInt(n, 16)); };
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
export const checksum = async (value: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value))));
async function expand(seed: Uint8Array, purpose: string) {
  const key = await crypto.subtle.importKey('raw', bytes(seed), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: utf8.encode('LopeOS E2EE v1'), info: utf8.encode(purpose) }, key, 256));
}
async function passwordRoot(accountName: string, password: string) {
  const key = await crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: utf8.encode('LopeOS E2EE v1:' + accountName.trim().toLowerCase()) }, key, 256));
}
export async function credentials(accountName: string, password: string) {
  const root = await passwordRoot(accountName, password);
  try { return { password: hex(await expand(root, 'authentication')), wrapping: await expand(root, 'password wrapping') }; }
  finally { root.fill(0); }
}
async function seal(keyBytes: Uint8Array, value: Uint8Array, purpose: string) {
  const key = await crypto.subtle.importKey('raw', bytes(keyBytes), 'AES-GCM', false, ['encrypt']);
  const iv = random(12);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode('LopeOS v1:' + purpose) }, key, bytes(value)));
  const result = new Uint8Array(iv.length + cipher.length); result.set(iv); result.set(cipher, iv.length); return result;
}
async function unseal(keyBytes: Uint8Array, value: Uint8Array, purpose: string) {
  if (value.length < 28) throw new Error('Encrypted data is incomplete.');
  const key = await crypto.subtle.importKey('raw', bytes(keyBytes), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(value.slice(0, 12)), additionalData: utf8.encode('LopeOS v1:' + purpose) }, key, bytes(value.slice(12))));
}
export interface VaultEnvelope { version: 1; id: string; passwordWrap: string; recoveryWrap: string }
export function validateEnvelope(value: VaultEnvelope) {
  if (!value || value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.id) || !/^[a-f0-9]{120}$/.test(value.passwordWrap) || !/^[a-f0-9]{120}$/.test(value.recoveryWrap)) throw new Error('Unsupported or invalid encryption envelope.');
  return value;
}
function normalizeRecovery(key: string) { const clean = key.replace(/[-\s]/g, '').toLowerCase(); if (!/^[a-f0-9]{64}$/.test(clean)) throw new Error('Enter the complete recovery key.'); return unhex(clean); }
export async function recoveryCredentials(key: string) {
  const seed = normalizeRecovery(key);
  try { return { proof: hex(await expand(seed, 'recovery authentication')), wrapping: await expand(seed, 'recovery wrapping') }; }
  finally { seed.fill(0); }
}
export class EncryptedVault {
  private master: Uint8Array;
  readonly id: string;
  private wire = new Map<string, SyncEntry>();
  constructor(master: Uint8Array, id: string) { this.master = master; this.id = id; }
  destroy() { this.master.fill(0); this.wire.clear(); }
  private key(purpose: string) { if (this.master.every(n => n === 0)) throw new Error('Unlock your encrypted files first.'); return expand(this.master, purpose); }
  static async create(accountName: string, password: string) {
    const vault = new EncryptedVault(random(32), hex(random(16)));
    const secured = await vault.rewrap(accountName, password); return { vault, ...secured };
  }
  static async unlock(envelope: VaultEnvelope, accountName: string, password: string) {
    validateEnvelope(envelope); const auth = await credentials(accountName, password);
    try { return new EncryptedVault(await unseal(auth.wrapping, unhex(envelope.passwordWrap), envelope.id + ':master'), envelope.id); }
    catch { throw new Error('Could not unlock your files. Check your password.'); }
    finally { auth.wrapping.fill(0); }
  }
  static async recover(envelope: VaultEnvelope, recoveryKey: string) {
    validateEnvelope(envelope); const recovery = await recoveryCredentials(recoveryKey);
    try { return new EncryptedVault(await unseal(recovery.wrapping, unhex(envelope.recoveryWrap), envelope.id + ':master'), envelope.id); }
    catch { throw new Error('The recovery key could not unlock your files.'); }
    finally { recovery.wrapping.fill(0); }
  }
  async rewrap(accountName: string, password: string) {
    const auth = await credentials(accountName, password);
    const recoveryKey = hex(random(32)).match(/.{8}/g)!.join('-'), recovery = await recoveryCredentials(recoveryKey);
    try {
      const envelope: VaultEnvelope = { version: 1, id: this.id, passwordWrap: hex(await seal(auth.wrapping, this.master, this.id + ':master')), recoveryWrap: hex(await seal(recovery.wrapping, this.master, this.id + ':master')) };
      return { envelope, password: auth.password, recoveryProof: recovery.proof, recoveryKey };
    } finally { auth.wrapping.fill(0); recovery.wrapping.fill(0); }
  }
  /** Seal the master key for this device only; `deviceKey` is a non-extractable AES-GCM key. */
  async sealForDevice(deviceKey: CryptoKey) {
    if (this.master.every(n => n === 0)) throw new Error('Unlock your encrypted files first.');
    const iv = random(12);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode('LopeOS device v1:' + this.id) }, deviceKey, bytes(this.master)));
    const result = new Uint8Array(iv.length + cipher.length); result.set(iv); result.set(cipher, iv.length); return result.buffer;
  }
  static async openFromDevice(deviceKey: CryptoKey, sealed: ArrayBuffer, id: string) {
    const value = new Uint8Array(sealed);
    if (value.length !== 60) throw new Error('The saved device key is invalid.');
    const master = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(value.slice(0, 12)), additionalData: utf8.encode('LopeOS device v1:' + id) }, deviceKey, bytes(value.slice(12))));
    if (master.length !== 32) { master.fill(0); throw new Error('The saved device key is invalid.'); }
    return new EncryptedVault(master, id);
  }
  async encryptBlob(entry: SyncEntry, plain: Uint8Array) {
    if (plain.length !== entry.size || await checksum(plain) !== entry.hash) throw new Error('The file changed before encryption.');
    const key = await this.key('file content');
    try {
      const cipher = await seal(key, plain, this.id + ':file');
      const wire = { ...entry, hash: await checksum(cipher), size: cipher.length };
      this.wire.set(entry.hash, wire); return { bytes: cipher, entry: wire };
    } finally { key.fill(0); }
  }
  remoteEntry(entry: SyncEntry) { const wire = this.wire.get(entry.hash); if (!wire) throw new Error('Encrypted file metadata is missing.'); return { ...wire, key: entry.key }; }
  async decryptBlob(entry: SyncEntry, cipher: Uint8Array) {
    const wire = this.remoteEntry(entry);
    if (cipher.length !== wire.size || await checksum(cipher) !== wire.hash) throw new Error('Encrypted file integrity check failed.');
    const key = await this.key('file content');
    try { const plain = await unseal(key, cipher, this.id + ':file'); if (plain.length !== entry.size || await checksum(plain) !== entry.hash) throw new Error('Decrypted file integrity check failed.'); return plain; }
    finally { key.fill(0); }
  }
  async encodeManifest(entries: SyncEntry[]) {
    const key = await this.key('file metadata');
    try { return await Promise.all(entries.map(async entry => {
      const wire = this.remoteEntry(entry);
      return { key: 'e2ee:' + hex(await seal(key, utf8.encode(JSON.stringify(entry)), this.id + ':' + wire.hash)), hash: wire.hash, size: wire.size, modifiedAt: '2000-01-01T00:00:00.000Z' };
    })); } finally { key.fill(0); }
  }
  async decodeManifest(entries: SyncEntry[]) {
    const key = await this.key('file metadata');
    try {
      const pairs = await Promise.all(entries.map(async wire => {
        if (!wire.key.startsWith('e2ee:')) throw new Error('Unencrypted metadata was rejected.');
        const entry = JSON.parse(text.decode(await unseal(key, unhex(wire.key.slice(5)), this.id + ':' + wire.hash))) as SyncEntry;
        if (!entry || typeof entry.key !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size + 28 !== wire.size || !Number.isFinite(Date.parse(entry.modifiedAt))) throw new Error('Invalid encrypted file metadata.');
        return { entry, wire };
      }));
      this.wire.clear(); for (const pair of pairs) this.wire.set(pair.entry.hash, pair.wire);
      return pairs.map(pair => pair.entry);
    } finally { key.fill(0); }
  }
}
