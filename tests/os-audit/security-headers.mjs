/**
 * OS AUDIT: proposed production response headers for the LopeOS web root.
 *
 * Two tiers, deliberately:
 *  - ENFORCED: structural controls that no described LopeOS feature depends on
 *    (framing, <base>, plugins, form targets, transport, feature delegation).
 *  - REPORT-ONLY: the full script/connect/img policy. It detects violations but is
 *    NOT an enforced control until application owners validate their flows
 *    (Image Editor ONNX runtime, Writer/SuperDoc, Lightroom codecs, Movie Maker).
 *
 * docs/audits/lopeos-general-os/patches/caddy-security-headers.patch carries the
 * same values; tests/os-audit/headers.test.mjs keeps the two in sync.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const indexHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
/** CSP hashes of the classic inline boot script(s) in index.html (exact bytes). */
export const inlineScriptHashes = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => `'sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);

export const enforcedCsp = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'";

export const connectHosts = [
  'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com', // Weather (OS status item + app)
  'https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.co', // optional local AI weights (+ CDN redirects)
  'https://raw.githubusercontent.com', // WebLLM model library (.wasm)
  'https://cdn.jsdelivr.net', // Image Editor pinned ONNX Runtime bytes (sha256-verified by the app)
];

export function reportOnlyCsp(reportUri) {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' blob: ${inlineScriptHashes.join(' ')}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src 'self' ${connectHosts.join(' ')}`,
    "frame-src 'self' blob:",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
    ...(reportUri ? [`report-uri ${reportUri}`] : []),
  ].join('; ');
}

/** Features LopeOS uses stay first-party; unused powerful features are disabled everywhere. */
export const permissionsPolicy = [
  'camera=(self)', 'microphone=(self)', 'geolocation=(self)', 'display-capture=(self)', 'fullscreen=(self)',
  'clipboard-read=(self)', 'clipboard-write=(self)', 'autoplay=(self)',
  'payment=()', 'usb=()', 'serial=()', 'hid=()', 'bluetooth=()', 'midi=()', 'xr-spatial-tracking=()', 'browsing-topics=()',
].join(', ');

export function productionHeaders({ reportUri } = {}) {
  return {
    'Content-Security-Policy': enforcedCsp,
    'Content-Security-Policy-Report-Only': reportOnlyCsp(reportUri),
    'X-Frame-Options': 'SAMEORIGIN',
    'Strict-Transport-Security': 'max-age=31536000',
    'Permissions-Policy': permissionsPolicy,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}
