import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Accessibility, ArrowRight, Check, CircleCheck, Cpu, Palette, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '../../../../packages/ui/src';
import { SettingSwitch } from '../../../../packages/ui/src/settings';
import { preferences, usePreferences, type Preferences } from '../../../../packages/sdk/src/preferences';
import { type LocalAccount } from '../../../../packages/sdk/src/accounts';
import { AppIcon } from '../shell/Icons';
import { skyOptions } from '../shell/background';
import { LocalModelsStep, LocalModelsSummary } from './LocalModelsStep';
import { AccountPanel } from '../accounts/AccountPanel';
import { useCloudAccount } from '../accounts/service';

export const SETUP_COMPLETE_KEY = 'lope.setup.complete.v1';
const steps = ['Welcome', 'Appearance', 'Privacy', 'Accessibility', 'Local AI', 'Account', 'Finish'];
const AI_STEP = 4, ACCOUNT_STEP = 5, FINISH_STEP = 6;
const titles = ['Welcome to LopeOS', 'Appearance', 'Privacy & storage', 'Accessibility', 'Local AI', 'LopeOS Account', 'Review setup'];
const subtitles = ['Set up your desktop, storage, and accessibility preferences. You can change them later in Settings.', '', '', '', 'Optional model downloads for chat and photo editing on this device.', 'Create an account, sign in, or continue without one.', ''];
const symbols = [null, Palette, ShieldCheck, Accessibility, Cpu, UserRound, CircleCheck];
const accents = [['Ocean', '#167bac'], ['Iris', '#7756c5'], ['Rose', '#b94672'], ['Clay', '#af6037'], ['Forest', '#26785d'], ['Graphite', '#526775']];
const disclosures = [
  ['Browser limitations', 'A browser desktop with limits on native apps and device access.', 'LopeOS runs in your browser. It cannot replace your operating system or run native apps. Files, Terminal, and Lope Browser use their configured services. Device access depends on browser support and your permission.'],
  ["Your computer’s files", 'Choose files to add to LopeOS.', 'LopeOS cannot freely read your computer’s files. You choose what to add. Downloads are separate copies; editing them does not automatically update the original file on your device.'],
  ['Optional cloud account', '1 GB of free storage, with automatic sync.', 'An account backs up your LopeOS settings, app data, saved layout, photos, recovery drafts, and workspace files to the account server. Existing local work is included when you sign in. Stay signed in and connected for changes to sync; Files shows storage usage and transfer progress.'],
  ['Local storage', 'Use LopeOS without an account.', 'Without an account, preferences and app data stay in this browser, and workspace files use the connected workspace service. Clearing browser data can remove local work or your workspace connection. You can create a cloud account later in Settings.'],
  ['Local AI', 'Optional downloads. Chat and photo processing run on your device.', 'AI packages download only when you choose, from LopeOS or the model and runtime hosts shown in setup. Models are saved in this browser and are not uploaded to your account. Optional Generative Fill uses your separately configured local ComfyUI server.'],
  ['Connected services', 'Lope Browser, Terminal, and Weather have separate connections.', 'Remote browser profiles, cookies, terminal processes, and credentials are managed by their services and are not included in account sync. Passwords are hashed on the account server. Cloud storage is not end-to-end encrypted.'],
];
function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="setup-toggle-row"><div><strong>{label}</strong><p>{hint}</p></div><SettingSwitch label={label} checked={checked} onChange={onChange}/></div>;
}
function ThemePreview({ theme }: { theme: string }) {
  return <span className={'setup-mini setup-mini--' + theme} data-glass-tone={theme === 'system' ? undefined : theme} aria-hidden="true"><span className="setup-mini-window"><i/><i/><i/><span className="setup-mini-sidebar"/><b/><b/><b/></span><span className="setup-mini-dock"/></span>;
}
export function SetupAssistant({ onSignedIn }: { existingAccounts?: LocalAccount[]; onSignedIn: () => void; onLogin?: () => void }) {
  const p = usePreferences();
  const cloud = useCloudAccount();
  const [step, setStep] = useState(0); const [direction, setDirection] = useState(1);
  const [accountBusy, setAccountBusy] = useState(false);
  const [persist, setPersist] = useState(true);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null); const body = useRef<HTMLDivElement>(null); const form = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); body.current?.scrollTo(0, 0); }, [step]);
  function navigate(next: number) { setError(''); setDirection(next >= step ? 1 : -1); setStep(next); }
  function change(values: Partial<Preferences>) { preferences.apply(values); }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (accountBusy) return;
    if (step !== FINISH_STEP) { navigate(step + 1); return; }
    try { localStorage.setItem(SETUP_COMPLETE_KEY, '1'); }
    catch { /* The desktop remains usable for this session when site storage is blocked. */ }
    if (persist) { try { void navigator.storage?.persist?.().catch(() => {}); } catch { /* Browser storage protection is optional. */ } }
    onSignedIn();
  }
  const Symbol = symbols[step];
  const defaultWallpaper = p.theme === 'dark' || p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches ? 'perfecthue-dark' : 'perfecthue-light';
  const usingWallpaper = p.wallpaper !== 'sky';
  return <section className="setup-section" aria-label="Set up LopeOS">
    <form ref={form} className="setup-panel" onSubmit={submit} onKeyDown={event => { if (event.key === 'Enter' && event.target === heading.current) { event.preventDefault(); form.current?.requestSubmit(); } }} noValidate style={{ '--setup-direction': direction } as CSSProperties}>
      <nav className="setup-progress" aria-label="Setup progress">{steps.map((label, index) => <button key={label} type="button" aria-label={label} aria-current={index === step ? 'step' : undefined} disabled={index > step || accountBusy} onClick={() => navigate(index)}><span className="setup-step-indicator" aria-hidden="true">{index < step ? <Check size={11}/> : index + 1}</span><span className="setup-step-label">{label}</span></button>)}</nav>
      <div className="setup-body" ref={body}><div className={'setup-page' + (step === 0 ? ' setup-page--welcome' : '')} key={step}>
        <header className="setup-heading"><div className="setup-symbol" aria-hidden="true">{step === 0 ? <AppIcon name="welcome" size={92}/> : Symbol && <Symbol size={30} strokeWidth={1.5}/>}</div><h1 tabIndex={-1} ref={heading}>{titles[step]}</h1>{subtitles[step] && <p>{subtitles[step]}</p>}</header>
        <div className="setup-content">
            {step === 1 && <div className="setup-appearance">
              <fieldset><legend>Appearance</legend><div className="setup-theme-grid">{([['dark', 'Dark'], ['light', 'Light'], ['system', 'Automatic']] as const).map(([theme, label]) => <button type="button" key={theme} aria-pressed={p.theme === theme} onClick={() => change({ theme, ...(usingWallpaper ? { wallpaper: theme === 'dark' || theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches ? 'perfecthue-dark' : 'perfecthue-light' } : {}) })}><ThemePreview theme={theme}/><span>{label}</span></button>)}</div></fieldset>
              <fieldset><legend>Wallpaper</legend><button type="button" className="setup-wallpaper-card" aria-pressed={usingWallpaper} onClick={() => change({ wallpaper: defaultWallpaper })}><span className="setup-wallpaper-thumb" style={{ backgroundImage: `url(/wallpapers/perfecthue-aurora-${defaultWallpaper === 'perfecthue-dark' ? 'dark' : 'light'}.png)` }} aria-hidden="true"/><span><strong>Aurora Glass</strong><small>LopeOS desktop · by Perfect Hue</small></span>{usingWallpaper && <Check size={17} aria-hidden="true"/>}</button></fieldset>
              <fieldset><legend>Sky backgrounds</legend><div className="setup-sky-grid">{skyOptions.map(option => <button type="button" key={option.id} aria-label={option.name + ' sky'} aria-pressed={!usingWallpaper && p.background === option.id} onClick={() => change({ wallpaper: 'sky', background: option.id })}><span className={'setup-sky-swatch setup-sky--' + option.id} aria-hidden="true">{!usingWallpaper && p.background === option.id && <Check size={13}/>}</span><span>{option.name}</span></button>)}</div></fieldset>
              <fieldset><legend>Accent colour</legend><div className="setup-accents">{accents.map(([name, color]) => <button type="button" key={name} aria-label={name.toLowerCase() + ' accent'} aria-pressed={p.accent === color} onClick={() => change({ accent: color })} style={{ '--swatch': color } as CSSProperties}><span>{p.accent === color && <Check size={13} aria-hidden="true"/>}</span></button>)}</div></fieldset>
            </div>}
            {step === 2 && <><div className="setup-disclosures">{disclosures.map(([title, summary, detail]) => <details key={title}><summary><span><strong>{title}</strong><small>{summary}</small></span><i aria-hidden="true"/></summary><p>{detail}</p></details>)}</div><ToggleRow label="Request persistent storage" hint="Ask the browser to protect saved data from automatic cleanup. Clearing site data still removes it." checked={persist} onChange={setPersist}/></>}
            {step === 3 && <><div className="setup-accessibility"><ToggleRow label="Reduce transparency" hint="Use solid surfaces instead of background blur." checked={p.reduceTransparency} onChange={reduceTransparency => change({ reduceTransparency })}/><ToggleRow label="Increase contrast" hint="Make text and control edges more distinct." checked={p.increaseContrast} onChange={increaseContrast => change({ increaseContrast })}/><ToggleRow label="Reduce motion" hint="Stop moving backgrounds and interface animations." checked={p.reduceMotion} onChange={reduceMotion => change({ reduceMotion })}/></div><div className="setup-text-size"><label htmlFor="setup-text-size">Text size <output htmlFor="setup-text-size">{p.textSize}%</output></label><input id="setup-text-size" aria-label="Text size" type="range" min={85} max={150} step={5} value={p.textSize} onChange={event => change({ textSize: Number(event.target.value) })}/></div><div className="setup-text-preview"><p>The quick brown fox jumps over the lazy dog.</p><small>Preview of your text size</small></div></>}
            {step === AI_STEP && <LocalModelsStep/>}
          {step === ACCOUNT_STEP && <AccountPanel embedded onBusyChange={setAccountBusy} onAuthenticated={() => navigate(FINISH_STEP)}/>}
          {step === FINISH_STEP && <><div className="setup-review-person"><span className="setup-avatar" style={{ width: 70, height: 70 }}><UserRound size={30}/></span><h2>{cloud.account?.displayName || p.profileName || 'Your workspace'}</h2><p>{cloud.account ? '@' + cloud.account.accountName : 'No account'}</p></div><dl className="setup-review"><div><dt>Account</dt><dd><span>{cloud.account ? '1 GB storage · automatic sync' : 'Continue without an account'}</span><button type="button" className="setup-link" onClick={() => navigate(ACCOUNT_STEP)}>{cloud.account ? 'View account' : 'Add an account'}</button></dd></div><div><dt>Appearance</dt><dd><span>{p.theme === 'system' ? 'Automatic' : p.theme === 'dark' ? 'Dark' : 'Light'}</span><button type="button" className="setup-link" onClick={() => navigate(1)}>Edit appearance</button></dd></div><div><dt>Local AI</dt><dd><LocalModelsSummary/><button type="button" className="setup-link" onClick={() => navigate(AI_STEP)}>Edit local AI</button></dd></div><div><dt>Storage protection</dt><dd>{persist ? 'Request from browser' : 'Standard browser storage'}</dd></div></dl><p className="setup-account-note">{cloud.account ? 'Open LopeDrive in Files to see your backup progress.' : 'Create an account later in Settings to back up your existing work.'}</p></>}
          {error && <p className="setup-error" role="alert">{error}</p>}
        </div>
      </div></div>
      <footer className="setup-footer"><div>{step === 0 ? <span>Step 1 of {steps.length}</span> : <Button type="button" variant="ghost" disabled={accountBusy} onClick={() => navigate(step - 1)}>Back</Button>}</div><span>{step > 0 ? `${step + 1} of ${steps.length}` : ''}</span><Button type="submit" variant="primary" disabled={accountBusy}>{step === 0 ? 'Get started' : step === FINISH_STEP ? 'Finish setup' : step === ACCOUNT_STEP && !cloud.account ? 'Continue without account' : 'Continue'}{step === 0 && <ArrowRight size={14} aria-hidden="true"/>}</Button></footer>
    </form>
  </section>;
}
