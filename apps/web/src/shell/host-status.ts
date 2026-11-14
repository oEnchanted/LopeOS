import { useEffect, useSyncExternalStore } from 'react';

/** One poll of the hosting server, as percentages. */
export interface HostSample { at: number; cpu: number | null; memory: number | null }
export interface HostStatus {
  state: 'connecting' | 'live' | 'unavailable';
  cpu: number | null; cores: number | null;
  memoryUsed: number | null; memoryTotal: number | null;
  people: number | null; signedIn: number | null;
  history: readonly HostSample[];
}

/** The widget plots this much recent history. */
export const HISTORY_MS = 90_000;
const WATCH_MS = 3_000, HEARTBEAT_MS = 30_000, MAX_RETRY_MS = 120_000, PRESENCE_KEY = 'lope.presence.v1';

const finite = (value: unknown, min = 0, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;

/** An anonymous per-browser identifier, so several tabs count as one person. It is never linked to an account by the client. */
function presenceId() {
  const fresh = () => { const bytes = crypto.getRandomValues(new Uint8Array(16)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  try {
    const saved = localStorage.getItem(PRESENCE_KEY);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
    const created = fresh(); localStorage.setItem(PRESENCE_KEY, created); return created;
  } catch { return (memoryId ??= fresh()); }
}
let memoryId: string | undefined;

/**
 * Polls the account service on the hosting server. The desktop keeps a slow
 * presence heartbeat; a visible widget asks for frequent samples.
 */
class HostMonitor {
  private snapshot: HostStatus = { state: 'connecting', cpu: null, cores: null, memoryUsed: null, memoryTotal: null, people: null, signedIn: null, history: [] };
  private listeners = new Set<() => void>();
  private clients = 0;
  private watchers = 0;
  private failures = 0;
  private lastPoll = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private inflight?: AbortController;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  connect() {
    if (++this.clients === 1) { document.addEventListener('visibilitychange', this.visibility); void this.poll(); }
    return () => {
      if (--this.clients) return;
      document.removeEventListener('visibilitychange', this.visibility);
      clearTimeout(this.timer); this.inflight?.abort(); this.inflight = undefined;
    };
  }

  watch() {
    this.watchers++; this.refresh();
    return () => { this.watchers--; this.schedule(); };
  }

  private visibility = () => this.refresh();

  /** Polls now if the current cadence is already due, otherwise reschedules. */
  private refresh() {
    if (this.clients && !this.inflight && Date.now() - this.lastPoll >= this.interval()) void this.poll();
    else this.schedule();
  }

  private interval() {
    if (this.failures) return Math.min(MAX_RETRY_MS, 15_000 * 2 ** (this.failures - 1));
    return this.watchers && !document.hidden ? WATCH_MS : HEARTBEAT_MS;
  }

  private schedule() {
    clearTimeout(this.timer);
    if (!this.clients || this.inflight) return;
    this.timer = setTimeout(() => void this.poll(), Math.max(0, this.lastPoll + this.interval() - Date.now()));
  }

  private async poll() {
    if (this.inflight) return;
    clearTimeout(this.timer);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 6_000);
    this.inflight = controller; this.lastPoll = Date.now();
    try {
      const response = await fetch('/api/accounts/host', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presence: presenceId() }),
      });
      if (!response.ok) throw new Error(`Host status returned ${response.status}.`);
      this.accept(await response.json());
      this.failures = 0;
    } catch {
      if (this.inflight !== controller) return;
      this.failures++;
      this.publish({ ...this.snapshot, state: 'unavailable' });
    } finally {
      clearTimeout(timeout);
      if (this.inflight === controller) { this.inflight = undefined; this.schedule(); }
    }
  }

  private accept(body: unknown) {
    const value = (body ?? {}) as { cpu?: { percent?: unknown; cores?: unknown }; memory?: { usedBytes?: unknown; totalBytes?: unknown }; online?: { people?: unknown; signedIn?: unknown } };
    const total = finite(value.memory?.totalBytes), used = total === null ? null : finite(value.memory?.usedBytes, 0, total);
    const cpu = finite(value.cpu?.percent, 0, 100), at = Date.now();
    const memory = total && used !== null ? used / total * 100 : null;
    const history = [...this.snapshot.history.filter(sample => sample.at >= at - HISTORY_MS), { at, cpu, memory }].slice(-120);
    this.publish({
      state: 'live', cpu, cores: finite(value.cpu?.cores, 1), memoryUsed: used, memoryTotal: total,
      people: finite(value.online?.people), signedIn: finite(value.online?.signedIn), history,
    });
  }

  private publish(next: HostStatus) { this.snapshot = next; this.listeners.forEach(listener => listener()); }
}

export const hostMonitor = new HostMonitor();

/** Keeps this browser counted as online while the desktop is open. */
export function useHostPresence() { useEffect(() => hostMonitor.connect(), []); }

/** Live host status with frequent sampling while the caller is mounted. */
export function useHostStatus() {
  useEffect(() => hostMonitor.watch(), []);
  return useSyncExternalStore(hostMonitor.subscribe, hostMonitor.getSnapshot, hostMonitor.getSnapshot);
}
