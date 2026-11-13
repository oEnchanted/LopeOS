import { fileService } from '../../../../packages/runtime-client/src/index.ts';
import type { FileEntry } from '../../../../packages/contracts/src/index.ts';

export type WorkspaceBackupEntry = { path: string; type: 'directory' } | { path: string; type: 'file'; data: string };
export interface WorkspaceBackupData { version: 1; entries: WorkspaceBackupEntry[] }
export type BackupProgress = (message: string) => void;
export type WorkspaceBackupService = Pick<typeof fileService, 'list' | 'stat' | 'readBinary' | 'writeBinary' | 'mkdir' | 'remove'>;
export const MAX_WORKSPACE_BACKUP_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 10_000;
const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
const depth = (path: string) => path.split('/').length;
const message = (error: unknown) => error instanceof Error ? error.message : 'The workspace request failed.';
const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'NOT_FOUND';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function validPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > 4096 || !path.startsWith('/') || path === '/' || /[\u0000-\u001f\u007f\\]/.test(path)) return false;
  // The runtime reserves /home/lope as an alias for /. Do not permit aliases in an archive.
  if (path === '/home/lope' || path.startsWith('/home/lope/')) return false;
  const parts = path.slice(1).split('/');
  return parts.length <= 64 && parts.every(part => part !== '' && part !== '.' && part !== '..' && new TextEncoder().encode(part).length <= 255);
}
function encode(data: Uint8Array) {
  let text = '';
  for (let index = 0; index < data.length; index += 16384) text += String.fromCharCode(...data.subarray(index, index + 16384));
  return btoa(text);
}
function decode(data: string) { return Uint8Array.from(atob(data), character => character.charCodeAt(0)); }
function fileBytes(data: unknown): number {
  const invalid = () => new Error('The backup contains invalid or oversized file data. Files must be at most 8 MiB.');
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(data)) throw invalid();
  let binary: string;
  try { binary = atob(data); } catch { throw invalid(); }
  if (binary.length > MAX_FILE_BYTES || btoa(binary) !== data) throw invalid();
  return binary.length;
}

