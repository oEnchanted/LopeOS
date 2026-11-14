/** Account manifests contain only logical keys and immutable content hashes. */
export interface SyncEntry { key: string; hash: string; size: number; modifiedAt: string }
export interface SyncPlan { entries: Map<string, SyncEntry>; conflicts: SyncEntry[] }
const same = (a?: SyncEntry, b?: SyncEntry) => a?.hash === b?.hash;

/** Three-way merge: unchanged devices accept remote changes, including deletions.
 * A concurrent local edit is retained as a conflict copy before remote is applied.
 * An unavailable scope is never interpreted as a mass local deletion. */
export function mergeEntries(base: Map<string, SyncEntry>, local: Map<string, SyncEntry>, remote: Map<string, SyncEntry>, available: (key: string) => boolean = () => true): SyncPlan {
  const entries = new Map<string, SyncEntry>(), conflicts: SyncEntry[] = [];
  for (const key of new Set([...base.keys(), ...local.keys(), ...remote.keys()])) {
    const b = base.get(key), l = local.get(key), r = remote.get(key);
    let winner: SyncEntry | undefined;
    if (!available(key)) winner = r;
    else if (same(l, r)) winner = r ?? l;
    else if (same(l, b)) winner = r;
    else if (same(r, b)) winner = l;
    else {
      // Retain an edit that competes with a deletion. When both exist, keep the
      // server's canonical record and preserve this device's version separately.
      winner = r ?? l;
      if (l && r) conflicts.push(l);
    }
    if (winner) entries.set(key, winner);
  }
  return { entries, conflicts };
}
export function manifestsEqual(a: Map<string, SyncEntry>, b: Map<string, SyncEntry>): boolean {
  return a.size === b.size && [...a].every(([key, value]) => same(value, b.get(key)));
}
export function validEntry(value: unknown): value is SyncEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as SyncEntry;
  return typeof e.key === 'string' && e.key.length > 0 && e.key.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(e.key)
    && /^[a-f0-9]{64}$/.test(e.hash) && Number.isSafeInteger(e.size) && e.size >= 0 && e.size <= 1024 * 1024 * 1024 + 28
    && typeof e.modifiedAt === 'string' && Number.isFinite(Date.parse(e.modifiedAt));
}
export function entryMap(entries: unknown): Map<string, SyncEntry> {
  if (!Array.isArray(entries) || !entries.every(validEntry)) throw new Error('The account manifest is invalid. Local data has not been replaced.');
  const map = new Map(entries.map(entry => [entry.key, entry]));
  if (map.size !== entries.length) throw new Error('The account manifest contains duplicate records.');
  return map;
}

export const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
/** A retained child keeps its ancestors alive. A file competing with a directory
 * becomes a conflict copy, so no destructive type replacement loses content. */
export function normalizeFileTopology(plan: SyncPlan): SyncPlan {
  const conflict = (entry: SyncEntry) => { if (!plan.conflicts.some(other => other.key === entry.key && other.hash === entry.hash)) plan.conflicts.push(entry); };
  for (const entry of [...plan.entries.values()]) {
    const match = /^(drive|workspace):(file|directory):(\/.*)$/.exec(entry.key);
    if (!match) continue;
    const [, scope, type, path] = match;
    if (type === 'directory') {
      const fileKey = `${scope}:file:${path}`, file = plan.entries.get(fileKey);
      if (file) { conflict(file); plan.entries.delete(fileKey); }
    }
    const parts = path.split('/').slice(1, -1); let parent = '';
    for (const part of parts) {
      parent += '/' + part;
      if (scope === 'drive' && parent === '/LopeDrive') continue;
      const directoryKey = `${scope}:directory:${parent}`, fileKey = `${scope}:file:${parent}`, file = plan.entries.get(fileKey);
      if (file) { conflict(file); plan.entries.delete(fileKey); }
      if (!plan.entries.has(directoryKey)) plan.entries.set(directoryKey, { key: directoryKey, hash: EMPTY_HASH, size: 0, modifiedAt: entry.modifiedAt });
    }
  }
  return plan;
}
