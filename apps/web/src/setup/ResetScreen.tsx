import { useEffect, useRef, useState } from 'react';
import { performFactoryReset, type FactoryResetRequest } from '../../../../packages/sdk/src/reset';
import { LopeMark } from '../shell/Icons';
import { softwareUpdates } from '../updates/service';
import './reset.css';

export function ResetScreen({ request, restart, onReady, onComplete }: {
  request: FactoryResetRequest;
  restart: boolean;
  onReady: () => void | Promise<void>;
  onComplete: () => void;
}) {
  const [progress, setProgress] = useState(8);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [reduceMotion] = useState(() => request.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches);
  const callbacks = useRef({ onReady, onComplete });
  callbacks.current = { onReady, onComplete };
  const retry = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (restart) {
      // Paint black first, then terminate the old document and its app writers.
      const timer = window.setTimeout(() => window.location.reload(), 160);
      return () => clearTimeout(timer);
    }
    let active = true;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    const started = performance.now();
    const run = async () => {
      try {
        await softwareUpdates.cancelForReset();
        await performFactoryReset(request, value => { if (active) setProgress(value); });
        if (!active) return;
        setProgress(100);
        // Keep the boot screen recognizable even when browser storage is tiny.
        await new Promise(resolve => setTimeout(resolve, Math.max(0, (reduceMotion ? 250 : 1800) - (performance.now() - started))));
        if (!active) return;
        await callbacks.current.onReady();
        if (!active) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!active) return;
          setRevealing(true);
          revealTimer = setTimeout(() => { if (active) callbacks.current.onComplete(); }, reduceMotion ? 0 : 650);
        }));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The reset could not finish. Try again.');
      }
    };
    void run();
    return () => { active = false; clearTimeout(revealTimer); };
  }, [request, restart, attempt, reduceMotion]);

  useEffect(() => { if (error) retry.current?.focus(); }, [error]);

  return <main className="reset-boot" data-phase={error ? 'error' : revealing ? 'revealing' : 'working'} data-reduce-motion={reduceMotion} aria-label="Resetting LopeOS" aria-busy={!error && !revealing}>
    <div className="reset-boot__logo" aria-hidden="true"><LopeMark size={88}/></div>
    <div className="reset-boot__lower">
      <div className="reset-boot__progress" role="progressbar" aria-label="Resetting LopeOS" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span style={{ width: progress + '%' }}/>
      </div>
      {error ? <div className="reset-boot__error" role="alert">
        <h1>Reset couldn’t finish.</h1>
        <p>{error}</p>
        <button ref={retry} onClick={() => { setError(''); setAttempt(value => value + 1); }}>Try again</button>
      </div> : <span className="reset-boot__status" role="status">{revealing ? 'Opening Setup Assistant' : 'Resetting LopeOS. Please wait.'}</span>}
    </div>
  </main>;
}
