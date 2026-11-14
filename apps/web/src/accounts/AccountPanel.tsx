import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, Cloud, CloudOff, RefreshCw, KeyRound, ShieldCheck, ArrowLeft, ArrowRight, SlidersHorizontal } from 'lucide-react';
import { Button, Input } from '../../../../packages/ui/src';
import { deriveAccountName, validateAccountFields } from '../../../../packages/sdk/src/accounts';
import { AccountIcon } from '../shell/Icons';
import { cloudAccount, useCloudAccount } from './service';
import { AccountEncryption } from './AccountEncryption';
import { ProfilePictureEditor, useAccountPicture } from './ProfilePicture';
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
  const locked = !!state.account && state.encryption === 'locked';
  const needsEncryption = !!state.account && state.encryption === 'none';
  const title = !state.account ? 'LopeDrive' : locked ? 'Unlock to resume sync' : needsEncryption ? 'Set up encrypted sync' : busy ? 'Syncing with LopeDrive' : state.status === 'offline' ? 'Waiting for connection' : state.status === 'error' ? 'Sync needs attention' : state.pendingChanges ? 'Changes waiting to sync' : state.lastSyncedAt ? 'Up to date' : 'Preparing your backup';
  const percent = state.quotaBytes > 0 ? Math.min(100, state.usedBytes / state.quotaBytes * 100) : 0;
  const retry = async () => { setRetrying(true); setRetryError(''); try { await cloudAccount.syncNow(); } catch (error) { setRetryError(error instanceof Error ? error.message : 'Sync could not finish. Try again.'); } finally { setRetrying(false); } };
  return <section className={`account-status glass-inset${compact ? ' account-status--compact' : ''}`} aria-label="LopeDrive sync status">
    <div className="account-status-heading">{locked ? <KeyRound size={18}/> : needsEncryption ? <ShieldCheck size={18}/> : state.status === 'offline' ? <CloudOff size={18}/> : state.account && state.lastSyncedAt && state.status === 'idle' && !state.pendingChanges ? <Check size={18}/> : <Cloud size={18}/>}<strong>{title}</strong>{state.account && <Button type="button" variant="ghost" aria-label="Sync now" title="Sync now" disabled={busy || retrying || locked || needsEncryption} onClick={() => void retry()}><RefreshCw size={14}/></Button>}</div>
    {!state.account ? <p>Sign in to sync files and settings. Accounts include 1 GB of storage and are optional.</p> : <>
      <div className="account-quota" role="meter" aria-label="Cloud storage used" aria-valuemin={0} aria-valuemax={state.quotaBytes} aria-valuenow={state.usedBytes} aria-valuetext={`${cloudBytes(state.usedBytes)} of ${cloudBytes(state.quotaBytes)} used`}><span style={{ width: `${percent}%` }}/></div>
      <p>{cloudBytes(state.usedBytes)} of {cloudBytes(state.quotaBytes)} used</p>
      {locked && <p>Unlock your account in Account settings to resume syncing. Local files are still available.</p>}
      {needsEncryption && <p>Set up encryption in Account settings to resume syncing.</p>}
      {busy && <div className="account-transfer" role="status" aria-live="polite"><progress aria-label="Account sync progress" max={state.totalBytes || 1} value={state.totalBytes ? Math.min(state.transferredBytes, state.totalBytes) : undefined}/><span>{state.totalBytes ? `${cloudBytes(state.transferredBytes)} of ${cloudBytes(state.totalBytes)}` : 'Checking files and app data…'}</span>{state.currentFile && <span className="account-current-file" title={state.currentFile}>{state.currentFile}</span>}<small>{timeRemaining(state.etaSeconds)}</small></div>}
      {!compact && state.message && <small>{state.message}</small>}
      {!compact && !busy && state.lastSyncedAt && <small>Last synced {new Date(state.lastSyncedAt).toLocaleString()}</small>}
    </>}
    {(state.error || retryError) && <p className="account-error" role="alert">{retryError || state.error}</p>}
  </section>;
}

