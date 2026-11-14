import type { SearchProvider } from './contracts';

export const SEARCH_PROVIDERS: Record<SearchProvider, { name: string; url: string }> = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
};

export function destination(input: string, provider: SearchProvider = 'duckduckgo'): string {
  const value = input.trim();
  if (!value || value === 'lope://newtab' || value === 'about:blank') return 'about:blank';
  if (value.length > 8192) throw new Error('This address is too long.');
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password) throw new Error('Addresses containing credentials are not supported.');
    return url.href;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[\w.-]+:\d+(?:\/|$)/.test(value)) {
    throw new Error('Use an HTTP or HTTPS address.');
  }
  if (!/\s/.test(value) && /^(?:localhost|\[[\da-f:]+\]|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:[/?#]|$)/i.test(value)) {
    return new URL(`https://${value}`).href;
  }
  return SEARCH_PROVIDERS[provider].url + encodeURIComponent(value);
}

/** Files opened from LopeDrive are served by the worker on this reserved, never-resolving domain, one origin per file. */
export const OPENED_FILE_DOMAIN = 'file.lope.invalid';
export const MAX_OPENED_FILE_BYTES = 32 * 1024 * 1024;
export const OPENABLE_FILE_EXTENSIONS = ['.html', '.htm', '.xhtml'];

export function openableFileType(name: string): string | null {
  const extension = /\.[^./]+$/.exec(name.toLowerCase())?.[0];
  return extension === '.html' || extension === '.htm' ? 'text/html' : extension === '.xhtml' ? 'application/xhtml+xml' : null;
}

export const openedFileUrl = (id: string, name: string) => `https://${id}.${OPENED_FILE_DOMAIN}/${encodeURIComponent(name)}`;

/** The opened file an address shows, or null for any other address. */
export function openedFile(value: string): { id: string; name: string } | null {
  try {
    const url = new URL(value);
    const id = url.hostname.endsWith('.' + OPENED_FILE_DOMAIN) ? url.hostname.slice(0, -OPENED_FILE_DOMAIN.length - 1) : '';
    if (url.protocol !== 'https:' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(id)) return null;
    return { id, name: decodeURIComponent(url.pathname.slice(1)) || 'file' };
  } catch { return null; }
}

export function displayAddress(value: string): string {
  if (value === 'about:blank') return '';
  const file = openedFile(value);
  if (file) return file.name;
  try {
    const url = new URL(value);
    // Keep the ASCII hostname visible; Unicode homographs must not disguise the destination.
    return `${url.host}${url.pathname === '/' && !url.search && !url.hash ? '' : url.pathname + url.search + url.hash}`;
  } catch { return value; }
}

/** A website address the host browser can open, or null. Opened files exist only inside Lope Browser. */
export function safeHostUrl(value: string): string | null {
  if (openedFile(value)) return null;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
