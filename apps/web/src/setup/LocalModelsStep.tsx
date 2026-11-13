import { useEffect, useSyncExternalStore } from 'react';
import { Check, Download, HardDrive, MessageSquare, ScanFace, ShieldCheck, SlidersHorizontal, Square } from 'lucide-react';
import { Button } from '../../../../packages/ui/src';
import { localModels } from './local-models';
import './local-models.css';

type Model = ReturnType<typeof localModels.getSnapshot>['models'][number];
const icons = { spotlight: MessageSquare, denoise: SlidersHorizontal, portrait: ScanFace };
const sources = { spotlight: 'Hugging Face · GitHub', denoise: 'Included with LopeOS', portrait: 'Hugging Face · jsDelivr' };
const statusLabels: Record<Model['status'], string> = {
  checking: 'Checking this device…', available: 'Not downloaded', queued: 'Waiting to download',
  downloading: 'Downloading', verifying: 'Checking downloaded files…', installed: 'Downloaded',
  cancelled: 'Download cancelled', unsupported: 'Unavailable on this device', error: 'Download interrupted',
};
function formatBytes(bytes: number) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
function formatSpeed(bytes: number) { return `${(Math.max(0, bytes) / 1_000_000).toFixed(2)} MB/s`; }

function ModelCard({ model, busy }: { model: Model; busy: boolean }) {
  const Icon = icons[model.id];
  const working = model.status === 'downloading' || model.status === 'verifying';
  const complete = model.status === 'installed';
  const retry = model.status === 'error' || model.status === 'cancelled';
  const hasProgress = working || retry;
  const percent = model.total && model.total > 0 ? Math.min(100, model.received / model.total * 100) : null;
  const size = model.total ?? model.sizeBytes;
  return <article className="setup-ai-card glass-inset" data-model-id={model.id} data-status={model.status} aria-label={model.title}>
    <div className="setup-ai-card-heading"><span className="setup-ai-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.6}/></span><div><h2>{model.title}</h2><p>{model.modelName}</p></div>{complete ? <span className="setup-ai-installed"><Check size={14} aria-hidden="true"/>Downloaded</span> : <Button type="button" variant="ghost" aria-label={`${retry ? 'Retry' : 'Download'} ${model.title}`} disabled={busy || model.status === 'checking' || model.status === 'unsupported'} onClick={() => { void localModels.install(model.id); }}><Download size={14} aria-hidden="true"/>{retry ? 'Retry' : 'Download'}</Button>}</div>
    <p className="setup-ai-description">{model.description}</p>
    <div className="setup-ai-card-meta"><span>{model.purpose}</span><span>{size === null ? model.sizeLabel : `${model.total === null && model.id === 'spotlight' ? 'About ' : ''}${formatBytes(size)}`}</span></div>
    {hasProgress && <div className="setup-ai-transfer"><div className="setup-ai-transfer-label"><span>{statusLabels[model.status]}</span><span>{working ? formatSpeed(model.bytesPerSecond) : '0.00 MB/s'}</span></div><progress aria-label={`${model.title} download progress`} max={model.total ?? 1} value={model.total ? Math.min(model.received, model.total) : undefined}/><div className="setup-ai-transfer-detail"><span>{formatBytes(model.received)}{model.total ? ` of ${formatBytes(model.total)}` : ' received'}</span><span>{percent === null ? 'Finding download size…' : `${Math.floor(percent)}%`}</span></div></div>}
    {model.status === 'queued' && <p className="setup-ai-queued">Waiting to download…</p>}
    {model.status === 'unsupported' && <p className="setup-ai-unavailable">{model.message}</p>}
    {model.error && <p className="setup-ai-error" role="alert">{model.error}</p>}
    <small className="setup-ai-source">{sources[model.id]} · includes the required engine</small>
    <span className="setup-ai-announcement" role="status">{model.title}: {statusLabels[model.status]}</span>
  </article>;
}
export function LocalModelsStep() {
  const state = useSyncExternalStore(localModels.subscribe, localModels.getSnapshot);
  useEffect(() => { void localModels.inspect(); }, []);
  const installed = state.models.filter(model => model.status === 'installed').length;
  const eligible = state.models.filter(model => model.status !== 'unsupported');
  const finished = !state.checking && eligible.length > 0 && eligible.every(model => model.status === 'installed');
  return <div className="setup-ai">
    <div className="setup-ai-overview"><div><span className="setup-ai-optional">Optional</span><strong><HardDrive size={14} aria-hidden="true"/>{installed} of {state.models.length} models downloaded</strong></div>{state.busy ? <Button type="button" variant="secondary" onClick={() => localModels.cancel()}><Square size={12} aria-hidden="true"/>Cancel download</Button> : <Button type="button" variant="primary" disabled={state.checking || finished || !eligible.length} onClick={() => { void localModels.installAll(); }}>{finished ? <Check size={14} aria-hidden="true"/> : <Download size={14} aria-hidden="true"/>}{finished ? 'Models downloaded' : 'Download all models'}</Button>}</div>
    <div className="setup-ai-models">{state.models.map(model => <ModelCard key={model.id} model={model} busy={state.busy}/>)}</div>
    <div className="setup-ai-note"><ShieldCheck size={16} aria-hidden="true"/><p>Model files download from the sources above. Your messages and photos are processed on your device. Clearing browser data removes these downloads.</p></div>
    <p className="setup-ai-skip">You can continue setup while models download, or download them later in each app. Keep this tab open until downloads finish.</p>
    <details className="setup-ai-external"><summary>Generative Fill setup</summary><p>Generative Fill uses a separate ComfyUI installation. Configure it in Image Editor.</p></details>
  </div>;
}
export function LocalModelsSummary() {
  const state = useSyncExternalStore(localModels.subscribe, localModels.getSnapshot);
  const installed = state.models.filter(model => model.status === 'installed').length;
  return <span>{state.busy ? 'Downloading in this tab…' : installed ? `${installed} of ${state.models.length} models downloaded` : 'Download later in each app'}</span>;
}
