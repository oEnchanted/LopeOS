import type { FileEntry, FileService } from '../../../../packages/contracts/src';

export const TRASH_PATH = '/.Trash';
export const DRIVE_TRASH_PATH = '/LopeDrive/.Trash';
export interface TrashEntry extends FileEntry {
  id: string;
  originalPath?: string;
  deletedAt: string;
}
export interface TrashListing {
  entries: TrashEntry[];
  unavailable: { root: string; message: string }[];
}

interface TrashMetadata { schema: 1; originalPath: string; deletedAt: string }
const itemId = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const queues = new WeakMap<FileService, Promise<unknown>>();
const code = (error: unknown) => (error as { code?: string } | null)?.code;
const missing = (error: unknown) => code(error) === 'NOT_FOUND' || code(error) === 'ENOENT';

// Keep local operations in order. The runtime also serializes writes and provides
// atomic, non-overwriting rename, including across browser tabs.
function mutate<T>(fs: FileService, operation: () => Promise<T>): Promise<T> {
  const pending = (queues.get(fs) ?? Promise.resolve()).catch(() => {}).then(operation);
  queues.set(fs, pending);
  void pending.finally(() => { if (queues.get(fs) === pending) queues.delete(fs); }).catch(() => {});
  return pending;
}

function workspacePath(value: string): string {
  if (value === '/home/lope' || value.startsWith('/home/lope/')) value = value.slice('/home/lope'.length) || '/';
  if (!value.startsWith('/') || value.includes('\0') || value.includes('\\') || value.split('/').includes('..')) throw new Error('Choose a valid workspace path.');
  return '/' + value.split('/').filter(part => part && part !== '.').join('/');
}

function recoverablePath(value: string): string {
  const path = workspacePath(value);
  if (path === '/' || path === '/LopeDrive' || [TRASH_PATH, DRIVE_TRASH_PATH].some(root => path === root || path.startsWith(root + '/'))) throw new Error('The workspace, LopeDrive, and Trash cannot be moved to Trash.');
  return path;
}

function bucketPath(entry: TrashEntry): string {
  if (!itemId.test(entry.id)) throw new Error('This Trash item is invalid.');
  const trashRoot = entry.path.startsWith(DRIVE_TRASH_PATH + '/') ? DRIVE_TRASH_PATH : TRASH_PATH;
  const bucket = `${trashRoot}/${entry.id}`;
  const path = workspacePath(entry.path);
  const content = `${bucket}/content/`;
  if (path !== entry.path || !path.startsWith(content) || !path.slice(content.length) || path.slice(content.length).includes('/')) throw new Error('This item is outside Trash.');
  return bucket;
}

async function ensureTrash(fs: FileService, trashRoot = TRASH_PATH): Promise<void> {
  try { await fs.mkdir(trashRoot); }
  catch (error) {
    if (code(error) !== 'CONFLICT' && code(error) !== 'EEXIST') throw error;
    if ((await fs.stat(trashRoot)).type !== 'directory') throw new Error('The Trash location is occupied by a file.');
  }
}

async function metadata(fs: FileService, bucket: string): Promise<TrashMetadata | undefined> {
  let text: string;
  try { text = (await fs.read(`${bucket}/metadata.json`)).content; }
  catch (error) { if (missing(error)) return; throw error; }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return; }
  if (!value || typeof value !== 'object') return;
  const data = value as Partial<TrashMetadata>;
  if (data.schema !== 1 || typeof data.originalPath !== 'string' || typeof data.deletedAt !== 'string' || !Number.isFinite(Date.parse(data.deletedAt))) return;
  try { if (recoverablePath(data.originalPath) !== data.originalPath) return; } catch { return; }
  return data as TrashMetadata;
}

// Only remove empty bookkeeping directories. Never recursively clean a bucket:
// another client may have added content, or a failed request may have committed.
async function cleanBucket(fs: FileService, bucket: string): Promise<void> {
  try {
    await fs.remove(`${bucket}/content`, { recursive: false });
    await fs.remove(`${bucket}/metadata.json`, { recursive: false }).catch(error => { if (!missing(error)) throw error; });
    await fs.remove(bucket, { recursive: false });
  } catch { /* The item is already restored/deleted; stale bookkeeping is harmless. */ }
}

