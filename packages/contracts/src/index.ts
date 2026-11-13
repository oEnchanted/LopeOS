import type { ComponentType } from 'react';

export const CONTRACT_VERSION = '1.0.0' as const;
export type Unsubscribe = () => void;
export interface Bounds { x: number; y: number; width: number; height: number }
export interface WindowState {
  id: string; appId: string; title: string; bounds: Bounds; restoreBounds?: Bounds;
  focused: boolean; zIndex: number; state: 'normal' | 'minimized' | 'maximized';
  launchArgs?: Record<string, unknown>; restoreArgs?: Record<string, unknown>;
}
export interface Command {
  id: `${string}.${string}`; label: string; shortcut?: string;
  enabled?: boolean | (() => boolean); checked?: boolean | (() => boolean);
  execute: () => void | Promise<void>;
}
export interface CommandRegistry {
  register(command: Command): Unsubscribe; get(id: string): Command | undefined;
  list(): Command[]; execute(id: string): Promise<void>;
}
export interface MenuDefinition { label: string; items: Array<string | { separator: true }> }
export interface AppManifest {
  contractVersion: 1; id: string; name: string; description: string; icon: string;
  entry: () => Promise<{ default: ComponentType<{ context: AppContext }> }>;
  defaultSize: { width: number; height: number }; minSize: { width: number; height: number };
  commands?: Command[]; menus?: MenuDefinition[]; fileAssociations?: string[];
  protocols?: string[]; singleton?: boolean;
  lifecycle?: { onLaunch?: (context: AppContext) => void; onQuit?: () => void | Promise<void> };
}
export interface FileEntry { name: string; path: string; type: 'file' | 'directory'; size: number; modified: string; version?: string }
/** Capacity of the volume backing the workspace, which may be shared with other data. */
export interface FileStorageInfo { totalBytes: number; usedBytes: number; availableBytes: number; scope: 'runtime-volume' }
export interface FileRead { content: string; version: string }
export interface WriteOptions { version?: string; createOnly?: boolean }
export interface FileService {
  list(path: string): Promise<FileEntry[]>; stat(path: string): Promise<FileEntry>;
  read(path: string): Promise<FileRead>; write(path: string, content: string, expectedVersion?: string | WriteOptions): Promise<FileRead>;
  create?(path: string, content: string): Promise<FileRead>;
  readBinary?(path: string): Promise<{ data: Uint8Array; version: string }>;
  writeBinary?(path: string, data: Uint8Array, options?: WriteOptions): Promise<{ version: string }>;
  move?(path: string, destination: string): Promise<void>;
  copy?(path: string, destination: string): Promise<void>;
  storage?(): Promise<FileStorageInfo>;
  mkdir(path: string): Promise<void>; rename(path: string, target: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean; version?: string }): Promise<void>; subscribe(callback: (path?: string) => void): Unsubscribe;
}
export interface TerminalSession { id: string; state: 'running' | 'closed'; cols: number; rows: number }
export type TerminalEvent = { type: 'output'; sessionId: string; data: string } | { type: 'exit'; sessionId: string; exitCode: number };
export interface TerminalService {
  create(options?: { cwd?: string; cols?: number; rows?: number }): Promise<TerminalSession>;
  attach(sessionId: string, listener: (event: TerminalEvent) => void): Unsubscribe;
  input(sessionId: string, data: string): Promise<void>; resize(sessionId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string): Promise<void>;
}
export interface BrowserTab { id: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
export interface BrowserSession { id: string; tabs: BrowserTab[]; activeTabId?: string }
export interface BrowserService {
  createSession(): Promise<BrowserSession>; createTab(sessionId: string, url?: string): Promise<BrowserTab>;
  closeTab(sessionId: string, tabId: string): Promise<void>; navigate(sessionId: string, tabId: string, url: string): Promise<void>;
  subscribe(sessionId: string, callback: (session: BrowserSession) => void): Unsubscribe;
  download(sessionId: string, tabId: string, path: string): Promise<void>; upload(sessionId: string, tabId: string, path: string): Promise<void>;
}
export interface AppearanceSettings { theme: 'light' | 'dark' | 'system'; wallpaper: string; reduceTransparency: boolean; reduceMotion: boolean; increaseContrast: boolean }
export interface SettingsService { get<T>(key: string, fallback: T): T; set<T>(key: string, value: T): void; subscribe(listener: () => void): Unsubscribe }
export interface Notification { id?: string; title: string; message: string; tone?: 'info' | 'success' | 'error' }
export interface StatusItem { id: string; label: string; icon?: string; onClick: () => void }
export interface SharedServices {
  commands: CommandRegistry; files: FileService; terminal: TerminalService; browser: BrowserService;
  settings: SettingsService; notify(notification: Notification): void;
  dialogs: { openFile(options?: { extensions?: string[] }): Promise<string | null>; saveFile(options?: { defaultName?: string }): Promise<string | null> };
  openURL(url: string): void; openFile(path: string): Promise<void>; launch(appId: string, args?: Record<string, unknown>): void;
  statusItems: { register(item: StatusItem): Unsubscribe };
}
export interface AppContext {
  windowId: string; launchArgs: Record<string, unknown>; services: SharedServices;
  lifecycle: { setTitle(title: string): void; close(): void; onBeforeClose(handler: () => boolean | Promise<boolean>): Unsubscribe };
}
export interface Wallpaper {
  id: string; name: string; asset: string; creator: string; sourceURL: string | null;
  thumbnail?: string;
  creditURL: string | null; permission: 'original' | 'authorized' | 'pending'; kind: 'light' | 'dark';
}
