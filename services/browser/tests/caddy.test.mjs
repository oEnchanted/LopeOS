import test from 'node:test';
import assert from 'node:assert/strict';
import { enableBrowserRoute } from '../hosting/caddy.mjs';

test('Caddy activation replaces only the selected disabled browser route and preserves other services',()=>{
  const source='other.example {\n respond "leave this alone"\n}\nlopeos.online {\n handle /api/accounts/* { reverse_proxy 127.0.0.1:4176 }\n handle /api/browser/* { respond "Lope Browser hosting is not configured." 503 }\n handle /api/* { reverse_proxy 127.0.0.1:4174 }\n root * C:/LopeOS/releases/current\n}\n';
  const changed=enableBrowserRoute(source,'https://lopeos.online');
  assert.ok(changed.startsWith('other.example {\n respond "leave this alone"\n}'));
  for(const value of ['reverse_proxy 127.0.0.1:4177','flush_interval -1','stream_close_delay 5m','127.0.0.1:4176','127.0.0.1:4174','C:/LopeOS/releases/current'])assert.ok(changed.includes(value));
  assert.equal(enableBrowserRoute(changed,'https://lopeos.online'),changed);
});
test('shared Caddy host blocks are split rather than enabling browser routing on another domain',()=>{
  const source='other.example, lopeos.online {\n root * C:/website\n file_server\n}\n';
  const changed=enableBrowserRoute(source,'https://lopeos.online');
  assert.ok(changed.includes('other.example {\n root * C:/website\n file_server\n}'));
  assert.ok(changed.includes('lopeos.online {\n    handle /api/browser/*'));
  assert.throws(()=>enableBrowserRoute('other.example { file_server }','https://lopeos.online'),/Expected one/);
  assert.throws(()=>enableBrowserRoute('lopeos.online { handle /api/browser/* { reverse_proxy custom:9000 } }','https://lopeos.online'),/Custom browser/);
});
