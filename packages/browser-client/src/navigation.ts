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

export function displayAddress(value: string): string {
  if (value === 'about:blank') return '';
  try {
    const url = new URL(value);
    // Keep the ASCII hostname visible; Unicode homographs must not disguise the destination.
    return `${url.host}${url.pathname === '/' && !url.search && !url.hash ? '' : url.pathname + url.search + url.hash}`;
  } catch { return value; }
}

export function safeHostUrl(value: string): string | null {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
