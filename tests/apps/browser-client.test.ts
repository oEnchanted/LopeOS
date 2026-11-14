import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserClient } from '../../packages/browser-client/src/index.ts';
import type { BrowserSession } from '../../packages/browser-client/src/contracts.ts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const snapshot = (revision: number) => ({ id: 'session', revision }) as BrowserSession;
const encoder = new TextEncoder();

function eventStream() {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let canceled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { stream = controller; },
    cancel() { canceled = true; },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
  return { response, send: (text: string) => stream.enqueue(encoder.encode(text)), get canceled() { return canceled; } };
}

test('browser failures display structured runtime error messages', async () => {
  const client = new BrowserClient(async () => Response.json({ error: { code: 'unavailable', message: 'Browser service is unavailable.' } }, { status: 503 }));
  await assert.rejects(client.create(), { message: 'Browser service is unavailable.' });
});

test('browser failures retain string errors and use readable fallbacks for malformed responses', async () => {
  for (const [payload, status, message] of [
    [{ error: 'This browser session has expired.' }, 404, 'This browser session has expired.'],
    [{ error: { code: 'unavailable' } }, 503, 'The browser runtime is unavailable.'],
    [{ error: { message: { detail: 'unavailable' } } }, 503, 'The browser runtime is unavailable.'],
    [null, 401, 'Sign in to reconnect your browser.'],
    [{ error: '  ' }, 503, 'The browser runtime is unavailable.'],
  ] as const) {
    const client = new BrowserClient(async () => Response.json(payload, { status }));
    await assert.rejects(client.create(), { message });
  }
});

test('non-JSON browser failures show a readable fallback', async () => {
  const client = new BrowserClient(async () => new Response('Bad gateway', { status: 502 }));
  await assert.rejects(client.create(), { message: 'The browser runtime is unavailable.' });
});

test('browser events accept fragmented CRLF frames and report a stable connection once', async () => {
  const events = eventStream(); const states: BrowserSession[] = []; const connections: boolean[] = [];
  const client = new BrowserClient(async () => events.response);
  const unsubscribe = client.subscribe('session', state => states.push(state), connected => connections.push(connected));
  try {
    await flush();
    events.send(': heartbeat\r\n\r\nevent: state\r\ndata:{"id":"session",\r\n');
    events.send('data: "revision":1}\r\n\r');
    events.send('\ndata: ' + JSON.stringify(snapshot(2)) + '\r\n\r\n');
    await flush();
    assert.deepEqual(states.map(state => state.revision), [1, 2]);
    assert.deepEqual(connections, [true]);
  } finally { unsubscribe(); }
  await flush(); assert.equal(events.canceled, true);
});

test('unsubscribing cancels the reader and suppresses queued state callbacks', async () => {
  const events = eventStream(); const states: BrowserSession[] = []; const connections: boolean[] = [];
  const client = new BrowserClient(async () => events.response);
  const unsubscribe = client.subscribe('session', state => states.push(state), connected => connections.push(connected));
  await flush();
  events.send('data: ' + JSON.stringify(snapshot(1)) + '\n\n');
  unsubscribe();
  await flush();
  assert.equal(events.canceled, true);
  assert.deepEqual(states, []); assert.deepEqual(connections, []);
});

test('silent event connections are canceled and retried after missed heartbeats', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const streams = [eventStream(), eventStream()]; let requests = 0; const connections: boolean[] = [];
  const client = new BrowserClient(async () => streams[requests++].response);
  const unsubscribe = client.subscribe('session', () => {}, connected => connections.push(connected));
  try {
    await flush();
    streams[0].send('data: ' + JSON.stringify(snapshot(1)) + '\n\n'); await flush();
    context.mock.timers.tick(30000); streams[0].send(': heartbeat\n\n'); await flush();
    context.mock.timers.tick(30000); await flush();
    assert.equal(streams[0].canceled, false);
    context.mock.timers.tick(15000); await flush();
    assert.equal(streams[0].canceled, true); assert.deepEqual(connections, [true, false]);
    context.mock.timers.tick(500); await flush();
    assert.equal(requests, 2);
    streams[1].send('data: ' + JSON.stringify(snapshot(2)) + '\n\n'); await flush();
    assert.deepEqual(connections, [true, false, true]);
  } finally { unsubscribe(); await flush(); }
});

test('network recovery replaces an apparently connected stream without waiting for its heartbeat', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget(); const streams = [eventStream(), eventStream()]; let requests = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  const client = new BrowserClient(async () => streams[requests++].response);
  const unsubscribe = client.subscribe('session', () => {});
  try {
    await flush(); streams[0].send('data: ' + JSON.stringify(snapshot(1)) + '\n\n'); await flush();
    events.dispatchEvent(new Event('online')); await flush(); context.mock.timers.tick(0); await flush();
    assert.equal(streams[0].canceled, true); assert.equal(requests, 2);
  } finally {
    unsubscribe(); await flush();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('returning online bypasses reconnect backoff and removes its listener on unsubscribe', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget(); const stream = eventStream(); let requests = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  const client = new BrowserClient(async () => ++requests < 4 ? new Response('', { status: 503 }) : stream.response);
  const unsubscribe = client.subscribe('session', () => {});
  try {
    await flush(); context.mock.timers.tick(500); await flush(); context.mock.timers.tick(1000); await flush();
    assert.equal(requests, 3);
    events.dispatchEvent(new Event('online')); await flush();
    assert.equal(requests, 4);
    unsubscribe(); await flush();
    events.dispatchEvent(new Event('online')); context.mock.timers.tick(10000); await flush();
    assert.equal(requests, 4); assert.equal(stream.canceled, true);
  } finally {
    unsubscribe();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('expired event sessions notify once and stop reconnecting', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0; let expired = 0; const connections: boolean[] = [];
  const client = new BrowserClient(async () => { requests++; return new Response('', { status: 410 }); });
  const unsubscribe = client.subscribe('session', () => {}, connected => connections.push(connected), () => expired++);
  try {
    await flush(); context.mock.timers.tick(60000); await flush();
    assert.equal(requests, 1); assert.equal(expired, 1); assert.deepEqual(connections, [false]);
  } finally { unsubscribe(); }
});
