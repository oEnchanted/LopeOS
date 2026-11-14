/** Keep short update stages readable, while allowing reset to cancel immediately. */
export function waitForUpdate(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, Math.max(0, milliseconds));
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Missing estimates are advisory; the cache writer still enforces actual quota. */
export function checkUpdateStorage(estimate: StorageEstimate | undefined, requiredBytes: number, mayReclaimSpace = false): void {
  // Only the worker can tell whether other tabs still pin older release caches.
  // Let its normal pruning/quota checks decide when some space may be reclaimed.
  if (mayReclaimSpace) return;
  const { quota, usage } = estimate ?? {};
  if (quota === undefined || usage === undefined || !Number.isFinite(quota) || !Number.isFinite(usage) || quota < 0 || usage < 0) return;
  if (requiredBytes > Math.max(0, quota - usage)) {
    throw new Error('There is not enough browser storage for this update. Free some space and try again. Your installed release and saved files are kept.');
  }
}

/** Optional checks must not hold the OS update open indefinitely. */
export async function optionalUpdateCheck(operation: Promise<string>, signal: AbortSignal, timeoutMs = 15_000): Promise<string> {
  const timeout = new AbortController();
  const cancel = () => timeout.abort(signal.reason);
  signal.throwIfAborted();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await Promise.race([
      operation,
      waitForUpdate(timeoutMs, timeout.signal).then(() => 'Model update information is unavailable. You can check models after restarting.'),
    ]);
  } catch (cause) {
    signal.throwIfAborted();
    return 'Model update information is unavailable. You can check models after restarting.';
  } finally {
    signal.removeEventListener('abort', cancel);
    timeout.abort();
  }
}
