import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class HostingError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const cookieValue = (header, name) => String(header ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));

/** Authentication only. No password, recovery material or decrypted vault data enters a worker. */
export class BrowserIdentity {
  constructor({ secret, accountsUrl, production = true, request = fetch }) {
    if (!secret || Buffer.byteLength(secret) < 32) throw new Error('A private browser identity secret is required.');
    const url = new URL(accountsUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/') throw new Error('Accounts must be a trusted loopback HTTP service.');
    Object.assign(this, { secret, accountsUrl: url.origin, production, request });
    this.cookieName = production ? '__Host-lope-browser' : 'lope-browser';
    this.accountCookie = production ? '__Host-lope-account' : 'lope-account';
  }
  hash(value) { return createHmac('sha256', this.secret).update(value).digest('hex'); }
  sign(value) { return createHmac('sha256', this.secret).update(value).digest('base64url'); }
  device(header) {
    const matches = cookieValue(header, this.cookieName);
    if (matches.length !== 1) return null;
    const value = matches[0].slice(this.cookieName.length + 1);
    if (!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value)) return null;
    const [id, signature] = value.split('.');
    return timingSafeEqual(Buffer.from(signature), Buffer.from(this.sign(id))) ? id : null;
  }
  async resolve(header, { create = false } = {}) {
    let device = this.device(header), setCookie;
    if (!device) {
      if (!create) throw new HostingError(401, 'BROWSER_SESSION', 'Reconnect your browser session.');
      device = randomBytes(32).toString('base64url');
      setCookie = `${this.cookieName}=${device}.${this.sign(device)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${this.production ? '; Secure' : ''}`;
    }
    const cookies = cookieValue(header, this.accountCookie);
    if (cookies.length > 1) throw new HostingError(401, 'ACCOUNT_SESSION', 'Your account session is ambiguous. Sign in again.');
    let accountId = null;
    const accountCredential = cookies[0] ?? '';
    if (accountCredential) {
      // Forward only the account cookie to a fixed, trusted endpoint. Fail closed on outages.
      let response;
      try { response = await this.request(this.accountsUrl + '/api/accounts/session', {
        headers: { Cookie: accountCredential }, redirect: 'error', signal: AbortSignal.timeout(5000),
      }); } catch { throw new HostingError(503, 'ACCOUNTS_UNAVAILABLE', 'Account verification is unavailable. Your browser profile has not been opened.'); }
      if (!response.ok) throw new HostingError(503, 'ACCOUNTS_UNAVAILABLE', 'Account verification is unavailable. Try again shortly.');
      let value;
      try { value = await response.json(); } catch { throw new HostingError(503, 'ACCOUNTS_UNAVAILABLE', 'The account service returned an invalid response.'); }
      if (!value || !Object.hasOwn(value, 'account') || (value.account !== null && (typeof value.account?.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.account.id)))) throw new HostingError(503, 'ACCOUNTS_UNAVAILABLE', 'The account service returned an invalid response.');
      accountId = value.account?.id ?? null;
    }
    return { key: this.hash(`${accountId ? 'account:' + accountId : 'guest'}:${device}`), accountId,
      credential: accountCredential, device, setCookie };
  }
  async revalidate(owner) {
    if (!owner.accountId) return true;
    try {
      const current = await this.resolve(`${this.cookieName}=${owner.device}.${this.sign(owner.device)}; ${owner.credential}`);
      return current.key === owner.key;
    } catch { return false; }
  }
}
