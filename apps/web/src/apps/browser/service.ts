import type { BrowserService, BrowserSession, Unsubscribe } from '../../../../../packages/contracts/src';
import { BrowserClient } from '../../../../../packages/browser-client/src';
export const browserClient = new BrowserClient();
const shared = (state: Awaited<ReturnType<BrowserClient['get']>>): BrowserSession => ({
  id: state.id, tabs: state.tabs, activeTabId: state.activeTabId ?? undefined,
});
/** Compatibility adapter for Agent 1's SDK. All state is supplied by the engine. */
export function createBrowserService(): BrowserService {
  return {
    async createSession() { return shared(await browserClient.create()); },
    async createTab(sessionId, url) { const state = await browserClient.command(sessionId, { type: 'tab.create', url });
      return state.tabs.find(tab => tab.id === state.activeTabId)!; },
    async closeTab(sessionId, tabId) { await browserClient.command(sessionId, { type: 'tab.close', tabId }); },
    async navigate(sessionId, tabId, url) { await browserClient.command(sessionId, { type: 'navigate', tabId, input: url }); },
    subscribe(sessionId, callback): Unsubscribe { return browserClient.subscribe(sessionId, state => callback(shared(state))); },
    async download() { throw new Error('Downloads save automatically. Open the browser Downloads panel to view or cancel them.'); },
    async upload(sessionId, tabId, path) {
      const state = await browserClient.get(sessionId); const chooser = state.uploads.find(item => item.tabId === tabId);
      if (!chooser) throw new Error('Select a file input on the website first.');
      await browserClient.uploadWorkspace(sessionId, chooser.id, [path]);
    },
  };
}
