import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, ImagePlus, Save, Shuffle, Sparkles, Trash2, X } from 'lucide-react';
import type { AppContext } from '../../../../../packages/contracts/src';
import { Button, Input } from '../../../../../packages/ui/src';
import { formatBytes, useAppCommands } from '../hooks';
import { GENERATOR_BYTES, GENERATOR_MODEL, generatorInstalled, installGenerator, removeGenerator, type InstallProgress } from './catalog';
import './image-generator.css';

type Result = { url: string; blob: Blob; prompt: string; seed: number; steps: number; durationMs: number };
type Install = 'checking' | 'missing' | 'downloading' | 'installed';
const randomSeed = () => Math.floor(Math.random() * 2147483647);
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

export default function ImageGenerator({ context }: { context: AppContext }) {
  const [install, setInstall] = useState<Install>('checking');
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [prompt, setPrompt] = useState('');
  const [steps, setSteps] = useState(1);
  const [seed, setSeed] = useState(randomSeed);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState(0);
  const download = useRef<AbortController | null>(null);
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, { resolve: (value: { blob: Blob; durationMs: number }) => void; reject: (error: Error) => void }>());
  const current = results[selected];

  useEffect(() => { generatorInstalled().then(ok => setInstall(ok ? 'installed' : 'missing'), () => setInstall('missing')); }, []);
  useEffect(() => () => { download.current?.abort(); worker.current?.terminate(); }, []);
  const urls = useRef<string[]>([]); urls.current = results.map(r => r.url);
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);

  function engine() {
    if (worker.current) return worker.current;
    const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = ({ data }) => {
      if (data.status) { setStatus(data.status); return; }
      const job = pending.current.get(data.id); if (!job) return;
      pending.current.delete(data.id);
      data.error ? job.reject(new Error(data.error)) : job.resolve(data.result);
    };
    created.onerror = event => { pending.current.forEach(job => job.reject(new Error(event.message || 'The image engine stopped.'))); pending.current.clear(); worker.current = null; };
    return worker.current = created;
  }

  async function startDownload() {
    if (install === 'downloading') return;
    const controller = new AbortController(); download.current = controller;
    setError(''); setInstall('downloading'); setProgress({ loaded: 0, total: GENERATOR_BYTES, file: '' });
    try { await installGenerator(controller.signal, setProgress); setInstall('installed'); context.services.notify({ title: 'Image Generator', message: 'The model is downloaded and ready.', tone: 'success' }); }
    catch (cause) { setInstall('missing'); if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The download failed.'); }
    finally { download.current = null; }
  }
  async function remove() {
    if (busy || !confirm(`Delete the downloaded model? This frees about ${formatBytes(GENERATOR_BYTES)}.`)) return;
    worker.current?.terminate(); worker.current = null;
    await removeGenerator(); setInstall('missing');
  }
  async function generate() {
    if (busy || install !== 'installed' || !prompt.trim()) return;
    setBusy(true); setError(''); setStatus('Preparing…');
    const id = Date.now(), job = { prompt: prompt.trim(), seed, steps };
    try {
      const output = await new Promise<{ blob: Blob; durationMs: number }>((resolve, reject) => { pending.current.set(id, { resolve, reject }); engine().postMessage({ id, ...job }); });
      setResults(list => [{ ...job, ...output, url: URL.createObjectURL(output.blob) }, ...list].slice(0, 24)); setSelected(0); setSeed(randomSeed());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Image generation failed.'); }
    finally { setBusy(false); setStatus(''); }
  }
  function cancel() {
    worker.current?.terminate(); worker.current = null;
    pending.current.forEach(job => job.reject(new Error('Generation cancelled.'))); pending.current.clear();
  }
  async function save() {
    if (!current) return;
    const fs = context.services.files;
    if (!fs.writeBinary) { setError('Saving binary files is unavailable in this workspace.'); return; }
    try {
      await fs.mkdir('/Pictures').catch(() => {});
      const path = `/Pictures/${slug(current.prompt)}-${current.seed}.png`;
      await fs.writeBinary(path, new Uint8Array(await current.blob.arrayBuffer()), { createOnly: true });
      context.services.notify({ title: 'Image saved', message: path.slice(1), tone: 'success' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The image could not be saved.'); }
  }
  function downloadImage() {
    if (!current) return;
    const link = document.createElement('a'); link.href = current.url; link.download = `${slug(current.prompt)}-${current.seed}.png`; link.click();
  }

  useAppCommands(context, [
    { id: 'generator.generate', label: 'Generate', shortcut: 'Mod+Enter', enabled: () => install === 'installed' && !busy && !!prompt.trim(), execute: generate },
    { id: 'generator.save', label: 'Save to Pictures', shortcut: 'Mod+S', enabled: () => !!current, execute: save },
    { id: 'generator.download', label: 'Download PNG', enabled: () => !!current, execute: downloadImage },
    { id: 'generator.random-seed', label: 'New Random Seed', execute: () => setSeed(randomSeed()) },
    { id: 'generator.install', label: 'Download Model…', enabled: () => install === 'missing', execute: startDownload },
    { id: 'generator.remove', label: 'Delete Downloaded Model…', enabled: () => install === 'installed' && !busy, execute: remove },
  ]);

  if (install !== 'installed') {
    const percent = progress ? Math.round(progress.loaded / progress.total * 100) : 0;
    return <div className="lope-app image-generator">
      <div className="generator-install">
        <span className="generator-install-icon"><ImagePlus size={30}/></span>
        <h1>Image Generator</h1>
        <p>Create images from text with an AI model that runs on this device. Prompts and images are not sent to a server.</p>
        <dl>
          <div><dt>Model</dt><dd>{GENERATOR_MODEL.name}</dd></div>
          <div><dt>Download</dt><dd>{formatBytes(GENERATOR_BYTES)}, saved in this browser</dd></div>
          <div><dt>Requires</dt><dd>WebGPU and a graphics card with about 4 GB of memory{!hasWebGPU && <strong> · WebGPU isn't available in this browser</strong>}</dd></div>
          <div><dt>License</dt><dd><a href={GENERATOR_MODEL.licenseURL} target="_blank" rel="noreferrer">{GENERATOR_MODEL.license}</a>: personal and research use only</dd></div>
        </dl>
        {install === 'downloading' && progress ? <div className="generator-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Model download">
          <div className="generator-progress-track"><i style={{ width: percent + '%' }}/></div>
          <span>{formatBytes(progress.loaded)} of {formatBytes(progress.total)}{progress.file && ' · ' + progress.file}</span>
          <Button onClick={() => download.current?.abort()}><X size={14}/>Cancel</Button>
        </div> : <Button variant="primary" disabled={install === 'checking'} onClick={startDownload}><Download size={14}/>{install === 'checking' ? 'Checking…' : 'Download model'}</Button>}
        {error && <div className="application-error" role="alert"><strong>Download stopped</strong>{error}</div>}
      </div>
    </div>;
  }

  return <div className="lope-app image-generator generator-workspace">
    <aside className="generator-sidebar">
      <label className="generator-field"><span>Prompt</span>
        <textarea className="ui-input" rows={6} value={prompt} placeholder="A lighthouse on a cliff at sunset, soft watercolor" maxLength={600}
          onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(); } }}/>
      </label>
      <div className="generator-field"><span>Quality</span>
        <div className="generator-segmented" role="radiogroup" aria-label="Steps">
          {[1, 2, 4].map(value => <button key={value} role="radio" aria-checked={steps === value} className={steps === value ? 'selected' : ''} onClick={() => setSteps(value)}>{value === 1 ? 'Fast' : value === 2 ? 'Balanced' : 'Detailed'}</button>)}
        </div>
      </div>
      <label className="generator-field"><span>Seed</span>
        <div className="generator-seed"><Input type="number" min={0} max={2147483647} value={seed} onChange={e => setSeed(Math.max(0, Math.min(2147483647, Number(e.target.value) | 0)))}/><Button aria-label="Random seed" onClick={() => setSeed(randomSeed())}><Shuffle size={14}/></Button></div>
      </label>
      {busy ? <Button onClick={cancel}><X size={14}/>Cancel</Button> : <Button variant="primary" disabled={!prompt.trim()} onClick={generate}><Sparkles size={14}/>Generate</Button>}
      <p className="sidebar-footer">512 × 512 · {GENERATOR_MODEL.runtime}. The first image takes longer while the model loads onto your GPU.<br/><button className="generator-link" onClick={remove}><Trash2 size={11}/>Delete downloaded model</button></p>
    </aside>
    <main className="generator-content">
      <div className="generator-stage">
        {current ? <img src={current.url} alt={current.prompt}/> : <div className="application-state"><Sparkles size={22}/><p>Describe an image and choose Generate.</p></div>}
        {busy && <div className="generator-busy" role="status"><span className="generator-spinner"/>{status}</div>}
      </div>
      {error && <div className="application-error" role="alert"><strong>Couldn't generate</strong>{error}</div>}
      {current && <div className="generator-actions">
        <span title={current.prompt}>{current.prompt} · seed {current.seed} · {(current.durationMs / 1000).toFixed(1)} s</span>
        <Button onClick={() => { setPrompt(current.prompt); setSeed(current.seed); setSteps(current.steps); }}>Reuse settings</Button>
        <Button onClick={save}><Save size={14}/>Save to Pictures</Button>
        <Button onClick={downloadImage}><Download size={14}/>Download</Button>
        <Button aria-label="Open Pictures" onClick={() => context.services.launch('lope.files', { path: '/Pictures' })}><FolderOpen size={14}/></Button>
      </div>}
      {results.length > 1 && <div className="generator-history" aria-label="Recent images">
        {results.map((result, index) => <button key={result.url} className={index === selected ? 'selected' : ''} onClick={() => setSelected(index)} aria-label={result.prompt}><img src={result.url} alt=""/></button>)}
      </div>}
    </main>
  </div>;
}
