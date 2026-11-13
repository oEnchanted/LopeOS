import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button, Dialog } from '../../../../packages/ui/src';
import { SettingsGroup, SettingsRow } from '../../../../packages/ui/src/settings';
import { backupSummary, createBackup, downloadBackup, errorMessage, readBackup, restoreBackup, type LopeBackup } from './archive';
import { prepareForRestore } from './lifecycle';
import './backup.css';

export function BackupControls({ mode }: { mode: 'settings' | 'setup' }) {
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const mounted = useRef(true);
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [preview, setPreview] = useState<LopeBackup | null>(null);
  const [phase, setPhase] = useState<'' | 'reading' | 'exporting' | 'preparing' | 'importing'>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    const preventUnload = (event: BeforeUnloadEvent) => { if (operation.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventUnload);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', preventUnload); };
  }, []);
  async function exportFile() {
    if (operation.current) return;
    operation.current = true; setPhase('exporting'); setError('');
    try {
      const backup = await createBackup(includeWorkspace, setMessage);
      downloadBackup(backup);
      setMessage('Backup download started. Keep the file outside this browser so you can restore after clearing site data.');
    } catch (cause) { setError(errorMessage(cause)); setMessage(''); }
    finally { operation.current = false; setPhase(''); }
  }
  async function chooseFile(file?: File) {
    if (!file || operation.current) return;
    operation.current = true; setPhase('reading'); setError(''); setMessage('Checking the backup…');
    try { setPreview(await readBackup(file)); setMessage(''); }
    catch (cause) { setError(errorMessage(cause)); setMessage(''); }
    finally { operation.current = false; setPhase(''); }
  }
  async function importFile() {
    if (!preview || operation.current) return;
    const backup = preview; setPreview(null);
    operation.current = true; setPhase('preparing'); setError(''); setMessage('Checking open applications…');
    let release: (() => void) | null = null;
    try {
      release = await prepareForRestore();
      if (!release) { setMessage('Import cancelled. The backup was not applied.'); return; }
      if (!mounted.current) { release(); return; }
      setPhase('importing');
      await restoreBackup(backup, setMessage);
      setMessage('Backup restored. Restarting LopeOS…');
      operation.current = false;
      window.location.reload();
      return;
    } catch (cause) { release?.(); setError(errorMessage(cause)); setMessage(''); }
    finally { operation.current = false; setPhase(''); }
  }
  const summary = preview && backupSummary(preview);
  const chooseButton = <Button type="button" disabled={Boolean(phase)} onClick={() => input.current?.click()}><Upload size={15} aria-hidden="true"/>Import backup…</Button>;
  return <div className={'backup-controls backup-controls--' + mode}>
    {mode === 'settings' ? <>
      <SettingsGroup title="Backups" description="Save your open work before exporting. Keep the downloaded file somewhere outside this browser, such as your computer or cloud storage.">
        <SettingsRow label="Export backup" description="Download accounts, settings for every user, wallpaper images, desktop layout, app data, local photos, and recovery drafts."><Button type="button" variant="primary" disabled={Boolean(phase)} onClick={() => void exportFile()}><Download size={15} aria-hidden="true"/>Export backup</Button></SettingsRow>
        <SettingsRow label="Workspace files" description="Include files and folders from the connected workspace. Export stops if any file cannot be read. Uncheck this to back up browser data while the workspace is offline."><label className="backup-checkbox"><input type="checkbox" checked={includeWorkspace} disabled={Boolean(phase)} onChange={event => setIncludeWorkspace(event.target.checked)}/>Include workspace files</label></SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Restore backup">
        <SettingsRow label="Import backup" description="Choose a backup, review its contents, then restart with your restored accounts and interface. You can also import from the setup welcome screen.">{chooseButton}</SettingsRow>
      </SettingsGroup>
      <p className="backup-note">Backups contain personal files and account password hashes and are not encrypted. Keep them private. Service sign-ins, remote browser profiles, running terminals, and downloadable AI models are not included. Workspace transfers support files up to 8 MiB and 10,000 entries; each backup supports up to 256 MiB.</p>
    </> : <div className="backup-setup-entry"><p>Restore accounts, settings, and files from a LopeOS backup.</p>{chooseButton}</div>}
    <input ref={input} hidden type="file" aria-label="Choose LopeOS backup" accept="application/json,.json,.lopeos" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseFile(file); }}/>
    {error && <p className="backup-error" role="alert">{error}</p>}
    {message && !phase && <p className="backup-status" role="status">{message}</p>}
    {preview && summary && <Dialog title="Review LopeOS backup" onClose={() => setPreview(null)}>
      <div className="backup-review"><p>Created {new Date(preview.createdAt).toLocaleString()}.</p>
        <dl><div><dt>Local accounts</dt><dd>{summary.accounts}</dd></div><div><dt>Settings and app data groups</dt><dd>{summary.settings}</dd></div><div><dt>Photo and recovery records</dt><dd>{summary.records}</dd></div><div><dt>Workspace files</dt><dd>{preview.workspace ? `${summary.files} files · ${summary.folders} folders` : 'Not included'}</dd></div></dl>
        <p>This replaces the accounts, preferences, and local app data in this browser. Restored accounts keep their passwords. You will sign in again after LopeOS restarts.</p>
        <p>{preview.workspace ? 'Workspace files are added at their original paths. Existing identical files are kept; a different file at the same path stops the import. Other workspace files are kept.' : 'This backup has no workspace files. Your connected workspace will stay as it is.'}</p>
        <p>Save any open work and close other LopeOS tabs before continuing.</p>
      </div><div className="dialog-actions"><Button type="button" onClick={() => setPreview(null)}>Cancel</Button><Button type="button" variant="primary" onClick={() => void importFile()}>Import and restart</Button></div>
    </Dialog>}
    {phase && phase !== 'preparing' && <Dialog title={phase === 'exporting' ? 'Exporting LopeOS backup' : phase === 'reading' ? 'Checking LopeOS backup' : 'Restoring LopeOS backup'} dismissible={false} onClose={() => {}}><div className="backup-progress" aria-busy="true"><p role="status" aria-live="polite">{message}</p><p>Keep this tab open until the operation finishes.</p><progress aria-label="Backup progress"/></div></Dialog>}
  </div>;
}
