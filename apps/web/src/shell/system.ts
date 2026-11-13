import { useSyncExternalStore } from 'react';
import { preferences } from '../../../../packages/sdk/src/preferences';
import type { Notification as AppNotification } from '../../../../packages/contracts/src';
import { ClipboardHistory, type ClipboardSource } from './clipboard-store';
export type { ClipboardItem, ClipboardSource } from './clipboard-store';
export const buildInfo = { version: import.meta.env.VITE_APP_VERSION || '0.1.0', build: import.meta.env.VITE_BUILD_ID || 'development', mode: import.meta.env.DEV ? 'Development' : 'Production' };
export type CaptureKind = 'camera' | 'microphone' | 'screen' | 'location';
export interface ActiveCapture { kind: CaptureKind; stream?: MediaStream; startedAt: number }
type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown' | 'unavailable';
const permissionListeners = new Set<() => void>();
let capabilitySnapshot = { captures: [] as ActiveCapture[], permissions: {} as Record<string, PermissionState> };
const stops = new Map<CaptureKind, () => void>();
const generations = new Map<CaptureKind, number>();
const emitCapabilities = () => { capabilitySnapshot = { ...capabilitySnapshot }; permissionListeners.forEach(fn => fn()); };
const permissionFlags = { camera: 'cameraTools', microphone: 'microphoneTools', screen: 'screenTools', location: 'locationAccess' } as const;
export const capabilities = {
  subscribe(fn: () => void) { permissionListeners.add(fn); return () => { permissionListeners.delete(fn); }; },
  snapshot: () => capabilitySnapshot,
  async refreshPermissions() {
    const results: Record<string, PermissionState> = {};
    for (const name of ['camera','microphone','geolocation','notifications','clipboard-read','clipboard-write']) {
      if (!navigator.permissions?.query) { results[name] = 'unavailable'; continue; }
      try { const status = await navigator.permissions.query({ name: name as PermissionName }); results[name] = status.state; status.onchange = () => { capabilitySnapshot.permissions = { ...capabilitySnapshot.permissions, [name]: status.state }; emitCapabilities(); }; } catch { results[name] = 'unknown'; }
    }
    capabilitySnapshot.permissions = results; emitCapabilities();
  },
  stop(kind: CaptureKind) {
    generations.set(kind, (generations.get(kind) || 0) + 1);
    const stop = stops.get(kind); stops.delete(kind); stop?.();
    capabilitySnapshot.captures = capabilitySnapshot.captures.filter(c => c.kind !== kind); emitCapabilities();
  },
  stopAll() { for (const kind of ['camera','microphone','screen','location'] as const) this.stop(kind); if ('speechSynthesis' in window) speechSynthesis.cancel(); },
  async start(kind: Exclude<CaptureKind, 'location'>, deviceId?: string) {
    this.stop(kind);
    if (!preferences.get(permissionFlags[kind], true)) throw new Error('This LopeOS preview is disabled in Privacy & Security.');
    const generation = generations.get(kind);
    if (!navigator.mediaDevices) throw new Error('This browser does not provide media capture here.');
    const stream = kind === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      : await navigator.mediaDevices.getUserMedia(kind === 'camera' ? { video: true, audio: false } : { audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false });
    if (generation !== generations.get(kind) || !preferences.get(permissionFlags[kind], true)) { stream.getTracks().forEach(t => t.stop()); throw new Error('Capture was stopped.'); }
    stops.set(kind, () => stream.getTracks().forEach(t => t.stop()));
    capabilitySnapshot.captures = [...capabilitySnapshot.captures, { kind, stream, startedAt: Date.now() }];
    stream.getTracks().forEach(track => track.addEventListener('ended', () => this.stop(kind), { once: true }));
    emitCapabilities(); void this.refreshPermissions(); return stream;
  },
  locate(): Promise<GeolocationPosition> {
    this.stop('location');
    if (!preferences.get('locationAccess', true)) return Promise.reject(new Error('Location requests are disabled in LopeOS. Choose a city manually.'));
    if (!navigator.geolocation) return Promise.reject(new Error('Location is unavailable in this browser.'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (position?: GeolocationPosition, error?: unknown) => { if (settled) return; settled = true; navigator.geolocation.clearWatch(id); stops.delete('location'); capabilitySnapshot.captures = capabilitySnapshot.captures.filter(c => c.kind !== 'location'); emitCapabilities(); position ? resolve(position) : reject(error); };
      const id = navigator.geolocation.watchPosition(position => done(position), error => done(undefined, error), { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
      stops.set('location', () => done(undefined, new Error('Location request stopped.')));
      capabilitySnapshot.captures = [...capabilitySnapshot.captures, { kind: 'location', startedAt: Date.now() }]; emitCapabilities();
    });
  },
};
export const useCapabilities = () => useSyncExternalStore(capabilities.subscribe, capabilities.snapshot, capabilities.snapshot);
preferences.subscribe(() => { for (const capture of capabilitySnapshot.captures) if (!preferences.get(permissionFlags[capture.kind], true)) capabilities.stop(capture.kind); });
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => capabilities.stopAll());

let audio: AudioContext | null = null;
let outputId = '';
export async function playAlert(preview = false) {
  const p = preferences.getSnapshot();
  if (p.soundMuted || !p.soundVolume || !p.alertVolume) return;
  if (!preview && !audio) return;
  if (typeof AudioContext === 'undefined') throw new Error('Audio playback is unavailable in this browser.');
  audio ??= new AudioContext();
  if (audio.state === 'suspended') await audio.resume();
  if (outputId && 'setSinkId' in audio) await (audio as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(outputId);
  const gain = audio.createGain(); gain.gain.setValueAtTime(p.soundVolume / 100 * p.alertVolume / 100 * .17, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .55); gain.connect(audio.destination);
  const frequencies = p.alertSound === 'glass' ? [880,1320] : p.alertSound === 'drop' ? [660,880] : [440,550];
  frequencies.forEach((frequency, i) => { const oscillator = audio!.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = frequency; oscillator.connect(gain); oscillator.start(audio!.currentTime + i * .045); oscillator.stop(audio!.currentTime + .6); });
}
export async function chooseAudioOutput() {
  const devices = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
  if (!devices?.selectAudioOutput || typeof AudioContext === 'undefined' || !('setSinkId' in AudioContext.prototype)) throw new Error('Output selection is managed by this browser or operating system.');
  const device = await devices.selectAudioOutput(); outputId = device.deviceId; await playAlert(true); return device.label || 'Selected output';
}
export function setMediaPreferences() {
  const p = preferences.getSnapshot();
  document.querySelectorAll<HTMLMediaElement>('.desktop audio,.desktop video').forEach(media => {
    if (media.hasAttribute('data-capture-preview')) return;
    media.volume = p.soundVolume / 100; media.muted = p.soundMuted;
    for (const track of Array.from(media.textTracks)) if (track.kind === 'captions' || track.kind === 'subtitles') track.mode = p.mediaCaptions ? 'showing' : 'disabled';
  });
}
export async function readAloud(text: string) {
  if (!('speechSynthesis' in window)) throw new Error('Read aloud is unavailable in this browser.');
  const voice = speechSynthesis.getVoices().find(v => v.localService && v.lang.startsWith(preferences.getSnapshot().region.split('-')[0])) ?? speechSynthesis.getVoices().find(v => v.localService);
  if (!voice) throw new Error('No on-device voice is available. Install a voice using your device’s speech settings.');
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text.slice(0, 10000)); utterance.voice = voice; utterance.rate = preferences.getSnapshot().speechRate; utterance.volume = preferences.getSnapshot().soundMuted ? 0 : preferences.getSnapshot().soundVolume / 100; speechSynthesis.speak(utterance);
}
const historyMemory = new Map<string, unknown>();
export function readHistory<T>(name: string, fallback: T): T { if (historyMemory.has(name)) return historyMemory.get(name) as T; try { const raw = localStorage.getItem('lope.history.' + name + '.v1'); if (raw) { const value = JSON.parse(raw); historyMemory.set(name, value); return value; } } catch {} return fallback; }
export function writeHistory(name: string, value: unknown) { historyMemory.set(name, value); try { localStorage.setItem('lope.history.' + name + '.v1', JSON.stringify(value)); } catch {} window.dispatchEvent(new CustomEvent('lope:history-updated')); }
export function clearHistory(name: string) { writeHistory(name, []); }
export interface StoredNotification extends AppNotification { id: string; time: number; appId?: string }
export function notificationHistory(): StoredNotification[] { const days = preferences.getSnapshot().notificationHistoryDays; return days ? readHistory<StoredNotification[]>('notifications', []).filter(n => n && typeof n.time === 'number' && n.time > Date.now() - days * 86400000).slice(-100) : []; }
export function recordNotification(n: StoredNotification) { if (preferences.getSnapshot().notificationHistoryDays) writeHistory('notifications', [...notificationHistory(), n].slice(-100)); }
export function diagnostics(event: 'app-error' | 'service-unavailable' | 'storage-unavailable') { if (!preferences.getSnapshot().diagnostics) return; writeHistory('diagnostics', [...readHistory<object[]>('diagnostics', []), { event, time: new Date().toISOString() }].slice(-100)); }
export function diagnosticsExport() { return { build: buildInfo, capabilities: { media: !!navigator.mediaDevices, permissions: !!navigator.permissions, storageEstimate: !!navigator.storage?.estimate, fullscreen: !!document.fullscreenEnabled, speech: 'speechSynthesis' in window }, events: readHistory('diagnostics', []) }; }

const clipboard = new ClipboardHistory(() => {
  const p = preferences.getSnapshot();
  return { enabled: p.clipboardHistory, retentionMinutes: p.clipboardRetentionMinutes };
});
let clipboardGeneration = 0;
const emitClipboard = () => window.dispatchEvent(new Event('lope:history-updated'));
export function clipboardItems() { return clipboard.items(); }
export function clearClipboard() { clipboardGeneration++; if (clipboard.clear()) emitClipboard(); }
export function addClipboardItem(text: string, source: ClipboardSource = 'spotlight') {
  const item = clipboard.add(text, source);
  if (item) emitClipboard();
  return item;
}
export function removeClipboardItem(id: string) { if (clipboard.remove(id)) { clipboardGeneration++; emitClipboard(); } }
export function toggleClipboardPin(id: string) { if (clipboard.togglePin(id)) emitClipboard(); }
export async function importClipboardItem() {
  if (!preferences.getSnapshot().clipboardHistory) throw new Error('Enable clipboard history to keep text in this tab.');
  if (!navigator.clipboard?.readText) throw new Error('Clipboard access is unavailable. Paste text into Spotlight to add it.');
  const generation = clipboardGeneration, user = preferences.getActiveUser();
  let text: string;
  try { text = await navigator.clipboard.readText(); }
  catch { throw new Error('Clipboard access was not allowed. Paste text into Spotlight to add it.'); }
  if (generation !== clipboardGeneration || user !== preferences.getActiveUser()) throw new Error('Clipboard import was cancelled.');
  const item = addClipboardItem(text, 'import');
  if (!item) throw new Error(text.trim() ? 'Clipboard history is turned off.' : 'Your clipboard has no text to add.');
  return item;
}
function copyUsingSelection(text: string) {
  const previous = document.activeElement as HTMLElement | null;
  const input = previous instanceof HTMLInputElement || previous instanceof HTMLTextAreaElement ? previous : null;
  const inputRange = input ? [input.selectionStart, input.selectionEnd, input.selectionDirection] as const : null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = text; field.readOnly = true; field.setAttribute('data-clipboard-private', 'true');
  field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('Copy was not allowed. Select the text and use your keyboard to copy it.');
  } finally {
    field.remove();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
    if (input && inputRange && inputRange[0] !== null && inputRange[1] !== null) input.setSelectionRange(inputRange[0], inputRange[1], inputRange[2] ?? undefined);
    else if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); }
  }
}
/** Invoke from a user gesture. A failed copy never claims success or changes history. */
export async function copyClipboardText(text: string, source: ClipboardSource = 'spotlight') {
  const generation = clipboardGeneration, user = preferences.getActiveUser();
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else copyUsingSelection(text);
  } catch {
    throw new Error('Copy was not allowed. Select the text and use your keyboard to copy it.');
  }
  // Copy remains useful even when history is disabled, full, or the text exceeds its limit.
  if (generation === clipboardGeneration && user === preferences.getActiveUser()) { try { addClipboardItem(text, source); } catch {} }
}
function privateClipboardTarget(target: Element | null) {
  if (!target) return false;
  if (target.closest('input[type=password],[data-terminal-input=true],.xterm,[data-clipboard-private],[data-clipboard-history=off]')) return true;
  const field = target.closest('input,textarea');
  return !!field && (/password|one-time-code|(?:^|\s)cc-/i.test(field.getAttribute('autocomplete') || '') || /password|secret|token|api.?key|private.?key|credential/i.test([field.id, field.getAttribute('name'), field.getAttribute('aria-label')].join(' ')));
}
export function installClipboardHistory() {
  const capture = (event: ClipboardEvent) => {
    if (!preferences.getSnapshot().clipboardHistory || !event.isTrusted) return;
    const target = event.composedPath().find(node => node instanceof Element) as Element | undefined;
    const selection = document.getSelection();
    const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement;
    const focus = selection?.focusNode instanceof Element ? selection.focusNode : selection?.focusNode?.parentElement;
    if (!target || privateClipboardTarget(target) || privateClipboardTarget(anchor ?? null) || privateClipboardTarget(focus ?? null)) return;
    if (event.type === 'paste' && !target.closest('input,textarea,[contenteditable]')) return;
    const text = event.clipboardData?.getData('text/plain') || (event.type === 'paste' || event.defaultPrevented ? '' : target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0) : selection?.toString());
    // Reading event data never requests access to the system clipboard.
    if (text) { try { addClipboardItem(text, event.type as ClipboardSource); } catch {} }
  };
  document.addEventListener('copy', capture); document.addEventListener('cut', capture); document.addEventListener('paste', capture);
  let user = preferences.getActiveUser();
  const release = preferences.subscribe(() => {
    if (user !== preferences.getActiveUser() || !preferences.getSnapshot().clipboardHistory) clearClipboard();
    user = preferences.getActiveUser();
    if (clipboard.prune()) emitClipboard();
  });
  return () => { document.removeEventListener('copy', capture); document.removeEventListener('cut', capture); document.removeEventListener('paste', capture); release(); clearClipboard(); };
}
export function shellAction(action: 'privacy' | 'reload' | 'close-apps' | 'clear-layout' | 'show-desktop' | 'sign-out') { window.dispatchEvent(new CustomEvent('lope:system-action', { detail: { action } })); }
export async function browserNotificationPermission() { if (!('Notification' in window)) throw new Error('Browser notifications are unavailable.'); const state = await window.Notification.requestPermission(); await capabilities.refreshPermissions(); return state; }

/** Physically prune retained data as well as hiding expired entries in the UI. */
export function pruneHistories() {
  const p = preferences.getSnapshot();
  for (const [name, days] of [['search', p.searchHistoryDays], ['notifications', p.notificationHistoryDays]] as const) {
    const raw = readHistory<{time:number}[]>(name, []); const current = Array.isArray(raw) ? raw : [];
    const next = days ? current.filter(item=>item && typeof item.time==='number' && item.time > Date.now()-days*86400000) : [];
    if (next.length !== current.length || !Array.isArray(raw)) writeHistory(name,next);
  }
  if (clipboard.prune()) emitClipboard();
}
if (typeof window !== 'undefined') {
  pruneHistories(); preferences.subscribe(pruneHistories);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)pruneHistories();});
  setInterval(()=>{if(!document.hidden)pruneHistories();},60000);
}
