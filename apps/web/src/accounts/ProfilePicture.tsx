import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '../../../../packages/ui/src';
import { preferences } from '../../../../packages/sdk/src/preferences';
import { PROFILE_PICTURE_KEY, isProfilePicture } from '../../../../packages/contracts/src/profile';
import { prepareProfilePhoto } from '../setup/photo';
import { cloudAccount, useCloudAccount } from './service';

const readPicture = () => {
  const value = preferences.get<string | null>(PROFILE_PICTURE_KEY, null);
  return isProfilePicture(value) ? value : null;
};
export const useAccountPicture = () => useSyncExternalStore(preferences.subscribe, readPicture, () => null);

function savePicture(value: string | null) {
  preferences.set(PROFILE_PICTURE_KEY, value);
  if (!preferences.getStatus().persistent) {
    preferences.refresh();
    throw new Error('Your picture could not be saved. Free some browser storage and try again.');
  }
}

export function ProfilePictureEditor({ disabled = false }: { disabled?: boolean }) {
  const state = useCloudAccount(), picture = useAccountPicture();
  const input = useRef<HTMLInputElement>(null), active = useRef(false), mounted = useRef(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setError(''); setMessage(''); }, [state.account?.id]);
  const locked = state.encryption !== 'unlocked';
  const unavailable = disabled || busy || locked || !state.account;
  async function choose(file?: File) {
    if (!file || unavailable || active.current) return;
    const accountId = state.account!.id;
    active.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const prepared = await prepareProfilePhoto(file);
      if (!mounted.current) return;
      const current = cloudAccount.getSnapshot();
      if (current.account?.id !== accountId || current.encryption !== 'unlocked') throw new Error('Your account changed. Unlock your account and choose the picture again.');
      savePicture(prepared);
      setMessage('Picture saved. It will sync with your account.');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'The picture could not be saved.'); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  function remove() {
    if (unavailable || active.current) return;
    setError(''); setMessage('');
    try { savePicture(null); setMessage('Picture removed. This change will sync with your account.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The picture could not be removed.'); }
  }
  return <div className="account-picture-editor" aria-busy={busy}>
    <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp" aria-label="Choose profile picture" disabled={unavailable} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file); }}/>
    <div className="account-picture-actions"><Button type="button" variant="ghost" disabled={unavailable} onClick={() => input.current?.click()}><Camera size={15} aria-hidden="true"/>{busy ? 'Preparing picture…' : picture ? 'Change photo' : 'Add photo'}</Button>{picture && <Button type="button" variant="ghost" disabled={unavailable} onClick={remove}>Remove photo</Button>}</div>
    {locked && <p className="account-footnote">Unlock your account to change your profile picture.</p>}
    {message && <p className="account-footnote" role="status">{message}</p>}
    {error && <p className="account-error" role="alert">{error}</p>}
  </div>;
}
