import { useEffect, useRef, useState } from 'react';
import { Camera, Circle, Square, Pause, Play } from 'lucide-react';
import { Dialog } from '../../../../../packages/ui/src';

/** Camera tracks exist only while this explicitly opened capture dialog owns them. */
export function CameraDialog({ onClose, onAccept }: { onClose: () => void; onAccept: (file: File) => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'requesting' | 'preview' | 'recording' | 'paused' | 'review' | 'adding'>('idle');
  const [microphone, setMicrophone] = useState(true); const [error, setError] = useState(''); const [seconds, setSeconds] = useState(0);
  const [recorded, setRecorded] = useState<Blob | null>(null); const [url, setUrl] = useState('');
  const element = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null); const recorder = useRef<MediaRecorder | null>(null);
  const generation = useRef(0); const mounted = useRef(true); const stateRef = useRef(state); stateRef.current = state;
  function stopTracks() { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; if (element.current) element.current.srcObject = null; }
  function close() { generation.current++; if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop(); stopTracks(); onClose(); }
  useEffect(() => { mounted.current = true; const hide = () => { if (document.hidden) { if(stateRef.current==='requesting'){generation.current++;setState('idle');} if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop(); stopTracks(); if (stateRef.current === 'preview') setState('idle'); } }; document.addEventListener('visibilitychange', hide); return () => { mounted.current = false; generation.current++; if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop(); stopTracks(); document.removeEventListener('visibilitychange', hide); }; }, []);
  useEffect(() => { if (!recorded) { setUrl(''); return; } const next = URL.createObjectURL(recorded); setUrl(next); return () => URL.revokeObjectURL(next); }, [recorded]);
  useEffect(() => { if (state !== 'recording') return; const start = performance.now(), before = seconds; const timer = setInterval(() => setSeconds(before + (performance.now() - start) / 1000), 200); return () => clearInterval(timer); }, [state]);
  async function enable() {
    const request = ++generation.current; setState('requesting'); setError('');
    try { if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Camera recording is unavailable. Import a video recorded with your camera instead.'); const result = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: microphone }); if (!mounted.current || request !== generation.current) { result.getTracks().forEach(track => track.stop()); return; } stream.current = result; if (element.current) { element.current.srcObject = result; await element.current.play(); } setState('preview'); } catch (cause) { if (!mounted.current || request !== generation.current) return; stopTracks(); setError(cause instanceof Error ? cause.message : 'Camera access was denied. You can still import existing videos.'); setState('idle'); }
  }
  function record() {
    if (!stream.current) return; const request = generation.current; const chunks: Blob[] = []; let bytes = 0;
    try { const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type)); const instance = new MediaRecorder(stream.current, mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000 } : undefined); recorder.current = instance;
      instance.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); bytes += event.data.size; if (bytes > 256 * 1024 * 1024 && instance.state !== 'inactive') instance.stop(); } };
      instance.onstop = () => { stopTracks(); if (!mounted.current || request !== generation.current) return; const blob = new Blob(chunks, { type: instance.mimeType }); if (!blob.size) { setError('No video was recorded. Try recording again.'); setState('idle'); return; } setRecorded(blob); setState('review'); };
      instance.onerror = () => { stopTracks(); if (mounted.current) { setError('The camera stopped recording. Try again or import an existing video.'); setState('idle'); } };
      setSeconds(0); setRecorded(null); instance.start(250); setState('recording');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Recording could not start.'); }
  }
  async function accept() { if (!recorded) return; setState('adding'); try { await onAccept(new File([recorded], `Webcam ${new Date().toISOString().replace(/[:.]/g, '-')}.${recorded.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: recorded.type })); close(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The recording could not be added.'); setState('review'); } }
  return <Dialog title="Webcam video" onClose={close}><div className="mm-dialog mm-camera-dialog">
    {error && <p role="alert">{error}</p>}
    <div className="mm-camera-preview"><video ref={element} autoPlay={state !== 'review'} muted={state !== 'review'} playsInline controls={state === 'review'} src={url || undefined} aria-label={state === 'review' ? 'Review webcam recording' : 'Live camera preview'}/>{state === 'idle' && <Camera size={48}/>}</div>
    <p role="status">{state === 'requesting' ? 'Waiting for camera permission…' : state === 'recording' || state === 'paused' ? `Camera${microphone ? ' and microphone' : ''} active · ${state === 'paused' ? 'Paused' : 'Recording'} · ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : state === 'preview' ? `Camera${microphone ? ' and microphone' : ''} active · Ready to record` : state === 'review' ? 'Review your video. Camera and microphone are off.' : 'Record a new clip, then add it to your movie.'}</p>
    {(state === 'idle' || state === 'requesting') && <label className="mm-field"><input type="checkbox" checked={microphone} disabled={state === 'requesting'} onChange={event => setMicrophone(event.target.checked)}/>Record microphone audio</label>}
    <div className="mm-dialog-actions"><button className="mm-secondary" onClick={close}>Cancel</button>
      {state === 'idle' && <button className="mm-primary" onClick={() => void enable()}>Enable camera</button>}
      {state === 'preview' && <button className="mm-primary" onClick={record}><Circle size={14}/> Record</button>}
      {(state === 'recording' || state === 'paused') && <><button className="mm-secondary" onClick={() => { if (state === 'recording') { recorder.current?.pause(); setState('paused'); } else { recorder.current?.resume(); setState('recording'); } }}>{state === 'recording' ? <Pause size={14}/> : <Play size={14}/>} {state === 'recording' ? 'Pause recording' : 'Resume recording'}</button><button className="mm-primary" onClick={() => recorder.current?.stop()}><Square size={14}/> Stop recording</button></>}
      {(state === 'review' || state === 'adding') && <><button className="mm-secondary" disabled={state === 'adding'} onClick={() => { setRecorded(null); setState('idle'); }}>Record again</button><button className="mm-primary" disabled={state === 'adding'} onClick={() => void accept()}>{state === 'adding' ? 'Adding video…' : 'Add video to movie'}</button></>}
    </div>
  </div></Dialog>;
}
