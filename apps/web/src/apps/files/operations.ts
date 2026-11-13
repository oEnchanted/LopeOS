import type { FileEntry, FileService } from '../../../../../packages/contracts/src';

const TRASH_PATHS = ['/.Trash', '/LopeDrive/.Trash'];
const encoder = new TextEncoder();
const join = (parent: string, name: string) => `${parent === '/' ? '' : parent}/${name}`;
const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
const asError = (error: unknown) => error instanceof Error ? error : new Error('The file operation could not be completed.');

/** Workspace aliases are resolved before walking segments, so .. cannot escape home. */
export function normalizeWorkspacePath(value: string): string {
  if (typeof value !== 'string' || /[\\\x00-\x1f\x7f]/.test(value)) throw new Error('Choose a valid workspace path.');
  if (value === '~' || value.startsWith('~/')) value = value.slice(1) || '/';
  if (value === '/home/lope' || value.startsWith('/home/lope/')) value = value.slice('/home/lope'.length) || '/';
  if (!value.startsWith('/')) throw new Error('Use an absolute workspace path, such as /Documents or ~/Documents.');
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('The path cannot go outside the workspace.');
      parts.pop();
    } else parts.push(part);
  }
  return '/' + parts.join('/');
}

export function validateFileName(value: string): string {
  if (!value || value !== value.trim() || value === '.' || value === '..' || /[/\\\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Use a name without slashes, control characters, or leading or trailing spaces.');
  }
  if (encoder.encode(value).length > 255) throw new Error('This name is too long. Use 255 bytes or fewer.');
  return value;
}

function writablePath(value: string): string {
  const path = normalizeWorkspacePath(value);
  if (TRASH_PATHS.some(root => path === root || path.startsWith(root + '/'))) throw new Error('Use Move to Trash or Put Back to keep deleted items recoverable.');
  return path;
}

function truncateBytes(value: string, bytes: number): string {
  let length = 0;
  let result = '';
  for (const character of value) {
    length += encoder.encode(character).length;
    if (length > bytes) break;
    result += character;
  }
  return result;
}

/** Keeps an ordinary file extension, including .tar.gz, when making a sibling copy. */
export function uniqueCopyName(name: string, type: FileEntry['type'], occupied: ReadonlySet<string>): string {
  validateFileName(name);
  const extensionAt = type === 'directory' ? -1 : /\.tar\.(gz|bz2|xz|zst)$/i.test(name) ? name.toLowerCase().lastIndexOf('.tar.') : name.lastIndexOf('.');
  const extension = extensionAt > 0 ? name.slice(extensionAt) : '';
  const stem = extensionAt > 0 ? name.slice(0, extensionAt) : name;
  for (let index = 1; index <= 10000; index++) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`;
    // Reserve room for at least one stem character even for unusual long extensions.
    const safeExtension = truncateBytes(extension, 255 - encoder.encode(suffix).length - 4);
    const safeStem = truncateBytes(stem, 255 - encoder.encode(suffix + safeExtension).length);
    const candidate = safeStem + suffix + safeExtension;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error('Too many copies share this name. Rename the item before copying it.');
}

export interface TransferRecord { source: string; destination: string }
export interface TransferResult {
  completed: TransferRecord[];
  skipped: string[];
  failure?: Error;
  /** An attempted operation without an acknowledgement. Refresh before retrying it. */
  failed?: TransferRecord;
}
export interface TransferOptions { mode: 'copy' | 'move'; conflict: 'error' | 'keep-both' | 'skip' }
export interface TransferProgress { completed: number; total: number; name: string }
export class FileConflictError extends Error {
  readonly code = 'CONFLICT';
  readonly paths: string[];
  constructor(paths: string[]) {
    super(paths.length === 1 ? `“${paths[0].split('/').at(-1)}” already exists in this folder.` : `${paths.length} items already exist in this folder.`);
    this.name = 'FileConflictError';
    this.paths = paths;
  }
}

type CopyFileService = FileService & { copy?: (path: string, destination: string) => Promise<void> };
const queues = new WeakMap<FileService, Promise<unknown>>();

function serialize<T>(fs: FileService, operation: () => Promise<T>): Promise<T> {
  const task = (queues.get(fs) ?? Promise.resolve()).catch(() => {}).then(operation);
  queues.set(fs, task);
  void task.finally(() => { if (queues.get(fs) === task) queues.delete(fs); }).catch(() => {});
  return task;
}

/**
 * Preflight the whole batch before mutation. The runtime remains responsible for
 * atomic non-overwriting writes when another client changes a destination later.
 * A late failure stops the batch and leaves acknowledged successes explicit.
 */
export function transferEntries(
  fs: CopyFileService,
  entries: readonly FileEntry[],
  destination: string,
  options: TransferOptions,
  onProgress?: (progress: TransferProgress) => void,
): Promise<TransferResult> {
  return serialize(fs, async () => {
    const result: TransferResult = { completed: [], skipped: [] };
    let attempted: TransferRecord | undefined;
    try {
      if (!entries.length) return result;
      if (!['copy', 'move'].includes(options.mode) || !['error', 'keep-both', 'skip'].includes(options.conflict)) throw new Error('Choose a valid file operation.');
      if (options.mode === 'copy' && !fs.copy) throw new Error('Copying is unavailable. Update or reconnect the workspace runtime.');
      const folder = writablePath(destination);
      if ((await fs.stat(folder)).type !== 'directory') throw new Error('Choose an existing destination folder.');
      const sources = new Map<string, FileEntry>();
      for (const entry of entries) {
        const source = writablePath(entry.path);
        if (source === '/') throw new Error('The workspace itself cannot be moved or copied.');
        sources.set(source, entry);
      }
      // A folder carries its descendants. Never transfer a child twice when a
      // search or cross-window selection also contains its parent.
      const roots = [...sources.keys()].filter(source => ![...sources.keys()].some(other => source.startsWith(other + '/')));
      const current: FileEntry[] = [];
      for (const source of roots) {
        const entry = await fs.stat(source);
        if (entry.type === 'directory' && (folder === source || folder.startsWith(source + '/'))) throw new Error('Choose a destination outside the selected folder.');
        const name = source.split('/').at(-1)!;
        validateFileName(name);
        current.push({ ...entry, path: source, name });
      }
      const occupied = new Set((await fs.list(folder)).map(entry => entry.name));
      const planned: Array<TransferRecord & { name: string }> = [];
      const collisions: string[] = [];
      for (const entry of current) {
        if (options.mode === 'move' && parent(entry.path) === folder) { result.skipped.push(entry.path); continue; }
        let name = entry.name;
        if (occupied.has(name)) {
          if (options.conflict === 'skip') { result.skipped.push(entry.path); continue; }
          if (options.conflict === 'error') { collisions.push(join(folder, name)); continue; }
          name = uniqueCopyName(name, entry.type, occupied);
        }
        occupied.add(name);
        planned.push({ source: entry.path, destination: join(folder, name), name });
      }
      if (collisions.length) throw new FileConflictError(collisions);
      const progress = (name: string) => {
        try { onProgress?.({ completed: result.completed.length, total: planned.length, name }); }
        catch { /* Presentation cannot turn an acknowledged write into a failure. */ }
      };
      for (const operation of planned) {
        progress(operation.name);
        attempted = { source: operation.source, destination: operation.destination };
        if (options.mode === 'copy') await fs.copy!(operation.source, operation.destination);
        else await fs.rename(operation.source, operation.destination);
        result.completed.push(attempted);
        attempted = undefined;
        progress(operation.name);
      }
    } catch (error) {
      result.failure = asError(error);
      if (attempted) result.failed = attempted;
    }
    return result;
  });
}

/** Undo acknowledged moves only; it never removes copies or overwrites a new file. */
export function reverseMoves(fs: FileService, moves: readonly TransferRecord[]): Promise<TransferResult> {
  return serialize(fs, async () => {
    const result: TransferResult = { completed: [], skipped: [] };
    let attempted: TransferRecord | undefined;
    try {
      const operations = moves.map(move => ({ source: writablePath(move.destination), destination: writablePath(move.source) })).reverse();
      const destinations = new Set<string>();
      const sources = new Set<string>();
      for (const operation of operations) {
        if (operation.source === '/' || operation.destination === '/') throw new Error('The workspace itself cannot be moved.');
        if (sources.has(operation.source) || destinations.has(operation.destination)) throw new Error('This move history contains duplicate items.');
        sources.add(operation.source); destinations.add(operation.destination);
        const item = await fs.stat(operation.source);
        if (item.type === 'directory' && operation.destination.startsWith(operation.source + '/')) throw new Error('A folder cannot be moved inside itself.');
        if ((await fs.stat(parent(operation.destination))).type !== 'directory') throw new Error('The original folder is no longer available.');
        try {
          await fs.stat(operation.destination);
          throw new FileConflictError([operation.destination]);
        } catch (error) {
          const code = (error as { code?: string })?.code;
          if (code !== 'NOT_FOUND' && code !== 'ENOENT') throw error;
        }
      }
      for (const operation of operations) {
        attempted = operation;
        await fs.rename(operation.source, operation.destination);
        result.completed.push(operation);
        attempted = undefined;
      }
    } catch (error) {
      result.failure = asError(error);
      if (attempted) result.failed = attempted;
    }
    return result;
  });
}

export interface FileClipboardSnapshot { readonly mode: 'copy' | 'cut'; readonly entries: readonly FileEntry[] }
let snapshot: FileClipboardSnapshot | null = null;
const listeners = new Set<() => void>();
function publish(next: FileClipboardSnapshot | null) { snapshot = next; listeners.forEach(listener => listener()); }
function clipboardSnapshot(mode: FileClipboardSnapshot['mode'], entries: readonly FileEntry[]): FileClipboardSnapshot | null {
  const unique = new Map<string, FileEntry>();
  for (const entry of entries) {
    const path = writablePath(entry.path);
    if (path === '/') throw new Error('The workspace itself cannot be moved or copied.');
    unique.set(path, Object.freeze({ ...entry, path, name: path.split('/').at(-1)! }));
  }
  return unique.size ? Object.freeze({ mode, entries: Object.freeze([...unique.values()]) }) : null;
}

/** One in-memory clipboard shared by Files windows. It never writes device clipboard text. */
export const fileClipboard = {
  getSnapshot: (): FileClipboardSnapshot | null => snapshot,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  set(mode: FileClipboardSnapshot['mode'], entries: readonly FileEntry[]) { publish(clipboardSnapshot(mode, entries)); },
  clear() { if (snapshot) publish(null); },
  remove(paths: readonly string[]) {
    if (!snapshot) return;
    const removed = new Set(paths.map(normalizeWorkspacePath));
    const remaining = snapshot.entries.filter(entry => !removed.has(entry.path));
    if (remaining.length !== snapshot.entries.length) publish(clipboardSnapshot(snapshot.mode, remaining));
  },
};
