import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { accounts } from '../../../../packages/sdk/src/accounts';
import { preferences, usePreferences } from '../../../../packages/sdk/src/preferences';
import { Button } from '../../../../packages/ui/src';
import { LopeMark } from '../shell/Icons';
import { appearanceAttributes, appearanceStyle, syncDocumentAppearance } from '../shell/appearance';
import { resolveDesktopBackground } from '../shell/background';
import type { PersonalWallpaper } from '../apps/settings/wallpaper-policy';
import { ResetScreen } from './ResetScreen';
import { SetupBackground } from './SetupBackground';
import { softwareUpdates } from '../updates/service';
import { parseFactoryResetRequest, readFactoryResetRequest, rememberFactoryResetForTab, RESET_STORAGE_KEY, type FactoryResetRequest } from '../../../../packages/sdk/src/reset';
import { cloudAccount } from '../accounts/service';
import './setup.css';

// Reset boots load no desktop/app stores until erasure finishes.
const Shell = lazy(() => import('../shell/Shell').then(module => ({ default: module.Shell })));
const loadSetup = () => import('./SetupAssistant');
const SetupAssistant = lazy(() => loadSetup().then(module => ({ default: module.SetupAssistant })));

function SetupBackdrop({ children, }: { children: ReactNode }) {
  const p = usePreferences();
  const background = resolveDesktopBackground(p, preferences.get<PersonalWallpaper | null>('personalWallpaper', null));
  return <main className="setup-screen" {...appearanceAttributes(p)} style={appearanceStyle(p)}><SetupBackground background={background} reduceMotion={p.reduceMotion}/><header className="setup-masthead"><div className="setup-brand"><LopeMark size={25}/><div>Lope<span>OS</span></div></div><span>Setup Assistant</span></header>{children}</main>;
}
export function FirstRun() {
  const p = usePreferences();
  const [resetFlow, setResetFlow] = useState<{ request: FactoryResetRequest; restart: boolean } | null>(() => {
    const request = readFactoryResetRequest();
    return request ? { request, restart: false } : null;
  });
  const resetRef = useRef(resetFlow); resetRef.current = resetFlow;
  useEffect(() => {
    if (resetFlow) softwareUpdates.pauseForReset();
    else void softwareUpdates.start();
  }, [!!resetFlow]);
  const [resetReady, setResetReady] = useState(false);
  const [screen, setScreen] = useState<'loading' | 'setup' | 'desktop' | 'error'>('loading');
  const [error, setError] = useState('');
  const [appearanceVersion, setAppearanceVersion] = useState(0);
  useLayoutEffect(() => { syncDocumentAppearance(p); }, [p, appearanceVersion]);
  useLayoutEffect(() => {
    if (resetFlow) document.documentElement.dataset.resetting = 'true';
    else delete document.documentElement.dataset.resetting;
  }, [resetFlow]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setAppearanceVersion(value => value + 1);
    media.addEventListener('change', change);
    const timer = setInterval(change, 60_000);
    return () => { media.removeEventListener('change', change); clearInterval(timer); };
  }, []);
  async function refresh() {
    if (resetRef.current) return;
    let completed = false;
    try { completed = localStorage.getItem('lope.setup.complete.v1') === '1'; } catch { /* Guest sessions can run without persistent storage. */ }
    // Existing local accounts keep their preferences while upgrading to optional cloud accounts.
    // They no longer lock users out of their own browser workspace.
    try {
      const legacy = await accounts.list();
      const session = accounts.getSession();
      const previous = session || legacy[0];
      if (previous && !preferences.getActiveUser()) preferences.activateUser(previous.id);
      completed ||= legacy.length > 0;
    } catch { /* A damaged legacy account index must not make guest use impossible. */ }
    if (resetRef.current) return;
    setScreen(completed ? 'desktop' : 'setup'); setError('');
    void cloudAccount.initialize().then(() => {
      if (!resetRef.current && cloudAccount.getSnapshot().account) {
        try { localStorage.setItem('lope.setup.complete.v1', '1'); } catch { /* The account remains usable for this session. */ }
        setScreen('desktop');
      }
    }).catch(() => { /* Account status reports connectivity; local use stays available. */ });
  }
  useEffect(() => {
    if (!resetRef.current) void refresh();
    const signOut = () => { if (!resetRef.current) setScreen('desktop'); };
    const beginReset = (request: FactoryResetRequest | null) => {
      if (!request || resetRef.current?.request.id === request.id) return;
      try { rememberFactoryResetForTab(request); }
      catch { /* Reload still retires this tab if its session storage is blocked. */ }
      const flow = { request, restart: true };
      resetRef.current = flow;
      setResetReady(false);
      setResetFlow(flow);
    };
    const reset = () => beginReset(readFactoryResetRequest());
    const storage = (event: StorageEvent) => {
      // A suspended tab can receive this after the shared reset already finished.
      if (event.key === RESET_STORAGE_KEY && event.newValue) beginReset(parseFactoryResetRequest(event.newValue));
    };
    window.addEventListener('lope:sign-out', signOut);
    window.addEventListener('lope:reset-requested', reset);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('lope:sign-out', signOut);
      window.removeEventListener('lope:reset-requested', reset);
      window.removeEventListener('storage', storage);
    };
  }, []);
  const signedIn = () => setScreen('desktop');
  const content = resetFlow && !resetReady ? null : screen === 'desktop' ? <Shell/> :
    <SetupBackdrop>{screen === 'setup' ? <SetupAssistant onSignedIn={signedIn}/> : <section className="setup-panel setup-login setup-loading" aria-label="Open LopeOS"><LopeMark size={40}/>{error ? <><p role="alert" className="setup-error">{error}</p><Button type="button" onClick={() => { void refresh(); }}>Try again</Button></> : <p role="status">Opening LopeOS…</p>}</section>}</SetupBackdrop>;
  return <><Suspense fallback={resetFlow ? null : <SetupBackdrop><section className="setup-panel setup-login setup-loading" aria-label="Open LopeOS"><LopeMark size={40}/><p role="status">Opening LopeOS…</p></section></SetupBackdrop>}>{content}</Suspense>{resetFlow && <ResetScreen key={resetFlow.request.id} request={resetFlow.request} restart={resetFlow.restart}
    onReady={async () => {
      await loadSetup();
      if (resetRef.current?.request.id !== resetFlow.request.id || resetRef.current.restart) return;
      setError(''); setScreen('setup'); setResetReady(true);
    }}
    onComplete={() => { resetRef.current = null; setResetFlow(null); }}/>}</>;
}