/** Validates the complete tree before an import can issue any filesystem writes. */
export function validateWorkspaceData(input: unknown): WorkspaceBackupData {
  if (!object(input) || input.version !== 1 || !Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES || Object.keys(input).some(key => key !== 'version' && key !== 'entries')) throw new Error('This workspace backup format is not supported.');
  const entries: WorkspaceBackupEntry[] = [], paths = new Map<string, WorkspaceBackupEntry>();
  let size = 0;
  for (const value of input.entries) {
    if (!object(value) || !validPath(value.path) || (value.type !== 'file' && value.type !== 'directory') || Object.keys(value).some(key => !['path', 'type', ...(value.type === 'file' ? ['data'] : [])].includes(key))) throw new Error('The backup contains an invalid workspace path or entry.');
    if (paths.has(value.path)) throw new Error('The backup contains duplicate workspace paths.');
    if (value.type === 'file') fileBytes(value.data);
    const entry: WorkspaceBackupEntry = value.type === 'file' ? { path: value.path, type: 'file', data: value.data as string } : { path: value.path, type: 'directory' };
    size += entry.path.length * 2 + 64 + (entry.type === 'file' ? entry.data.length : 0);
    if (size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('Workspace files exceed the 256 MiB backup limit. Export large files separately in Files.');
    entries.push(entry); paths.set(entry.path, entry);
  }
  for (const entry of entries) if (parent(entry.path) !== '/' && paths.get(parent(entry.path))?.type !== 'directory') throw new Error('The backup is missing a parent folder or places a file inside another file.');
  return { version: 1, entries };
}

export function summarizeWorkspaceData(data: WorkspaceBackupData) {
  return { files: data.entries.filter(entry => entry.type === 'file').length, folders: data.entries.filter(entry => entry.type === 'directory').length, bytes: data.entries.reduce((sum, entry) => sum + (entry.type === 'file' ? fileBytes(entry.data) : 0), 0) };
}

/** Includes hidden entries. Unsupported/unreadable files abort the export instead of being omitted. */
export async function captureWorkspaceData(onProgress?: BackupProgress, service: WorkspaceBackupService = fileService): Promise<WorkspaceBackupData> {
  const entries: WorkspaceBackupEntry[] = [], directories = ['/'], seen = new Set<string>();
  let size = 0;
  for (let index = 0; index < directories.length; index++) {
    const folder = directories[index];
    onProgress?.(`Reading workspace folder ${folder}`);
    let children: FileEntry[];
    try { children = await service.list(folder); }
    catch (error) { throw new Error(`Could not back up ${folder}: ${message(error)} No backup was downloaded.`); }
    for (const child of children) {
      if (!validPath(child.path) || parent(child.path) !== folder || seen.has(child.path)) throw new Error(`The workspace returned an unsupported path in ${folder}. No backup was downloaded.`);
      seen.add(child.path);
      if (seen.size > MAX_ENTRIES) throw new Error('Workspace files exceed the 10,000-entry backup limit. No backup was downloaded.');
      let entry: WorkspaceBackupEntry;
      if (child.type === 'directory') { entry = { path: child.path, type: 'directory' }; directories.push(child.path); }
      else if (child.type === 'file') {
        if (child.size > MAX_FILE_BYTES) throw new Error(`${child.path} exceeds the workspace’s 8 MiB file transfer limit. Download this file separately or choose a browser-data-only backup. No backup was downloaded.`);
        onProgress?.(`Reading ${child.path}`);
        try {
          const file = await service.readBinary(child.path);
          if (file.data.byteLength > MAX_FILE_BYTES) throw new Error('The file exceeds the 8 MiB transfer limit.');
          entry = { path: child.path, type: 'file', data: encode(file.data) };
        } catch (error) { throw new Error(`Could not back up ${child.path}: ${message(error)} No backup was downloaded.`); }
      } else throw new Error(`${child.path} is a link or special file and cannot be included in a workspace backup. No backup was downloaded.`);
      size += entry.path.length * 2 + 64 + (entry.type === 'file' ? entry.data.length : 0);
      if (size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('Workspace files exceed the 256 MiB backup limit. Export large files separately in Files. No backup was downloaded.');
      entries.push(entry);
    }
  }
  return validateWorkspaceData({ version: 1, entries });
}

/** Adds missing files and folders; existing content is never overwritten. */
export async function restoreWorkspaceData(input: WorkspaceBackupData, onProgress?: BackupProgress, service: WorkspaceBackupService = fileService): Promise<{ rollback: () => Promise<void> }> {
  const data = validateWorkspaceData(input), absent = new Set<string>();
  const ordered = [...data.entries].sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));
  const created: Array<{ path: string; type: 'directory' } | { path: string; type: 'file'; version: string }> = [];
  // Preflight every collision before the first mutation. An identical file is already restored.
  for (const entry of ordered) {
    onProgress?.(`Checking ${entry.path}`);
    if (absent.has(parent(entry.path))) { absent.add(entry.path); continue; }
    let existing: FileEntry;
    try { existing = await service.stat(entry.path); }
    catch (error) { if (missing(error)) { absent.add(entry.path); continue; } throw new Error(`Could not check ${entry.path}: ${message(error)} No workspace files were changed.`); }
    if (existing.type !== entry.type) throw new Error(`Import conflicts with ${entry.path}. Move the existing item or import into a new workspace. No workspace files were changed.`);
    if (entry.type === 'file') {
      let current: Awaited<ReturnType<WorkspaceBackupService['readBinary']>>;
      try { current = await service.readBinary(entry.path); }
      catch (error) { throw new Error(`Could not compare ${entry.path}: ${message(error)} No workspace files were changed.`); }
      if (encode(current.data) !== entry.data) throw new Error(`Import conflicts with ${entry.path}. Move the existing file or import into a new workspace. No workspace files were changed.`);
    }
  }
  const rollback = async () => {
    const remaining: string[] = [];
    for (const entry of [...created].reverse()) {
      try {
        if (entry.type === 'file') {
          const current = await service.readBinary(entry.path);
          if (current.version !== entry.version) { remaining.push(entry.path); continue; }
        }
        // Never recursively remove a directory: another tab may have added content.
        await service.remove(entry.path, { recursive: false });
      } catch (error) { if (!missing(error)) remaining.push(entry.path); }
    }
    if (remaining.length) throw new Error(`Some imported items could not be removed: ${remaining.slice(0, 3).join(', ')}${remaining.length > 3 ? '…' : ''}. Check Files before retrying.`);
    created.length = 0;
  };
  let currentPath = '';
  try {
    for (const entry of ordered) {
      if (!absent.has(entry.path)) continue;
      currentPath = entry.path; onProgress?.(`Restoring ${entry.path}`);
      if (entry.type === 'directory') { await service.mkdir(entry.path); created.push({ path: entry.path, type: 'directory' }); }
      else {
        const result = await service.writeBinary(entry.path, decode(entry.data), { createOnly: true });
        created.push({ path: entry.path, type: 'file', version: result.version });
      }
    }
    return { rollback };
  } catch (error) {
    let cleanup = '';
    try { await rollback(); } catch (cause) { cleanup = ` ${message(cause)}`; }
    // A lost response can leave the last creation unacknowledged. Do not delete an unowned path.
    throw new Error(`Import stopped at ${currentPath}: ${message(error)} Existing files were preserved. Check this path in Files before retrying; a failed connection may have left a new item.${cleanup}`);
  }
}
