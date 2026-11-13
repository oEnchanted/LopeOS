/** Local browser accounts. This sign-in gate does not encrypt workspace data. */
export const ACCOUNTS_STORAGE_KEY = 'lope.accounts.v1';
export const ACCOUNT_SESSION_KEY = 'lope.account.session.v1';
const PASSWORD_ITERATIONS = 600_000;
const reservedNames = new Set(['guest', 'shared', 'root', 'system', 'admin', 'administrator', 'everyone', 'nobody']);
const accountPattern = /^[a-z][a-z0-9_-]{0,31}$/;
const accountNameMessage = 'An account name starts with a letter and uses only lower-case letters, digits, hyphens and underscores (32 at most).';
const duplicateMessage = 'That account name is already in use. Choose another.';

/** Distinguishes a competing creation from a failure after this account was saved. */
export class AccountNameTakenError extends Error {
  constructor() { super(duplicateMessage); this.name = 'AccountNameTakenError'; }
}

export interface PasswordCredential {
  algorithm: 'PBKDF2-HMAC-SHA-256';
  iterations: number;
  salt: string;
  hash: string;
}
export interface LocalAccount {
  id: string;
  accountName: string;
  displayName: string;
  role: 'admin';
  avatarDataUrl: string | null;
  passwordHint: string;
  password: PasswordCredential | null;
  createdAt: string;
  lastLoginAt: string | null;
}
export interface AccountFields {
  displayName: string;
  accountName: string;
  password: string;
  confirmation: string;
}
export type AccountValidation =
  | { ok: true; displayName: string; accountName: string }
  | { ok: false; field: 'displayName' | 'accountName' | 'confirmation'; message: string };
export interface CreateAccountInput {
  displayName: string;
  accountName: string;
  password: string;
  avatarDataUrl?: string | null;
  passwordHint?: string;
}
type Backend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function deriveAccountName(displayName: string, existingNames: readonly string[] = []): string {
  const base = displayName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9_-]/g, '').replace(/^[^a-z]+/, '').slice(0, 32) || 'user';
  const taken = new Set([...existingNames.map(name => name.trim().toLowerCase()), ...reservedNames]);
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const number = String(suffix);
    const candidate = base.slice(0, 32 - number.length) + number;
    if (!taken.has(candidate)) return candidate;
  }
}

export function validateAccountFields(fields: AccountFields, existingNames: readonly string[] = []): AccountValidation {
  const displayName = fields.displayName.trim().replace(/\s+/g, ' ');
  const accountName = fields.accountName.trim().toLowerCase();
  if (!displayName) return { ok: false, field: 'displayName', message: 'Enter a name.' };
  if (displayName.length > 64) return { ok: false, field: 'displayName', message: 'Use a name with 64 characters or fewer.' };
  if (!accountPattern.test(accountName) || reservedNames.has(accountName)) return { ok: false, field: 'accountName', message: accountNameMessage };
  if (existingNames.some(name => name.trim().toLowerCase() === accountName)) return { ok: false, field: 'accountName', message: duplicateMessage };
  if (fields.password !== fields.confirmation) return { ok: false, field: 'confirmation', message: 'The passwords do not match.' };
  return { ok: true, displayName, accountName };
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));

