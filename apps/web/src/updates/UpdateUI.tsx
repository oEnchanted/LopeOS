import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, HardDrive, RefreshCw, WifiOff } from 'lucide-react';
import { Button, Dialog } from '../../../../packages/ui/src';
import { SettingsGroup, SettingsRow } from '../../../../packages/ui/src/settings';
import { usePreferences } from '../../../../packages/sdk/src/preferences';
import { LopeMark } from '../shell/Icons';
import { formatReleaseDate, formatUpdateBytes, softwareUpdates, useSoftwareUpdate, type UpdateState } from './service';
import '../setup/reset.css';
import './updates.css';

const working = new Set<UpdateState['status']>(['starting', 'checking', 'preparing', 'checking-release', 'checking-storage', 'checking-models', 'downloading', 'verifying', 'installing', 'restarting']);
const phases: Partial<Record<UpdateState['status'], string>> = {
  'checking-release': 'Checking update availability…',
  'checking-storage': 'Checking browser storage…',
  'checking-models': 'Checking for model updates…',
  downloading: 'Downloading update…', verifying: 'Verifying update…',
  installing: 'Installing update…', restarting: 'Restarting LopeOS…',
};
const install = () => { void softwareUpdates.requestInstall(); };
const check = () => { void softwareUpdates.check(); };

function updateStatus(state: UpdateState) {
  if (state.status === 'unsupported') return 'Software updates are unavailable in this connection.';
  if (state.status === 'starting') return 'Preparing Software Update…';
  if (state.caching) return 'Saving this release for future visits…';
  if (state.status === 'checking') return 'Checking for updates…';
  if (state.status === 'preparing') return 'Checking open apps for unsaved work…';
  if (phases[state.status]) return phases[state.status];
  if (state.available) return 'A new LopeOS release is available.';
  if (state.offline) return 'You’re offline. Connect to check for updates.';
  if (state.lastChecked) return 'You’re using the latest published release.';
  return 'Check for a new LopeOS release.';
}

export function SoftwareUpdateSettings() {
  const state = useSoftwareUpdate();
  const busy = working.has(state.status) || state.caching;
  return <div className="software-update-settings" data-testid="software-update-settings">
    <div className="software-update-summary">
      <span className="software-update-summary__mark" aria-hidden="true"><LopeMark size={44}/></span>
      <div><h2>LopeOS {state.current.version}</h2><p>Installed build · {formatReleaseDate(state.current.build)}</p></div>
    </div>
    <SettingsGroup title="Software Update">
      <SettingsRow id="software-update" label={state.available ? 'Update available' : 'Your software'} description={<span role="status">{updateStatus(state)}</span>}>
        <Button onClick={check} disabled={busy || state.status === 'unsupported'}><RefreshCw size={14}/>{state.status === 'checking' ? 'Checking…' : 'Check for updates'}</Button>
      </SettingsRow>
      {state.available && <>
        <SettingsRow label={'LopeOS ' + state.available.version} description={'Published ' + formatReleaseDate(state.available.releasedAt)}>
          <Button variant="primary" disabled={busy || state.offline || state.status === 'unsupported'} onClick={install}><Download size={14}/>Download &amp; install</Button>
        </SettingsRow>
        <SettingsRow label="Release size" description="Some files may already be cached. Transfer size can be smaller when the server compresses files."><span className="settings-value">{formatUpdateBytes(state.available.totalBytes)}</span></SettingsRow>
        <SettingsRow label="Before you update" description="LopeOS checks unsaved work, update availability, browser storage, and model versions, then downloads and verifies the release before restarting. Your accounts, settings, and saved files are kept. Model downloads remain optional."/>
      </>}
      {state.lastChecked && <SettingsRow label="Last checked"><span className="settings-value">{formatReleaseDate(new Date(state.lastChecked).toISOString())}</span></SettingsRow>}
      {state.modelCheck && <SettingsRow label="Model update check" description={state.modelCheck}/>}
    </SettingsGroup>
    {state.error && <div className="software-update-error" role="alert">{state.error}</div>}
    <SettingsGroup title="Cached software" description="Software Update manages this LopeOS web workspace. Your device’s operating system is managed separately.">
      <SettingsRow label={state.cached ? 'This release is saved in your browser' : state.caching ? 'Saving this release' : 'This release is not cached yet'} description={state.cached ? 'Future visits use your saved release. New releases are installed when you choose to update.' : state.caching ? 'Keep LopeOS open while its apps and interface are saved for future visits.' : 'LopeOS needs a complete saved release before it can open reliably without a connection.'}>
        <span className="software-update-cache-state">{state.cached ? <Check size={16}/> : <HardDrive size={16}/>}{state.cached ? 'Cached' : state.caching ? 'Saving…' : 'Not cached'}</span>
      </SettingsRow>
      <SettingsRow label={state.offline ? 'Offline' : 'Working offline'} description="Cached LopeOS can open without an internet connection. Remote workspace files, Terminal, web browsing, weather, and optional model downloads still need their services. Clearing site data also removes the saved release.">
        {state.offline && <WifiOff size={17} aria-hidden="true"/>}
      </SettingsRow>
    </SettingsGroup>
  </div>;
}

