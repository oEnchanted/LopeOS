import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Locate top-level site blocks without treating quoted braces, comments, or
// Caddy placeholders as block delimiters. Leave every other site byte-for-byte.
export function mergeSiteTemplate(source, template, origin) {
  const host = new URL(origin).hostname;
  const blocks = []; let depth = 0, start = 0, open = -1, quote = '', comment = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (comment) { if (ch === '\n') comment = false; continue; }
    if (quote) { if (ch === '\\' && quote === '"') { i++; continue; } if (ch === quote) quote = ''; continue; }
    if (ch === '#') { comment = true; continue; }
    if (ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') {
      const placeholder = source.slice(i).match(/^\{[^\s{}]+\}/);
      if (placeholder) { i += placeholder[0].length - 1; continue; }
      if (depth++ === 0) open = i;
    } else if (ch === '}') {
      if (--depth < 0) throw new Error('Unbalanced Caddy configuration.');
      if (depth === 0) { blocks.push({ start, open, end: i + 1 }); start = i + 1; }
    }
  }
  if (depth || quote) throw new Error('Unbalanced Caddy configuration.');
  const matches = [];
  for (const block of blocks) {
    const header = source.slice(block.start, block.open);
    const addresses = header.replace(/#[^\n]*/g, '').trim().split(/[\s,]+/).filter(Boolean);
    const selected = addresses.filter(address => {
      try { const url = new URL(address.includes('://') ? address : 'https://' + address); return url.protocol === 'https:' && url.hostname === host && !url.pathname.replace(/\//g, '') && (!url.port || url.port === '443'); }
      catch { return false; }
    });
    if (selected.length) matches.push({ ...block, header, selected, addresses });
  }
  if (matches.length !== 1) throw new Error('Expected exactly one explicit HTTPS site block for ' + host + '; imported or ambiguous configurations need a host-provided template.');
  const block = matches[0];
  // Split shared address blocks so every other hostname retains its old routes.
  const others = block.addresses.filter(address => !block.selected.includes(address));
  const preserved = others.length ? '\n' + others.join(', ') + ' ' + source.slice(block.open, block.end) + '\n' : '';
  const comments = (block.header.match(/#[^\n]*/g) || []).join('\n');
  const header = '\n' + (comments ? comments + '\n' : '') + '__LOPE_SITE_HOST__ ';
  const body = template.slice(template.indexOf('{') + 1, template.lastIndexOf('}'));
  if (!body.includes('__LOPE_WEB_ROOT__') || !body.includes('__LOPE_ASSET_ROOT__')) throw new Error('Invalid release template.');
  return source.slice(0, block.start) + preserved + header + '{' + body + '}' + source.slice(block.end);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [sourcePath, templatePath, origin, destination] = process.argv.slice(2);
  await writeFile(destination, mergeSiteTemplate(await readFile(sourcePath, 'utf8'), await readFile(templatePath, 'utf8'), origin), { flag: 'wx' });
}
