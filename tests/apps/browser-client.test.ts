import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserClient } from '../../packages/browser-client/src/index.ts';

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
