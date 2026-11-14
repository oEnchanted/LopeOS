import type { BrowserBookmark, BrowserTab, BrowserVisit, SearchProvider } from './contracts.ts';
import { SEARCH_PROVIDERS, destination, displayAddress } from './navigation.ts';

/**
 * One row of the address bar's list. The first row, when present, is what the typed text does
 * on Enter (`search` or `url`); the rest are open tabs, bookmarks and history.
 */
export interface AddressSuggestion {
  kind: 'search' | 'url' | 'tab' | 'bookmark' | 'history';
  title: string; url: string; tabId?: string;
}
export interface SuggestionSources {
  tabs?: BrowserTab[]; activeTabId?: string | null; bookmarks?: BrowserBookmark[];
  history?: BrowserVisit[]; provider?: SearchProvider; limit?: number;
}

const bare = (url: string) => url.replace(/^https?:\/\/(?:www\.)?/i, '').toLowerCase();
const priority: Record<AddressSuggestion['kind'], number> = { search: 0, url: 0, tab: 20, bookmark: 15, history: 0 };

/** Ranks local sources against typed text. Pure, so the address bar can run it on every keystroke. */
export function addressSuggestions(input: string, sources: SuggestionSources): AddressSuggestion[] {
  const value = input.trim();
  if (!value) return [];
  const provider = sources.provider ?? 'duckduckgo';
  const rows: AddressSuggestion[] = [];
  try {
    const url = destination(value, provider);
    if (url !== 'about:blank') rows.push(url.startsWith(SEARCH_PROVIDERS[provider].url)
      ? { kind: 'search', title: value, url } : { kind: 'url', title: displayAddress(url) || value, url });
  } catch { /* Not a usable address: Enter reports why, and there is no typed row. */ }

  const needle = bare(value);
  const words = value.toLowerCase().split(/\s+/).filter(Boolean);
  const visits = new Map<string, number>();
  for (const visit of sources.history ?? []) visits.set(visit.url, (visits.get(visit.url) ?? 0) + 1);
  const score = (title: string, url: string) => {
    const text = title.toLowerCase(), address = bare(url), host = address.split(/[/?#:]/)[0];
    if (!words.every(word => text.includes(word) || address.includes(word))) return 0;
    let result = 10;
    if (address.startsWith(needle)) result += host.startsWith(needle) ? 60 : 50;
    else if (host.split('.').some(label => label.startsWith(needle))) result += 40;
    else if (text.split(/[^\p{L}\p{N}]+/u).some(word => word.startsWith(words[0]))) result += 25;
    return result + Math.min(visits.get(url) ?? 0, 20) * 2 - Math.min(address.length, 200) / 100;
  };

  const best = new Map<string, AddressSuggestion & { score: number }>();
  const consider = (kind: AddressSuggestion['kind'], title: string, url: string, tabId?: string) => {
    if (!url || url === 'about:blank' || url === rows[0]?.url) return;
    const value = score(title, url);
    if (!value) return;
    const total = value + priority[kind], current = best.get(url);
    // Prefer switching to an open tab, then the most specific saved kind, for the same address.
    if (!current || priority[kind] > priority[current.kind] || (priority[kind] === priority[current.kind] && total > current.score)) {
      best.set(url, { kind, title: title || displayAddress(url), url, ...(tabId ? { tabId } : {}), score: Math.max(total, current?.score ?? 0) });
    } else current.score = Math.max(current.score, total);
  };
  for (const tab of sources.tabs ?? []) if (tab.id !== sources.activeTabId) consider('tab', tab.title, tab.url, tab.id);
  for (const item of sources.bookmarks ?? []) consider('bookmark', item.title, item.url);
  for (const item of sources.history ?? []) consider('history', item.title, item.url);
  const matches = [...best.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(0, (sources.limit ?? 7) - rows.length));
  return [...rows, ...matches.map(({ score: _score, ...row }) => row)];
}
