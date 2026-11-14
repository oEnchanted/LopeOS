import { useEffect, useRef, useState } from 'react';
import { Check, Cpu, Download, FolderOpen, HardDrive, RotateCcw, Save, Scale, ShieldCheck, Shuffle, Sparkles, Square, Trash2, TriangleAlert, Wand2 } from 'lucide-react';
import type { AppContext } from '../../../../../packages/contracts/src';
import { Button, Dialog } from '../../../../../packages/ui/src';
import { AppIcon } from '../../shell/Icons';
import { formatBytes, useAppCommands } from '../hooks';
import { GENERATOR_BYTES, GENERATOR_MODEL, inspectGenerator, installGenerator, removeGenerator, type InstallProgress } from './catalog';
import type { EngineMessage, EnginePhase } from './protocol';
import '../application.css';
import './image-generator.css';

type Result = { url: string; blob: Blob; prompt: string; seed: number; steps: number; durationMs: number };
type Install = { state: 'checking' | 'missing' | 'downloading' | 'installed'; partial: boolean; missingBytes: number };
type Engine = { phase: EnginePhase; text: string; progress: number; device: string };
type Job = { id: number; text: string; progress: number };
type GPUCheck = { state: 'checking' } | { state: 'ready'; device: string } | { state: 'unsupported'; reason: string };
type Adapter = { features: { has(name: string): boolean }; info?: { vendor?: string; architecture?: string; description?: string } };

const MAX_SEED = 2147483647;
const randomSeed = () => Math.floor(Math.random() * MAX_SEED);
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
const QUALITY = [{ steps: 1, label: 'Fast' }, { steps: 2, label: 'Balanced' }, { steps: 4, label: 'Detailed' }] as const;
const qualityLabel = (steps: number) => QUALITY.find(q => q.steps === steps)?.label ?? `${steps} steps`;
const IDEAS = [
  'A lighthouse on a rocky cliff at sunset, soft watercolor',
  'A red fox resting in fresh snow, wildlife photograph',
  'A cozy reading nook with plants and warm lamplight, illustration',
  'Glass sculpture of a jellyfish, studio lighting, dark background',
];
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? '⌘' : 'Ctrl';

async function checkGPU(): Promise<GPUCheck> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(options?: object): Promise<Adapter | null> } }).gpu;
  if (!globalThis.isSecureContext) return { state: 'unsupported', reason: 'Needs HTTPS or localhost' };
  if (!gpu) return { state: 'unsupported', reason: 'WebGPU isn’t available in this browser' };
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  if (!adapter) return { state: 'unsupported', reason: 'No compatible graphics card. Turn on hardware acceleration.' };
  if (!adapter.features.has('shader-f16')) return { state: 'unsupported', reason: 'This graphics card lacks 16-bit shader support' };
  const info = adapter.info ?? {};
  const name = [info.vendor, info.architecture].filter(Boolean).map(v => v!.charAt(0).toUpperCase() + v!.slice(1)).join(' ');
  return { state: 'ready', device: info.description || (name ? `${name} GPU` : 'Compatible graphics card') };
}

