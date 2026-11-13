import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { AppContext, Command } from '../../../../packages/contracts/src';

/** Stable registrations read current state, so menu and keyboard handlers cannot go stale. */
export function useAppCommands(context: AppContext, commands: Command[]) {
  const latest = useRef(commands); latest.current = commands;
  const signature = commands.map(command => command.id).join('|');
  useEffect(() => {
    const releases = latest.current.map(command => context.services.commands.register({
      ...command,
      enabled: () => {
        const enabled = latest.current.find(item => item.id === command.id)?.enabled;
        return typeof enabled === 'function' ? enabled() : enabled !== false;
      },
      checked: command.checked === undefined ? undefined : () => {
        const checked = latest.current.find(item => item.id === command.id)?.checked;
        return typeof checked === 'function' ? checked() : Boolean(checked);
      },
      execute: () => latest.current.find(item => item.id === command.id)?.execute(),
    }));
    return () => releases.forEach(release => release());
  }, [context.services.commands, signature]);
}
export function usePreference<T>(context: AppContext, key: string, fallback: T): [T, (value: T) => void] {
  const { settings } = context.services;
  const value = useSyncExternalStore(settings.subscribe.bind(settings), () => settings.get<T>(key, fallback));
  return [value, (next: T) => settings.set(key, next)];
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'This action could not be completed.';
export const errorCode = (error: unknown) => error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
export const parentPath = (path: string) => path.split('/').slice(0, -1).join('/') || '/';
export const baseName = (path: string) => path.split('/').filter(Boolean).pop() || 'Home';
export function joinPath(path: string, name: string) {
  if (!name.trim() || name !== name.trim() || name === '.' || name === '..' || /[/\\\x00-\x1f]/.test(name)) throw new Error('Use a name without slashes or control characters.');
  return `${path === '/' ? '' : path}/${name}`;
}
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB']; let index = 0; bytes /= 1024;
  while (bytes >= 1024 && index < units.length - 1) { bytes /= 1024; index++; }
  return `${bytes.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[index]}`;
}
