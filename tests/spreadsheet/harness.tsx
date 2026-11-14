import React from "react";
import { createRoot } from "react-dom/client";
import Spreadsheet from "../../apps/web/src/apps/spreadsheet";
import { Commands } from "../../apps/web/src/shell/commands";
import { AppProvider } from "../../packages/sdk/src";
import { preferences as systemPreferences } from "../../packages/sdk/src/preferences";
import type { AppContext } from "../../packages/contracts/src";
import { createAnalyticsWorkbook } from "../../packages/spreadsheet-engine/src/fixtures";
import { serializeWorkbook } from "../../packages/spreadsheet-engine/src/io";
import { WorkbookEngine } from "../../packages/spreadsheet-engine/src/calculation";
import "../../packages/ui/src/styles.css";
import "../../apps/web/src/shell/materials.css";
const query = new URLSearchParams(location.search),
  files = new Map<string, { data: Uint8Array; version: string }>(),
  commands = new Commands();
const settingsListeners = new Set<() => void>();
const settings = {
  get: (key: string, fallback: unknown) => {
    try { return JSON.parse(localStorage.getItem("sheets-test." + key) ?? "null") ?? fallback; }
    catch { return fallback; }
  },
  set: (key: string, value: unknown) => {
    localStorage.setItem("sheets-test." + key, JSON.stringify(value));
    settingsListeners.forEach(listener => listener());
  },
  subscribe: (listener: () => void) => {
    settingsListeners.add(listener);
    return () => settingsListeners.delete(listener);
  },
};
window.addEventListener("storage", event => {
  if (event.key?.startsWith("sheets-test.")) settingsListeners.forEach(listener => listener());
});
(window as any).testSettings = settings;
(window as any).testSystemPreferences = systemPreferences;
for (const method of [
  "setCell",
  "batch",
  "transact",
  "applyCalculation",
] as const) {
  const original = WorkbookEngine.prototype[method];
  (WorkbookEngine.prototype[method] as any) = function (...args: any[]) {
    (window as any).sheetsTestEngine = this;
    return (original as any).apply(this, args);
  };
}
const context = {
  windowId: query.get("window") ?? "sheets-test",
  launchArgs: {},
  services: {
    commands,
    files: {
      readBinary: async (path: string) => {
        const f = files.get(path);
        if (!f) throw new Error("Not found");
        return f;
      },
      read: async (path: string) => {
        const f = files.get(path);
        if (!f) throw new Error("Not found");
        return {
          content: new TextDecoder().decode(f.data),
          version: f.version,
        };
      },
      writeBinary: async (path: string, data: Uint8Array, options: any) => {
        const existing = files.get(path);
        if (existing && options?.createOnly) throw new Error("File exists");
        if (options?.version && options.version !== existing?.version)
          throw new Error("Version conflict");
        const version = String(Date.now());
        files.set(path, { data, version });
        return { version };
      },
      stat: async (path: string) => {
        const f = files.get(path);
        if (!f) throw new Error("Not found");
        return { ...f, path };
      },
      subscribe: () => () => {},
    },
    settings,
    dialogs: {
      openFile: async () => (window as any).openPath ?? null,
      saveFile: async () =>
        (window as any).savePath ?? "/Documents/Test.lopebook",
    },
    notify: () => {},
    openURL: (url: string) => {
      (window as any).openedURL = url;
    },
    launch: () => {},
    statusItems: { register: () => () => {} },
  },
  lifecycle: {
    setTitle: (title: string) => {
      document.title = title;
    },
    onBeforeClose: (fn: unknown) => {
      (window as any).closeGuard = fn;
      return () => {};
    },
    close: () => {},
  },
} as unknown as AppContext;
if (query.get("fixture") === "analytics") {
  const workbook = createAnalyticsWorkbook(100000);
  files.set("/Analytics.lopebook", {
    data: new TextEncoder().encode(serializeWorkbook(workbook)),
    version: "1",
  });
  context.launchArgs.path = "/Analytics.lopebook";
  (window as any).fixtureReadyAt = performance.now();
}
(window as any).testCommands = commands;
(window as any).testFiles = files;
createRoot(document.getElementById("root")!).render(
  <AppProvider context={context}>
    <Spreadsheet context={context} />
  </AppProvider>,
);
