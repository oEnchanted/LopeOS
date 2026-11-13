import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, Cloud, CloudOff, RefreshCw, UserRound } from 'lucide-react';
import { Button, Input } from '../../../../packages/ui/src';
import { deriveAccountName, validateAccountFields } from '../../../../packages/sdk/src/accounts';
import { cloudAccount, useCloudAccount } from './service';
import './accounts.css';

export function cloudBytes(bytes: number) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2).replace(/\.00$/, '')} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${Math.max(0, Math.round(bytes))} bytes`;
}
function timeRemaining(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return 'Estimating time remaining…';
  if (seconds < 60) return 'Less than a minute remaining';
  if (seconds < 3600) return `About ${Math.ceil(seconds / 60)} min remaining`;
  return `About ${Math.ceil(seconds / 3600)} hr remaining`;
}

/** Shared cloud usage and actual transfer progress, including the Files sidebar. */
export function AccountStatus({ compact = false }: { compact?: boolean }) {
  const state = useCloudAccount();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const busy = state.status === 'syncing';
  const title = !state.account ? 'LopeDrive' : busy ? 'Syncing with LopeDrive' : state.status === 'offline' ? 'Waiting for connection' : state.status === 'error' ? 'Sync needs attention' : state.pendingChanges ? 'Changes waiting to sync' : state.lastSyncedAt ? 'Up to date' : 'Preparing your backup';
  const percent = state.quotaBytes > 0 ? Math.min(100, state.usedBytes / state.quotaBytes * 100) : 0;
  const retry = async () => { setRetrying(true); setRetryError(''); try { await cloudAccount.syncNow(); } catch (error) { setRetryError(error instanceof Error ? error.message : 'Sync could not finish. Try again.'); } finally { setRetrying(false); } };
  return <section className={`account-status glass-inset${compact ? ' account-status--compact' : ''}`} aria-label="LopeDrive sync status">
    <div className="account-status-heading">{state.status === 'offline' ? <CloudOff size={18}/> : state.account && state.lastSyncedAt && state.status === 'idle' && !state.pendingChanges ? <Check size={18}/> : <Cloud size={18}/>}<strong>{title}</strong>{state.account && <Button type="button" variant="ghost" aria-label="Sync now" title="Sync now" disabled={busy || retrying} onClick={() => void retry()}><RefreshCw size={14}/></Button>}</div>
    {!state.account ? <p>Sign in to sync files and settings. Accounts include 1 GB of storage and are optional.</p> : <>
      <div className="account-quota" role="meter" aria-label="Cloud storage used" aria-valuemin={0} aria-valuemax={state.quotaBytes} aria-valuenow={state.usedBytes} aria-valuetext={`${cloudBytes(state.usedBytes)} of ${cloudBytes(state.quotaBytes)} used`}><span style={{ width: `${percent}%` }}/></div>
      <p>{cloudBytes(state.usedBytes)} of {cloudBytes(state.quotaBytes)} used</p>
      {busy && <div className="account-transfer" role="status" aria-live="polite"><progress aria-label="Account sync progress" max={state.totalBytes || 1} value={state.totalBytes ? Math.min(state.transferredBytes, state.totalBytes) : undefined}/><span>{state.totalBytes ? `${cloudBytes(state.transferredBytes)} of ${cloudBytes(state.totalBytes)}` : 'Checking files and app data…'}</span>{state.currentFile && <span className="account-current-file" title={state.currentFile}>{state.currentFile}</span>}<small>{timeRemaining(state.etaSeconds)}</small></div>}
      {!compact && state.message && <small>{state.message}</small>}
      {!compact && !busy && state.lastSyncedAt && <small>Last synced {new Date(state.lastSyncedAt).toLocaleString()}</small>}
    </>}
    {(state.error || retryError) && <p className="account-error" role="alert">{retryError || state.error}</p>}
  </section>;
}

export function AccountPanel({ embedded = false, onAuthenticated, onBusyChange }: { embedded?: boolean; onAuthenticated?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const state = useCloudAccount();
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [displayName, setDisplayName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const id = useId();
  const manuallyNamed = useRef(false);
  const inFlight = useRef(false);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault(); event?.stopPropagation();
    if (inFlight.current) return;
    setError('');
    if (mode === 'register') {
      const validation = validateAccountFields({ displayName, accountName, password, confirmation });
      if (!validation.ok) { setError(validation.message); return; }
      if (password.length < 12) { setError('Use a password with at least 12 characters.'); return; }
    }
    if (!accountName.trim() || !password) { setError('Enter your account name and password.'); return; }
    inFlight.current = true; setBusy(true);
    try {
      if (mode === 'register') await cloudAccount.register({ displayName: displayName.trim(), accountName: accountName.trim().toLowerCase(), password });
      else await cloudAccount.signIn(accountName.trim().toLowerCase(), password);
      setPassword(''); setConfirmation(''); onAuthenticated?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not connect to your account. Please try again.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const signOut = async () => { if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); try { await cloudAccount.signOut(); setConfirmSignOut(false); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-out could not finish.'); } finally { inFlight.current = false; setBusy(false); } };
  const fields = <>
    <div className="account-mode" role="group" aria-label="Account action"><Button type="button" variant={mode === 'register' ? 'primary' : 'ghost'} aria-pressed={mode === 'register'} disabled={busy} onClick={() => { setMode('register'); setError(''); }}>Create account</Button><Button type="button" variant={mode === 'login' ? 'primary' : 'ghost'} aria-pressed={mode === 'login'} disabled={busy} onClick={() => { setMode('login'); setError(''); }}>Sign in</Button></div>
    <div className="account-fields">
      {mode === 'register' && <label htmlFor={`${id}-name`}>Your name<Input id={`${id}-name`} name="displayName" autoComplete="name" maxLength={64} value={displayName} disabled={busy} onChange={event => { setDisplayName(event.target.value); if (!manuallyNamed.current) setAccountName(deriveAccountName(event.target.value)); }}/></label>}
      <label htmlFor={`${id}-account`}>Account name<Input id={`${id}-account`} name="accountName" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} value={accountName} disabled={busy} onChange={event => { manuallyNamed.current = true; setAccountName(event.target.value); }}/></label>
      <label htmlFor={`${id}-password`}>Password<Input id={`${id}-password`} name="password" aria-label="Password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} maxLength={1024} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} aria-describedby={mode === 'register' ? `${id}-password-hint` : undefined}/>{mode === 'register' && <small id={`${id}-password-hint`}>At least 12 characters.</small>}</label>
      {mode === 'register' && <label htmlFor={`${id}-confirm`}>Confirm password<Input id={`${id}-confirm`} name="confirmation" type="password" autoComplete="new-password" maxLength={1024} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)}/></label>}
    </div>
    {error && <p className="account-error" role="alert">{error}</p>}
    <Button type={embedded ? 'button' : 'submit'} variant="primary" disabled={busy} onClick={embedded ? () => void submit() : undefined}>{busy ? mode === 'register' ? 'Creating account…' : 'Signing in…' : mode === 'register' ? 'Create free account' : 'Sign in to LopeOS'}</Button>
  </>;
  return <section className="account-panel" aria-label="LopeOS account" aria-busy={busy}>
    {state.account ? <>
      <div className="account-identity"><span className="account-avatar"><UserRound size={28}/></span><div><strong>{state.account.displayName}</strong><p>@{state.account.accountName} · Free account</p></div></div>
      <AccountStatus/>
      <p className="account-description">Your LopeOS files, settings, app data, photos, and saved layout sync automatically while you’re signed in. Each account includes 1 GB of cloud storage.</p>
      {!embedded && <div className="account-session-actions">{confirmSignOut ? <><p>Sign out and stop syncing? Files already on this device stay here. Save any open documents first.</p><Button type="button" disabled={busy} onClick={() => setConfirmSignOut(false)}>Cancel</Button><Button type="button" disabled={busy} onClick={() => void signOut()}>{busy ? 'Signing out…' : 'Sign out'}</Button></> : <Button type="button" disabled={busy} onClick={() => setConfirmSignOut(true)}>Sign out…</Button>}</div>}
      {error && <p className="account-error" role="alert">{error}</p>}
    </> : <>
      <div className="account-benefit"><span className="account-avatar"><Cloud size={28}/></span><div><strong>LopeOS Account</strong><p>1 GB of cloud storage</p></div></div>
      <p className="account-description">Files, settings, app data, photos, and window layout sync while you’re signed in. Signing in also backs up existing LopeOS data.</p>
      {embedded ? <div className="account-form" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); void submit(); } }}>{fields}</div> : <form className="account-form" onSubmit={event => void submit(event)} noValidate>{fields}</form>}
      <p className="account-footnote">An account is optional. You can create one later in Settings. Remote browser sessions, credentials, and downloaded AI models are managed separately.</p>
    </>}
  </section>;
}
