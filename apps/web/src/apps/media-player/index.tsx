import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, Circle, Clapperboard, FastForward, FolderOpen, Globe, ListMusic, ListVideo, Maximize, Minimize, Music, Pause, Play, Plus, Repeat, Repeat1, Rewind, Search, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Square, StepForward, Subtitles, Trash2, Volume, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import type { AppContext } from '../../../../../packages/contracts/src';
import { Button, Input } from '../../../../../packages/ui/src';
import { baseName, errorMessage, parentPath, useAppCommands } from '../hooks';
import { AudioChain, DEFAULT_COMPRESSOR, type Compressor, type StereoMode } from './audio';
import { AboutDialog, BookmarksDialog, CaptureDialog, PreferencesDialog, ConvertDialog, DEFAULT_ADJUST, DEFAULT_EQ, EffectsDialog, InfoDialog, JumpDialog, NetworkDialog, ShortcutsDialog, type Adjust, type Equalizer, type Geometry, type Sync } from './dialogs';
import { audioStreams, cancelTasks, convert, engineAvailable, mp4Supported, extractCover, extractSubtitles, nativeAudioCodec, nativeVideoCodec, primaryVideo, probe as probeMedia, releaseTasks, subtitleStreams, type ProbeResult, type ProfileId, type StreamInfo } from './engine';
import { ASPECT_RATIOS, CROP_RATIOS, MEDIA_EXTENSIONS, PLAYLIST_EXTENSIONS, SUBTITLE_EXTENSIONS, VOLUME_STEP, ZOOM_MODES, activeCues, displayName, extensionOf, fineRate, formatRate, formatTime, isAudioName, isMedia, isPlaylist, isSubtitle, nextRate, parsePlaylist, parseSubtitles, serializeM3U, serializeXSPF, titleFromName, videoLayout, type Cue } from './formats';
import { TranscodeStream, type StreamStatus } from './stream';
import { addBookmark, readPreferences, type Bookmark, type Preferences } from './preferences';
import './media-player.css';