export default function ImageGenerator({ context }: { context: AppContext }) {
  const [install, setInstall] = useState<Install>({ state: 'checking', partial: false, missingBytes: GENERATOR_BYTES });
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [speed, setSpeed] = useState(0);
  const [gpu, setGPU] = useState<GPUCheck>({ state: 'checking' });
  const [engineState, setEngine] = useState<Engine>({ phase: 'idle', text: 'Loads when you open Image Generator', progress: 0, device: '' });
  const [prompt, setPrompt] = useState('');
  const [steps, setSteps] = useState(1);
  const [seed, setSeed] = useState(randomSeed);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const download = useRef<AbortController | null>(null);
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, { resolve: (value: { blob: Blob; durationMs: number }) => void; reject: (error: Error) => void }>());
  const promptField = useRef<HTMLTextAreaElement>(null);
  const rate = useRef<{ time: number; bytes: number }[]>([]);
  const busy = job !== null;
  const current = results[selected];
  const installed = install.state === 'installed';

  async function refreshInstall() {
    const result = await inspectGenerator().catch(() => ({ installed: false, partial: false, missingBytes: GENERATOR_BYTES }));
    setInstall({ state: result.installed ? 'installed' : 'missing', partial: result.partial, missingBytes: result.missingBytes });
  }
  useEffect(() => { void refreshInstall(); checkGPU().then(setGPU, () => setGPU({ state: 'unsupported', reason: 'Graphics check failed' })); }, []);
  useEffect(() => () => { download.current?.abort(); worker.current?.terminate(); }, []);
  const urls = useRef<string[]>([]); urls.current = results.map(r => r.url);
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  // Warm the GPU as soon as the model is available so the first image starts quickly.
  useEffect(() => { if (installed && gpu.state === 'ready') engine().postMessage({ type: 'load' }); }, [installed, gpu.state]);

  function engine() {
    if (worker.current) return worker.current;
    const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = ({ data }: MessageEvent<EngineMessage>) => {
      if (data.type === 'engine') { setEngine(previous => ({ phase: data.phase, text: data.text, progress: data.progress ?? previous.progress, device: data.device ?? previous.device })); return; }
      if (data.type === 'progress') { setJob(value => value && value.id === data.id ? { ...value, text: data.text, progress: data.progress } : value); return; }
      const entry = pending.current.get(data.id); if (!entry) return;
      pending.current.delete(data.id);
      data.error || !data.result ? entry.reject(new Error(data.error || 'Image generation failed.')) : entry.resolve(data.result);
    };
    created.onerror = event => {
      pending.current.forEach(entry => entry.reject(new Error(event.message || 'The image engine stopped.'))); pending.current.clear();
      worker.current = null; setEngine(value => ({ ...value, phase: 'error', text: 'The image engine stopped. It will restart on the next image.' }));
    };
    return worker.current = created;
  }
  function stopEngine(text: string) {
    worker.current?.terminate(); worker.current = null;
    setEngine(value => ({ ...value, phase: 'idle', text, progress: 0 }));
  }

  async function startDownload() {
    if (install.state === 'downloading') return;
    const controller = new AbortController(); download.current = controller;
    rate.current = [];
    setError(''); setInstall(value => ({ ...value, state: 'downloading' })); setProgress(null); setSpeed(0);
    try {
      await installGenerator(controller.signal, value => {
        setProgress(value);
        const now = performance.now(), samples = rate.current;
        samples.push({ time: now, bytes: value.network });
        while (samples.length > 2 && samples[0].time < now - 3000) samples.shift();
        const elapsed = (now - samples[0].time) / 1000;
        if (elapsed > .3) setSpeed((value.network - samples[0].bytes) / elapsed);
      });
      await refreshInstall();
      context.services.notify({ title: 'Image Generator', message: 'The model is downloaded and ready.', tone: 'success' });
    } catch (cause) {
      await refreshInstall();
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The download failed.');
    } finally { download.current = null; }
  }
  async function remove() {
    setConfirmRemove(false);
    if (busy) return;
    stopEngine('Not loaded'); setResults([]);
    await removeGenerator(); await refreshInstall();
  }
  async function generate() {
    const text = prompt.trim();
    if (busy || !installed || !text) return;
    const id = Date.now(), request = { prompt: text, seed, steps };
    setError(''); setJob({ id, text: engineState.phase === 'ready' ? 'Reading your prompt…' : 'Loading the model onto the GPU…', progress: 0 });
    try {
      const output = await new Promise<{ blob: Blob; durationMs: number }>((resolve, reject) => { pending.current.set(id, { resolve, reject }); engine().postMessage({ type: 'generate', id, ...request }); });
      setResults(list => {
        const next = [{ ...request, ...output, url: URL.createObjectURL(output.blob) }, ...list];
        next.slice(24).forEach(old => URL.revokeObjectURL(old.url));
        return next.slice(0, 24);
      });
      setSelected(0); setSeed(randomSeed());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Image generation failed.';
      if (message !== 'Generation stopped.') setError(message);
    } finally { setJob(null); }
  }
  function cancel() {
    stopEngine('Stopped. Reloads on the next image.');
    pending.current.forEach(entry => entry.reject(new Error('Generation stopped.'))); pending.current.clear();
    if (installed && gpu.state === 'ready') engine().postMessage({ type: 'load' });
  }
  async function save() {
    if (!current) return;
    const fs = context.services.files;
    if (!fs.writeBinary) { setError('Saving images is unavailable in this workspace. Use Download instead.'); return; }
    try {
      await fs.mkdir('/Pictures').catch(() => {});
      const path = `/Pictures/${slug(current.prompt)}-${current.seed}.png`;
      await fs.writeBinary(path, new Uint8Array(await current.blob.arrayBuffer()), { createOnly: true });
      context.services.notify({ title: 'Saved to Pictures', message: path.slice(10), tone: 'success' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The image could not be saved.'); }
  }
  function downloadImage() {
    if (!current) return;
    const link = document.createElement('a'); link.href = current.url; link.download = `${slug(current.prompt)}-${current.seed}.png`; link.click();
  }
  function reuse(result: Result) { setPrompt(result.prompt); setSeed(result.seed); setSteps(result.steps); promptField.current?.focus(); }
  function useIdea(idea: string) { setPrompt(idea); promptField.current?.focus(); }

  useAppCommands(context, [
    { id: 'generator.generate', label: 'Generate', shortcut: 'Mod+Enter', enabled: () => installed && !busy && !!prompt.trim(), execute: generate },
    { id: 'generator.stop', label: 'Stop Generating', enabled: () => busy, execute: cancel },
    { id: 'generator.save', label: 'Save to Pictures', shortcut: 'Mod+S', enabled: () => !!current, execute: save },
    { id: 'generator.download', label: 'Download PNG', enabled: () => !!current, execute: downloadImage },
    { id: 'generator.reuse', label: 'Reuse Prompt and Seed', enabled: () => !!current && !busy, execute: () => current && reuse(current) },
    { id: 'generator.random-seed', label: 'New Random Seed', execute: () => setSeed(randomSeed()) },
    { id: 'generator.install', label: 'Download Model…', enabled: () => install.state === 'missing', execute: startDownload },
    { id: 'generator.remove', label: 'Delete Downloaded Model…', enabled: () => installed && !busy, execute: () => setConfirmRemove(true) },
  ]);

  if (!installed) return <InstallView install={install} progress={progress} speed={speed} gpu={gpu} error={error} onDownload={startDownload} onCancel={() => download.current?.abort()}/>;

  const stageBusy = busy ? job : null;
  const engineReady = engineState.phase === 'ready';
  return <div className="lope-app image-generator generator-workspace">
    <aside className="generator-sidebar" aria-label="Image settings">
      <div className="generator-sidebar-scroll">
        <section className="generator-group">
          <label className="generator-group-title" htmlFor="generator-prompt">Prompt</label>
          <div className="generator-card generator-prompt">
            <textarea id="generator-prompt" ref={promptField} rows={5} value={prompt} placeholder="Describe the image you want to create…" maxLength={600} spellCheck
              onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(); } }}/>
            <div className="generator-prompt-footer"><span>{prompt.length ? `${prompt.length} / 600` : 'Subject, setting, style, lighting'}</span>{prompt && <button type="button" onClick={() => { setPrompt(''); promptField.current?.focus(); }}>Clear</button>}</div>
          </div>
        </section>
        <section className="generator-group">
          <h2 className="generator-group-title">Options</h2>
          <div className="generator-card">
            <div className="generator-row generator-row--stacked">
              <span className="generator-row-label" id="generator-quality">Quality</span>
              <div className="generator-segmented" role="radiogroup" aria-labelledby="generator-quality">
                {QUALITY.map(q => <button key={q.steps} type="button" role="radio" aria-checked={steps === q.steps} onClick={() => setSteps(q.steps)}>{q.label}</button>)}
              </div>
              <p>{steps === 1 ? 'One pass. Quickest, great for exploring.' : steps === 2 ? 'Two passes. Cleaner shapes and edges.' : 'Four passes. Finer texture and detail.'}</p>
            </div>
            <div className="generator-row">
              <label className="generator-row-label" htmlFor="generator-seed">Seed</label>
              <div className="generator-seed">
                <input id="generator-seed" type="number" inputMode="numeric" min={0} max={MAX_SEED} value={seed} onChange={e => setSeed(Math.max(0, Math.min(MAX_SEED, Number(e.target.value) | 0)))}/>
                <button type="button" className="generator-icon-button" aria-label="New random seed" title="New random seed" onClick={() => setSeed(randomSeed())}><Shuffle size={13}/></button>
              </div>
            </div>
          </div>
          <p className="generator-note">The same prompt and seed recreate the same image. 512 × 512 pixels.</p>
        </section>
      </div>
      <div className="generator-sidebar-footer">
        {busy ? <Button className="generator-primary" onClick={cancel}><Square size={12}/>Stop</Button>
          : <Button className="generator-primary" variant="primary" disabled={!prompt.trim() || gpu.state === 'unsupported'} onClick={generate}><Sparkles size={14}/>Generate<kbd>{modKey} ↵</kbd></Button>}
        <div className={'generator-engine generator-engine--' + engineState.phase} role="status">
          <span className="generator-engine-dot" aria-hidden="true"/>
          <div><strong>{gpu.state === 'unsupported' ? 'Graphics unavailable' : engineReady ? 'Ready on the GPU' : engineState.phase === 'loading' ? 'Loading onto the GPU' : engineState.phase === 'error' ? 'Engine problem' : 'Model downloaded'}</strong>
            <small>{gpu.state === 'unsupported' ? gpu.reason : engineState.phase === 'loading' ? engineState.text : engineState.phase === 'error' ? engineState.text : engineState.device || (gpu.state === 'ready' ? gpu.device : engineState.text)}</small>
            {engineState.phase === 'loading' && <i className="generator-engine-track"><b style={{ width: Math.max(4, engineState.progress * 100) + '%' }}/></i>}
          </div>
          <button type="button" className="generator-icon-button" aria-label="Delete downloaded model" title="Delete downloaded model" disabled={busy} onClick={() => setConfirmRemove(true)}><Trash2 size={13}/></button>
        </div>
      </div>
    </aside>
    <main className="generator-content">
      <header className="generator-toolbar">
        <strong title={current?.prompt}>{current ? current.prompt : 'New image'}</strong>
        {current && <div className="generator-toolbar-actions">
          <button type="button" className="generator-tool" onClick={() => reuse(current)} disabled={busy} title="Reuse prompt and seed"><RotateCcw size={14}/><span>Reuse</span></button>
          <button type="button" className="generator-tool" onClick={save} title={`Save to Pictures (${modKey}S)`}><Save size={14}/><span>Save</span></button>
          <button type="button" className="generator-tool" onClick={downloadImage} title="Download PNG"><Download size={14}/><span>Download</span></button>
          <button type="button" className="generator-tool generator-tool--icon" aria-label="Open Pictures" title="Open Pictures" onClick={() => context.services.launch('lope.files', { path: '/Pictures' })}><FolderOpen size={14}/></button>
        </div>}
      </header>
      <div className="generator-stage-area">
        <figure className={'generator-frame' + (current ? ' has-image' : '') + (stageBusy ? ' is-busy' : '')}>
          {current ? <img src={current.url} alt={current.prompt}/> : !stageBusy && <div className="generator-empty">
            <span className="generator-empty-icon"><Wand2 size={22} strokeWidth={1.6}/></span>
            <h1>Describe an image</h1>
            <p>Write a prompt and choose Generate. Everything runs on this device.</p>
            <div className="generator-ideas" aria-label="Prompt ideas">{IDEAS.map(idea => <button type="button" key={idea} onClick={() => useIdea(idea)}>{idea}</button>)}</div>
          </div>}
          {stageBusy && <div className="generator-progress-overlay">
            <div className="generator-progress-pill glass" role="status" aria-live="polite"><span className="generator-spinner" aria-hidden="true"/>{stageBusy.text}</div>
            <i className="generator-progress-line" role="progressbar" aria-label="Generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stageBusy.progress * 100)}><b style={{ width: Math.max(3, stageBusy.progress * 100) + '%' }}/></i>
          </div>}
        </figure>
        {current && <figcaption className="generator-meta"><span>Seed {current.seed}</span><span>{qualityLabel(current.steps)}</span><span>{(current.durationMs / 1000).toFixed(1)} s</span><span>512 × 512</span></figcaption>}
        {error && <div className="generator-error" role="alert"><TriangleAlert size={15}/><div><strong>Couldn’t generate</strong><p>{error}</p></div><button type="button" onClick={() => setError('')}>Dismiss</button></div>}
      </div>
      {results.length > 0 && <nav className="generator-history" aria-label="Recent images">
        {results.map((result, index) => <button key={result.url} type="button" aria-pressed={index === selected} onClick={() => setSelected(index)} aria-label={`${result.prompt}, seed ${result.seed}`} title={result.prompt}><img src={result.url} alt=""/></button>)}
      </nav>}
    </main>
    {confirmRemove && <Dialog title="Delete the downloaded model?" onClose={() => setConfirmRemove(false)}>
      <p className="generator-dialog-copy">This frees about {formatBytes(GENERATOR_BYTES)} of browser storage. Images you saved to Pictures are kept. You can download the model again later.</p>
      <div className="generator-dialog-actions"><Button onClick={() => setConfirmRemove(false)}>Cancel</Button><Button variant="primary" className="generator-destructive" onClick={remove}>Delete model</Button></div>
    </Dialog>}
  </div>;
}

