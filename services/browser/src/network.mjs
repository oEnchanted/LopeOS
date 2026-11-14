import { createServer, request } from 'node:http';
import { connect, isIP, BlockList } from 'node:net';
import { lookup } from 'node:dns/promises';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],
  ['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address, prefix, 'ipv4');
blocked.addSubnet('2001:db8::', 32, 'ipv6'); blocked.addSubnet('2001::', 32, 'ipv6');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
export function publicAddress(ip) {
  const family = isIP(ip);
  return family === 4 ? !blocked.check(ip, 'ipv4') : family === 6 && globalV6.check(ip, 'ipv6') && !blocked.check(ip, 'ipv6');
}

// A page opens dozens of connections to the same few hosts, and each system lookup takes one
// of libuv's few threads. Reuse answers briefly; every use is still checked as public below.
const DNS_TTL_MS = 60000, DNS_CACHE_LIMIT = 2000, dnsCache = new Map();
async function cachedLookup(host, options) {
  const hit = dnsCache.get(host);
  if (hit && hit.expires > Date.now()) return hit.addresses;
  const addresses = await lookup(host, options);
  if (dnsCache.size >= DNS_CACHE_LIMIT) dnsCache.delete(dnsCache.keys().next().value);
  dnsCache.set(host, { addresses, expires: Date.now() + DNS_TTL_MS });
  return addresses;
}

/** DNS is checked once and the outbound socket uses that exact numeric address. */
export async function publicDestination(host, port, { resolve = cachedLookup, testOrigins = [] } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  const addresses = await resolve(host.replace(/^\[|\]$/g, ''), { all: true, verbatim: true });
  const explicitTest = testOrigins.includes(`${host}:${port}`);
  if (!addresses.length || (!explicitTest && (![80, 443].includes(port) || addresses.some(item => !publicAddress(item.address))))) throw new Error('This network destination is unavailable.');
  return { ...(addresses.find(item => item.family === 4) ?? addresses[0]), port };
}

/** Public web egress for all tabs, workers, redirects and WebSockets. Pair with OS egress policy. */
export async function createEgressProxy(options = {}) {
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url);
      if (url.protocol !== 'http:' || url.username || url.password) throw new Error();
      const target = await publicDestination(url.hostname, Number(url.port || 80), options);
      const headers = { ...req.headers, host: url.host };
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      // Website Authorization and cookies are part of normal origin behavior, never host credentials.
      const upstream = request({ host: target.address, family: target.family, port: target.port,
        path: url.pathname + url.search, method: req.method, headers, timeout: 30000 }, reply => {
        res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      upstream.on('timeout', () => upstream.destroy()); req.pipe(upstream);
      res.on('close', () => upstream.destroy());
    } catch { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Lope Browser cannot reach this network address.'); }
  });
  server.on('connect', async (req, client, head) => {
    try {
      const url = new URL(`http://${req.url}`);
      const target = await publicDestination(url.hostname, Number(url.port || 443), options);
      const remote = connect({ host: target.address, family: target.family, port: target.port });
      const timeout = setTimeout(() => remote.destroy(), 10000);
      sockets.add(remote); remote.on('close', () => sockets.delete(remote));
      remote.on('connect', () => { clearTimeout(timeout); client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); remote.pipe(client).pipe(remote); });
      remote.on('close', () => clearTimeout(timeout));
      remote.on('error', () => client.destroy()); client.on('error', () => remote.destroy()); client.on('close', () => remote.destroy());
    } catch { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  server.on('upgrade', async (req, client, head) => {
    try {
      const url = new URL(req.url); if (!['ws:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
      const target = await publicDestination(url.hostname, Number(url.port || 80), options);
      const headers = { ...req.headers, host: url.host }; delete headers['proxy-authorization']; delete headers['proxy-connection'];
      const upstream = request({ host: target.address, family: target.family, port: target.port, path: url.pathname + url.search, headers, timeout: 10000 });
      upstream.on('upgrade', (reply, remote, remoteHead) => {
        sockets.add(remote); remote.on('close', () => sockets.delete(remote));
        client.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
        if (remoteHead.length) client.write(remoteHead); if (head.length) remote.write(head);
        remote.pipe(client).pipe(remote); remote.on('error', () => client.destroy()); client.on('close', () => remote.destroy());
      });
      upstream.on('response', () => client.destroy()); upstream.on('error', () => client.destroy()); upstream.on('timeout', () => upstream.destroy()); upstream.end();
    } catch { client.destroy(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
  server.headersTimeout = 10000; server.requestTimeout = 60000; server.maxConnections = 200;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