export function moveToTrash(fs: FileService, value: string): Promise<TrashEntry> {
  return mutate(fs, async () => {
    const path = recoverablePath(value);
    const original = await fs.stat(path);
    const trashRoot = path.startsWith('/LopeDrive/') ? DRIVE_TRASH_PATH : TRASH_PATH;
    await ensureTrash(fs, trashRoot);
    const id = crypto.randomUUID();
    const bucket = `${trashRoot}/${id}`;
    const destination = `${bucket}/content/${path.split('/').at(-1)!}`;
    const deletedAt = new Date().toISOString();
    await fs.mkdir(bucket);
    await fs.mkdir(`${bucket}/content`);
    // Persist recovery information before moving any user data.
    await fs.write(`${bucket}/metadata.json`, JSON.stringify({ schema: 1, originalPath: path, deletedAt } satisfies TrashMetadata), { createOnly: true });
    await fs.rename(path, destination);
    return { ...original, path: destination, id, originalPath: path, deletedAt };
  });
}

export async function listTrash(fs: FileService, trashRoot = TRASH_PATH): Promise<TrashEntry[]> {
  let buckets: FileEntry[];
  try { buckets = await fs.list(trashRoot); }
  catch (error) { if (missing(error)) return []; throw error; }
  const entries: TrashEntry[] = [];
  // A small worker pool avoids flooding the runtime for larger Trash folders.
  const pending = buckets.filter(entry => entry.type === 'directory' && itemId.test(entry.name));
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (index < pending.length) {
      const bucket = pending[index++];
      let contents: FileEntry[];
      try { contents = await fs.list(`${bucket.path}/content`); }
      catch (error) { if (missing(error)) continue; throw error; }
      if (!contents.length) continue;
      const info = await metadata(fs, bucket.path);
      for (const entry of contents) {
        const originalPath = info?.originalPath.split('/').at(-1) === entry.name ? info.originalPath : undefined;
        entries.push({ ...entry, id: bucket.name, originalPath, deletedAt: info?.deletedAt ?? bucket.modified });
      }
    }
  }));
  return entries.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt) || a.name.localeCompare(b.name));
}

/** Ordinary Trash combines both volumes; an explicit root keeps its volume scope. */
export async function readTrash(fs: FileService, trashRoot?: string): Promise<TrashListing> {
  const roots = trashRoot ? [trashRoot] : [TRASH_PATH, DRIVE_TRASH_PATH];
  const results = await Promise.allSettled(roots.map(root => listTrash(fs, root)));
  const entries: TrashEntry[] = [], unavailable: TrashListing['unavailable'] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') entries.push(...result.value);
    else unavailable.push({ root: roots[index], message: result.reason instanceof Error ? result.reason.message : 'This Trash location could not be loaded.' });
  }
  if (unavailable.length === roots.length) throw new Error(unavailable.map(location => location.message).join(' '));
  return { entries: entries.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt) || a.name.localeCompare(b.name)), unavailable };
}

export function trashAvailabilityMessage(unavailable: TrashListing['unavailable']): string {
  return unavailable.length ? `${unavailable.map(location => location.root === DRIVE_TRASH_PATH ? 'LopeDrive Trash' : 'Workspace Trash').join(' and ')} is unavailable. Showing items from available locations only.` : '';
}

export function restoreTrashItem(fs: FileService, entry: TrashEntry): Promise<string> {
  return mutate(fs, async () => {
    const bucket = bucketPath(entry);
    const info = await metadata(fs, bucket);
    if (!info || info.originalPath.split('/').at(-1) !== entry.path.split('/').at(-1)) throw new Error('The original location is unavailable for this item.');
    const parent = info.originalPath.slice(0, info.originalPath.lastIndexOf('/')) || '/';
    try { if ((await fs.stat(parent)).type !== 'directory') throw new Error('The original folder is no longer available.'); }
    catch (error) { if (missing(error)) throw new Error('The original folder is no longer available. Recreate it before putting this item back.'); throw error; }
    try { await fs.rename(entry.path, info.originalPath); }
    catch (error) { if (code(error) === 'CONFLICT' || code(error) === 'EEXIST') throw new Error(`“${entry.name}” already exists in its original folder. Rename or move that item before putting this one back.`); throw error; }
    await cleanBucket(fs, bucket);
    return info.originalPath;
  });
}

async function removeItem(fs: FileService, entry: TrashEntry): Promise<void> {
  const bucket = bucketPath(entry);
  await fs.remove(entry.path, { recursive: true });
  await cleanBucket(fs, bucket);
}

export function removeTrashItem(fs: FileService, entry: TrashEntry): Promise<void> {
  return mutate(fs, () => removeItem(fs, entry));
}

export function emptyTrash(fs: FileService, selection: string | readonly TrashEntry[] = TRASH_PATH): Promise<void> {
  const snapshot = typeof selection === 'string' ? undefined : [...selection];
  return mutate(fs, async () => {
    // UIs pass the confirmed snapshot, so new arrivals or recovered volumes survive.
    const entries = snapshot ?? await listTrash(fs, selection as string);
    for (const entry of entries) {
      try { await removeItem(fs, entry); } catch (error) { if (!missing(error)) throw error; }
    }
  });
}
