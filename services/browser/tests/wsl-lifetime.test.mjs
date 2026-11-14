import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { startWslLifetime } from '../hosting/wsl-lifetime.mjs';

function processFixture({ ready = true, cooperate = true } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  let killed = false, input = '';
  const finish = code => { child.emit('exit', code); child.emit('close', code); };
  child.stdin.on('data', chunk => { input += chunk; });
  child.stdin.once('finish', () => { if (cooperate) queueMicrotask(() => finish(0)); });
  child.kill = () => { killed = true; queueMicrotask(() => finish(1)); return true; };
  const calls = [];
  const spawnProcess = (...args) => {
    calls.push(args);
    if (ready) queueMicrotask(() => { child.stdout.write('lope-browser-'); child.stdout.write('wsl-ready\n'); });
    return child;
  };
  return { child, calls, spawnProcess, finish, get killed() { return killed; }, get input() { return input; } };
}

test('WSL lifetime is scoped to Windows and the configured distribution', async () => {
  const spawnProcess = () => { throw new Error('WSL must not launch'); };
  await (await startWslLifetime({ platform: 'linux', distro: 'Ubuntu', spawnProcess })).stop();
  await (await startWslLifetime({ platform: 'win32', spawnProcess })).stop();
  await assert.rejects(startWslLifetime({ platform: 'win32', distro: 'bad distribution', spawnProcess }));
});

test('WSL lifetime holds a foreground stdin reader and cooperatively releases it on shutdown', async () => {
  const fixture = processFixture(); let failures = 0;
  const lifetime = await startWslLifetime({ platform: 'win32', distro: 'Ubuntu', spawnProcess: fixture.spawnProcess, onUnexpectedExit: () => failures++ });
  const [file, args, options] = fixture.calls[0];
  assert.equal(file, 'wsl.exe');
  assert.deepEqual(args.slice(0, 8), ['--distribution', 'Ubuntu', '--user', 'root', '--exec', '/bin/sh', '-c', args[7]]);
  assert.match(args[7], /while IFS= read -r line/);
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'ignore']);
  assert.equal(fixture.child.stdin.writableEnded, false);
  await lifetime.stop(); await lifetime.stop();
  assert.equal(fixture.input, 'stop\n'); assert.equal(fixture.killed, false); assert.equal(failures, 0);
});

test('an unexpected WSL exit requests gateway failure, and a startup failure cleans up its transport', async () => {
  const fixture = processFixture(); const errors = [];
  const lifetime = await startWslLifetime({ platform: 'win32', distro: 'Ubuntu', spawnProcess: fixture.spawnProcess, onUnexpectedExit: error => errors.push(error) });
  fixture.finish(1); await lifetime.stop();
  assert.equal(errors.length, 1); assert.match(errors[0].message, /WSL host stopped/);
  const stalled = processFixture({ ready: false, cooperate: false });
  await assert.rejects(startWslLifetime({ platform: 'win32', distro: 'Ubuntu', spawnProcess: stalled.spawnProcess, timeoutMs: 5, stopTimeoutMs: 5 }), /did not start/);
  assert.equal(stalled.input, 'stop\n'); assert.equal(stalled.killed, true);
});

test('the real Linux foreground command exits on a lost parent stdin pipe', { skip: process.platform === 'win32', timeout: 5000 }, async () => {
  let child, resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const lifetime = await startWslLifetime({ platform: 'win32', distro: 'Ubuntu',
    spawnProcess: (_file, args, options) => { child = spawn('/bin/sh', args.slice(6), options); return child; },
    onUnexpectedExit: resolveExit,
  });
  try {
    // Simulate a parent disappearing without sending the cooperative stop line.
    child.stdin.end();
    assert.match((await exited).message, /WSL host stopped/);
  } finally { await lifetime.stop(); }
});