/** Redeems a storage code that raises the signed-in account to 10 GB. */
function StorageUnlock() {
  const state = useCloudAccount();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!state.account || state.quotaBytes >= 10_000_000_000) return null;
  const submit = async () => {
    if (busy) return;
    setError('');
    if (!code.trim()) { setError('Enter your unlock code.'); return; }
    setBusy(true);
    try { await cloudAccount.unlockStorage(code); setCode(''); setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'That code could not be used.'); }
    finally { setBusy(false); }
  };
  return <section className="account-security glass-inset" aria-labelledby={`${id}-heading`} aria-busy={busy}>
    <div className="account-security-heading"><span className="account-row-icon" aria-hidden="true"><Cloud size={21}/></span><div><h3 id={`${id}-heading`}>Unlock 10 GB</h3><p>Have a code? Raise your LopeDrive storage to 10 GB.</p></div></div>
    {open ? <div className="account-form" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); void submit(); } }}>
      <div className="account-fields"><label className="account-wide" htmlFor={`${id}-code`}>Unlock code
        <Input id={`${id}-code`} name="unlockCode" autoComplete="off" spellCheck={false} maxLength={200} value={code} disabled={busy} onChange={event => setCode(event.target.value)}/>
      </label></div>
      {error && <p className="account-error" role="alert">{error}</p>}
      <Button type="button" variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Unlocking…' : 'Unlock 10 GB'}<ArrowRight size={16} aria-hidden="true"/></Button>
    </div> : <Button type="button" onClick={() => setOpen(true)}>Enter a code</Button>}
  </section>;
}

function AccountEmblem({ small = false }: { small?: boolean }) {
  return <div className={`account-emblem${small ? ' account-emblem--small' : ''}`} aria-hidden="true">
    <span className="account-emblem-mark"><AccountIcon size={small ? 58 : 78}/></span>
    {!small && <><span className="account-emblem-orbit"/><span className="account-emblem-cloud glass-inset"><Cloud size={22} strokeWidth={1.6}/></span><span className="account-emblem-check"><Check size={12} strokeWidth={2.5}/></span></>}
  </div>;
}

function AccountPrivacy() {
  return <details className="account-privacy">
    <summary>Privacy & things to know</summary>
    <div className="account-privacy-copy">
      <p>Files, filenames, and supported app data are encrypted in your browser before syncing to LopeDrive. The server can still see your account name, display name, storage use, item counts, and access times.</p>
      <p>Signing out stops sync but leaves local files on this device. Use a separate browser profile on shared computers. Clearing browser storage can erase unsynced files.</p>
      <p>This encryption protects cloud data, not local browser storage. An unlocked account can be accessed by a compromised device or modified application. The encryption implementation has not had an independent security review.</p>
      <p>Accounts include 1 GB of storage (10 GB with an unlock code), including encryption overhead, and up to 1 GB per synced item. Sync needs an internet connection; keep another copy of important files. Remote browser sessions, credentials, and downloaded AI models are managed separately.</p>
      <p>We do not collect an email for recovery. Keep your password and recovery key safe, outside LopeOS. If you lose both, even the server administrator cannot recover encrypted cloud data. Backups made before an older account was upgraded may still contain unencrypted data.</p>
    </div>
  </details>;
}