type Source = 'workspace' | 'local' | 'url' | 'capture';
interface Item { id: string; title: string; location: string; source: Source; blob?: Blob; duration?: number; constraints?: MediaStreamConstraints }
interface SubtitleTrack { id: string; label: string; cues?: Cue[]; streamIndex?: number; bitmap?: boolean }
type Loop = 'none' | 'all' | 'one';
type Visual = 'off' | 'spectrum' | 'scope' | 'vu';
type DialogName = 'network' | 'capture' | 'jump' | 'effects' | 'sync' | 'info' | 'codec' | 'convert' | 'about' | 'shortcuts' | 'prefs' | 'prefs-audio' | 'bookmarks' | null;
interface Recent { location: string; title: string; source: 'workspace' | 'url' }
const FILE_DRAG_TYPE = 'application/x-lope-files';
const ACCEPT = [...MEDIA_EXTENSIONS, ...PLAYLIST_EXTENSIONS, ...SUBTITLE_EXTENSIONS].map(extension => '.' + extension).join(',') + ',video/*,audio/*';
let itemCounter = 0;
const makeItem = (fields: Omit<Item, 'id'>): Item => ({ id: `item-${Date.now().toString(36)}-${++itemCounter}`, ...fields });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const snapshotName = () => { const d = new Date(), p = (n: number, l = 2) => String(n).padStart(l, '0'); return `lopesnap-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s${p(d.getMilliseconds(), 3)}`; };
const languageName = (code?: string) => { if (!code) return ''; try { return new Intl.DisplayNames(undefined, { type: 'language' }).of(code.length === 3 ? ({ eng: 'en', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', ita: 'it', jpn: 'ja', chi: 'zh', zho: 'zh', kor: 'ko', rus: 'ru', por: 'pt', dut: 'nl', nld: 'nl', swe: 'sv', pol: 'pl', ara: 'ar', hin: 'hi', tur: 'tr' } as Record<string, string>)[code] ?? code : code) ?? code; } catch { return code; } };
const streamLabel = (stream: StreamInfo, index: number) => [stream.title, languageName(stream.language)].filter(Boolean).join(' - ') || `Track ${index + 1}`;

export default function MediaPlayer({ context }: { context: AppContext }) {
  const { services } = context;
  const settings = services.settings;
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const subtitleInput = useRef<HTMLInputElement>(null);

  // ---------- State ----------
  const [playlist, setPlaylist] = useState<Item[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [stopped, setStopped] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [rate, setRateState] = useState(1);
  const [prefs, setPrefsState] = useState<Preferences>(() => readPreferences(settings.get('media-player.preferences', null)));
  const setPrefs = (next: Preferences) => { setPrefsState(next); settings.set('media-player.preferences', next); };
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const [bookmarkStore, setBookmarkStore] = useState<Record<string, Bookmark[]>>(() => settings.get('media-player.bookmarks', {}));
  const [volume, setVolumeState] = useState(() => clamp(settings.get('media-player.volume', 1), 0, readPreferences(settings.get('media-player.preferences', null)).maxVolume));
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState<Loop>(() => settings.get('media-player.loop', 'none'));
  const [random, setRandom] = useState(() => settings.get('media-player.random', false));
  const [ab, setAb] = useState<{ a?: number; b?: number }>({});
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [mode, setMode] = useState<'native' | 'stream'>('native');
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({ buffering: false });
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [osd, setOsd] = useState<{ text: string; id: number } | null>(null);
  const [titleOsd, setTitleOsd] = useState<{ text: string; id: number } | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [cover, setCover] = useState<string | null>(null);
  const [audioIndex, setAudioIndex] = useState<number | undefined>(undefined);
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [subtitleId, setSubtitleId] = useState<string | null>(null);
  const [aspect, setAspect] = useState<string>('Default');
  const [crop, setCrop] = useState<string>('Default');
  const [zoom, setZoom] = useState(0);
  const [deinterlace, setDeinterlace] = useState(false);
  const [geometry, setGeometry] = useState<Geometry>({ rotation: 0, flipH: false, flipV: false });
  const [adjust, setAdjust] = useState<Adjust>(DEFAULT_ADJUST);
  const [eq, setEq] = useState<Equalizer>(() => settings.get('media-player.eq', DEFAULT_EQ));
  const [compressor, setCompressor] = useState<Compressor>(DEFAULT_COMPRESSOR);
  const [stereo, setStereo] = useState<StereoMode>('stereo');
  const [sync, setSync] = useState<Sync>({ audio: 0, subtitle: 0, subtitleSpeed: 1 });
  const [visual, setVisual] = useState<Visual>(() => settings.get('media-player.visual', 'off'));
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [minimal, setMinimal] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [remaining, setRemaining] = useState(false);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [networkInitial, setNetworkInitial] = useState('');
  const [convertProgress, setConvertProgress] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [tracksOpen, setTracksOpen] = useState(false);
  const [resume, setResume] = useState<{ id: string; time: number } | null>(null);
  const [quitAtEnd, setQuitAtEnd] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioGraph, setAudioGraph] = useState(true);
  const [recent, setRecent] = useState<Recent[]>(() => settings.get('media-player.recent', []));
  const [filter, setFilter] = useState('');
  const [advanced, setAdvanced] = useState(() => settings.get('media-player.advanced', false));
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  const current = playlist.find(item => item.id === currentId) ?? null;
  const video = primaryVideo(probe ?? { streams: [] } as unknown as ProbeResult);
  const audios = probe ? audioStreams(probe) : [];
  const chapters = probe?.chapters ?? [];
  const bookmarkKey = current ? positionKey(current) : '';
  const bookmarks = bookmarkKey ? bookmarkStore[bookmarkKey] ?? [] : [];
  function setBookmarks(next: Bookmark[]) {
    if (!bookmarkKey) return;
    setBookmarkStore(store => { const updated = { ...store }; if (next.length) updated[bookmarkKey] = next; else delete updated[bookmarkKey]; settings.set('media-player.bookmarks', updated); return updated; });
  }
  const hasPicture = videoSize.width > 0 && !stopped;
  const isAudioOnly = !!current && !stopped && !hasPicture && (probe ? !video : isAudioName(current.title) || current.source === 'capture' && !current.constraints?.video);

  // Imperative playback objects; React state mirrors them for rendering.
  const el = useRef<HTMLVideoElement | null>(null);
  const chain = useRef<AudioChain | null>(null);
  const stream = useRef<TranscodeStream | null>(null);
  const media = useRef<{ item: Item; blob?: Blob; url?: string; capture?: MediaStream; nativeFailed: boolean; cors: boolean; token: number } | null>(null);
  const probeRef = useRef<ProbeResult | null>(null);
  const loadToken = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const convertCancelled = useRef(false);
  const state = useRef({ playlist, currentId, loop, random, ab, volume, muted, rate, audioIndex, deinterlace, subtitleId, subtitles, quitAtEnd, eq, compressor, stereo, sync });
  state.current = { playlist, currentId, loop, random, ab, volume, muted, rate, audioIndex, deinterlace, subtitleId, subtitles, quitAtEnd, eq, compressor, stereo, sync };
  const history = useRef<string[]>([]);

  const showOsd = useCallback((text: string) => { if (prefsRef.current.osd) setOsd({ text, id: Date.now() }); }, []);
  useEffect(() => { if (!osd) return; const timer = setTimeout(() => setOsd(null), 1600); return () => clearTimeout(timer); }, [osd]);
  useEffect(() => { if (!titleOsd) return; const timer = setTimeout(() => setTitleOsd(null), 3000); return () => clearTimeout(timer); }, [titleOsd]);
  const notifyError = (message: string) => { setError(message); services.notify({ title: 'Media Player', message, tone: 'error' }); };

  // ---------- Audio chain ----------
  useEffect(() => { chain.current?.setEqualizer(eq.enabled, eq.preamp, eq.bands, eq.twoPass); settings.set('media-player.eq', eq); }, [eq]);
  useEffect(() => { chain.current?.setCompressor(compressor); }, [compressor]);
  useEffect(() => { chain.current?.setStereo(stereo); }, [stereo]);
  useEffect(() => { chain.current?.setDelay(sync.audio); }, [sync.audio]);
  useEffect(() => {
    chain.current?.setVolume(volume, muted);
    if (el.current) { el.current.volume = chain.current ? 1 : Math.min(1, volume); el.current.muted = chain.current ? false : muted; }
    settings.set('media-player.volume', volume);
  }, [volume, muted]);
  useEffect(() => { if (volume > prefs.maxVolume) setVolumeState(prefs.maxVolume); }, [prefs.maxVolume]);
  /** VLC's Audio Device menu: route this player's output to the chosen device. */
  function applyOutput(element: HTMLVideoElement | null = el.current) {
    const id = prefsRef.current.outputDevice;
    if (chain.current) void chain.current.setOutput(id).catch(() => showOsd('That audio device is unavailable'));
    else if (element && 'setSinkId' in element) void (element as HTMLVideoElement & { setSinkId(id: string): Promise<void> }).setSinkId(id).catch(() => {});
  }
  useEffect(() => applyOutput(), [prefs.outputDevice]);
  useEffect(() => settings.set('media-player.loop', loop), [loop]);
  useEffect(() => settings.set('media-player.random', random), [random]);
  useEffect(() => settings.set('media-player.visual', visual), [visual]);
  useEffect(() => settings.set('media-player.advanced', advanced), [advanced]);

  // ---------- Element lifecycle ----------
  function teardown() {
    stream.current?.destroy(); stream.current = null;
    chain.current?.disconnect(); chain.current = null;
    const m = media.current;
    if (m?.url) URL.revokeObjectURL(m.url);
    m?.capture?.getTracks().forEach(track => track.stop());
    if (m?.blob) void releaseTasks(m.blob);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    if (el.current) { el.current.pause(); el.current.removeAttribute('src'); el.current.srcObject = null; el.current.load(); el.current.remove(); el.current = null; }
  }
  function mountElement(withGraph: boolean, cors: boolean) {
    if (el.current) { chain.current?.disconnect(); chain.current = null; el.current.pause(); el.current.removeAttribute('src'); el.current.load(); el.current.remove(); }
    const element = document.createElement('video');
    element.className = 'mp-video'; element.playsInline = true; element.preload = 'auto'; element.disablePictureInPicture = false;
    if (cors) element.crossOrigin = 'anonymous';
    element.playbackRate = state.current.rate; element.defaultPlaybackRate = state.current.rate;
    const sync = () => {
      setTime(element.currentTime);
      setDuration(Number.isFinite(element.duration) ? element.duration : probeRef.current?.duration ?? 0);
      const ranges = element.buffered; setBuffered(ranges.length ? ranges.end(ranges.length - 1) : 0);
    };
    element.addEventListener('play', () => { setPlaying(true); setStopped(false); chain.current?.resume(); });
    element.addEventListener('pause', () => { setPlaying(false); savePosition(); });
    element.addEventListener('timeupdate', sync);
    element.addEventListener('durationchange', sync);
    element.addEventListener('progress', sync);
    element.addEventListener('waiting', () => setWaiting(true));
    element.addEventListener('playing', () => setWaiting(false));
    element.addEventListener('canplay', () => setWaiting(false));
    element.addEventListener('ratechange', () => setRateState(element.playbackRate));
    element.addEventListener('loadedmetadata', () => { setVideoSize({ width: element.videoWidth, height: element.videoHeight }); sync(); void decide(); });
    element.addEventListener('resize', () => setVideoSize({ width: element.videoWidth, height: element.videoHeight }));
    element.addEventListener('ended', ended);
    element.addEventListener('error', () => void failed(element));
    host.current?.appendChild(element);
    el.current = element;
    if (withGraph) { try { chain.current = new AudioChain(element); } catch { chain.current = null; } }
    setAudioGraph(!!chain.current);
    const s = state.current;
    if (chain.current) { chain.current.setVolume(s.volume, s.muted); chain.current.setEqualizer(s.eq.enabled, s.eq.preamp, s.eq.bands, s.eq.twoPass); chain.current.setCompressor(s.compressor); chain.current.setStereo(s.stereo); chain.current.setDelay(s.sync.audio); element.volume = 1; }
    else { element.volume = Math.min(1, s.volume); element.muted = s.muted; }
    if (prefsRef.current.outputDevice) applyOutput(element);
    return element;
  }
  async function start(element: HTMLVideoElement, at = 0) {
    if (at > 0) { const seek = () => { element.currentTime = at; }; if (element.readyState >= 1) seek(); else element.addEventListener('loadedmetadata', seek, { once: true }); }
    try { await element.play(); } catch (cause) { if ((cause as DOMException).name === 'NotAllowedError') setPlaying(false); }
  }

  // ---------- Loading ----------
  async function materialize(item: Item): Promise<Blob | undefined> {
    if (item.blob) return item.blob;
    if (item.source === 'workspace') {
      if (!services.files.readBinary) throw new Error('Binary file access is unavailable in this workspace.');
      const { data } = await services.files.readBinary(item.location);
      const blob = new Blob([data as BlobPart]);
      setPlaylist(list => list.map(entry => entry.id === item.id ? { ...entry, blob } : entry));
      return blob;
    }
    return undefined;
  }
  async function load(item: Item, at = 0, autoplay = true) {
    const token = ++loadToken.current;
    teardown();
    probeRef.current = null; setProbe(null); setMode('native'); setStreamStatus({ buffering: false }); setError(''); setCover(null); setResume(null);
    setVideoSize({ width: 0, height: 0 }); setTime(at); setDuration(item.duration ?? 0); setBuffered(0); setAb({});
    setAudioIndex(undefined); setSubtitleId(null); setSubtitles([]); setWaiting(true);
    setCurrentId(item.id); setStopped(false);
    if (history.current.at(-1) !== item.id) history.current.push(item.id);
    context.lifecycle.setTitle(item.title);
    if (prefsRef.current.osd) setTitleOsd({ text: item.title, id: Date.now() });
    if (item.source === 'workspace' || item.source === 'url') remember({ location: item.location, title: item.title, source: item.source });
    try {
      if (item.source === 'capture') {
        const capture = await navigator.mediaDevices.getUserMedia(item.constraints ?? { video: true });
        if (token !== loadToken.current) { capture.getTracks().forEach(track => track.stop()); return; }
        const element = mountElement(true, false);
        media.current = { item, capture, nativeFailed: false, cors: false, token };
        element.srcObject = capture; setWaiting(false);
        await start(element);
        return;
      }
      if (item.source === 'url' && !item.blob) {
        const element = mountElement(true, true);
        media.current = { item, nativeFailed: false, cors: true, token };
        element.src = item.location;
        if (autoplay) await start(element, at);
        return;
      }
      const blob = await materialize(item);
      if (token !== loadToken.current || !blob) return;
      const url = URL.createObjectURL(blob);
      media.current = { item, blob, url, nativeFailed: false, cors: false, token };
      const element = mountElement(true, false);
      element.src = url;
      const saved = positionFor(item), resumeMode = prefsRef.current.resume;
      if (!at && saved && resumeMode === 'always') { at = saved; showOsd(`Resuming at ${formatTime(saved)}`); }
      else if (!at && saved && resumeMode === 'ask') setResume({ id: item.id, time: saved });
      if (engineAvailable) void probeMedia(blob, item.title).then(result => {
        if (token !== loadToken.current) return;
        probeRef.current = result; setProbe(result);
        if (result.duration) setPlaylist(list => list.map(entry => entry.id === item.id ? { ...entry, duration: result.duration } : entry));
        setDuration(value => value || result.duration);
        const streams = subtitleStreams(result);
        if (streams.length) setSubtitles(list => [...list, ...streams.map((stream, index) => ({ id: `stream-${stream.index}`, label: streamLabel(stream, index) + (stream.bitmap ? ' (burned in)' : ''), streamIndex: stream.index, bitmap: stream.bitmap }))]);
        const art = result.streams.find(stream => stream.attachedPic);
        if (art) void extractCover(blob, item.title, art).then(image => { if (token === loadToken.current) setCover(URL.createObjectURL(image)); }, () => {});
        const defaultSub = streams.find(stream => stream.isDefault && !stream.bitmap);
        if (defaultSub) void selectSubtitle(`stream-${defaultSub.index}`, true);
        void decide();
      }, cause => { if (token === loadToken.current && media.current?.nativeFailed) fail(cause); });
      void autoloadSubtitles(item, token);
      if (autoplay) await start(element, at);
    } catch (cause) { if (token === loadToken.current) fail(cause); }
  }
  function fail(cause: unknown) {
    setWaiting(false); setPlaying(false);
    notifyError(`Your input can't be opened: ${errorMessage(cause)}`);
  }
  async function failed(element: HTMLVideoElement) {
    const m = media.current;
    if (!m || element !== el.current) return;
    if (stream.current) { fail(new Error(element.error?.message || 'The decoder rejected this stream.')); return; }
    if (m.item.source === 'url' && !m.blob) {
      // Retry without CORS (audio effects need it), then download it for FFmpeg.
      if (m.cors) { m.cors = false; const retry = mountElement(false, false); retry.src = m.item.location; await start(retry, 0); return; }
      try {
        setWaiting(true);
        const response = await fetch(m.item.location);
        if (!response.ok) throw new Error(`The server answered ${response.status}.`);
        const blob = await response.blob();
        const item = { ...m.item, blob, title: m.item.title };
        setPlaylist(list => list.map(entry => entry.id === item.id ? item : entry));
        await load(item);
      } catch (cause) { fail(new Error(`The stream could not be read (${errorMessage(cause)}).`)); }
      return;
    }
    m.nativeFailed = true;
    if (probeRef.current) await decide();
    else if (!engineAvailable) fail(new Error('This browser cannot decode the file.'));
  }
  /** Switch to FFmpeg when the browser can't decode a stream (or a filter needs it). */
  async function decide(force = false) {
    const m = media.current, result = probeRef.current, element = el.current;
    if (!m?.blob || !result || !element) return;
    const v = primaryVideo(result), list = audioStreams(result);
    const s = state.current;
    const audio = list.find(stream => stream.index === s.audioIndex) ?? list.find(stream => stream.isDefault) ?? list[0];
    if (s.audioIndex === undefined && audio) setAudioIndex(audio.index);
    const subtitle = s.subtitles.find(track => track.id === s.subtitleId);
    const tenBit = (stream?: StreamInfo) => !!stream?.pixFmt && /1[02]le|p010/.test(stream.pixFmt) && stream.codec === 'h264';
    const videoBlank = element.readyState >= 1 && element.videoWidth === 0 && !!v;
    const needs = m.nativeFailed || videoBlank || (v && (!nativeVideoCodec(v.codec) || tenBit(v))) || (audio && !nativeAudioCodec(audio.codec)) || (!!audio && audio.index !== list[0]?.index) || s.deinterlace || !!subtitle?.bitmap;
    if (!needs) {
      if (stream.current && force) { const at = element.currentTime, wasPlaying = !element.paused; stream.current.destroy(); stream.current = null; setMode('native'); element.src = m.url!; await start(element, at); if (!wasPlaying) element.pause(); }
      return;
    }
    if (stream.current && !force) return;
    if (!result.duration) { fail(new Error('This media has no known duration, so it cannot be transcoded while playing.')); return; }
    const at = element.currentTime || 0, wasPlaying = !element.paused || m.nativeFailed || videoBlank || element.readyState < 3;
    stream.current?.destroy();
    const copyVideo = !!v && ['h264', 'hevc'].includes(v.codec) && nativeVideoCodec(v.codec) && !tenBit(v) && !s.deinterlace && !subtitle?.bitmap;
    const created = new TranscodeStream(m.blob, m.item.title, element, {
      container: mp4Supported() ? 'mp4' : 'webm', videoIndex: v?.index, audioIndex: audio?.index, copyVideo, deinterlace: s.deinterlace, maxHeight: 720,
      burnSubtitleIndex: subtitle?.bitmap ? subtitle.streamIndex : undefined, duration: result.duration, startTime: result.startTime,
    }, status => { setStreamStatus(status); if (status.error) fail(new Error(status.error)); }, at);
    stream.current = created; setMode('stream'); setWaiting(true);
    element.src = created.url;
    await start(element, at);
    if (!wasPlaying) element.pause();
  }
  async function autoloadSubtitles(item: Item, token: number) {
    if (item.source !== 'workspace' || !prefsRef.current.autoSubtitles) return;
    try {
      const folder = parentPath(item.location), base = titleFromName(item.title).toLowerCase();
      const entries = await services.files.list(folder);
      const matches = entries.filter(entry => entry.type === 'file' && isSubtitle(entry.name) && entry.name.toLowerCase().startsWith(base));
      for (const entry of matches) {
        const { content } = await services.files.read(entry.path);
        if (token !== loadToken.current) return;
        addSubtitle(entry.name, content, matches.length === 1);
      }
    } catch { /* Folder listing is optional. */ }
  }
  function addSubtitle(name: string, text: string, select = true) {
    const cues = parseSubtitles(text, name, probeRef.current ? primaryVideo(probeRef.current)?.fps : 25);
    if (!cues.length) { showOsd('No subtitles found in that file'); return; }
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setSubtitles(list => [...list, { id, label: displayName(name), cues }]);
    if (select) { setSubtitleId(id); showOsd(`Subtitle track: ${displayName(name)}`); }
  }
  async function selectSubtitle(id: string | null, quiet = false) {
    const previous = state.current.subtitles.find(track => track.id === state.current.subtitleId);
    setSubtitleId(id);
    state.current.subtitleId = id;
    const track = state.current.subtitles.find(item => item.id === id);
    if (!quiet) showOsd(track ? `Subtitle track: ${track.label}` : 'Subtitle track: Disabled');
    if (track?.bitmap || previous?.bitmap) { await decide(true); return; }
    if (track && !track.cues && track.streamIndex !== undefined && media.current?.blob) {
      try {
        const text = await extractSubtitles(media.current.blob, media.current.item.title, track.streamIndex);
        const cues = parseSubtitles(text, 'track.vtt');
        setSubtitles(list => list.map(item => item.id === id ? { ...item, cues } : item));
      } catch (cause) { showOsd(`Subtitles unavailable: ${errorMessage(cause)}`); }
    }
  }

  // ---------- Playlist ----------
  const order = () => state.current.playlist;
  function nextItem(direction: 1 | -1, wrap: boolean) {
    const list = order(), index = list.findIndex(item => item.id === state.current.currentId);
    if (!list.length) return null;
    if (state.current.random && direction > 0) { const pool = list.filter(item => item.id !== state.current.currentId); return pool.length ? pool[Math.floor(Math.random() * pool.length)] : wrap ? list[0] : null; }
    if (state.current.random && direction < 0 && history.current.length > 1) { history.current.pop(); const id = history.current.pop(); return list.find(item => item.id === id) ?? null; }
    const target = index + direction;
    if (target >= 0 && target < list.length) return list[target];
    return wrap ? list[(target + list.length) % list.length] : null;
  }
  function ended() {
    clearPosition();
    const s = state.current;
    if (s.loop === 'one' && el.current) { el.current.currentTime = 0; void el.current.play(); return; }
    const next = nextItem(1, s.loop === 'all');
    if (next) { void load(next); return; }
    setPlaying(false); setStopped(true);
    if (s.quitAtEnd) context.lifecycle.close();
  }
  async function enqueue(items: Item[], play = true) {
    if (!items.length) return;
    const expanded: Item[] = [];
    for (const item of items) {
      if (isPlaylist(item.title)) {
        try {
          const text = item.blob ? await item.blob.text() : (await services.files.read(item.location)).content;
          const folder = item.source === 'workspace' ? parentPath(item.location) : '/';
          for (const entry of parsePlaylist(text, item.title, folder)) {
            const remote = /^https?:/i.test(entry.location);
            expanded.push(makeItem({ title: entry.title || displayName(entry.location), location: entry.location, source: remote ? 'url' : 'workspace', duration: entry.duration }));
          }
        } catch (cause) { notifyError(`The playlist couldn't be read: ${errorMessage(cause)}`); }
      } else if (isSubtitle(item.title) && !state.current.currentId) { notifyError('Open a video before adding subtitles.');
      } else if (isSubtitle(item.title)) {
        try { addSubtitle(item.title, item.blob ? await item.blob.text() : (await services.files.read(item.location)).content); } catch (cause) { notifyError(errorMessage(cause)); }
      } else expanded.push(item);
    }
    if (!expanded.length) return;
    setPlaylist(list => [...list, ...expanded]);
    state.current.playlist = [...state.current.playlist, ...expanded];
    if (play) await load(expanded[0]);
  }
  const localItems = (files: File[]) => files.filter(file => isMedia(file.name) || isPlaylist(file.name) || isSubtitle(file.name) || /^(audio|video)\//.test(file.type)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(file => makeItem({ title: file.name, location: file.name, source: 'local', blob: file }));
  const workspaceItem = (path: string) => makeItem({ title: baseName(path), location: path, source: 'workspace' });
  async function openWorkspace(path: string, play = true) {
    try {
      const entry = await services.files.stat(path);
      if (entry.type === 'directory') await enqueue(await folderItems(path), play);
      else await enqueue([workspaceItem(path)], play);
    } catch (cause) { notifyError(`Your input can't be opened: ${errorMessage(cause)}`); }
  }
  async function folderItems(path: string): Promise<Item[]> {
    const entries = await services.files.list(path), result: Item[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      if (entry.name.startsWith('.')) continue;
      if (entry.type === 'directory') result.push(...await folderItems(entry.path));
      else if (isMedia(entry.name)) result.push(workspaceItem(entry.path));
    }
    return result;
  }
  function removeItems(ids: string[]) {
    if (ids.includes(state.current.currentId ?? '')) stop(true);
    setPlaylist(list => list.filter(item => !ids.includes(item.id)));
    setSelectedRows([]);
  }
  function remember(entry: Recent) {
    setRecent(list => { const next = [entry, ...list.filter(item => item.location !== entry.location)].slice(0, 10); settings.set('media-player.recent', next); return next; });
  }

  // ---------- Resume positions (VLC's "continue where you left off") ----------
  function positionKey(item: Item) { return item.source === 'workspace' || item.source === 'url' ? item.location : item.source === 'local' && item.blob ? `local:${item.title}:${item.blob.size}` : ''; }
  function positionFor(item: Item) { const key = positionKey(item); const saved = key ? settings.get<Record<string, number>>('media-player.positions', {})[key] : 0; return saved && saved > 5 ? saved : 0; }
  function savePosition() {
    const m = media.current, element = el.current;
    if (!m || !element || m.item.source === 'capture' || !Number.isFinite(element.duration) || element.duration < 60) return;
    const key = positionKey(m.item); if (!key) return;
    const positions = { ...settings.get<Record<string, number>>('media-player.positions', {}) };
    if (element.currentTime > 5 && element.currentTime < element.duration - 10) positions[key] = Math.floor(element.currentTime); else delete positions[key];
    const keys = Object.keys(positions); if (keys.length > 100) delete positions[keys[0]];
    settings.set('media-player.positions', positions);
  }
  function clearPosition() { const m = media.current; if (!m) return; const key = positionKey(m.item); const positions = { ...settings.get<Record<string, number>>('media-player.positions', {}) }; if (key && key in positions) { delete positions[key]; settings.set('media-player.positions', positions); } }
  useEffect(() => { if (!resume) return; const timer = setTimeout(() => setResume(null), 8000); return () => clearTimeout(timer); }, [resume]);
  useEffect(() => { if (!playing) return; const timer = setInterval(savePosition, 5000); return () => clearInterval(timer); }, [playing]);

  // ---------- Transport ----------
  function togglePlay() {
    const element = el.current;
    if (!element) { const first = current ?? playlist[0]; if (first) void load(first); else void openFile(); return; }
    if (stopped) { setStopped(false); void start(element, 0); return; }
    if (element.paused) { chain.current?.resume(); void element.play().catch(() => {}); showOsd('Play'); } else { element.pause(); showOsd('Pause'); }
  }
  function stop(silent = false) {
    savePosition(); loadToken.current++;
    teardown(); media.current = null;
    setPlaying(false); setStopped(true); setTime(0); setVideoSize({ width: 0, height: 0 }); setWaiting(false); setCover(null); setRecording(false);
    context.lifecycle.setTitle('Media Player');
    if (!silent) showOsd('Stop');
  }
  function seek(target: number, label?: string) {
    const element = el.current; if (!element || media.current?.capture) return;
    const limit = Number.isFinite(element.duration) ? element.duration : duration || probeRef.current?.duration || 0;
    const value = clamp(target, 0, limit || Infinity);
    element.currentTime = value; setTime(value);
    showOsd(label ?? `${formatTime(value, limit)} / ${formatTime(limit)}`);
  }
  const jump = (seconds: number) => { const element = el.current; if (!element) return; seek(element.currentTime + seconds, `${seconds > 0 ? 'Jump +' : 'Jump -'}${Math.abs(seconds)}s`); };
  function setRate(value: number) { const next = clamp(value, 1 / 16, 16); setRateState(next); if (el.current) { el.current.playbackRate = next; el.current.defaultPlaybackRate = next; } showOsd(`Speed: ${formatRate(next)}`); }
  function setVolume(value: number) { const next = clamp(Math.round(value * 100) / 100, 0, prefs.maxVolume); setVolumeState(next); setMuted(false); showOsd(`Volume: ${Math.round(next * 100)}%`); }
  const toggleMute = () => { setMuted(value => { showOsd(value ? `Volume: ${Math.round(volume * 100)}%` : 'Mute'); return !value; }); };
  const playNext = () => { const next = nextItem(1, state.current.loop === 'all'); if (next) void load(next); };
  const playPrevious = () => { if (el.current && el.current.currentTime > 3 && !state.current.random && order().findIndex(item => item.id === currentId) <= 0) { seek(0); return; } const prev = nextItem(-1, state.current.loop === 'all'); if (prev) void load(prev); else seek(0); };
  function nextFrame() { const element = el.current; if (!element) return; element.pause(); const fps = video?.fps || 25; element.currentTime = Math.min(element.duration || Infinity, element.currentTime + 1 / fps); showOsd('Next frame'); }
  function cycleLoop() { const next: Loop = loop === 'none' ? 'all' : loop === 'all' ? 'one' : 'none'; setLoop(next); showOsd(next === 'none' ? 'Loop: Off' : next === 'all' ? 'Loop: All' : 'Loop: One'); }
  function toggleRandom() { setRandom(value => { showOsd(value ? 'Random: Off' : 'Random: On'); return !value; }); }
  function abLoop() {
    const t = el.current?.currentTime ?? 0;
    if (ab.a === undefined) { setAb({ a: t }); showOsd('A→B loop: A set'); }
    else if (ab.b === undefined) { if (t > ab.a) { setAb({ a: ab.a, b: t }); showOsd('A→B loop: B set'); } else setAb({ a: t }); }
    else { setAb({}); showOsd('A→B loop: Off'); }
  }
  function chapterJump(direction: 1 | -1) {
    if (!chapters.length || !el.current) return;
    const t = el.current.currentTime, index = chapters.findIndex(chapter => t >= chapter.start - 0.5 && t < chapter.end);
    const target = direction > 0 ? chapters[index + 1] : t - (chapters[index]?.start ?? 0) > 3 ? chapters[index] : chapters[index - 1];
    if (target) seek(target.start, target.title);
  }
  function cycleAudioTrack() {
    if (audios.length < 2) { showOsd(audios.length ? `Audio track: ${streamLabel(audios[0], 0)}` : 'No audio track'); return; }
    const index = audios.findIndex(stream => stream.index === audioIndex), next = audios[(index + 1) % audios.length];
    void selectAudio(next.index);
  }
  async function selectAudio(index: number) {
    const position = audios.findIndex(stream => stream.index === index);
    setAudioIndex(index); state.current.audioIndex = index;
    showOsd(`Audio track: ${streamLabel(audios[position], position)}`);
    await decide(true);
  }
  function cycleSubtitle() {
    const ids = [null, ...subtitles.map(track => track.id)], index = ids.indexOf(subtitleId);
    void selectSubtitle(ids[(index + 1) % ids.length]);
  }
  function subtitleDelay(delta: number) { setSync(value => { const subtitle = Math.round((value.subtitle + delta) * 1000) / 1000; showOsd(`Subtitle delay ${Math.round(subtitle * 1000)} ms`); return { ...value, subtitle }; }); }
  function audioDelay(delta: number) { setSync(value => { const audio = clamp(Math.round((value.audio + delta) * 1000) / 1000, 0, 5); showOsd(delta < 0 && value.audio === 0 ? 'Audio delay can only be positive' : `Audio delay ${Math.round(audio * 1000)} ms`); return { ...value, audio }; }); }
  function cycle<T extends string>(list: readonly T[], value: T, set: (next: T) => void, label: string) { const next = list[(list.indexOf(value) + 1) % list.length]; set(next); showOsd(`${label}: ${next}`); }
  function cycleZoom() { const index = ZOOM_MODES.findIndex(item => item.value === zoom), next = ZOOM_MODES[(index + 1) % ZOOM_MODES.length]; setZoom(next.value); showOsd(`Zoom mode: ${next.label}`); }
  async function toggleDeinterlace() {
    const next = !deinterlace; setDeinterlace(next); state.current.deinterlace = next;
    showOsd(`Deinterlace ${next ? 'On (Yadif)' : 'Off'}`);
    if (media.current?.blob) await decide(true);
  }
  const rotate = () => setGeometry(value => { const rotation = (value.rotation + 90) % 360; showOsd(`Rotation: ${rotation}°`); return { ...value, rotation }; });

  async function snapshot() {
    const element = el.current;
    if (!element || !element.videoWidth) { showOsd('Snapshot unavailable'); return; }
    const c = document.createElement('canvas'); c.width = element.videoWidth; c.height = element.videoHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(element, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const name = `${snapshotName()}.png`;
    try {
      if (!services.files.writeBinary) throw new Error('unavailable');
      await services.files.mkdir('/Pictures').catch(() => {});
      await services.files.writeBinary(`/Pictures/${name}`, new Uint8Array(await blob.arrayBuffer()), { createOnly: true });
      showOsd('Snapshot taken'); services.notify({ title: 'Snapshot', message: `Pictures/${name}`, tone: 'success' });
    } catch { download(blob, name); showOsd('Snapshot taken'); }
  }
  function toggleRecord() {
    const element = el.current as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null;
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return; }
    if (!element?.captureStream || typeof MediaRecorder === 'undefined') { showOsd('Recording is unavailable in this browser'); return; }
    const chunks: Blob[] = [], title = titleFromName(current?.title ?? 'record');
    const rec = new MediaRecorder(element.captureStream(), { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm' });
    rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    rec.onstop = async () => {
      setRecording(false); recorder.current = null;
      const blob = new Blob(chunks, { type: 'video/webm' }), name = `lope-record-${title}-${snapshotName().slice(9)}.webm`;
      try {
        if (!services.files.writeBinary) throw new Error('unavailable');
        await services.files.mkdir('/Videos').catch(() => {});
        await services.files.writeBinary(`/Videos/${name}`, new Uint8Array(await blob.arrayBuffer()), { createOnly: true });
        services.notify({ title: 'Recording saved', message: `Videos/${name}`, tone: 'success' });
      } catch { download(blob, name); }
    };
    rec.start(1000); recorder.current = rec; setRecording(true); showOsd('Recording');
  }
  function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }

  // ---------- Opening ----------
  async function openFile() { const path = await services.dialogs.openFile({ extensions: [...MEDIA_EXTENSIONS, ...PLAYLIST_EXTENSIONS] }); if (path) await openWorkspace(path); }
  async function openSubtitleFile() {
    if (!current) { showOsd('Open a media file first'); return; }
    const path = await services.dialogs.openFile({ extensions: SUBTITLE_EXTENSIONS });
    if (path) { try { addSubtitle(baseName(path), (await services.files.read(path)).content); } catch (cause) { notifyError(errorMessage(cause)); } }
  }
  async function openClipboard() {
    try { const text = (await navigator.clipboard.readText()).trim(); setNetworkInitial(/^https?:\/\//i.test(text) ? text : ''); }
    catch { setNetworkInitial(''); }
    setDialog('network');
  }
  function openNetwork(url: string) { setDialog(null); void enqueue([makeItem({ title: displayName(url), location: url, source: 'url' })]); }
  async function savePlaylist() {
    if (!playlist.length) { showOsd('The playlist is empty'); return; }
    const path = await services.dialogs.saveFile({ defaultName: 'Playlist.xspf' });
    if (!path) return;
    const entries = playlist.map(item => ({ location: item.source === 'local' ? item.title : item.location, title: item.title, duration: item.duration }));
    const text = extensionOf(path) === 'm3u' || extensionOf(path) === 'm3u8' ? serializeM3U(entries) : serializeXSPF(entries);
    try { await services.files.write(path, text); services.notify({ title: 'Playlist saved', message: path.slice(1), tone: 'success' }); }
    catch (cause) { notifyError(errorMessage(cause)); }
  }
  async function runConvert(profile: ProfileId, destination: 'workspace' | 'download', name: string) {
    const m = media.current, blob = m?.blob ?? (current ? await materialize(current).catch(() => undefined) : undefined);
    if (!blob || !current) { notifyError('Choose a file (not a stream) to convert.'); return; }
    setConvertProgress(0); convertCancelled.current = false;
    try {
      const data = await convert(blob, current.title, profile, setConvertProgress);
      if (destination === 'download') download(new Blob([data as BlobPart]), name);
      else {
        if (!services.files.writeBinary) throw new Error('Binary file access is unavailable in this workspace.');
        const folder = current.source === 'workspace' ? parentPath(current.location) : '/Videos';
        await services.files.mkdir(folder).catch(() => {});
        const path = `${folder === '/' ? '' : folder}/${name}`;
        await services.files.writeBinary(path, data, { createOnly: true });
        services.notify({ title: 'Conversion finished', message: path.slice(1), tone: 'success' });
      }
      setDialog(null);
    } catch (cause) { if (!convertCancelled.current) notifyError(`Conversion failed: ${errorMessage(cause)}`); }
    finally { setConvertProgress(null); }
  }
  function cancelConvert() { convertCancelled.current = true; cancelTasks(); setConvertProgress(null); showOsd('Conversion stopped'); }

  // ---------- Full screen and interface ----------
  async function toggleFullscreen() {
    const target = root.current; if (!target) return;
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await target.requestFullscreen(); } catch { showOsd('Full screen is unavailable'); }
  }
  useEffect(() => { const change = () => setFullscreen(document.fullscreenElement === root.current); document.addEventListener('fullscreenchange', change); return () => document.removeEventListener('fullscreenchange', change); }, []);
  useEffect(() => { if (dialog && document.fullscreenElement === root.current) void document.exitFullscreen(); }, [dialog]);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const overlayMode = fullscreen || minimal;
  function revealControls() {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    if (overlayMode) hideTimer.current = setTimeout(() => setControlsVisible(false), 2500);
  }
  useEffect(() => { revealControls(); return () => clearTimeout(hideTimer.current); }, [overlayMode]);

  // ---------- System media controls (media keys, OS now-playing) ----------
  const sessionActions = useRef({ togglePlay, stop: () => stop(), playNext, playPrevious, jump, seek });
  sessionActions.current = { togglePlay, stop: () => stop(), playNext, playPrevious, jump, seek };
  useEffect(() => {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!session) return;
    const run = () => sessionActions.current;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => { if (!el.current || el.current.paused) run().togglePlay(); }],
      ['pause', () => { if (el.current && !el.current.paused) run().togglePlay(); }],
      ['stop', () => run().stop()],
      ['nexttrack', () => run().playNext()],
      ['previoustrack', () => run().playPrevious()],
      ['seekforward', details => run().jump(details.seekOffset ?? prefsRef.current.jumps.short)],
      ['seekbackward', details => run().jump(-(details.seekOffset ?? prefsRef.current.jumps.short))],
      ['seekto', details => { if (details.seekTime !== undefined) run().seek(details.seekTime); }],
    ];
    for (const [action, handler] of handlers) { try { session.setActionHandler(action, handler); } catch { /* unsupported action */ } }
    return () => { for (const [action] of handlers) { try { session.setActionHandler(action, null); } catch {} } session.metadata = null; session.playbackState = 'none'; };
  }, []);
  useEffect(() => {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!session || typeof MediaMetadata === 'undefined') return;
    session.metadata = current && !stopped ? new MediaMetadata({ title: probe?.tags.title || titleFromName(current.title), artist: probe?.tags.artist ?? '', album: probe?.tags.album ?? '', artwork: cover ? [{ src: cover }] : [] }) : null;
    session.playbackState = !current || stopped ? 'none' : playing ? 'playing' : 'paused';
  }, [current?.id, current?.title, probe, cover, stopped, playing]);
  const wholeSecond = Math.floor(time);
  useEffect(() => {
    const total = duration || probe?.duration || 0;
    if (!navigator.mediaSession?.setPositionState || !total || !Number.isFinite(total) || stopped) return;
    try { navigator.mediaSession.setPositionState({ duration: total, playbackRate: rate, position: Math.min(time, total) }); } catch { /* inconsistent state while loading */ }
  }, [wholeSecond, duration, rate, stopped]);

  // ---------- Frame loop: smooth time, A→B loop, visualizer ----------
  useEffect(() => {
    let frame = 0, last = 0;
    const data = new Uint8Array(1024), wave = new Uint8Array(2048);
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const element = el.current;
      if (element && !element.paused) {
        const { a, b } = state.current.ab;
        if (a !== undefined && b !== undefined && element.currentTime >= b) element.currentTime = a;
        if (now - last > 100) { last = now; setTime(element.currentTime); }
      }
      const c = canvas.current, analyser = chain.current?.analyser;
      if (!c || !analyser) return;
      const ctx = c.getContext('2d'); if (!ctx) return;
      const width = c.clientWidth * devicePixelRatio, height = c.clientHeight * devicePixelRatio;
      if (c.width !== width || c.height !== height) { c.width = width; c.height = height; }
      ctx.clearRect(0, 0, width, height);
      const accent = getComputedStyle(c).color;
      ctx.fillStyle = accent; ctx.strokeStyle = accent;
      const kind = c.dataset.visual as Visual;
      if (kind === 'spectrum') {
        analyser.getByteFrequencyData(data);
        const bars = 40, gap = 2 * devicePixelRatio, w = width / bars;
        for (let i = 0; i < bars; i++) {
          const from = Math.floor(Math.pow(i / bars, 2) * 400) + 1, to = Math.floor(Math.pow((i + 1) / bars, 2) * 400) + 2;
          let peak = 0; for (let j = from; j < to; j++) peak = Math.max(peak, data[j]);
          const h = (peak / 255) * height * 0.9;
          ctx.fillRect(i * w + gap / 2, height - h, w - gap, h);
        }
      } else if (kind === 'scope') {
        analyser.getByteTimeDomainData(wave);
        ctx.lineWidth = 2 * devicePixelRatio; ctx.beginPath();
        for (let i = 0; i < wave.length; i++) { const x = i / wave.length * width, y = wave[i] / 255 * height; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      } else if (kind === 'vu') {
        analyser.getByteTimeDomainData(wave);
        let sum = 0; for (const value of wave) sum += ((value - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / wave.length) * 2.5), segments = 30, sw = width * 0.8 / segments;
        for (let i = 0; i < segments; i++) { ctx.globalAlpha = i / segments < level ? 1 : 0.15; ctx.fillRect(width * 0.1 + i * sw, height * 0.42, sw - 3 * devicePixelRatio, height * 0.16); }
        ctx.globalAlpha = 1;
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  // ---------- Layout ----------
  useEffect(() => {
    const target = stage.current; if (!target) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(target); return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => videoLayout(stageSize, videoSize, { aspect, crop, zoom, rotation: geometry.rotation }), [stageSize, videoSize, aspect, crop, zoom, geometry.rotation]);
  useEffect(() => {
    const element = el.current, box = host.current; if (!element || !box) return;
    Object.assign(box.style, {
      width: layout ? `${layout.visibleWidth}px` : '100%', height: layout ? `${layout.visibleHeight}px` : '100%',
      transform: geometry.rotation ? `rotate(${geometry.rotation}deg)` : '',
    });
    const filters = adjust.enabled ? [`brightness(${adjust.brightness})`, `contrast(${adjust.contrast})`, `saturate(${adjust.saturation})`, `hue-rotate(${adjust.hue}deg)`, adjust.gamma !== 1 ? 'url(#mp-gamma)' : ''].filter(Boolean).join(' ') : '';
    Object.assign(element.style, {
      width: layout ? `${layout.width}px` : '100%', height: layout ? `${layout.height}px` : '100%', objectFit: layout ? 'fill' : 'contain',
      transform: `translate(-50%, -50%) scale(${geometry.flipH ? -1 : 1}, ${geometry.flipV ? -1 : 1})`, filter: filters,
      visibility: hasPicture ? 'visible' : 'hidden',
    });
  });

  // ---------- Hotkeys (VLC defaults) ----------
  function keydown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('input,select,textarea,[role="dialog"],.mp-playlist-search') || event.nativeEvent.isComposing) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key;
    const run = (action: () => void) => { event.preventDefault(); event.stopPropagation(); action(); };
    if (key === ' ') return run(togglePlay);
    if (key === 'Escape' && document.fullscreenElement) return run(() => void document.exitFullscreen());
    if (key === 'Escape' && minimal) return run(() => setMinimal(false));
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (target.closest('.mp-playlist')) return;
      const sign = key === 'ArrowRight' ? 1 : -1;
      const size = mod && event.altKey ? prefs.jumps.long : mod ? prefs.jumps.medium : event.shiftKey ? prefs.jumps.veryShort : prefs.jumps.short;
      return run(() => jump(sign * size));
    }
    if ((key === 'ArrowUp' || key === 'ArrowDown') && (mod || !target.closest('.mp-playlist'))) return run(() => setVolume(volume + (key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP)));
    if (mod || event.altKey) return;
    const actions: Record<string, () => void> = {
      f: toggleFullscreen, s: () => stop(), n: playNext, p: playPrevious, m: toggleMute, e: nextFrame, t: () => showOsd(`${formatTime(time, duration)} / ${formatTime(duration)}`),
      '[': () => setRate(nextRate(rate, -1)), ']': () => setRate(nextRate(rate, 1)), '=': () => setRate(1), '+': () => setRate(fineRate(rate, 1)), '-': () => setRate(fineRate(rate, -1)),
      l: cycleLoop, r: toggleRandom, b: cycleAudioTrack, v: cycleSubtitle, a: () => cycle(ASPECT_RATIOS, aspect as typeof ASPECT_RATIOS[number], setAspect, 'Aspect ratio'),
      c: () => cycle(CROP_RATIOS, crop as typeof CROP_RATIOS[number], setCrop, 'Crop'), z: cycleZoom, d: () => void toggleDeinterlace(),
      g: () => subtitleDelay(-0.05), h: () => subtitleDelay(0.05), j: () => audioDelay(-0.05), k: () => audioDelay(0.05),
      S: () => void snapshot(), L: abLoop, N: () => chapterJump(1), P: () => chapterJump(-1),
    };
    const action = actions[event.shiftKey && key.length === 1 ? key.toUpperCase() : key.length === 1 ? key.toLowerCase() : key] ?? (key === 'F11' ? toggleFullscreen : undefined);
    if (action) run(action);
  }
  function wheel(event: React.WheelEvent) {
    if (!current) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) { if (Math.abs(event.deltaX) > 8) jump(event.deltaX > 0 ? prefs.jumps.veryShort : -prefs.jumps.veryShort); return; }
    setVolume(volume + (event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP));
  }

  // ---------- Commands (global menu bar) ----------
  const active = !!current && !stopped;
  useAppCommands(context, [
    { id: 'media.open-file', label: 'Open File…', shortcut: 'Mod+O', execute: openFile },
    { id: 'media.open-multiple', label: 'Open Files from Computer…', shortcut: 'Mod+Shift+O', execute: () => fileInput.current?.click() },
    { id: 'media.open-folder', label: 'Open Folder from Computer…', shortcut: 'Mod+F', execute: () => folderInput.current?.click() },
    { id: 'media.open-network', label: 'Open Network Stream…', shortcut: 'Mod+N', execute: () => { setNetworkInitial(''); setDialog('network'); } },
    { id: 'media.open-capture', label: 'Open Capture Device…', execute: () => setDialog('capture') },
    { id: 'media.open-clipboard', label: 'Open Location from Clipboard', shortcut: 'Mod+Shift+V', execute: openClipboard },
    { id: 'media.save-playlist', label: 'Save Playlist to File…', shortcut: 'Mod+Y', enabled: playlist.length > 0, execute: savePlaylist },
    { id: 'media.convert', label: 'Convert / Save…', shortcut: 'Mod+R', enabled: !!current && current.source !== 'capture' && engineAvailable, execute: () => setDialog('convert') },
    { id: 'media.quit-at-end', label: 'Quit at the End of Playlist', checked: quitAtEnd, execute: () => setQuitAtEnd(value => !value) },
    { id: 'media.quit', label: 'Quit', shortcut: 'Mod+Q', execute: () => context.lifecycle.close() },
    { id: 'playback.play', label: 'Play/Pause', execute: togglePlay },
    { id: 'playback.stop', label: 'Stop', shortcut: 'S', enabled: active, execute: () => stop() },
    { id: 'playback.previous', label: 'Previous', shortcut: 'P', enabled: playlist.length > 0, execute: playPrevious },
    { id: 'playback.next', label: 'Next', shortcut: 'N', enabled: playlist.length > 1 || loop !== 'none', execute: playNext },
    { id: 'playback.record', label: 'Record', checked: recording, enabled: active, execute: toggleRecord },
    { id: 'playback.faster', label: 'Faster', shortcut: ']', enabled: active, execute: () => setRate(nextRate(rate, 1)) },
    { id: 'playback.faster-fine', label: 'Faster (fine)', enabled: active, execute: () => setRate(fineRate(rate, 1)) },
    { id: 'playback.normal', label: 'Normal Speed', shortcut: '=', enabled: active, execute: () => setRate(1) },
    { id: 'playback.slower-fine', label: 'Slower (fine)', enabled: active, execute: () => setRate(fineRate(rate, -1)) },
    { id: 'playback.slower', label: 'Slower', shortcut: '[', enabled: active, execute: () => setRate(nextRate(rate, -1)) },
    { id: 'playback.forward', label: 'Jump Forward', enabled: active, execute: () => jump(prefs.jumps.short) },
    { id: 'playback.backward', label: 'Jump Backward', enabled: active, execute: () => jump(-prefs.jumps.short) },
    { id: 'playback.jump', label: 'Jump to Specific Time…', shortcut: 'Mod+T', enabled: active, execute: () => setDialog('jump') },
    { id: 'playback.next-frame', label: 'Next Frame', shortcut: 'E', enabled: active, execute: nextFrame },
    { id: 'playback.ab-loop', label: 'A→B Loop', shortcut: 'Shift+L', checked: ab.a !== undefined, enabled: active, execute: abLoop },
    { id: 'playback.next-chapter', label: 'Next Chapter', shortcut: 'Shift+N', enabled: chapters.length > 0, execute: () => chapterJump(1) },
    { id: 'playback.previous-chapter', label: 'Previous Chapter', shortcut: 'Shift+P', enabled: chapters.length > 0, execute: () => chapterJump(-1) },
    { id: 'playback.loop', label: 'Loop (Off / All / One)', shortcut: 'L', checked: loop !== 'none', execute: cycleLoop },
    { id: 'playback.random', label: 'Random', shortcut: 'R', checked: random, execute: toggleRandom },
    { id: 'audio.next-track', label: 'Next Audio Track', shortcut: 'B', enabled: audios.length > 1, execute: cycleAudioTrack },
    ...(['stereo', 'mono', 'left', 'right', 'reverse'] as StereoMode[]).map(value => ({ id: `audio.${value}` as const, label: { stereo: 'Stereo', mono: 'Mono', left: 'Left', right: 'Right', reverse: 'Reverse stereo' }[value], checked: stereo === value, enabled: audioGraph, execute: () => { setStereo(value); showOsd(`Stereo audio mode: ${value}`); } })),
    ...([['off', 'Visualizations: Disabled'], ['spectrum', 'Spectrometer'], ['scope', 'Scope'], ['vu', 'VU meter']] as [Visual, string][]).map(([value, label]) => ({ id: `audio.vis-${value}` as const, label, checked: visual === value, enabled: audioGraph, execute: () => setVisual(value) })),
    { id: 'audio.volume-up', label: 'Increase Volume', shortcut: 'Mod+ArrowUp', execute: () => setVolume(volume + VOLUME_STEP) },
    { id: 'audio.volume-down', label: 'Decrease Volume', shortcut: 'Mod+ArrowDown', execute: () => setVolume(volume - VOLUME_STEP) },
    { id: 'audio.mute', label: 'Mute', shortcut: 'M', checked: muted, execute: toggleMute },
    { id: 'video.fullscreen', label: 'Fullscreen', shortcut: 'F', checked: fullscreen, execute: toggleFullscreen },
    { id: 'video.fit', label: 'Always Fit Window', checked: zoom === 0, execute: () => setZoom(0) },
    { id: 'video.zoom', label: 'Cycle Zoom', shortcut: 'Z', enabled: hasPicture, execute: cycleZoom },
    { id: 'video.aspect', label: 'Cycle Aspect Ratio', shortcut: 'A', enabled: hasPicture, execute: () => cycle(ASPECT_RATIOS, aspect as typeof ASPECT_RATIOS[number], setAspect, 'Aspect ratio') },
    { id: 'video.crop', label: 'Cycle Crop', shortcut: 'C', enabled: hasPicture, execute: () => cycle(CROP_RATIOS, crop as typeof CROP_RATIOS[number], setCrop, 'Crop') },
    { id: 'video.deinterlace', label: 'Deinterlace (Yadif)', shortcut: 'D', checked: deinterlace, enabled: engineAvailable, execute: () => void toggleDeinterlace() },
    { id: 'video.rotate', label: 'Rotate 90°', checked: geometry.rotation !== 0, enabled: hasPicture, execute: rotate },
    { id: 'video.flip', label: 'Flip Horizontally', checked: geometry.flipH, enabled: hasPicture, execute: () => setGeometry(value => ({ ...value, flipH: !value.flipH })) },
    { id: 'video.snapshot', label: 'Take Snapshot', shortcut: 'Shift+S', enabled: hasPicture, execute: () => void snapshot() },
    { id: 'subtitle.add', label: 'Add Subtitle File…', enabled: !!current, execute: openSubtitleFile },
    { id: 'subtitle.next-track', label: 'Next Subtitle Track', shortcut: 'V', enabled: subtitles.length > 0, execute: cycleSubtitle },
    { id: 'subtitle.disable', label: 'Disable Subtitles', enabled: subtitleId !== null, execute: () => void selectSubtitle(null) },
    { id: 'subtitle.delay-up', label: 'Delay Subtitles (+50 ms)', shortcut: 'H', enabled: subtitleId !== null, execute: () => subtitleDelay(0.05) },
    { id: 'subtitle.delay-down', label: 'Advance Subtitles (−50 ms)', shortcut: 'G', enabled: subtitleId !== null, execute: () => subtitleDelay(-0.05) },
    { id: 'subtitle.delay-reset', label: 'Reset Subtitle Delay', enabled: sync.subtitle !== 0, execute: () => setSync(value => ({ ...value, subtitle: 0 })) },
    { id: 'tools.effects', label: 'Effects and Filters', shortcut: 'Mod+E', execute: () => setDialog('effects') },
    { id: 'tools.sync', label: 'Track Synchronization', execute: () => setDialog('sync') },
    { id: 'tools.info', label: 'Media Information', shortcut: 'Mod+I', enabled: !!current, execute: () => setDialog('info') },
    { id: 'tools.codec', label: 'Codec Information', shortcut: 'Mod+J', enabled: !!current, execute: () => setDialog('codec') },
    { id: 'tools.preferences', label: 'Preferences', shortcut: 'Mod+P', execute: () => setDialog('prefs') },
    { id: 'playback.bookmarks', label: 'Custom Bookmarks…', shortcut: 'Mod+B', enabled: active && !!bookmarkKey, execute: () => setDialog('bookmarks') },
    { id: 'playback.add-bookmark', label: 'Add Bookmark', enabled: active && !!bookmarkKey, execute: () => { setBookmarks(addBookmark(bookmarks, el.current?.currentTime ?? time)); showOsd('Bookmark added'); } },
    { id: 'audio.device', label: 'Audio Device…', execute: () => setDialog('prefs-audio') },
    { id: 'view.playlist', label: 'Playlist', shortcut: 'Mod+L', checked: showPlaylist, execute: () => setShowPlaylist(value => !value) },
    { id: 'view.minimal', label: 'Minimal Interface', shortcut: 'Mod+H', checked: minimal, execute: () => setMinimal(value => !value) },
    { id: 'view.fullscreen-interface', label: 'Fullscreen Interface', shortcut: 'F11', checked: fullscreen, execute: toggleFullscreen },
    { id: 'view.advanced', label: 'Advanced Controls', checked: advanced, execute: () => setAdvanced(value => !value) },
    { id: 'view.time', label: 'Show Remaining Time', checked: remaining, execute: () => setRemaining(value => !value) },
    { id: 'help.shortcuts', label: 'Hotkeys', execute: () => setDialog('shortcuts') },
    { id: 'help.about', label: 'About', execute: () => setDialog('about') },
  ]);

  // ---------- Launch, drag & drop, cleanup ----------
  useEffect(() => {
    const path = context.launchArgs.path, paths = context.launchArgs.paths;
    if (typeof path === 'string') void openWorkspace(path);
    else if (Array.isArray(paths)) void enqueue(paths.filter((item): item is string => typeof item === 'string').map(workspaceItem));
    root.current?.focus();
    const close = context.lifecycle.onBeforeClose(() => { savePosition(); return true; });
    return () => { close(); savePosition(); teardown(); };
  }, []);
  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover); }, [cover]);
  async function drop(event: React.DragEvent) {
    event.preventDefault();
    const internal = event.dataTransfer.getData(FILE_DRAG_TYPE);
    if (internal) { try { const paths: unknown = JSON.parse(internal); if (Array.isArray(paths)) for (const [index, path] of paths.entries()) if (typeof path === 'string') await openWorkspace(path, index === 0 && !(event.target as HTMLElement).closest('.mp-playlist')); } catch {} return; }
    const files = [...event.dataTransfer.files];
    if (files.length) await enqueue(localItems(files), !(event.target as HTMLElement).closest('.mp-playlist') || !current);
  }

  // ---------- Render ----------
  const subtitle = subtitles.find(track => track.id === subtitleId);
  const cues = subtitle?.cues ? activeCues(subtitle.cues, time, sync.subtitle, sync.subtitleSpeed) : [];
  const shown = time;
  const total = duration || probe?.duration || 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.34 ? Volume : volume < 0.67 ? Volume1 : Volume2;
  const playlistTotal = playlist.reduce((sum, item) => sum + (item.duration ?? 0), 0);
  const filtered = filter ? playlist.filter(item => item.title.toLowerCase().includes(filter.toLowerCase())) : playlist;
  const busy = !!current && !stopped && !error && (waiting || streamStatus.buffering) && !playing;
  const visible = !overlayMode || controlsVisible;
  const vis = isAudioOnly && visual !== 'off' && audioGraph;

  return <div ref={root} className={`media-player ${overlayMode ? 'is-overlay' : ''} ${visible ? '' : 'is-idle'}`} tabIndex={-1} data-testid="media-player" onKeyDown={keydown}
    onPointerMove={revealControls} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes(FILE_DRAG_TYPE)) { dragDepth.current++; setDragOver(true); } }}
    onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false); }}
    onDrop={event => { dragDepth.current = 0; setDragOver(false); void drop(event); }}
    onPointerDown={event => { if (!(event.target as HTMLElement).closest('input,select,textarea,button,[role="slider"]')) root.current?.focus(); if (menu && !(event.target as HTMLElement).closest('.mp-context')) setMenu(null); if (tracksOpen && !(event.target as HTMLElement).closest('.mp-tracks,.mp-tracks-button')) setTracksOpen(false); }}>
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}><filter id="mp-gamma"><feComponentTransfer><feFuncR type="gamma" exponent={1 / adjust.gamma}/><feFuncG type="gamma" exponent={1 / adjust.gamma}/><feFuncB type="gamma" exponent={1 / adjust.gamma}/></feComponentTransfer></filter></svg>
    <div className="mp-body">
      <div ref={stage} className="mp-stage" onDoubleClick={() => void toggleFullscreen()} onWheel={wheel} onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}>
        <div ref={host} className="mp-host"/>
        {(stopped || !current) && <div className="mp-idle">
          {!playlist.length ? <div className="mp-hero">
            <PlayerMark/>
            <h2>Media Player</h2>
            <p>Plays almost any video or audio file — MKV, AVI, MP4, MOV, WMV, FLV, FLAC, WMA and more.</p>
            <div className="mp-welcome-actions">
              <Button variant="primary" onClick={() => void openFile()}><FolderOpen size={15}/>Open File…</Button>
              <Button onClick={() => fileInput.current?.click()}><Plus size={15}/>From Computer…</Button>
              <Button onClick={() => { setNetworkInitial(''); setDialog('network'); }}><Globe size={15}/>Network Stream…</Button>
            </div>
            <p className="mp-hint">or drop files anywhere in this window</p>
            {recent.length > 0 && <section className="mp-recent" aria-label="Recent media">
              <header><h3>Recent Media</h3><button className="mp-link" onClick={() => { setRecent([]); settings.set('media-player.recent', []); }}>Clear</button></header>
              {recent.slice(0, 6).map(entry => <button key={entry.location} title={entry.location} onClick={() => void (entry.source === 'url' ? enqueue([makeItem({ title: entry.title, location: entry.location, source: 'url' })]) : openWorkspace(entry.location))}>
                <span className="mp-recent-icon">{entry.source === 'url' ? <Globe size={15}/> : isAudioName(entry.title) ? <Music size={15}/> : <Clapperboard size={15}/>}</span>
                <span className="mp-recent-title">{titleFromName(entry.title)}</span>
                <span className="mp-recent-kind">{entry.source === 'url' ? 'Stream' : extensionOf(entry.title).toUpperCase()}</span>
              </button>)}
            </section>}
          </div> : <div className="mp-hero is-compact">
            <PlayerMark/>
            <p>Stopped · {playlist.length} item{playlist.length === 1 ? '' : 's'} in the playlist</p>
            <p className="mp-hint">Press Space to play</p>
          </div>}
        </div>}
        {isAudioOnly && <div className="mp-audio-art" data-cover={!!cover}>
          {cover && !vis && <img className="mp-ambient" src={cover} alt=""/>}
          {vis ? <canvas ref={canvas} data-visual={visual} className="mp-visual" aria-label={`${visual} visualization`}/> : cover ? <img className="mp-cover" src={cover} alt="Album art"/> : <div className="mp-music"><Music size={56}/></div>}
          <div className="mp-audio-meta">
            <strong>{probe?.tags.title || titleFromName(current!.title)}</strong>
            {(probe?.tags.artist || probe?.tags.album) && <span>{[probe?.tags.artist, probe?.tags.album].filter(Boolean).join(' — ')}</span>}
            {audios[0] && <small>{[audios[0].codec.toUpperCase(), audios[0].sampleRate ? `${(audios[0].sampleRate / 1000).toLocaleString()} kHz` : '', audios[0].channels === 1 ? 'Mono' : audios[0].channels === 2 ? 'Stereo' : audios[0].channels ? `${audios[0].channels} channels` : '', audios[0].bitrate ? `${Math.round(audios[0].bitrate / 1000)} kb/s` : ''].filter(Boolean).join(' · ')}</small>}
          </div>
        </div>}
        {cues.length > 0 && !stopped && <div className="mp-subtitles" aria-live="off" data-background={prefs.subtitleBackground} style={{ '--mp-sub-scale': prefs.subtitleScale, '--mp-sub-color': prefs.subtitleColor } as CSSProperties}>{cues.map((cue, index) => <span key={index} dangerouslySetInnerHTML={{ __html: cue.text }}/>)}</div>}
        {osd && <div className="mp-osd" key={osd.id} role="status">{osd.text}</div>}
        {titleOsd && !stopped && <div className="mp-osd-title" key={titleOsd.id}>{titleOsd.text}</div>}
        {busy && <div className="mp-buffering" role="status"><span className="mp-spinner" aria-hidden="true"/>{mode === 'stream' ? 'Decoding with FFmpeg…' : 'Opening…'}</div>}
        {overlayMode && <div className="mp-scrim" aria-hidden="true"/>}
        {dragOver && <div className="mp-drop" aria-hidden="true"><Plus size={28}/><span>{current ? 'Drop to play, or onto the playlist to queue' : 'Drop to play'}</span></div>}
        {error && <div className="mp-error" role="alert"><strong>Your input can't be opened</strong><p>{error.replace(/^Your input can't be opened: /, '')}</p><Button onClick={() => setError('')}>Close</Button></div>}
        {resume && resume.id === currentId && <div className="mp-resume glass" data-glass-tone="dark"><span>Continue playback from {formatTime(resume.time)}?</span><Button variant="primary" onClick={() => { seek(resume.time); setResume(null); }}>Continue</Button><button aria-label="Dismiss" onClick={() => setResume(null)}><X size={14}/></button></div>}
        {recording && <div className="mp-rec" role="status"><Circle size={10} fill="currentColor"/>REC</div>}
        {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          [playing ? 'Pause' : 'Play', togglePlay, false, 'Space'], ['Stop', () => stop(), !active, 'S'], ['Previous', playPrevious, !playlist.length, 'P'], ['Next', playNext, playlist.length < 2, 'N'], null,
          ['Faster', () => setRate(nextRate(rate, 1)), !active, ']'], ['Slower', () => setRate(nextRate(rate, -1)), !active, '['], ['Jump to Time…', () => setDialog('jump'), !active, '⌘T'], null,
          [fullscreen ? 'Leave Fullscreen' : 'Fullscreen', toggleFullscreen, false, 'F'], ['Take Snapshot', () => void snapshot(), !hasPicture, '⇧S'], ['Tracks and Picture…', () => setTracksOpen(true), !active], null,
          ['Effects and Filters', () => setDialog('effects'), false, '⌘E'], ['Media Information', () => setDialog('info'), !current, '⌘I'], [showPlaylist ? 'Hide Playlist' : 'Show Playlist', () => setShowPlaylist(value => !value), false, '⌘L'], [minimal ? 'Normal Interface' : 'Minimal Interface', () => setMinimal(value => !value), false, '⌘H'], null,
          ['Open File…', () => void openFile(), false, '⌘O'], ['Quit', () => context.lifecycle.close(), false, '⌘Q'],
        ]}/>}
      </div>
      {showPlaylist && <aside className="mp-playlist" aria-label="Playlist">
        <header><strong>Playlist</strong><span>{playlist.length} item{playlist.length === 1 ? '' : 's'}{playlistTotal ? ` · ${formatTime(playlistTotal)}` : ''}</span><button aria-label="Close playlist" title="Close playlist" onClick={() => setShowPlaylist(false)}><X size={14}/></button></header>
        <label className="mp-playlist-search"><Search size={13}/><Input placeholder="Search Filter" value={filter} onChange={event => setFilter(event.target.value)} aria-label="Search playlist"/></label>
        <div className="mp-playlist-rows" role="listbox" aria-label="Playlist items" aria-multiselectable="true" tabIndex={0} onKeyDown={event => {
          if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRows.length) { event.preventDefault(); event.stopPropagation(); removeItems(selectedRows); }
          if (event.key === 'Enter' && selectedRows[0]) { event.preventDefault(); event.stopPropagation(); const item = playlist.find(entry => entry.id === selectedRows[0]); if (item) void load(item); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); const index = filtered.findIndex(item => item.id === selectedRows[0]); const next = filtered[clamp(index + (event.key === 'ArrowDown' ? 1 : -1), 0, filtered.length - 1)]; if (next) setSelectedRows([next.id]); }
        }}>
          {filtered.map(item => <div key={item.id} role="option" aria-selected={selectedRows.includes(item.id)} className={`mp-row ${item.id === currentId ? 'is-current' : ''}`} draggable
            onClick={event => setSelectedRows(rows => event.metaKey || event.ctrlKey ? rows.includes(item.id) ? rows.filter(id => id !== item.id) : [...rows, item.id] : [item.id])}
            onDoubleClick={() => void load(item)}
            onDragStart={event => event.dataTransfer.setData('application/x-lope-playlist', item.id)}
            onDragOver={event => { if (event.dataTransfer.types.includes('application/x-lope-playlist')) { event.preventDefault(); event.stopPropagation(); } }}
            onDrop={event => { const id = event.dataTransfer.getData('application/x-lope-playlist'); if (!id) return; event.preventDefault(); event.stopPropagation(); setPlaylist(list => { const moving = list.find(entry => entry.id === id); if (!moving || id === item.id) return list; const rest = list.filter(entry => entry.id !== id); rest.splice(rest.findIndex(entry => entry.id === item.id), 0, moving); return rest; }); }}>
            <span className="mp-row-state">{item.id === currentId && !stopped ? (playing ? <span className="mp-eq-bars" aria-label="Playing"><i/><i/><i/></span> : <Pause size={12}/>) : item.source === 'url' ? <Globe size={13}/> : isAudioName(item.title) ? <Music size={13}/> : <Clapperboard size={13}/>}</span>
            <span className="mp-row-title" title={item.location}>{titleFromName(item.title)}</span>
            <span className="mp-row-duration">{item.duration ? formatTime(item.duration) : '--:--'}</span>
          </div>)}
          {!playlist.length && <div className="mp-empty"><ListMusic size={28}/><p>Drop files here to add them to the playlist.</p></div>}
        </div>
        <footer>
          <button aria-label="Add file" title="Add file from workspace" onClick={async () => { const path = await services.dialogs.openFile({ extensions: [...MEDIA_EXTENSIONS, ...PLAYLIST_EXTENSIONS] }); if (path) await openWorkspace(path, !current); }}><Plus size={15}/></button>
          <button aria-label="Add from computer" title="Add from this computer" onClick={() => fileInput.current?.click()}><FolderOpen size={15}/></button>
          <button aria-label="Remove selected" title="Remove selected" disabled={!selectedRows.length} onClick={() => removeItems(selectedRows)}><Trash2 size={15}/></button>
          <button aria-label="Save playlist" title="Save playlist to file" disabled={!playlist.length} onClick={() => void savePlaylist()}><ListMusic size={15}/></button>
          <button className="mp-link" disabled={!playlist.length} onClick={() => { stop(true); setPlaylist([]); }}>Clear</button>
        </footer>
      </aside>}
    </div>
    <div className={`mp-controls ${overlayMode ? 'glass' : ''}`} data-glass-tone={overlayMode ? 'dark' : undefined} onPointerMove={() => { clearTimeout(hideTimer.current); setControlsVisible(true); }}>
      <div className="mp-seek-row">
        <span className="mp-time">{formatTime(shown, total)}</span>
        <SeekBar time={shown} duration={total} buffered={buffered} chapters={chapters} bookmarks={bookmarks} ab={ab} disabled={!active || !!media.current?.capture} onSeek={value => seek(value)}/>
        <button className="mp-time mp-time-total" onClick={() => setRemaining(value => !value)} title="Toggle remaining time">{remaining && total ? `-${formatTime(Math.max(0, total - shown), total)}` : total ? formatTime(total) : '--:--'}</button>
      </div>
      {advanced && <div className="mp-buttons mp-advanced" role="toolbar" aria-label="Advanced controls">
        <button aria-label="Record" aria-pressed={recording} title="Record" onClick={toggleRecord} disabled={!active} className="mp-record"><Circle size={13} fill="currentColor"/></button>
        <button aria-label="Take a snapshot" title="Take a snapshot" onClick={() => void snapshot()} disabled={!hasPicture}><Camera size={16}/></button>
        <button aria-label="Loop from point A to point B" aria-pressed={ab.a !== undefined} title="Loop from point A to point B continuously. Click to set point A" onClick={abLoop} disabled={!active} className="mp-ab"><span>A</span><span>B</span></button>
        <button aria-label="Frame by frame" title="Frame by frame" onClick={nextFrame} disabled={!hasPicture}><StepForward size={16}/></button>
        <span className="mp-sep"/>
        <button aria-label="Slower" title="Slower" onClick={() => setRate(nextRate(rate, -1))} disabled={!active}><Rewind size={15}/></button>
        <button className="mp-rate" title="Click to reset to normal speed" onClick={() => setRate(1)} disabled={!active}>{formatRate(rate)}</button>
        <button aria-label="Faster" title="Faster" onClick={() => setRate(nextRate(rate, 1))} disabled={!active}><FastForward size={15}/></button>
      </div>}
      <div className="mp-buttons" role="toolbar" aria-label="Playback controls">
        <button className="mp-play" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause the playback' : 'Play'} onClick={togglePlay}>{playing ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}</button>
        <span className="mp-group">
          <button aria-label="Previous" title="Previous media in the playlist" onClick={playPrevious} disabled={!playlist.length}><SkipBack size={16} fill="currentColor"/></button>
          <button aria-label="Stop" title="Stop playback" onClick={() => stop()} disabled={!active} className="mp-p4"><Square size={13} fill="currentColor"/></button>
          <button aria-label="Next" title="Next media in the playlist" onClick={playNext} disabled={playlist.length < 2 && loop === 'none'}><SkipForward size={16} fill="currentColor"/></button>
        </span>
        <span className="mp-sep"/>
        <button aria-label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'} title="Toggle the video in fullscreen" onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={16}/> : <Maximize size={16}/>}</button>
        <button aria-label="Extended settings" title="Show extended settings" onClick={() => setDialog('effects')} className="mp-p3"><SlidersHorizontal size={16}/></button>
        <button aria-label="Toggle playlist" aria-pressed={showPlaylist} title="Toggle playlist" onClick={() => setShowPlaylist(value => !value)}><ListVideo size={17}/></button>
        <button aria-label={`Loop: ${loop}`} aria-pressed={loop !== 'none'} title={loop === 'none' ? 'Loop: off' : loop === 'all' ? 'Loop: all' : 'Loop: one'} onClick={cycleLoop} className="mp-p2">{loop === 'one' ? <Repeat1 size={16}/> : <Repeat size={16}/>}</button>
        <button aria-label="Random" aria-pressed={random} title={random ? 'Random: on' : 'Random: off'} onClick={toggleRandom} className="mp-p2"><Shuffle size={16}/></button>
        <span className="mp-spacer"/>
        <span className="mp-chips mp-p1">
          {mode === 'stream' && current && !stopped && <span className="mp-chip" title="Decoded by FFmpeg on this device because the browser cannot play this format directly">FFmpeg{streamStatus.quality ? ` · ${streamStatus.quality}p` : ''}</span>}
          {rate !== 1 && <button className="mp-chip is-accent" title="Playback speed. Click for normal speed" onClick={() => setRate(1)}>{formatRate(rate)}</button>}
          {ab.a !== undefined && <span className="mp-chip is-accent">{ab.b === undefined ? 'A→' : 'A→B'}</span>}
        </span>
        <button className={`mp-tracks-button ${tracksOpen ? 'is-open' : ''}`} aria-label="Tracks and picture" aria-expanded={tracksOpen} title="Audio, subtitles, chapters and picture" onClick={() => setTracksOpen(value => !value)} disabled={!current}><Subtitles size={17}/></button>
        <span className="mp-volume-group">
          <button aria-label={muted ? 'Unmute' : 'Mute'} title="Mute/Unmute" onClick={toggleMute}><VolumeIcon size={17}/></button>
          <input className="mp-volume" type="range" min={0} max={prefs.maxVolume * 100} step={1} value={Math.round((muted ? 0 : volume) * 100)} aria-label="Volume" aria-valuetext={`${Math.round(volume * 100)}%`} onChange={event => setVolume(Number(event.target.value) / 100)} style={{ '--fill': `${(muted ? 0 : volume) / prefs.maxVolume * 100}%`, '--unity': `${100 / prefs.maxVolume}%` } as CSSProperties} data-boost={volume > 1 && !muted}/>
          <span className="mp-volume-label">{Math.round((muted ? 0 : volume) * 100)}%</span>
        </span>
      </div>
      {tracksOpen && <div className="mp-tracks glass" data-glass-tone="dark" role="dialog" aria-label="Tracks and picture" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setTracksOpen(false); } }}>
        <TrackGroup label="Audio Track" value={String(audioIndex ?? '')} options={audios.length ? audios.map((stream, index) => [String(stream.index), `${streamLabel(stream, index)} · ${stream.codec}${stream.channels ? ` ${stream.channels}ch` : ''}`]) : [['', probe ? 'No audio' : 'Track 1']]} onChange={value => value && void selectAudio(Number(value))}/>
        <TrackGroup label="Subtitle Track" value={subtitleId ?? ''} options={[['', 'Disable'], ...subtitles.map(track => [track.id, track.label] as [string, string])]} onChange={value => void selectSubtitle(value || null)} footer={<div className="mp-track-links"><button className="mp-link" onClick={() => void openSubtitleFile()}>Add subtitle file…</button><button className="mp-link" onClick={() => subtitleInput.current?.click()}>From computer…</button></div>}/>
        {chapters.length > 0 && <TrackGroup label="Chapter" value={String(chapters.findIndex(chapter => time >= chapter.start && time < chapter.end))} options={chapters.map((chapter, index) => [String(index), `${chapter.title} · ${formatTime(chapter.start)}`])} onChange={value => seek(chapters[Number(value)].start, chapters[Number(value)].title)}/>}
        <TrackGroup label="Aspect Ratio" value={aspect} options={ASPECT_RATIOS.map(value => [value, value])} onChange={setAspect}/>
        <TrackGroup label="Crop" value={crop} options={CROP_RATIOS.map(value => [value, value])} onChange={setCrop}/>
        <TrackGroup label="Zoom" value={String(zoom)} options={ZOOM_MODES.map(item => [String(item.value), item.label])} onChange={value => setZoom(Number(value))}/>
        <TrackGroup label="Visualization" value={visual} options={[['off', 'Disabled'], ['spectrum', 'Spectrometer'], ['scope', 'Scope'], ['vu', 'VU meter']]} onChange={value => setVisual(value as Visual)}/>
      </div>}
    </div>
    <input ref={fileInput} type="file" multiple hidden accept={ACCEPT} onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void enqueue(localItems(files), true); }}/>
    <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void enqueue(localItems(files).filter(item => isMedia(item.title)), true); }}/>
    <input ref={subtitleInput} type="file" hidden accept={SUBTITLE_EXTENSIONS.map(extension => '.' + extension).join(',')} onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) addSubtitle(file.name, await file.text()); }}/>
    {dialog === 'network' && <NetworkDialog initial={networkInitial} onOpen={openNetwork} onClose={() => setDialog(null)}/>}
    {dialog === 'capture' && <CaptureDialog onClose={() => setDialog(null)} onOpen={(constraints, label) => { setDialog(null); void enqueue([makeItem({ title: label, location: 'capture://', source: 'capture', constraints })]); }}/>}
    {dialog === 'jump' && <JumpDialog current={time} duration={total} onClose={() => setDialog(null)} onJump={value => { setDialog(null); seek(value); }}/>}
    {(dialog === 'effects' || dialog === 'sync') && <EffectsDialog initialTab={dialog === 'sync' ? 'Synchronization' : undefined} onClose={() => setDialog(null)} eq={eq} setEq={setEq} compressor={compressor} setCompressor={setCompressor} adjust={adjust} setAdjust={setAdjust} geometry={geometry} setGeometry={setGeometry} sync={sync} setSync={setSync} audioGraph={audioGraph}/>}
    {(dialog === 'info' || dialog === 'codec') && current && <InfoDialog probe={probe} title={current.title} location={current.source === 'local' ? `${current.title} (this computer)` : current.location} initialTab={dialog === 'codec' ? 'Codec' : 'General'} video={el.current} onClose={() => setDialog(null)}/>}
    {dialog === 'convert' && current && <ConvertDialog sourceName={current.title} hasVideo={!!video || !isAudioName(current.title)} progress={convertProgress} onCancel={cancelConvert} onClose={() => setDialog(null)} onConvert={(profile, destination, name) => void runConvert(profile, destination, name)}/>}
    {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)}/>}
    {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)}/>}
    {(dialog === 'prefs' || dialog === 'prefs-audio') && <PreferencesDialog value={prefs} onChange={setPrefs} initialTab={dialog === 'prefs-audio' ? 'Audio' : 'Interface'} onClose={() => setDialog(null)}/>}
    {dialog === 'bookmarks' && current && <BookmarksDialog bookmarks={bookmarks} current={time} onChange={setBookmarks} onJump={value => seek(value)} onClose={() => setDialog(null)}/>}
  </div>;
}

