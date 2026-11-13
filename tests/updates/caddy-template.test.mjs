import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSiteTemplate } from '../../scripts/caddy-template.mjs';
const template = '__LOPE_SITE_HOST__ {\n root * "__LOPE_WEB_ROOT__"\n handle /assets/* {\n root * "__LOPE_ASSET_ROOT__"\n }\n}\n';
test('Caddy migration preserves globals and unrelated domains including quoted braces and placeholders', () => {
  const before = '{\n email owner@example.com\n}\nother.example {\n respond "brace } # text"\n header X-Test {host}\n}\n';
  const after = '\nlast.example {\n reverse_proxy localhost:8000\n}\n';
  const result = mergeSiteTemplate(before + 'lopeos.online, www.lopeos.online {\n root * C:/old\n file_server\n}' + after, template, 'https://lopeos.online');
  assert.ok(result.startsWith(before)); assert.ok(result.endsWith(after));
  assert.ok(result.includes('www.lopeos.online {\n root * C:/old'));
  assert.ok(result.includes('__LOPE_SITE_HOST__ {'));
  assert.ok(result.includes('__LOPE_WEB_ROOT__')); assert.equal(result.match(/C:\/old/g).length, 1);
});
test('Caddy migration refuses missing and ambiguous site blocks', () => {
  assert.throws(() => mergeSiteTemplate('other.example {\n file_server\n}', template, 'https://lopeos.online'), /exactly one/);
  assert.throws(() => mergeSiteTemplate('lopeos.online {\n}\nlopeos.online {\n}', template, 'https://lopeos.online'), /exactly one/);
});

test('Caddy migration preserves HTTP redirects and hostname comments', () => {
  const redirect = 'http://lopeos.online {\n redir https://lopeos.online{uri}\n}';
  const source = redirect + '\n# lopeos.online website\nlopeos.online {\n file_server\n}';
  const result = mergeSiteTemplate(source, template, 'https://lopeos.online');
  assert.ok(result.startsWith(redirect));
  assert.ok(result.includes('# lopeos.online website'));
  assert.ok(result.includes('__LOPE_SITE_HOST__ {'));
});
