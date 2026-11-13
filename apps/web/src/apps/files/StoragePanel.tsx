import { useCallback, useEffect, useRef, useState } from 'react';
import { HardDrive, RefreshCw } from 'lucide-react';
import type { FileService, FileStorageInfo } from '../../../../../packages/contracts/src';
import { formatBytes } from '../hooks';

export function StoragePanel({ fs, revision }: { fs: FileService; revision: number }) {
  const [storage, setStorage] = useState<FileStorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const mounted = useRef(true);
  const service = useRef(fs); service.current = fs;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  const refresh = useCallback(async function refreshStorage(): Promise<void> {
    if (inFlight.current) { queued.current = true; return; }
    inFlight.current = true; queued.current = false;
    const id = ++request.current;
    setLoading(true);
    try {
      if (!service.current.storage) throw new Error('Storage reporting unavailable');
      const next = await service.current.storage();
      if (![next.totalBytes, next.usedBytes, next.availableBytes].every(value => Number.isFinite(value) && value >= 0) || !next.totalBytes) throw new Error('Invalid storage report');
      if (id === request.current) { setStorage(next); setFailed(false); }
    } catch { if (id === request.current) setFailed(true); }
    finally {
      inFlight.current = false;
      if (id === request.current) {
        setLoading(false);
      }
      if (queued.current && mounted.current) void refreshStorage();
    }
  }, []);
  useEffect(() => { void refresh(); }, [fs, refresh, revision]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 400); };
    const unsubscribe = fs.subscribe(changed);
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30000);
    return () => { request.current++; unsubscribe(); clearTimeout(timer); clearInterval(interval); };
  }, [fs, refresh]);
  const percent = storage ? Math.min(100, Math.max(0, storage.usedBytes / storage.totalBytes * 100)) : 0;
  const summary = storage ? `${formatBytes(storage.usedBytes)} used of ${formatBytes(storage.totalBytes)}; ${formatBytes(storage.availableBytes)} available` : 'Disk usage unavailable';
  return <section className="files-storage glass-inset" aria-label="Disk usage" title={`Workspace runtime volume. ${summary}`}>
    <div className="files-storage-heading"><HardDrive size={18}/><strong>Workspace disk</strong><button type="button" aria-label="Refresh disk usage" disabled={loading} onClick={() => void refresh()}><RefreshCw size={12}/></button></div>
    {storage ? <>
      <div className="files-storage-meter" role="meter" aria-label="Disk space used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={summary}><span style={{ width: `${percent}%` }}/></div>
      <p className="files-storage-amount"><strong>{formatBytes(storage.usedBytes)}</strong> of {formatBytes(storage.totalBytes)} used</p>
      <p className="files-storage-free">{formatBytes(storage.availableBytes)} available</p>
      <small>{failed ? 'Couldn’t refresh · showing last report' : 'Runtime volume · may be shared'}</small>
    </> : <p className="files-storage-unavailable">{loading ? 'Reading disk usage…' : 'Disk usage unavailable'}</p>}
  </section>;
}
