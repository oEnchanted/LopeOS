import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

export class RuntimeError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const fail = (code, message, status) => { throw new RuntimeError(code, message, status); };
const equal = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function authenticate(token, config, now = Date.now() / 1000) {
  if (typeof token !== 'string' || token.length > 4096) fail('UNAUTHENTICATED', 'A valid runtime credential is required.', 401);
  let subject;
  // Static, random local credentials are stored as hashes. Production uses short-lived JWTs.
  const digest = sha256(token);
  for (const principal of config.tokenIndex ? [config.tokenIndex.get(digest)].filter(Boolean) : config.principals) {
    if (principal.tokenHash && equal(digest, principal.tokenHash) && (!principal.expiresAt || principal.expiresAt > now)) subject = principal.userId;
  }
  if (!subject && config.authSecret) {
    try {
      const [header, payload, signature, extra] = token.split('.');
      if (extra !== undefined || !signature) throw new Error();
      const h = JSON.parse(Buffer.from(header, 'base64url'));
      const p = JSON.parse(Buffer.from(payload, 'base64url'));
      const expected = createHmac('sha256', config.authSecret).update(`${header}.${payload}`).digest('base64url');
      if (h.alg !== 'HS256' || h.typ !== 'JWT' || !equal(signature, expected) || p.aud !== 'lope-runtime' || p.iss !== config.authIssuer || !Number.isFinite(p.exp) || p.exp <= now || p.exp > now + 3600 || (p.nbf !== undefined && (!Number.isFinite(p.nbf) || p.nbf > now))) throw new Error();
      subject = p.sub;
    } catch { /* A credential failure must not reveal JWT internals. */ }
  }
  const principal = config.resolvePrincipal?.(subject) || config.userIndex?.get(subject) || config.principals.find(p => p.userId === subject);
  if (!principal) fail('UNAUTHENTICATED', 'Invalid or expired runtime credential.', 401);
  return principal;
}
export function loadConfig(env = process.env) {
  const publicVisitors = env.LOPE_PUBLIC_VISITORS === '1';
  if (!env.LOPE_PRINCIPALS_FILE && !publicVisitors) fail('CONFIG', 'Set LOPE_PRINCIPALS_FILE to a private server-side identity registry.', 500);
  const principals = env.LOPE_PRINCIPALS_FILE ? JSON.parse(readFileSync(env.LOPE_PRINCIPALS_FILE, 'utf8')) : [];
  if (!Array.isArray(principals) || (!principals.length && !publicVisitors)) fail('CONFIG', 'At least one principal is required.', 500);
  const users = new Set(), workspaces = new Set(), containers = new Set(), tokens = new Set();
  for (const p of principals) {
    for (const key of ['userId', 'workspaceId', 'container']) if (typeof p[key] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(p[key])) fail('CONFIG', `Invalid ${key}.`, 500);
    if (users.has(p.userId) || workspaces.has(p.workspaceId) || containers.has(p.container)) fail('CONFIG', 'Principals must have unique users, workspaces, and containers.', 500);
    users.add(p.userId); workspaces.add(p.workspaceId); containers.add(p.container);
    if (p.tokenHash && tokens.has(p.tokenHash)) fail('CONFIG', 'Credential hashes must be unique per user.', 500);
    if (p.tokenHash) tokens.add(p.tokenHash);
    if (p.tokenHash && !/^[a-f0-9]{64}$/.test(p.tokenHash)) fail('CONFIG', 'tokenHash must be SHA-256 hex.', 500);
    if (p.expiresAt !== undefined && !Number.isFinite(p.expiresAt)) fail('CONFIG', 'Invalid credential expiry.', 500);
  }
  if (env.LOPE_AUTH_SECRET && Buffer.byteLength(env.LOPE_AUTH_SECRET) < 32) fail('CONFIG', 'LOPE_AUTH_SECRET must contain at least 32 bytes.', 500);
  const origins = (env.LOPE_ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173').split(',').map(x => x.trim());
  for (const origin of origins) if (new URL(origin).origin !== origin || !['http:', 'https:'].includes(new URL(origin).protocol)) fail('CONFIG', 'Origins must be exact http(s) origins.', 500);
  const number = (name, fallback, min, max) => {
    const n = Number(env[name] || fallback);
    if (!Number.isSafeInteger(n) || n < min || n > max) fail('CONFIG', `Invalid ${name}.`, 500);
    return n;
  };
  return { stateDirectory: env.LOPE_STATE_DIR || '/var/lib/lopeos', publicVisitors, principals, tokenIndex: new Map(principals.filter(p => p.tokenHash).map(p => [p.tokenHash, p])), userIndex: new Map(principals.map(p => [p.userId, p])), authSecret: env.LOPE_AUTH_SECRET, authIssuer: env.LOPE_AUTH_ISSUER || 'lope-gateway', origins, host: env.LOPE_RUNTIME_HOST || '127.0.0.1', port: number('LOPE_RUNTIME_PORT', 4174, 1, 65535), detachedMs: number('LOPE_DETACHED_MS', 900000, 1000, 86400000), maxSessions: number('LOPE_MAX_SESSIONS', 8, 1, 16), shell: env.LOPE_SHELL === 'zsh' ? 'zsh' : 'bash' };
}
export function normalizePath(input = '/') {
  if (typeof input !== 'string' || input.includes('\0') || input.length > 4096) fail('INVALID', 'Invalid workspace path.');
  const parts = input.replace(/^\/home\/lope(?=\/|$)/, '').split('/').filter(x => x && x !== '.');
  if (parts.some(x => x === '..' || Buffer.byteLength(x) > 255)) fail('FORBIDDEN', 'Parent traversal is not allowed.', 403);
  return '/' + parts.join('/');
}
export function dimensions(cols = 80, rows = 24) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 500 || rows < 1 || rows > 200) fail('INVALID', 'Terminal dimensions are outside the supported range.');
  return { cols, rows };
}
