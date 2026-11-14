import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assertWorkerAccepts, type ReleaseManifest } from '../../scripts/release-validation.ts';

const worker = await readFile(new URL('../../public/lope-sw.js', import.meta.url), 'utf8');
function release(urls: string[]): ReleaseManifest {
  const assets = urls.map(url => ({ url, size: 1, sha256: 'a'.repeat(64) }));
  return { format: 1, version: '0.1.7', build: '2026-11-14T00:00:00.000Z', releasedAt: '2026-11-14T00:00:00.000Z', totalBytes: assets.length, assets };
}

test('releases with supported public paths pass the installed worker checks', () => {
  assert.doesNotThrow(() => assertWorkerAccepts(release(['/index.html', '/assets/app-1a2b.js', '/assets/source-1-9f8e.webm', '/wallpapers/aurora.png', '/photos/sample.jpg', '/favicon.svg']), worker));
});

test('files outside the worker allowlist fail the build and are named', () => {
  assert.throws(
    () => assertWorkerAccepts(release(['/index.html', '/assets/app-1a2b.js', '/movie-maker-sample/narration.wav', '/movie-maker-sample/source-1.webm']), worker),
    error => error instanceof Error && error.message.includes('/movie-maker-sample/narration.wav') && error.message.includes('/movie-maker-sample/source-1.webm') && !error.message.includes('/assets/app-1a2b.js'),
  );
});

test('the shipped worker still exposes the validator the build relies on', () => {
  assert.throws(() => assertWorkerAccepts(release(['/index.html']), 'self.addEventListener("fetch", () => {});'), /validateRelease/);
});
