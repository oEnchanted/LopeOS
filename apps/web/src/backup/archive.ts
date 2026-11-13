import { ACCOUNT_SESSION_KEY } from '../../../../packages/sdk/src/accounts';
import { captureLocalData, restoreLocalData, summarizeLocalData, validateLocalData, type LocalBackupData } from './local-data';
import { captureWorkspaceData, restoreWorkspaceData, validateWorkspaceData, type WorkspaceBackupData } from './workspace-data';

export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
export interface LopeBackup {
  format: 'lopeos-backup';
  version: 1;
  createdAt: string;
  local: LocalBackupData;
  workspace: WorkspaceBackupData | null;
}
type Progress = (message: string) => void;

export function validateBackup(value: unknown): LopeBackup {
  if (!value || typeof value !== 'object') throw new Error('Choose a LopeOS backup file.');
  const backup = value as LopeBackup;
  if (backup.format !== 'lopeos-backup') throw new Error('This is not a LopeOS backup. Preference exports can be imported from Settings → General.');
  if (backup.version !== 1) throw new Error('This backup version is not supported by this LopeOS installation.');
  if (typeof backup.createdAt !== 'string' || !Number.isFinite(Date.parse(backup.createdAt))) throw new Error('The backup date is invalid.');
  return {
    format: 'lopeos-backup', version: 1, createdAt: backup.createdAt,
    local: validateLocalData(backup.local),
    workspace: backup.workspace === null ? null : validateWorkspaceData(backup.workspace),
  };
}

export async function readBackup(file: File): Promise<LopeBackup> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('This backup exceeds the 256 MiB import limit.');
  let data: unknown;
  try { data = JSON.parse(await file.text()); }
  catch { throw new Error('The backup could not be read. Choose an intact LopeOS backup file.'); }
  return validateBackup(data);
}

export async function createBackup(includeWorkspace: boolean, progress: Progress): Promise<LopeBackup> {
  progress('Collecting accounts, settings, photos, and recovery drafts…');
  const local = await captureLocalData();
  const workspace = includeWorkspace ? await captureWorkspaceData(progress) : null;
  return validateBackup({ format: 'lopeos-backup', version: 1, createdAt: new Date().toISOString(), local, workspace });
}

export function downloadBackup(backup: LopeBackup) {
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) throw new Error('The backup exceeds the 256 MiB limit. Download large workspace files separately, then export browser data with workspace files unchecked.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lopeos-backup-${backup.createdAt.replace(/[:.]/g, '-')}.lopeos.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function backupSummary(backup: LopeBackup) {
  const local = summarizeLocalData(backup.local);
  return { ...local, files: backup.workspace?.entries.filter(entry => entry.type === 'file').length ?? 0,
    folders: backup.workspace?.entries.filter(entry => entry.type === 'directory').length ?? 0 };
}

export async function restoreBackup(input: LopeBackup, progress: Progress) {
  const backup = validateBackup(input);
  // End the old session before replacing accounts; recover it if import fails.
  const previousSession = sessionStorage.getItem(ACCOUNT_SESSION_KEY);
  sessionStorage.removeItem(ACCOUNT_SESSION_KEY);
  let workspace: Awaited<ReturnType<typeof restoreWorkspaceData>> | undefined;
  try {
    if (backup.workspace) workspace = await restoreWorkspaceData(backup.workspace, progress);
    progress('Restoring accounts, settings, and browser data…');
    await restoreLocalData(backup.local);
  } catch (cause) {
    const recoveryErrors: string[] = [];
    if (workspace) {
      try { await workspace.rollback(); }
      catch (rollbackError) { recoveryErrors.push(errorMessage(rollbackError)); }
    }
    try { if (previousSession !== null) sessionStorage.setItem(ACCOUNT_SESSION_KEY, previousSession); }
    catch { recoveryErrors.push('Your sign-in session could not be recovered. Reload LopeOS and sign in again.'); }
    if (recoveryErrors.length) throw new Error([errorMessage(cause), ...recoveryErrors].join(' '));
    throw cause;
  }
}

export function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : 'The backup operation could not finish. Please try again.'; }