export function AccountPanel({ embedded = false, onAuthenticated, onBusyChange }: { embedded?: boolean; onAuthenticated?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const state = useCloudAccount();
  const picture = useAccountPicture();
  const [mode, setMode] = useState<'welcome' | 'register' | 'login' | 'recover' | 'upgrade'>('welcome');
  const [displayName, setDisplayName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [issuedKey, setIssuedKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [security, setSecurity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [legacyAccount, setLegacyAccount] = useState(false);
  const id = useId();
  const manuallyNamed = useRef(false), inFlight = useRef(false);
  const keyHeading = useRef<HTMLHeadingElement>(null);
  const introHeading = useRef<HTMLHeadingElement>(null);
  const focusIntro = useRef(false);
  useEffect(() => { if (issuedKey) keyHeading.current?.focus(); }, [issuedKey]);
  useEffect(() => {
    if (focusIntro.current && !issuedKey) { introHeading.current?.focus(); focusIntro.current = false; }
  }, [mode, issuedKey, state.account]);
  useEffect(() => { onBusyChange?.(busy || !!issuedKey); return () => onBusyChange?.(false); }, [busy, issuedKey, onBusyChange]);
  const changeMode = (next: typeof mode) => { focusIntro.current = true; setMode(next); setPassword(''); setConfirmation(''); setRecoveryInput(''); setError(''); setLegacyAccount(false); };
  const action = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setLegacyAccount(false);
    try { await work(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'LEGACY_ACCOUNT') setLegacyAccount(true);
    }
    finally { inFlight.current = false; setBusy(false); }
  };
  const showKey = (key: string) => { setIssuedKey(key); setSaved(false); setPassword(''); setConfirmation(''); setRecoveryInput(''); };
  const submit = (event?: FormEvent) => {
    event?.preventDefault(); event?.stopPropagation();
    if (mode === 'welcome' || mode === 'upgrade') return;
    void action(async () => {
      if (mode === 'register') {
        const validation = validateAccountFields({ displayName, accountName, password, confirmation });
        if (!validation.ok) throw new Error(validation.message);
      }
      if (mode !== 'login' && (password.length < 12 || password !== confirmation)) throw new Error('Use at least 12 characters and make sure both passwords match.');
      if (mode === 'register') {
        const key = await cloudAccount.register({ displayName: displayName.trim(), accountName: accountName.trim().toLowerCase(), password });
        if (key) showKey(key); else { setPassword(''); setConfirmation(''); onAuthenticated?.(); }
      } else if (mode === 'recover') {
        showKey((await cloudAccount.recover(accountName.trim().toLowerCase(), recoveryInput, password)).recoveryKey);
      } else {
        await cloudAccount.signIn(accountName.trim().toLowerCase(), password); setPassword(''); onAuthenticated?.();
      }
    });
  };
  const errorMessage = error && <p className="account-error" role="alert">{error}</p>;
  if (issuedKey) return <section className="account-panel account-welcome account-recovery" aria-label="Save your recovery key">
    <div className="account-intro"><span className="account-avatar" aria-hidden="true"><KeyRound size={28}/></span><p className="account-eyebrow">Your way back in</p><h2 ref={keyHeading} tabIndex={-1}>{mode === 'recover' ? 'A fresh start.' : 'Keep a spare key.'}</h2><p>Save this recovery key somewhere safe outside LopeOS. It’s how you reset your password without email.</p></div>
    <div className="account-key-card glass-inset"><code aria-label="Recovery key">{issuedKey}</code><p>This key is shown only now. Anyone with it can reset your password and access your cloud files. Any previous key no longer works.</p></div>
    <Button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([`LopeOS recovery key\nAccount: ${state.account?.accountName || accountName}\nKey: ${issuedKey}\nKeep private. Use Forgot password at https://lopeos.online.\n`], { type: 'text/plain' }));
      const link = document.createElement('a'); link.href = url; link.download = 'LopeOS-recovery-key.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Download recovery key</Button>
    <label className="account-consent"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)}/>I saved my recovery key somewhere safe.</label>
    <Button type="button" variant="primary" disabled={!saved} onClick={() => { setIssuedKey(''); setSecurity(false); changeMode(state.account ? 'welcome' : 'login'); if (state.account) onAuthenticated?.(); }}>{state.account ? 'Continue to LopeOS' : 'Continue to sign in'}<ArrowRight size={16}/></Button>
    <p className="account-footnote">If you lose both your password and this key, your encrypted cloud data cannot be recovered. There is no email reset.</p>
  </section>;
  const fields = <>
    <div className="account-fields">
      {mode === 'register' && <label htmlFor={`${id}-name`}>Your name<Input id={`${id}-name`} name="displayName" autoComplete="nickname" placeholder="Your name or nickname" maxLength={64} value={displayName} disabled={busy} onChange={event => { setDisplayName(event.target.value); if (!manuallyNamed.current) setAccountName(deriveAccountName(event.target.value)); }}/></label>}
      <label htmlFor={`${id}-account`}>Account name<Input id={`${id}-account`} name="accountName" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} value={accountName} placeholder={mode === 'register' ? 'Choose a username' : 'Your username'} disabled={busy} onChange={event => { manuallyNamed.current = true; setLegacyAccount(false); setAccountName(event.target.value); }}/></label>
      {mode === 'recover' && <label className="account-wide" htmlFor={`${id}-key`}>Recovery key<Input id={`${id}-key`} autoComplete="off" spellCheck={false} value={recoveryInput} maxLength={100} disabled={busy} onChange={event => setRecoveryInput(event.target.value)}/></label>}
      <label htmlFor={`${id}-password`}>{mode === 'recover' ? 'New password' : 'Password'}<Input id={`${id}-password`} name="password" aria-label={mode === 'recover' ? 'New password' : 'Password'} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={1024} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} aria-describedby={mode !== 'login' ? `${id}-password-hint` : undefined}/>{mode !== 'login' && <small id={`${id}-password-hint`}>At least 12 characters. A memorable phrase works well.</small>}</label>
      {mode !== 'login' && <label htmlFor={`${id}-confirm`}>Confirm password<Input id={`${id}-confirm`} name="confirmation" type="password" autoComplete="new-password" maxLength={1024} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)}/></label>}
    </div>
    {mode === 'register' && <p className="account-footnote">Creating an account starts syncing this browser’s existing LopeOS data. Next, you’ll save your recovery key.</p>}
    {mode === 'recover' && <p className="account-footnote">Resetting signs out all sessions and replaces your recovery key. Your synced files stay in your account.</p>}
    {errorMessage}
    {legacyAccount && <Button type="button" disabled={busy} onClick={() => changeMode('upgrade')}>Set up encrypted sync<ArrowRight size={16}/></Button>}
    <Button type={embedded ? 'button' : 'submit'} variant="primary" disabled={busy} onClick={embedded ? () => submit() : undefined}>{busy ? mode === 'register' ? 'Creating account…' : mode === 'recover' ? 'Resetting password…' : 'Signing in…' : mode === 'register' ? 'Create free account' : mode === 'recover' ? 'Reset password' : 'Sign in to LopeOS'}<ArrowRight size={16}/></Button>
    {mode === 'login' && <Button type="button" variant="ghost" disabled={busy} onClick={() => changeMode('recover')}>Forgot password?</Button>}
    {mode === 'recover' && <Button type="button" variant="ghost" disabled={busy} onClick={() => changeMode('login')}>Back to sign in</Button>}
  </>;
  return <section className={`account-panel account-welcome ${mode === 'upgrade' ? 'account-auth' : state.account ? 'account-dashboard' : mode === 'welcome' ? 'account-landing' : `account-auth account-auth--${mode}`}`} aria-label="LopeOS account" aria-busy={busy}>
    {mode === 'upgrade' ? <>
      <Button type="button" variant="ghost" className="account-back" disabled={busy} onClick={() => changeMode(state.account ? 'welcome' : 'login')}><ArrowLeft size={14}/>Back</Button>
      <AccountEncryption mode="upgrade" accountName={accountName.trim().toLowerCase()} embedded={embedded} focusOnMount onRecoveryKey={showKey} onBusyChange={setBusy}/>
    </> : state.account ? <>
      <header className="account-identity account-intro"><span className="account-avatar">{picture ? <img src={picture} alt="Profile picture"/> : <AccountIcon size={64}/>}</span><div><h2 ref={introHeading} tabIndex={-1}>{state.account.displayName}</h2><p>@{state.account.accountName}</p></div><ProfilePictureEditor disabled={busy}/><span className="account-plan"><Cloud size={13} aria-hidden="true"/>Free account · 1 GB</span></header>
      <div className="account-storage"><div className="account-section-heading"><h3>LopeDrive</h3><span>Your files, connected</span></div><AccountStatus/></div>
      <StorageUnlock/>
      {state.encryption !== 'unlocked' && <AccountEncryption mode={state.encryption === 'locked' ? 'unlock' : 'upgrade'} accountName={state.account.accountName} embedded={embedded} onRecoveryKey={showKey} onBusyChange={setBusy}/>}
      {state.encryption === 'unlocked' && <section className="account-security glass-inset" aria-label="Account recovery">
        <div className="account-security-heading"><span className="account-row-icon" aria-hidden="true"><KeyRound size={21}/></span><div><h3>Password & recovery</h3><p>A spare key for your account, kept safely with you.</p></div></div>
        {security ? <div className="account-form account-security-form" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); void action(async () => showKey((await cloudAccount.replaceRecoveryKey(password)).recoveryKey)); } }}><label htmlFor={`${id}-current`}>Confirm your current password<Input id={`${id}-current`} type="password" autoComplete="current-password" autoFocus value={password} maxLength={1024} disabled={busy} onChange={event => setPassword(event.target.value)}/></label><p className="account-footnote">Creating a new recovery key invalidates your old one.</p><Button type="button" disabled={busy} onClick={() => void action(async () => showKey((await cloudAccount.replaceRecoveryKey(password)).recoveryKey))}>{busy ? 'Creating recovery key…' : 'Create new recovery key'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setSecurity(false); setPassword(''); setError(''); }}>Cancel</Button></div> : <Button type="button" variant="ghost" className="account-manage" disabled={busy} onClick={() => { setSecurity(true); setError(''); }}>Manage recovery key<ArrowRight size={14}/></Button>}
      </section>}
      {!embedded && <div className="account-session-actions">{confirmSignOut ? <><p>Sign out and stop syncing? Files already on this device stay here. Save any open documents first.</p><Button type="button" disabled={busy} onClick={() => setConfirmSignOut(false)}>Cancel</Button><Button type="button" disabled={busy} onClick={() => void action(async () => { await cloudAccount.signOut(); setConfirmSignOut(false); setSecurity(false); changeMode('welcome'); })}>{busy ? 'Signing out…' : 'Sign out'}</Button></> : <><div><strong>This device</strong><p>Your files and settings sync while you’re signed in.</p></div><Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmSignOut(true)}>Sign out…</Button></>}</div>}
      {errorMessage}
      <AccountPrivacy/>
    </> : mode === 'welcome' ? <>
      <div className="account-intro"><AccountEmblem/><h2 ref={introHeading} tabIndex={-1}>Your LopeOS.<br/>Wherever you go.</h2><p>Bring your files and familiar settings along.<br/>{' '}A free account makes every desktop feel like yours.</p></div>
      <div className="account-benefits glass-inset">
        <div><Cloud size={21} strokeWidth={1.6} aria-hidden="true"/><div><strong>Room for your things</strong><p>1 GB of free cloud storage.</p></div></div>
        <div><SlidersHorizontal size={21} strokeWidth={1.6} aria-hidden="true"/><div><strong>Feels like you</strong><p>Your settings, in sync.</p></div></div>
        <div><ShieldCheck size={21} strokeWidth={1.6} aria-hidden="true"/><div><strong>Simply yours</strong><p>No email needed.</p></div></div>
      </div>
      <div className="account-landing-actions"><Button type="button" variant="primary" onClick={() => changeMode('register')}>Create free account<ArrowRight size={16}/></Button><p className="account-switch">Already have an account?<Button type="button" variant="ghost" onClick={() => changeMode('login')}>Sign in</Button></p></div>
      <p className="account-optional">An account is optional. {embedded ? 'You can always add one later in Settings.' : 'Your local workspace is ready whenever you are.'}</p>
      <AccountPrivacy/>
    </> : <>
      <Button type="button" variant="ghost" className="account-back" disabled={busy} onClick={() => changeMode('welcome')}><ArrowLeft size={14}/>Account overview</Button>
      <div className="account-intro"><AccountEmblem small/><h2 ref={introHeading} tabIndex={-1}>{mode === 'register' ? 'Make yourself at home.' : mode === 'login' ? 'Welcome back.' : 'Let’s get you back in.'}</h2><p>{mode === 'register' ? 'Your own account, with 1 GB of cloud storage. No email or real name needed.' : mode === 'login' ? 'Your files and familiar settings are waiting for you.' : 'Use your recovery key to choose a new password. No email needed.'}</p></div>
      {embedded ? <div className="account-form" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); submit(); } }}>{fields}</div> : <form className="account-form" onSubmit={submit} noValidate>{fields}</form>}
      {mode !== 'recover' && <p className="account-switch">{mode === 'register' ? 'Already have an account?' : 'New to LopeOS?'}<Button type="button" variant="ghost" disabled={busy} onClick={() => changeMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'Sign in' : 'Create account'}</Button></p>}
      <AccountPrivacy/>
    </>}
  </section>;
}