export async function hashPassword(password: string): Promise<PasswordCredential | null> {
  if (!password) return null;
  if (!globalThis.crypto?.subtle) throw new Error('Secure password storage is unavailable. Open LopeOS using HTTPS or localhost.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: PASSWORD_ITERATIONS, salt }, key, 256);
  return { algorithm: 'PBKDF2-HMAC-SHA-256', iterations: PASSWORD_ITERATIONS, salt: base64(salt), hash: base64(new Uint8Array(bits)) };
}

function validCredential(value: unknown): value is PasswordCredential {
  if (!value || typeof value !== 'object') return false;
  const credential = value as PasswordCredential;
  if (credential.algorithm !== 'PBKDF2-HMAC-SHA-256' || credential.iterations !== PASSWORD_ITERATIONS || typeof credential.salt !== 'string' || typeof credential.hash !== 'string') return false;
  try { return fromBase64(credential.salt).length === 16 && fromBase64(credential.hash).length === 32; } catch { return false; }
}

export async function verifyPassword(password: string, credential: PasswordCredential | null): Promise<boolean> {
  if (credential === null) return password === '';
  if (!validCredential(credential)) return false;
  if (!globalThis.crypto?.subtle) throw new Error('Secure password verification is unavailable. Open LopeOS using HTTPS or localhost.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: credential.iterations, salt: fromBase64(credential.salt) }, key, 256);
  const actual = new Uint8Array(bits), expected = fromBase64(credential.hash);
  // Fixed-size outputs: visit every byte regardless of the first differing byte.
  let difference = 0;
  for (let index = 0; index < 32; index++) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

export function validAccount(value: unknown): value is LocalAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as LocalAccount;
  return typeof account.id === 'string' && account.id.length > 0
    && typeof account.accountName === 'string' && accountPattern.test(account.accountName) && !reservedNames.has(account.accountName)
    && typeof account.displayName === 'string' && !!account.displayName.trim() && account.displayName.length <= 64
    && account.role === 'admin' && (account.avatarDataUrl === null || typeof account.avatarDataUrl === 'string')
    && typeof account.passwordHint === 'string' && account.passwordHint.length <= 120
    && (account.password === null || validCredential(account.password))
    && typeof account.createdAt === 'string' && Number.isFinite(Date.parse(account.createdAt))
    && (account.lastLoginAt === null || typeof account.lastLoginAt === 'string' && Number.isFinite(Date.parse(account.lastLoginAt)));
}

export class AccountStore {
  private backend?: Backend;
  private sessionBackend?: Backend;
  private queue: Promise<unknown> = Promise.resolve();
  private newlyCreated = new Map<string, LocalAccount>();
  private listeners = new Set<() => void>();

  constructor(backend?: Backend, sessionBackend?: Backend) {
    this.backend = backend;
    this.sessionBackend = sessionBackend;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach(listener => listener()); }
  private read(): LocalAccount[] {
    if (!this.backend) throw new Error('Browser storage is unavailable. Allow site storage to create or open a local account.');
    let raw: string | null;
    try { raw = this.backend.getItem(ACCOUNTS_STORAGE_KEY); } catch { throw new Error('Local accounts could not be read. Check this browser’s site storage permissions.'); }
    if (raw === null) return [];
    try {
      const saved = JSON.parse(raw);
      if (saved?.version !== 1 || !Array.isArray(saved.accounts) || !saved.accounts.every(validAccount)) throw new Error();
      const accounts = saved.accounts as LocalAccount[];
      if (new Set(accounts.map(account => account.accountName)).size !== accounts.length || new Set(accounts.map(account => account.id)).size !== accounts.length) throw new Error();
      return accounts;
    } catch { throw new Error('The local account file could not be read. Existing accounts have not been changed.'); }
  }
  private write(accounts: LocalAccount[]) {
    if (!this.backend) throw new Error('Browser storage is unavailable. Allow site storage to save a local account.');
    try { this.backend.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify({ version: 1, accounts })); }
    catch { throw new Error('The account could not be saved. Check available browser storage and try again.'); }
  }
  private transaction<T>(operation: () => Promise<T> | T): Promise<T> {
    const run = async () => {
      if (typeof globalThis.navigator?.locks?.request === 'function') return navigator.locks.request(ACCOUNTS_STORAGE_KEY, async () => operation());
      return operation();
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
  async list(): Promise<LocalAccount[]> { return this.read(); }
  async isNameTaken(name: string): Promise<boolean> { return this.read().some(account => account.accountName === name.trim().toLowerCase()); }

  async create(input: CreateAccountInput): Promise<LocalAccount> {
    const validation = validateAccountFields({ ...input, confirmation: input.password });
    if (!validation.ok) throw new Error(validation.message);
    const password = await hashPassword(input.password);
    return this.transaction(() => {
      const accounts = this.read();
      if (accounts.some(account => account.accountName === validation.accountName)) throw new AccountNameTakenError();
      const account: LocalAccount = {
        id: crypto.randomUUID(), accountName: validation.accountName, displayName: validation.displayName, role: 'admin',
        avatarDataUrl: input.avatarDataUrl ?? null, passwordHint: input.password ? (input.passwordHint ?? '').slice(0, 120) : '',
        password, createdAt: new Date().toISOString(), lastLoginAt: null,
      };
      this.write([...accounts, account]);
      this.newlyCreated.set(account.id, account);
      this.emit();
      return account;
    });
  }
  private beginSession(account: LocalAccount, accounts: LocalAccount[]): LocalAccount {
    const signedIn = { ...account, lastLoginAt: new Date().toISOString() };
    this.write(accounts.map(value => value.id === account.id ? signedIn : value));
    if (!this.sessionBackend) throw new Error('The sign-in session could not be saved. Allow session storage and try again.');
    try { this.sessionBackend.setItem(ACCOUNT_SESSION_KEY, account.id); }
    catch { throw new Error('The sign-in session could not be saved. Allow session storage and try again.'); }
    this.newlyCreated.delete(account.id);
    this.emit();
    return signedIn;
  }
  async signIn(accountName: string, password: string): Promise<LocalAccount> {
    const account = this.read().find(value => value.accountName === accountName.trim().toLowerCase());
    if (!account || !await verifyPassword(password, account.password)) throw new Error('The account name or password is incorrect.');
    return this.transaction(() => {
      const accounts = this.read();
      const current = accounts.find(value => value.id === account.id);
      if (!current || JSON.stringify(current.password) !== JSON.stringify(account.password)) throw new Error('This account changed. Try signing in again.');
      return this.beginSession(current, accounts);
    });
  }
  async signInCreated(account: LocalAccount): Promise<LocalAccount> {
    if (this.newlyCreated.get(account.id) !== account) throw new Error('Sign in with your account name and password.');
    return this.transaction(() => {
      // A queued sign-in or sign-out may have consumed this one-time capability.
      if (this.newlyCreated.get(account.id) !== account) throw new Error('Sign in with your account name and password.');
      const accounts = this.read();
      const current = accounts.find(value => value.id === account.id);
      if (!current || JSON.stringify(current.password) !== JSON.stringify(account.password)) throw new Error('This account changed. Sign in with your account name and password.');
      return this.beginSession(current, accounts);
    });
  }
  getSession(): LocalAccount | null {
    let id: string | null;
    try { id = this.sessionBackend?.getItem(ACCOUNT_SESSION_KEY) ?? null; } catch { return null; }
    if (!id) return null;
    return this.read().find(account => account.id === id) ?? null;
  }
  signOut(): void {
    try { this.sessionBackend?.removeItem(ACCOUNT_SESSION_KEY); }
    catch { throw new Error('The session could not be cleared. Close this tab to sign out.'); }
    this.newlyCreated.clear();
    this.emit();
  }
}

let accountBackend: Storage | undefined, sessionBackend: Storage | undefined;
try { if (typeof window !== 'undefined') accountBackend = window.localStorage; } catch { /* Account operations report unavailable storage. */ }
try { if (typeof window !== 'undefined') sessionBackend = window.sessionStorage; } catch { /* Sign-in reports unavailable session storage. */ }
export const accounts = new AccountStore(accountBackend, sessionBackend);
