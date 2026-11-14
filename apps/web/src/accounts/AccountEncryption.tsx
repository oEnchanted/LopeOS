import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Button, Input } from '../../../../packages/ui/src';
import { cloudAccount } from './service';

interface AccountEncryptionProps {
  mode: 'unlock' | 'upgrade';
  accountName: string;
  embedded: boolean;
  focusOnMount?: boolean;
  onRecoveryKey: (key: string) => void;
  onBusyChange: (busy: boolean) => void;
}

/** Account credentials stay in this form and are passed only to the account service. */
export function AccountEncryption({ mode, accountName, embedded, focusOnMount = false, onRecoveryKey, onBusyChange }: AccountEncryptionProps) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => () => busyCallback.current(false), []);
  useEffect(() => { if (focusOnMount) heading.current?.focus(); }, [focusOnMount]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    if (inFlight.current) return;
    setError('');
    if (!password) { setError('Enter your current password.'); return; }
    if (mode === 'upgrade') {
      if (newPassword !== confirmation) { setError('The new passwords do not match.'); return; }
      if (newPassword.length < 12) { setError('Use a new password with at least 12 characters.'); return; }
      if (newPassword === password) { setError('Choose a new password that is different from your current password.'); return; }
    }
    inFlight.current = true;
    setBusy(true);
    busyCallback.current(true);
    try {
      if (mode === 'unlock') {
        await cloudAccount.unlock(password);
        setPassword('');
      } else {
        const { recoveryKey } = await cloudAccount.upgradeEncryption(accountName.trim().toLowerCase(), password, newPassword);
        setPassword(''); setNewPassword(''); setConfirmation('');
        onRecoveryKey(recoveryKey);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your account could not be unlocked. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
      busyCallback.current(false);
    }
  }

  const fields = <>
    <div className="account-fields">
      <label className="account-wide" htmlFor={`${id}-current`}>{mode === 'unlock' ? 'Account password' : 'Current password'}
        <Input id={`${id}-current`} name="currentPassword" type="password" autoComplete="current-password" maxLength={1024} value={password} disabled={busy} onChange={event => setPassword(event.target.value)}/>
      </label>
      {mode === 'upgrade' && <>
        <label htmlFor={`${id}-new`}>New password
          <Input id={`${id}-new`} name="newPassword" aria-label="New password" type="password" autoComplete="new-password" maxLength={1024} value={newPassword} disabled={busy} aria-describedby={`${id}-hint`} onChange={event => setNewPassword(event.target.value)}/>
          <small id={`${id}-hint`}>At least 12 characters, different from your current password.</small>
        </label>
        <label htmlFor={`${id}-confirm`}>Confirm new password
          <Input id={`${id}-confirm`} name="confirmation" type="password" autoComplete="new-password" maxLength={1024} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)}/>
        </label>
      </>}
    </div>
    {mode === 'upgrade' && <p className="account-footnote">Your current password is sent once to sign in to your existing account. Your new password stays in your browser. Use the new password next time you sign in, and save the recovery key shown next.</p>}
    {error && <p className="account-error" role="alert">{error}</p>}
    <Button type={embedded ? 'button' : 'submit'} variant="primary" disabled={busy} onClick={embedded ? () => void submit() : undefined}>
      {busy ? mode === 'unlock' ? 'Unlocking…' : 'Encrypting your files…' : mode === 'unlock' ? 'Unlock LopeDrive' : 'Set up encrypted sync'}<ArrowRight size={16} aria-hidden="true"/>
    </Button>
    {mode === 'upgrade' && <p className="account-footnote">Existing cloud files will be encrypted. Old server backups may still contain unencrypted copies.</p>}
  </>;

  return <section className="account-security glass-inset" aria-labelledby={`${id}-heading`} aria-busy={busy}>
    <div className="account-security-heading">
      <span className="account-row-icon" aria-hidden="true">{mode === 'unlock' ? <LockKeyhole size={21}/> : <ShieldCheck size={21}/>}</span>
      <div><h3 id={`${id}-heading`} ref={heading} tabIndex={-1}>{mode === 'unlock' ? 'Unlock your LopeDrive' : 'Protect your cloud files'}</h3><p>{mode === 'unlock' ? 'Enter your password to unlock encrypted sync. Your local files are still available.' : 'Update this account to encrypt your files before they sync.'}</p></div>
    </div>
    {embedded ? <div className="account-form" onKeyDown={event => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        event.preventDefault(); event.stopPropagation(); void submit();
      }
    }}>{fields}</div> : <form className="account-form" onSubmit={event => void submit(event)} noValidate>{fields}</form>}
  </section>;
}