function UpdateBootScreen({ state }: { state: UpdateState }) {
  const preferences = usePreferences();
  const container = useRef<HTMLElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const error = state.status === 'error';
  const progress = state.progress;
  const phase = error ? 'Update couldn’t finish.' : phases[state.status] || 'Preparing update…';
  const preflight = state.status.startsWith('checking-');
  const detail = state.status === 'checking-release' ? 'Confirming the published release is still available.'
    : state.status === 'checking-storage' ? 'Checking the update cache and space for this release.'
    : state.status === 'checking-models' ? 'Comparing Spotlight AI, photo denoise, and portrait model versions.'
    : `${state.completedFiles} of ${state.totalFiles} files prepared`;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    const wasInert = root?.inert;
    if (root) root.inert = true;
    container.current?.focus();
    const containFocus = (event: FocusEvent) => {
      if (!container.current?.contains(event.target as Node)) container.current?.focus();
    };
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('focusin', containFocus);
      if (root) root.inert = wasInert ?? false;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => { if (error) retry.current?.focus(); }, [error]);

  return createPortal(<section ref={container} tabIndex={-1} className="reset-boot software-update-boot" role="dialog" aria-modal="true" aria-label="Updating LopeOS" data-phase={error ? 'error' : 'working'} data-reduce-motion={preferences.reduceMotion} onKeyDown={event => {
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    const buttons = [...(container.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!buttons.length) { event.preventDefault(); container.current?.focus(); }
    else if (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === container.current)) { event.preventDefault(); buttons.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
  }}>
    <div className="reset-boot__logo" aria-hidden="true"><LopeMark size={88}/></div>
    <div className="reset-boot__lower">
      <div className="reset-boot__progress" role="progressbar" aria-label="Preparing LopeOS update" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}% · ${phase}`}><span style={{ width: progress + '%' }}/></div>
      <h1 className="software-update-boot__phase" role="status">{phase}</h1>
      {state.available && <p className="software-update-boot__version">LopeOS {state.available.version} · {formatUpdateBytes(state.available.totalBytes)}</p>}
      {!error && <>
        {!preflight && <p className="software-update-boot__download">{formatUpdateBytes(state.downloadedBytes)} of {formatUpdateBytes(state.downloadBytes)} downloaded</p>}
        <p className="software-update-boot__detail">{detail}</p>
        {state.modelCheck && <p className="software-update-boot__hint">{state.modelCheck}</p>}
        <p className="software-update-boot__hint">Keep this tab open. LopeOS will restart when the update is ready.</p>
      </>}
      {error && <div className="reset-boot__error" role="alert">
        <p>{state.error || 'Try again when your connection is available.'}</p>
        <p>Your installed release and saved data are still available.</p>
        <div className="software-update-boot__actions"><button ref={retry} onClick={install} disabled={state.offline}>Try again</button><button onClick={() => softwareUpdates.returnToDesktop()}>Back to desktop</button></div>
      </div>}
    </div>
  </section>, document.body);
}

export function UpdateExperience() {
  const state = useSoftwareUpdate();
  if (state.foreground) return <UpdateBootScreen state={state}/>;
  if (!state.promptVisible || !state.available || state.status === 'preparing') return null;
  return <Dialog title="A LopeOS update is available" onClose={() => softwareUpdates.dismissPrompt()}>
    <div className="software-update-prompt">
      <div className="software-update-prompt__release glass-inset"><span aria-hidden="true"><LopeMark size={38}/></span><div><strong>LopeOS {state.available.version}</strong><small>Published {formatReleaseDate(state.available.releasedAt)}</small></div></div>
      <dl className="software-update-prompt__details"><div><dt>Release size</dt><dd>{formatUpdateBytes(state.available.totalBytes)}</dd></div><div><dt>Installed version</dt><dd>LopeOS {state.current.version}</dd></div><div><dt>Installed build</dt><dd>{formatReleaseDate(state.current.build)}</dd></div></dl>
      <p>You can keep using your current release and update later in Settings → Software Update.</p>
      <p>LopeOS will check unsaved work, browser storage, and model updates before installing and restarting. Your accounts, settings, and saved files are kept. Model downloads remain optional.</p>
      {state.error && <p className="software-update-error" role="alert">{state.error}</p>}
      {state.offline && <p role="status">Connect to the internet to download this update.</p>}
      <div className="dialog-actions"><Button onClick={() => softwareUpdates.dismissPrompt()}>Later</Button><Button variant="primary" disabled={working.has(state.status) || state.caching || state.offline} onClick={install}><Download size={14}/>Download &amp; install</Button></div>
    </div>
  </Dialog>;
}
