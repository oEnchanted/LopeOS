import type { FileEntry, FileService } from '../../contracts/src/index.ts';
import { isLopeDrivePath, LOPE_DRIVE, lopeDriveFiles } from './lope-drive.ts';

type BinaryFiles = FileService & Required<Pick<FileService, 'readBinary' | 'writeBinary' | 'copy' | 'move' | 'create'>>;
/** Mount LopeDrive for every application and the shared open/save dialogs. */
export function mountLopeDrive<T extends BinaryFiles>(runtime: T, local: BinaryFiles = lopeDriveFiles) {
  const provider = (path: string): BinaryFiles => isLopeDrivePath(path) ? local : runtime;
  async function transfer(path: string, destination: string, move: boolean) {
    const source = provider(path), target = provider(destination);
    if (path === LOPE_DRIVE || destination === LOPE_DRIVE) throw new Error('The LopeDrive root cannot be moved or replaced.');
    if (source === target) return move ? source.rename(path, destination) : source.copy(path, destination);
    // Cross-volume moves retain their source until every copy is confirmed.
    const copied: { entry: FileEntry; version?: string; children?: string[] }[] = [];
    async function copyTree(from: string, to: string) {
      const entry = await source.stat(from);
      if (entry.type === 'directory') {
        const children = await source.list(from);
        await target.mkdir(to); copied.push({ entry, children: children.map(child => child.path).sort() });
        for (const child of children) await copyTree(child.path, to + '/' + child.name);
      } else {
        const file = await source.readBinary(from);
        await target.writeBinary(to, file.data, { createOnly: true });
        copied.push({ entry, version: file.version });
      }
    }
    await copyTree(path, destination);
    if (move) {
      for (const { entry, version, children } of copied) {
        const current = await source.stat(entry.path);
        if (current.type !== entry.type || (version && (await source.readBinary(entry.path)).version !== version) || (children && JSON.stringify((await source.list(entry.path)).map(child => child.path).sort()) !== JSON.stringify(children))) throw new Error('The source changed during copying. Both copies were kept.');
      }
      for (const { entry, version } of [...copied].reverse()) {
        if (version && (await source.readBinary(entry.path)).version !== version) throw new Error('The source changed during moving. The changed file and destination copy were kept.');
        await source.remove(entry.path, { recursive: false, ...(version ? { version } : {}) });
      }
    }
  }
  return {
    ...runtime,
    async list(path: string) {
      if (path !== '/') return provider(path).list(path);
      const entries = await runtime.list(path);
      if (entries.some(entry => entry.path === LOPE_DRIVE)) return entries;
      return [...entries, await local.stat(LOPE_DRIVE)];
    },
    stat: (path: string) => provider(path).stat(path),
    read: (path: string) => provider(path).read(path),
    readBinary: (path: string) => provider(path).readBinary(path),
    write: (path: string, content: string, options?: Parameters<FileService['write']>[2]) => provider(path).write(path, content, options),
    writeBinary: (path: string, data: Uint8Array, options?: Parameters<BinaryFiles['writeBinary']>[2]) => provider(path).writeBinary(path, data, options),
    create: (path: string, content: string) => provider(path).create(path, content),
    mkdir: (path: string) => provider(path).mkdir(path),
    remove: (path: string, options?: { recursive?: boolean; version?: string }) => provider(path).remove(path, options),
    rename: (path: string, destination: string) => transfer(path, destination, true),
    move: (path: string, destination: string) => transfer(path, destination, true),
    copy: (path: string, destination: string) => transfer(path, destination, false),
    subscribe(callback: (path?: string) => void, onError?: (error: Error) => void) {
      const remote = (runtime.subscribe as (cb: (path?: string) => void, onError?: (error: Error) => void) => () => void)(callback, onError);
      const unwatch = local.subscribe(callback);
      return () => { remote(); unwatch(); };
    },
  };
}
