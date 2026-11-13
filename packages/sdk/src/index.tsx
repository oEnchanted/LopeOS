import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AppContext, Command } from '../../contracts/src';

const Context = createContext<AppContext | null>(null);
export function AppProvider({ context, children }: { context: AppContext; children: ReactNode }) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export function useApp() {
  const context = useContext(Context);
  if (!context) throw new Error('useApp must be used inside an AppProvider.');
  return context;
}
export function useCommand(command: Command) {
  const { services } = useApp();
  useEffect(() => services.commands.register(command), [services.commands, command]);
}
export function useBeforeClose(callback: () => boolean | Promise<boolean>) {
  const { lifecycle } = useApp();
  useEffect(() => lifecycle.onBeforeClose(callback), [lifecycle, callback]);
}
export type { AppManifest, AppContext, SharedServices, Command, FileService } from '../../contracts/src';
