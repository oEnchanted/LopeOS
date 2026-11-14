/** Lope Browser v1 integration contracts. Browser metadata comes from Chromium. */
export const BROWSER_APP_ID = 'lope.browser' as const;
export type BrowserMode = 'normal' | 'private';
export type SearchProvider = 'duckduckgo' | 'google' | 'bing';
export interface BrowserTab {
  id: string; url: string; title: string; favicon?: string; pinned: boolean;
  loading: boolean; canGoBack: boolean; canGoForward: boolean; zoom: number;
  openerId?: string; error?: { kind: 'certificate' | 'crashed' | 'navigation'; message: string };
}
export interface BrowserVisit { id: string; url: string; title: string; visitedAt: number }
export interface BrowserBookmark { id: string; url: string; title: string; createdAt: number }
export interface BrowserTransfer {
  id: string; name: string; receivedBytes: number; totalBytes: number;
  state: 'progress' | 'importing' | 'completed' | 'failed' | 'canceled';
  fileId?: string; error?: string;
}
export interface BrowserPermission {
  id: string; tabId: string; origin: string;
  kind: 'geolocation' | 'notifications' | 'camera' | 'microphone' | 'clipboard';
  supported: boolean; explanation: string;
}
export interface BrowserUpload { id: string; tabId: string; multiple: boolean }
export interface BrowserSession {
  hosting?: { remote: true; accountId: string | null; profile: 'server' };
  generation: string;
  revision: number;
  id: string; mode: BrowserMode; status: 'connecting' | 'ready' | 'crashed';
  tabs: BrowserTab[]; activeTabId: string | null;
  history: BrowserVisit[]; bookmarks: BrowserBookmark[]; downloads: BrowserTransfer[];
  uploads: BrowserUpload[]; permissions: BrowserPermission[];
  searchProvider: SearchProvider; engineVersion: string;
  /** Same-origin, authenticated Selkies core URL; never an arbitrary website. */
  streamUrl: string | null;
  capabilities: { stream: boolean; audio: boolean; deviceForwarding: boolean; workspaceFiles: boolean };
}
export type BrowserCommand =
  | { type: 'tab.create'; url?: string }
  | { type: 'tab.close' | 'tab.activate' | 'tab.duplicate'; tabId: string }
  | { type: 'tab.pin'; tabId: string; pinned: boolean }
  | { type: 'tab.reorder'; tabId: string; index: number }
  | { type: 'tab.reopen' }
  | { type: 'navigate'; tabId: string; input: string }
  | { type: 'back' | 'forward' | 'reload' | 'stop' | 'home' | 'print' | 'devtools'; tabId: string }
  | { type: 'zoom'; tabId: string; value: number }
  | { type: 'find'; tabId: string; text: string; forward?: boolean }
  | { type: 'paste'; tabId: string; text: string }
  | { type: 'bookmark.add'; tabId: string }
  | { type: 'bookmark.remove'; id: string }
  | { type: 'download.cancel'; id: string }
  | { type: 'permission.respond'; id: string; allow: boolean }
  | { type: 'upload.cancel'; id: string }
  | { type: 'settings'; searchProvider: SearchProvider }
  | { type: 'data.clear' }
  | { type: 'engine.restart' };

/** Agent 2: pass an already-authorized bridge on the server. Never exposed to websites. */
export interface BrowserFileBridge {
  importDownload(input: { sessionId: string; transferId: string; name: string; path: string; signal: AbortSignal }): Promise<{ fileId: string }>;
  materializeUpload(input: { sessionId: string; fileId: string; destination: string }): Promise<{ path: string }>;
}
/** Agent 1: inject shared UI and URL/files services without coupling the engine to the shell. */
export interface BrowserShellBridge {
  openInHost(url: string): void;
  showInFiles(fileId: string): void;
  chooseWorkspaceFile?(options: { multiple: boolean }): Promise<string[]>;
  onOpenUrl?(handler: (url: string) => void): () => void;
}
export interface BrowserMenuItem { label: string; shortcut?: string; action: string; disabled?: boolean }
export interface BrowserMenuContribution { label: string; items: BrowserMenuItem[] }