function InstallView({ install, progress, speed, gpu, error, onDownload, onCancel }: { install: Install; progress: InstallProgress | null; speed: number; gpu: GPUCheck; error: string; onDownload: () => void; onCancel: () => void }) {
  const downloading = install.state === 'downloading';
  const percent = progress ? Math.min(100, progress.loaded / progress.total * 100) : 0;
  const update = install.partial && !downloading;
  return <div className="lope-app image-generator generator-setup">
    <div className="generator-setup-page">
      <header className="generator-setup-heading">
        <AppIcon name="image-generator" size={72}/>
        <h1>{update ? 'Update Image Generator' : 'Image Generator'}</h1>
        <p>{update ? 'A newer graphics engine is needed to run the model on your GPU. Your downloaded model is kept.' : 'Turn a sentence into a picture with an AI model that runs on your graphics card. Prompts and images never leave this device.'}</p>
      </header>

      <section className="generator-setup-group">
        <h2>About this download</h2>
        <div className="generator-card">
          <SetupRow icon={<Wand2 size={15}/>} label="Model" value={GENERATOR_MODEL.name}/>
          <SetupRow icon={<HardDrive size={15}/>} label={update ? 'Update size' : 'Download size'} value={`${formatBytes(install.missingBytes)} · saved in this browser`}/>
          <SetupRow icon={<Cpu size={15}/>} label="Graphics" value={gpu.state === 'checking' ? 'Checking…' : gpu.state === 'ready' ? gpu.device : gpu.reason}
            status={gpu.state === 'ready' ? <span className="generator-pill generator-pill--ok"><Check size={11}/>WebGPU ready</span> : gpu.state === 'unsupported' ? <span className="generator-pill generator-pill--warn">Unavailable</span> : undefined}/>
          <SetupRow icon={<ShieldCheck size={15}/>} label="Privacy" value="Runs offline once downloaded. Nothing is uploaded."/>
          <SetupRow icon={<Scale size={15}/>} label="License" value={<><a href={GENERATOR_MODEL.licenseURL} target="_blank" rel="noreferrer">Stability AI Community License</a> · personal and research use</>}/>
        </div>
      </section>

      <div className="generator-setup-action">
        {downloading ? <div className="generator-transfer">
          <div className="generator-transfer-label"><span>{progress ? `Downloading ${progress.label.toLowerCase()}…` : 'Preparing download…'}</span><span>{(speed / 1e6).toFixed(1)} MB/s</span></div>
          <progress aria-label="Model download progress" max={100} value={percent}/>
          <div className="generator-transfer-detail"><span>{progress ? `${formatBytes(progress.loaded)} of ${formatBytes(progress.total)}` : ' '}</span><span>{Math.floor(percent)}%</span></div>
          <Button onClick={onCancel}><Square size={11}/>Cancel download</Button>
        </div> : <>
          <Button className="generator-primary" variant="primary" disabled={install.state === 'checking'} onClick={onDownload}><Download size={14}/>{install.state === 'checking' ? 'Checking…' : update ? `Download update · ${formatBytes(install.missingBytes)}` : error ? 'Try again' : `Download model · ${formatBytes(install.missingBytes)}`}</Button>
          <small>{gpu.state === 'unsupported' ? 'You can download now and generate later in a browser with WebGPU.' : 'Keep this window open while it downloads. Finished files are kept if you stop.'}</small>
        </>}
        {error && <div className="generator-error" role="alert"><TriangleAlert size={15}/><div><strong>Download stopped</strong><p>{error}</p></div></div>}
      </div>
    </div>
  </div>;
}

function SetupRow({ icon, label, value, status }: { icon: React.ReactNode; label: string; value: React.ReactNode; status?: React.ReactNode }) {
  return <div className="generator-row generator-setup-row"><span className="generator-row-icon" aria-hidden="true">{icon}</span><span className="generator-row-label">{label}</span><span className="generator-row-value">{value}</span>{status}</div>;
}
