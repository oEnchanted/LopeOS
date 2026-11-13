import { useEffect, useRef, useState } from 'react';
import { Check, Download, HardDrive, LoaderCircle, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Dialog } from '../../../../../packages/ui/src';
import { DENOISE_PACKAGE } from '../../../../../packages/photo-engine/src/denoise-manifest';
import { installDenoise, installedDenoise, removeDenoise, type DenoiseInstallation, type DownloadProgress } from '../../../../../packages/photo-engine/src/denoise-cache';
import type { DenoiseParameters, DenoiseProgress, DenoiseProvenance, DenoiseRegion } from '../../../../../packages/photo-engine/src/denoise';
import type { Asset, Culling } from '../../../../../packages/photo-engine/src/model';
import { displayPixels } from '../../../../../packages/photo-engine/src/render';
import { errorMessage, formatBytes } from '../hooks';
import { DenoiseClient } from './denoise-client';
export type DenoiseResult={blob:Blob;thumbnail:Blob;analysis:Culling;width:number;height:number;provenance:DenoiseProvenance};
type DenoisePreview={width:number;height:number;region:DenoiseRegion;before:Uint8ClampedArray;after:Uint8ClampedArray;originalPixels:Float32Array;denoisedPixels:Float32Array;navigator:Blob;durationMs:number};
type Props={asset:Asset;getSource:(asset:Asset)=>Promise<Blob>;onCreated:(result:DenoiseResult,source:Asset)=>Promise<void>;onClose:()=>void;onBusyChange:(busy:boolean)=>void};
export function DenoiseDialog({asset,getSource,onCreated,onClose,onBusyChange}:Props){
  const [installation,setInstallation]=useState<DenoiseInstallation|null>(null),[checking,setChecking]=useState(true),[busy,setBusy]=useState<'download'|'preview'|'process'|'save'|null>(null),[error,setError]=useState('');
  const [parameters,setParameters]=useState<DenoiseParameters>({sigma:25,amount:75}),[focus,setFocus]=useState({x:.5,y:.5}),[preview,setPreview]=useState<DenoisePreview>(),[previewKey,setPreviewKey]=useState(''),[requestedKey,setRequestedKey]=useState(''),[paused,setPaused]=useState(false),[download,setDownload]=useState<DownloadProgress>(),[progress,setProgress]=useState<DenoiseProgress>();
  const [thumbnail,setThumbnail]=useState('');const client=useRef(new DenoiseClient()),abort=useRef<AbortController|null>(null),alive=useRef(true),operation=useRef(0),sourceBlob=useRef<Blob|undefined>(undefined),pending=useRef<DenoiseResult|undefined>(undefined),callback=useRef(onBusyChange),attempted=useRef('');callback.current=onBusyChange;
  const requestKey=`${parameters.sigma}:${focus.x}:${focus.y}`,stale=previewKey!==requestKey,controlsLocked=!!busy&&busy!=='preview';
  useEffect(()=>{alive.current=true;void installedDenoise().then(value=>{if(alive.current)setInstallation(value);}).catch(cause=>{if(alive.current)setError(errorMessage(cause));}).finally(()=>{if(alive.current)setChecking(false);});return()=>{alive.current=false;operation.current++;abort.current?.abort();client.current.dispose();pending.current=undefined;sourceBlob.current=undefined;callback.current(false);};},[]);
  useEffect(()=>{const url=URL.createObjectURL(preview?.navigator||asset.thumbnail);setThumbnail(url);return()=>URL.revokeObjectURL(url);},[preview?.navigator,asset.thumbnail]);
  useEffect(()=>{callback.current(!!busy);},[busy]);
  useEffect(()=>{const timer=setTimeout(()=>setRequestedKey(requestKey),250);return()=>clearTimeout(timer);},[requestKey]);
  useEffect(()=>{if(installation&&!busy&&!paused&&!pending.current&&requestedKey===requestKey&&attempted.current!==requestKey)void runPreview();},[installation,busy,paused,requestedKey,requestKey]);
  function changeFocus(value:{x:number;y:number}){setFocus(value);setPaused(false);}
  async function original(){return sourceBlob.current??=await getSource(asset);}
  const updateProgress=(value:DenoiseProgress)=>{if(alive.current)setProgress(value);};
  function cancel(){operation.current++;abort.current?.abort();abort.current=null;client.current.cancel();setBusy(null);setProgress(undefined);setDownload(undefined);setError('');setPaused(true);}
  async function install(){
    if(busy)return;const token=++operation.current,controller=new AbortController();abort.current=controller;setBusy('download');setError('');setDownload({file:'AI tools',received:0,total:DENOISE_PACKAGE.totalBytes});
    try{const record=await installDenoise(controller.signal,value=>{if(alive.current&&token===operation.current)setDownload(value);});if(alive.current&&token===operation.current){setInstallation(record);attempted.current='';setPaused(false);setBusy(null);setDownload(undefined);}}
    catch(cause){if(alive.current&&token===operation.current&&!controller.signal.aborted)setError(errorMessage(cause));}
    finally{if(alive.current&&token===operation.current){setBusy(null);abort.current=null;}}
  }
  async function runPreview(){
    if(!installation||busy)return;const token=++operation.current,key=requestKey;attempted.current=key;setPaused(false);setBusy('preview');setError('');setProgress(undefined);
    try{const blob=await original();if(!alive.current||token!==operation.current)return;const value=await client.current.run<DenoisePreview>('preview',{installation,assetId:asset.id,sourceHash:asset.hash,name:asset.name,blob,parameters:{...parameters,amount:100},focus},updateProgress);if(alive.current&&token===operation.current){setPreview(value);setPreviewKey(key);}}
    catch(cause){if(alive.current&&token===operation.current)setError(errorMessage(cause));}
    finally{if(alive.current&&token===operation.current)setBusy(null);}
  }
  async function save(result:DenoiseResult,token:number){setBusy('save');await onCreated(result,asset);if(alive.current&&token===operation.current){pending.current=undefined;setBusy(null);onClose();}}
  async function create(){
    if(!installation||busy||parameters.amount===0)return;const token=++operation.current;setBusy('process');setError('');setProgress(undefined);
    try{const blob=await original();if(!alive.current||token!==operation.current)return;const result=await client.current.run<DenoiseResult>('denoise',{installation,assetId:asset.id,sourceHash:asset.hash,name:asset.name,blob,parameters,recipe:asset.recipe},updateProgress);if(alive.current&&token===operation.current){pending.current=result;await save(result,token);}}
    catch(cause){if(alive.current&&token===operation.current)setError(errorMessage(cause));}
    finally{if(alive.current&&token===operation.current)setBusy(null);}
  }
  async function retrySave(){if(!pending.current||busy)return;const token=++operation.current;setError('');try{await save(pending.current,token);}catch(cause){if(alive.current){setBusy(null);setError(errorMessage(cause));}}}
  async function uninstall(){if(busy)return;try{client.current.dispose();await removeDenoise();setInstallation(null);setPreview(undefined);setPreviewKey('');attempted.current='';setPaused(false);setError('');}catch(cause){setError(errorMessage(cause));}}
  const phase=busy==='download'?'Downloading local AI tools':busy==='save'?'Saving denoised copy':progress?.phase==='loading'?'Loading local model':progress?.phase==='decoding'?'Reading original photo':progress?.phase==='encoding'?'Encoding 16-bit TIFF':busy==='preview'?'Denoising preview':'Denoising full-resolution photo';
  const completed=busy==='download'?download?.received:progress?.completed,total=busy==='download'?download?.total:progress?.total;
  return <Dialog title="AI Denoise" onClose={()=>{if(busy==='save')return;if(busy)cancel();onClose();}}><div className="ps-dialog ps-denoise-dialog">
    <div className="ps-denoise-model"><HardDrive size={17}/><div><strong>{checking?'Checking local AI tools…':installation?'Local AI tools installed':'One-time local AI download'}</strong><span>{formatBytes(DENOISE_PACKAGE.files[0].bytes)} model + {formatBytes(DENOISE_PACKAGE.totalBytes-DENOISE_PACKAGE.files[0].bytes)} engine · {formatBytes(DENOISE_PACKAGE.totalBytes)} total</span></div>{installation?<><Check size={15}/><button title="Remove downloaded AI tools" aria-label="Remove downloaded AI tools" disabled={!!busy} onClick={()=>void uninstall()}><Trash2 size={14}/></button></>:<button className="ps-primary" disabled={checking||!!busy} onClick={()=>void install()}><Download size={13}/>Download AI tools</button>}</div>
    <div className="ps-denoise-controls"><label>Amount<output>{parameters.amount}%</output><input type="range" aria-label="AI denoise amount" min={0} max={100} value={parameters.amount} disabled={controlsLocked} onChange={e=>{pending.current=undefined;setError('');setParameters(p=>({...p,amount:Number(e.target.value)}));}}/></label><label>Noise level<output>{parameters.sigma} / 255</output><input type="range" aria-label="AI denoise noise level" min={1} max={75} value={parameters.sigma} disabled={controlsLocked} onChange={e=>{setParameters(p=>({...p,sigma:Number(e.target.value)}));setPaused(false);pending.current=undefined;}}/></label></div>
    <div className="ps-denoise-preview-heading"><span>100% detail · before edits</span><button disabled={!installation||!!busy} onClick={()=>void runPreview()}><RefreshCw size={12}/>{error||paused?'Retry preview':'Refresh preview'}</button></div>
    <div className="ps-denoise-preview"><PreviewCanvas preview={preview} amount={0} label="Original"/><PreviewCanvas preview={preview} amount={parameters.amount} label="AI Denoise"/>{!preview&&<div className="ps-denoise-preview-empty">{installation?(error?'Preview unavailable':paused?'Preview paused':'Preparing preview…'):'Download AI tools to preview this photo'}</div>}</div>
    {preview&&<div className="ps-denoise-preview-note" role="status" data-testid="denoise-preview-status" data-preview-key={previewKey}>{paused?'Preview paused':stale?'Updating preview…':`${preview.width} × ${preview.height} source pixels · ${(preview.durationMs/1000).toFixed(1)} s`}<span>Preview updates automatically.</span></div>}
    <div className="ps-denoise-focus"><button className="ps-denoise-navigator" disabled={controlsLocked} aria-label="Choose denoise preview position" title="Click to move the 100% preview" onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();changeFocus({x:(e.clientX-rect.left)/rect.width,y:(e.clientY-rect.top)/rect.height});}}><img src={thumbnail||undefined} alt="Original photo preview navigator"/><span style={{left:focus.x*100+'%',top:focus.y*100+'%'}}>+</span></button><div><strong>{asset.name}</strong><span>{asset.metadata.width.toLocaleString()} × {asset.metadata.height.toLocaleString()} source pixels</span><label>Preview X<input type="range" aria-label="AI preview horizontal position" min={0} max={1} step={.01} disabled={controlsLocked} value={focus.x} onChange={e=>{changeFocus({...focus,x:Number(e.target.value)});}}/></label><label>Preview Y<input type="range" aria-label="AI preview vertical position" min={0} max={1} step={.01} disabled={controlsLocked} value={focus.y} onChange={e=>{changeFocus({...focus,y:Number(e.target.value)});}}/></label></div></div>
    <p className="ps-panel-note">Creates a separate 16-bit TIFF copy with your current edits carried over. The original stays in your library. Processing runs at full resolution and may take time on large photos.</p>
    <p className="ps-panel-note">Supports opaque SDR photos, including RAW after development. No photo upload. <a href="/models/denoise/README.txt" target="_blank" rel="noreferrer">Model & license</a></p>
    {busy&&<div className="ps-denoise-progress" role="status"><LoaderCircle size={15}/><div><strong>{phase}</strong><progress max={total||1} value={completed}/><span>{busy==='download'?`${formatBytes(download?.received||0)} of ${formatBytes(DENOISE_PACKAGE.totalBytes)}`:progress?.phase==='processing'?`${progress.completed} of ${progress.total} image tiles`:busy==='save'?'Writing the result to your local library':'Working locally…'}</span></div>{busy!=='save'&&<button onClick={cancel}>Cancel processing</button>}</div>}
    {error&&<p className="ps-denoise-error" role="alert">{error}{pending.current&&' The completed denoise result is still available; retry saving without running the model again.'}</p>}
    <div className="ps-dialog-actions"><button disabled={busy==='save'} onClick={()=>{if(busy)cancel();onClose();}}>Close</button>{pending.current?<button className="ps-primary" disabled={!!busy} onClick={()=>void retrySave()}>Retry saving copy</button>:<button className="ps-primary" disabled={!installation||checking||!!busy||parameters.amount===0} onClick={()=>void create()}><SlidersHorizontal size={13}/>Create denoised copy</button>}</div>
  </div></Dialog>;
}
function PreviewCanvas({preview,amount,label}:{preview:DenoisePreview|undefined;amount:number;label:string}){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{const canvas=ref.current;if(!canvas)return;if(!preview){canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);return;}const data=preview.originalPixels.slice();if(amount>0)for(let i=0;i<data.length;i++)if(i%4!==3)data[i]+=(preview.denoisedPixels[i]-data[i])*amount/100;canvas.width=preview.width;canvas.height=preview.height;canvas.getContext('2d')!.putImageData(new ImageData(displayPixels({width:preview.width,height:preview.height,data}) as Uint8ClampedArray<ArrayBuffer>,preview.width,preview.height),0,0);},[preview,amount]);
  return <figure><canvas ref={ref} width={192} height={192} aria-label={'AI denoise '+label.toLowerCase()+' preview'}/><figcaption>{label}</figcaption></figure>;
}
