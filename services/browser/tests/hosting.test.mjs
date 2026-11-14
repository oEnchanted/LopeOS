import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountServer } from '../../accounts/server.mjs';
import { BrowserIdentity } from '../hosting/identity.mjs';
import { createBrowserGateway } from '../hosting/gateway.mjs';

const origin = 'https://lopeos.online';
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
const cookie = response => response.headers.get('set-cookie')?.split(';')[0] ?? '';

test('public gateway isolates encrypted accounts and guests; cookies and vault material never enter workers', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lope-hosting-'));
  const accounts = await createAccountServer({ directory, production: true, origins: [origin] });
  let service; const servers = [];
  t.after(async()=>{await service?.close();for(const server of servers){server.closeAllConnections();server.close();}await accounts.dispose();await rm(directory,{recursive:true,force:true});});
  const accountUrl = await listen(accounts.server);
  const accountRequest = (path, body, authCookie) => fetch(accountUrl + '/api/accounts' + path, { method: body ? 'POST' : 'GET',
    headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(authCookie ? { Cookie: authCookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  // Opaque, well-formed client ciphertext. This gateway never has a decryption key.
  const sealed = () => ({ password:randomBytes(32).toString('hex'), recoveryProof:randomBytes(32).toString('hex'), recoveryKey:randomBytes(32).toString('hex'), envelope:{version:1,id:randomBytes(16).toString('hex'),passwordWrap:randomBytes(60).toString('hex'),recoveryWrap:randomBytes(60).toString('hex')} });
  const vault = sealed();
  const registered = await accountRequest('/register', { accountName: 'browserone', displayName: 'Browser One', password: vault.password, credentialVersion: 1, vault: vault.envelope, recoveryProof: vault.recoveryProof });
  assert.equal(registered.status,201); const firstAccount = (await registered.json()).account;
  const firstCookie = cookie(registered);
  const secondVault = sealed();
  const secondRegistered = await accountRequest('/register', { accountName: 'browsertwo', displayName: 'Browser Two', password: secondVault.password, credentialVersion: 1, vault: secondVault.envelope, recoveryProof: secondVault.recoveryProof });
  const secondAccount = (await secondRegistered.json()).account, secondCookie = cookie(secondRegistered);
  const seen = [], allocations = [], stopped = [];
  const allocator = {
    async create(input) {
      allocations.push(input); const token = randomBytes(32).toString('hex');
      const state = id => ({ id, mode: id === 'normal' ? 'normal' : 'private', tabs: [{ id: 'tab-' + input.id, url: 'about:blank', title: input.id }], streamUrl: '/api/browser/stream/' + input.id + '/selkies/' });
      const server = createServer(async (req,res) => {
        seen.push({ headers: req.headers, path: req.url });
        assert.equal(req.headers.authorization,'Bearer ' + token); assert.equal(req.headers.cookie,undefined);
        if (req.url === '/api/browser/sessions') {
          let raw = ''; for await (const chunk of req) raw += chunk;
          assert.deepEqual(Object.keys(JSON.parse(raw)),['mode']);
          res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(state(JSON.parse(raw).mode === 'normal' ? 'normal' : randomUUID())));
        } else if (req.url.includes('/stream/')) { res.setHeader('Set-Cookie','must-not-escape=secret'); res.end('trusted media client'); }
        else if (req.url.endsWith('/events')) { res.writeHead(200,{'Content-Type':'text/event-stream'}); res.write('data: '+JSON.stringify(state('normal'))+'\n\n'); }
        else { res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state('normal'))); }
      }); servers.push(server); const url = await listen(server); return { url, token, name: input.id };
    },
    async destroy(worker) { stopped.push(worker.id); const server = servers[allocations.findIndex(item=>item.id===worker.id)]; server.closeAllConnections(); server.close(); },
  };
  const identity = new BrowserIdentity({ secret: randomBytes(32).toString('hex'), accountsUrl: accountUrl, production: true });
  let time = Date.now(); service = createBrowserGateway({ identity, allocator, origins:[origin], maxWorkers:2, now:()=>time, revokeMs:3600000 });
  const base = await listen(service.server);
  const request = (path, authCookie='', options={}) => new Promise((resolve,reject)=>{
    const req=httpRequest(base+'/api/browser'+path,{method:options.method??'GET',headers:{Host:'lopeos.online',Origin:origin,...(authCookie?{Cookie:authCookie}:{}),...options.headers}},response=>{
      const headers=Object.fromEntries(Object.entries(response.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,Array.isArray(value)?value.join(', '):value]));
      resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers}));
    });req.on('error',reject);req.end(options.body);
  });
  const first = await request('/sessions',firstCookie,{method:'POST',body:JSON.stringify({mode:'normal'}),headers:{'X-Lope-Browser-Account':firstAccount.id}});
  assert.equal(first.status,200);const firstDevice=cookie(first);const firstState=await first.json();
  assert.notEqual(firstState.id,'normal');assert.equal(firstState.hosting.accountId,firstAccount.id);
  assert.equal(firstState.streamUrl,`/api/browser/stream/${allocations[0].id}/selkies/`);
  assert.equal(first.headers.get('set-cookie').includes('HttpOnly'),true);
  const aCookie=firstCookie+'; '+firstDevice;
  const same=await request('/sessions',aCookie,{method:'POST',body:'{"mode":"normal"}'});assert.equal((await same.json()).id,firstState.id);assert.equal(allocations.length,1);
  const second=await request('/sessions',secondCookie+'; '+firstDevice,{method:'POST',body:'{"mode":"normal"}'});
  assert.equal(second.status,200);const secondState=await second.json();assert.notEqual(secondState.id,firstState.id);assert.notEqual(allocations[0].ownerKey,allocations[1].ownerKey);
  assert.equal((await request('/sessions/'+firstState.id,secondCookie+'; '+firstDevice)).status,404);
  assert.equal((await request(firstState.streamUrl.replace('/api/browser',''),secondCookie+'; '+firstDevice)).status,404);
  assert.equal((await request('/sessions/normal',aCookie)).status,404);
  assert.equal((await request('/sessions',aCookie,{method:'POST',headers:{Origin:'https://attacker.test'},body:'{"mode":"normal"}'})).status,403);
  assert.equal((await request('/sessions',aCookie,{method:'POST',headers:{'X-Lope-Browser-Account':secondAccount.id},body:'{"mode":"normal"}'})).status,409);
  const media=await request(firstState.streamUrl.replace('/api/browser',''),aCookie);assert.equal(await media.text(),'trusted media client');assert.equal(media.headers.get('set-cookie'),null);
  const events=await request('/sessions/'+firstState.id+'/events',aCookie);const reader=events.body.getReader();const packet=await reader.read();
  assert.match(new TextDecoder().decode(packet.value),new RegExp(firstState.id));
  assert.equal((await request('/sessions','',{method:'POST',body:'{"mode":"normal"}'})).status,503);
  await accountRequest('/logout',{},firstCookie);await service.sweep();assert.deepEqual(stopped,[allocations[0].id]);assert.equal(service.workers.size,1);
  await reader.cancel().catch(()=>{});
  assert.equal((await request('/sessions/'+firstState.id,aCookie)).status,404);
  const guest=await request('/sessions','',{method:'POST',body:'{"mode":"normal"}'});assert.equal(guest.status,200);assert.equal((await guest.json()).hosting.accountId,null);
  for(const allocation of allocations)assert.deepEqual(Object.keys(allocation).sort(),['id','origin','ownerKey']);
  const wire=JSON.stringify({seen,allocations,firstState,secondState});
  for(const forbidden of [firstCookie,secondCookie,vault.password,vault.recoveryKey,vault.envelope.passwordWrap,secondVault.envelope.passwordWrap])assert.equal(wire.includes(forbidden),false);
  time+=1800001;await service.sweep();assert.equal(service.workers.size,0);
});

test('account verification fails closed and ignores forged client identities',async()=>{
  const identity=new BrowserIdentity({secret:'s'.repeat(64),accountsUrl:'http://127.0.0.1:4176',request:async()=>{throw new Error('offline');}});
  await assert.rejects(identity.resolve('__Host-lope-account='+'a'.repeat(64),{create:true}),{code:'ACCOUNTS_UNAVAILABLE'});
  const guest=await identity.resolve('__Host-lope-browser=forged.account-id',{create:true});assert.equal(guest.accountId,null);assert.match(guest.key,/^[a-f0-9]{64}$/);
  await assert.rejects(identity.resolve('__Host-lope-browser=forged.account-id'),{code:'BROWSER_SESSION'});
});