function TrackGroup({ label, value, options, onChange, footer }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void; footer?: React.ReactNode }) {
  return <section className="mp-track-group" role="radiogroup" aria-label={label}>
    <h4>{label}</h4>
    {options.map(([key, text]) => <button key={key} role="radio" aria-checked={key === value} onClick={() => onChange(key)}><span className="mp-dot"/>{text}</button>)}
    {footer}
  </section>;
}

function SeekBar({ time, duration, buffered, chapters, bookmarks, ab, disabled, onSeek }: { time: number; duration: number; buffered: number; chapters: { start: number; title: string }[]; bookmarks: Bookmark[]; ab: { a?: number; b?: number }; disabled: boolean; onSeek: (time: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (event: ReactPointerEvent) => { const rect = bar.current!.getBoundingClientRect(); const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1); return { x: ratio * rect.width, time: ratio * duration }; };
  const shown = drag ?? time, percent = (value: number) => duration ? `${clamp(value / duration, 0, 1) * 100}%` : '0%';
  const chapter = hover && [...chapters].reverse().find(item => item.start <= hover.time);
  return <div ref={bar} className={`mp-seek ${disabled ? 'is-disabled' : ''}`} role="slider" tabIndex={disabled ? -1 : 0} aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(shown)} aria-valuetext={`${formatTime(shown, duration)} of ${formatTime(duration)}`}
    onPointerDown={event => { if (disabled || !duration) return; event.currentTarget.setPointerCapture(event.pointerId); setDrag(at(event).time); }}
    onPointerMove={event => { if (!duration) return; const point = at(event); setHover(point); if (drag !== null) setDrag(point.time); }}
    onPointerUp={event => { if (drag !== null) { onSeek(at(event).time); setDrag(null); } }}
    onPointerLeave={() => setHover(null)}
    onKeyDown={event => { if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); onSeek(0); } if (event.key === 'End') { event.preventDefault(); event.stopPropagation(); onSeek(duration - 1); } }}>
    <div className="mp-seek-track"><span className="mp-seek-buffer" style={{ width: percent(buffered) }}/><span className="mp-seek-fill" style={{ width: percent(shown) }}/>
      {ab.a !== undefined && <span className="mp-seek-ab" style={{ left: percent(ab.a), width: ab.b !== undefined ? `calc(${percent(ab.b)} - ${percent(ab.a)})` : '2px' }}/>}
      {chapters.map(item => item.start > 0 && <span key={item.start} className="mp-seek-chapter" style={{ left: percent(item.start) }}/>)}
      {bookmarks.map(item => <span key={`${item.name}-${item.time}`} className="mp-seek-bookmark" title={item.name} style={{ left: percent(item.time) }}/>)}
    </div>
    <span className="mp-seek-knob" style={{ left: percent(shown) }}/>
    {hover && !disabled && <span className="mp-seek-tip" style={{ left: hover.x }}>{chapter ? `${chapter.title} · ` : ''}{formatTime(hover.time, duration)}</span>}
  </div>;
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ([string, () => void, boolean?, string?] | null)[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useEffect(() => {
    const menu = ref.current; if (!menu) return;
    const parent = menu.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const rect = menu.getBoundingClientRect();
    setPosition({ left: clamp(x - parent.left, 4, parent.width - rect.width - 4), top: clamp(y - parent.top, 4, parent.height - rect.height - 4) });
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  return <div ref={ref} className="mp-context glass" data-glass-tone="dark" role="menu" style={position} onKeyDown={event => {
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === ' ') event.stopPropagation();
  }}>
    {items.map((item, index) => item ? <button key={item[0]} role="menuitem" disabled={item[2]} onClick={() => { onClose(); item[1](); }}><span>{item[0]}</span>{item[3] && <kbd>{item[3]}</kbd>}</button> : <div key={index} className="mp-context-sep" role="separator"/>)}
  </div>;
}

function PlayerMark() {
  return <svg className="mp-mark" width="120" height="120" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="mp-mark-fill" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse"><stop stopColor="#f6a54b"/><stop offset="1" stopColor="#e2582b"/></linearGradient></defs>
    <circle cx="32" cy="32" r="26" fill="url(#mp-mark-fill)" opacity=".95"/>
    <path d="M26 21.5v21l17-10.5-17-10.5Z" fill="#fff"/>
    <path d="M12 46c6 5 13 8 20 8s14-3 20-8" stroke="#fff" strokeOpacity=".5" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
  </svg>;
}
