import { useEffect, useState, type ReactNode } from 'react';
import { Button, Dialog, Input, Select, Tabs } from '../../../../../packages/ui/src';
import { formatBytes } from '../hooks';
import { EQ_BAND_LABELS, EQ_PRESETS, formatTime, parseTime } from './formats';
import { PROFILES, type ProbeResult, type ProfileId } from './engine';
import type { Compressor } from './audio';
import { DEFAULT_PREFERENCES, SUBTITLE_SIZES, addBookmark, type Bookmark, type Preferences } from './preferences';

export interface Equalizer { enabled: boolean; preset: string; preamp: number; bands: number[]; twoPass: boolean }
export interface Adjust { enabled: boolean; brightness: number; contrast: number; hue: number; saturation: number; gamma: number }
export interface Geometry { rotation: number; flipH: boolean; flipV: boolean }
export interface Sync { audio: number; subtitle: number; subtitleSpeed: number }
export const DEFAULT_EQ: Equalizer = { enabled: false, preset: 'flat', preamp: 12, bands: EQ_PRESETS.flat.bands, twoPass: false };
export const DEFAULT_ADJUST: Adjust = { enabled: false, brightness: 1, contrast: 1, hue: 0, saturation: 1, gamma: 1 };

function Slider({ label, value, min, max, step, onChange, format = (v: number) => v.toFixed(2), vertical }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; format?: (value: number) => string; vertical?: boolean }) {
  return <label className={`mp-slider ${vertical ? 'is-vertical' : ''}`}>
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={event => onChange(Number(event.target.value))} onDoubleClick={() => onChange(vertical ? 0 : (min + max) / 2)}/>
    <output>{format(value)}</output>
  </label>;
}
const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) => <label className="mp-check"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/>{label}</label>;

export function EffectsDialog(props: {
  initialTab?: string; onClose: () => void;
  eq: Equalizer; setEq: (value: Equalizer) => void;
  compressor: Compressor; setCompressor: (value: Compressor) => void;
  adjust: Adjust; setAdjust: (value: Adjust) => void;
  geometry: Geometry; setGeometry: (value: Geometry) => void;
  sync: Sync; setSync: (value: Sync) => void; audioGraph: boolean;
}) {
  const [tab, setTab] = useState(props.initialTab ?? 'Audio Effects');
  const [audioTab, setAudioTab] = useState('Equalizer');
  const [videoTab, setVideoTab] = useState('Essential');
  const { eq, setEq, compressor: c, setCompressor, adjust: a, setAdjust, geometry: g, setGeometry, sync, setSync } = props;
  return <Dialog title="Adjustments and Effects" onClose={props.onClose}>
    <div className="mp-dialog mp-effects">
      <Tabs tabs={['Audio Effects', 'Video Effects', 'Synchronization']} value={tab} onChange={setTab}/>
      {tab === 'Audio Effects' && <>
        {!props.audioGraph && <p className="mp-note">Audio effects are unavailable for this stream because its server does not allow audio processing.</p>}
        <Tabs tabs={['Equalizer', 'Compressor']} value={audioTab} onChange={setAudioTab}/>
        {audioTab === 'Equalizer' && <fieldset disabled={!props.audioGraph}>
          <div className="mp-line">
            <Check label="Enable" checked={eq.enabled} onChange={enabled => setEq({ ...eq, enabled })}/>
            <Check label="2 Pass" checked={eq.twoPass} onChange={twoPass => setEq({ ...eq, twoPass })}/>
            <Select aria-label="Preset" value={eq.preset} disabled={!eq.enabled} onChange={event => { const preset = EQ_PRESETS[event.target.value]; if (preset) setEq({ ...eq, preset: event.target.value, preamp: preset.preamp, bands: [...preset.bands] }); }}>
              {eq.preset === 'custom' && <option value="custom">Custom</option>}
              {Object.entries(EQ_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.name}</option>)}
            </Select>
          </div>
          <div className="mp-eq" aria-disabled={!eq.enabled}>
            <Slider vertical label="Preamp" value={eq.preamp} min={-20} max={20} step={0.1} format={v => `${v.toFixed(1)} dB`} onChange={preamp => setEq({ ...eq, preamp, preset: 'custom' })}/>
            {EQ_BAND_LABELS.map((label, index) => <Slider vertical key={label} label={label} value={eq.bands[index]} min={-20} max={20} step={0.1} format={v => `${v.toFixed(1)} dB`} onChange={value => { const bands = [...eq.bands]; bands[index] = value; setEq({ ...eq, bands, preset: 'custom' }); }}/>)}
          </div>
        </fieldset>}
        {audioTab === 'Compressor' && <fieldset disabled={!props.audioGraph}>
          <Check label="Enable" checked={c.enabled} onChange={enabled => setCompressor({ ...c, enabled })}/>
          <div className="mp-grid">
            <Slider label="Attack" value={c.attack} min={1} max={200} step={1} format={v => `${v} ms`} onChange={attack => setCompressor({ ...c, attack })}/>
            <Slider label="Release" value={c.release} min={2} max={800} step={1} format={v => `${v} ms`} onChange={release => setCompressor({ ...c, release })}/>
            <Slider label="Threshold" value={c.threshold} min={-30} max={0} step={0.5} format={v => `${v} dB`} onChange={threshold => setCompressor({ ...c, threshold })}/>
            <Slider label="Ratio" value={c.ratio} min={1} max={20} step={0.5} format={v => `${v}:1`} onChange={ratio => setCompressor({ ...c, ratio })}/>
            <Slider label="Knee radius" value={c.knee} min={1} max={10} step={0.5} format={v => `${v} dB`} onChange={knee => setCompressor({ ...c, knee })}/>
            <Slider label="Makeup gain" value={c.makeup} min={0} max={24} step={0.5} format={v => `${v} dB`} onChange={makeup => setCompressor({ ...c, makeup })}/>
          </div>
        </fieldset>}
      </>}
      {tab === 'Video Effects' && <>
        <Tabs tabs={['Essential', 'Geometry']} value={videoTab} onChange={setVideoTab}/>
        {videoTab === 'Essential' && <fieldset>
          <Check label="Image adjust" checked={a.enabled} onChange={enabled => setAdjust({ ...a, enabled })}/>
          <div className="mp-grid" aria-disabled={!a.enabled}>
            <Slider label="Hue" value={a.hue} min={-180} max={180} step={1} format={v => `${v}°`} onChange={hue => setAdjust({ ...a, enabled: true, hue })}/>
            <Slider label="Brightness" value={a.brightness} min={0} max={2} step={0.01} onChange={brightness => setAdjust({ ...a, enabled: true, brightness })}/>
            <Slider label="Contrast" value={a.contrast} min={0} max={2} step={0.01} onChange={contrast => setAdjust({ ...a, enabled: true, contrast })}/>
            <Slider label="Saturation" value={a.saturation} min={0} max={3} step={0.01} onChange={saturation => setAdjust({ ...a, enabled: true, saturation })}/>
            <Slider label="Gamma" value={a.gamma} min={0.01} max={3} step={0.01} onChange={gamma => setAdjust({ ...a, enabled: true, gamma })}/>
          </div>
          <Button onClick={() => setAdjust({ ...DEFAULT_ADJUST })}>Reset</Button>
        </fieldset>}
        {videoTab === 'Geometry' && <fieldset>
          <div className="mp-line"><span>Transform</span>
            <Select aria-label="Transform" value={String(g.rotation)} onChange={event => setGeometry({ ...g, rotation: Number(event.target.value) })}>
              <option value="0">None</option><option value="90">Rotate by 90 degrees</option><option value="180">Rotate by 180 degrees</option><option value="270">Rotate by 270 degrees</option>
            </Select>
          </div>
          <Check label="Flip horizontally" checked={g.flipH} onChange={flipH => setGeometry({ ...g, flipH })}/>
          <Check label="Flip vertically" checked={g.flipV} onChange={flipV => setGeometry({ ...g, flipV })}/>
        </fieldset>}
      </>}
      {tab === 'Synchronization' && <fieldset>
        <h3>Audio/Video</h3>
        <Slider label="Audio track synchronization" value={sync.audio} min={0} max={5} step={0.05} format={v => `${v.toFixed(3)} s`} onChange={audio => setSync({ ...sync, audio })}/>
        <p className="mp-note">A positive value means the audio is played after the picture. Web audio cannot play sound ahead of the picture.</p>
        <h3>Subtitles/Video</h3>
        <Slider label="Subtitle track synchronization" value={sync.subtitle} min={-30} max={30} step={0.05} format={v => `${v.toFixed(3)} s`} onChange={subtitle => setSync({ ...sync, subtitle })}/>
        <Slider label="Subtitle speed" value={sync.subtitleSpeed} min={0.5} max={2} step={0.001} format={v => `${v.toFixed(3)} fps`} onChange={subtitleSpeed => setSync({ ...sync, subtitleSpeed })}/>
        <Button onClick={() => setSync({ audio: 0, subtitle: 0, subtitleSpeed: 1 })}>Reset</Button>
      </fieldset>}
      <footer><Button variant="primary" onClick={props.onClose}>Close</Button></footer>
    </div>
  </Dialog>;
}

const META_LABELS: [string, string][] = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['album_artist', 'Album artist'], ['genre', 'Genre'], ['track', 'Track number'], ['date', 'Date'], ['composer', 'Composer'], ['copyright', 'Copyright'], ['publisher', 'Publisher'], ['encoded_by', 'Encoded by'], ['encoder', 'Encoder'], ['language', 'Language'], ['description', 'Description'], ['comment', 'Comments']];
export function InfoDialog({ probe, title, location, initialTab = 'General', video, onClose }: { probe: ProbeResult | null; title: string; location: string; initialTab?: string; video: HTMLVideoElement | null; onClose: () => void }) {
  const [tab, setTab] = useState(initialTab);
  const [, tick] = useState(0);
  useEffect(() => { if (tab !== 'Statistics') return; const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer); }, [tab]);
  const tags = probe?.tags ?? {};
  const quality = video?.getVideoPlaybackQuality?.();
  const rows = (items: [string, ReactNode][]) => <dl className="mp-info">{items.filter(([, value]) => value !== undefined && value !== '').map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
  return <Dialog title="Current Media Information" onClose={onClose}>
    <div className="mp-dialog mp-info-dialog">
      <Tabs tabs={['General', 'Metadata', 'Codec', 'Statistics']} value={tab} onChange={setTab}/>
      {tab === 'General' && rows([['Title', tags.title || title], ...META_LABELS.slice(1, 7).map(([key, label]) => [label, tags[key]] as [string, ReactNode]), ['Location', location]])}
      {tab === 'Metadata' && (probe ? rows([...META_LABELS.map(([key, label]) => [label, tags[key]] as [string, ReactNode]), ...Object.entries(tags).filter(([key]) => !META_LABELS.some(([known]) => known === key)).map(([key, value]) => [key, value] as [string, ReactNode])]) : <p className="mp-note">Reading metadata…</p>)}
      {tab === 'Codec' && (probe ? <div className="mp-streams">
        {rows([['Container', `${probe.formatLong || probe.format}`], ['Duration', formatTime(probe.duration)], ['Bitrate', probe.bitrate ? `${Math.round(probe.bitrate / 1000)} kb/s` : ''], ['Size', formatBytes(probe.size)]])}
        {probe.streams.map(stream => <section key={stream.index}><h3>Stream {stream.index}</h3>{rows([
          ['Type', stream.attachedPic ? 'Cover art' : stream.kind[0].toUpperCase() + stream.kind.slice(1)], ['Codec', `${stream.codecLong} (${stream.codec})`], ['Profile', stream.profile], ['Language', stream.language], ['Description', stream.title],
          ['Video resolution', stream.width ? `${stream.width}x${stream.height}` : ''], ['Display aspect ratio', stream.aspect], ['Frame rate', stream.fps && !stream.attachedPic ? stream.fps.toFixed(3) : ''], ['Decoded format', stream.pixFmt], ['Field order', stream.fieldOrder],
          ['Channels', stream.channels ? `${stream.channels}${stream.layout ? ` (${stream.layout})` : ''}` : ''], ['Sample rate', stream.sampleRate ? `${stream.sampleRate} Hz` : ''], ['Sample format', stream.sampleFormat], ['Bitrate', stream.bitrate ? `${Math.round(stream.bitrate / 1000)} kb/s` : ''],
        ])}</section>)}
      </div> : <p className="mp-note">Reading codec details…</p>)}
      {tab === 'Statistics' && rows([
        ['Playback position', video ? `${formatTime(video.currentTime)} / ${formatTime(video.duration)}` : ''],
        ['Input bitrate', probe?.bitrate ? `${Math.round(probe.bitrate / 1000)} kb/s` : ''],
        ['Displayed frames', quality ? String(quality.totalVideoFrames - quality.droppedVideoFrames) : ''],
        ['Lost frames', quality ? String(quality.droppedVideoFrames) : ''],
        ['Picture size', video?.videoWidth ? `${video.videoWidth}x${video.videoHeight}` : ''],
        ['Buffered ahead', video && video.buffered.length ? `${Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime).toFixed(1)} s` : ''],
      ])}
      <footer><Button variant="primary" onClick={onClose}>Close</Button></footer>
    </div>
  </Dialog>;
}

export function ConvertDialog({ sourceName, onConvert, onClose, progress, onCancel, hasVideo }: { sourceName: string; hasVideo: boolean; onConvert: (profile: ProfileId, destination: 'workspace' | 'download', name: string) => void; progress: number | null; onCancel: () => void; onClose: () => void }) {
  const [profile, setProfile] = useState<ProfileId>(hasVideo ? 'h264-mp3-mp4' : 'mp3');
  const extension = PROFILES.find(item => item.id === profile)!.extension;
  const [name, setName] = useState('');
  const base = sourceName.replace(/\.[^.]+$/, '');
  const target = (name || `${base} (converted)`).replace(/\.[^.]+$/, '') + '.' + extension;
  return <Dialog title="Convert" onClose={progress === null ? onClose : onCancel} dismissible={progress === null}>
    <div className="mp-dialog">
      <p className="mp-note">Source: <strong>{sourceName}</strong></p>
      <label className="mp-field"><span>Profile</span><Select value={profile} onChange={event => setProfile(event.target.value as ProfileId)} disabled={progress !== null}>{PROFILES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>
      <label className="mp-field"><span>Destination file</span><Input value={name || `${base} (converted)`} onChange={event => setName(event.target.value)} disabled={progress !== null}/></label>
      <p className="mp-note">Saves as <strong>{target}</strong>. Conversion runs on this device; long videos can take a while.</p>
      {progress !== null && <div className="mp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }}/></div>}
      <footer>
        {progress === null ? <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => onConvert(profile, 'download', target)}>Download</Button>
          <Button variant="primary" onClick={() => onConvert(profile, 'workspace', target)}>Start</Button>
        </> : <Button onClick={onCancel}>Stop</Button>}
      </footer>
    </div>
  </Dialog>;
}

export function NetworkDialog({ initial = '', onOpen, onClose }: { initial?: string; onOpen: (url: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState(initial);
  const valid = /^https?:\/\/\S+$/i.test(url.trim());
  return <Dialog title="Open Media" onClose={onClose}>
    <form className="mp-dialog" onSubmit={event => { event.preventDefault(); if (valid) onOpen(url.trim()); }}>
      <label className="mp-field"><span>Please enter a network URL:</span><Input autoFocus value={url} onChange={event => setUrl(event.target.value)} placeholder="https://www.example.com/stream.mp4"/></label>
      <p className="mp-note">http://www.example.com/stream.avi<br/>https://www.example.com/live/playlist.m3u8<br/>https://www.example.com/radio.mp3</p>
      <footer><Button type="button" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" disabled={!valid}>Play</Button></footer>
    </form>
  </Dialog>;
}

export function CaptureDialog({ onOpen, onClose }: { onOpen: (constraints: MediaStreamConstraints, label: string) => void; onClose: () => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [video, setVideo] = useState('default'), [audio, setAudio] = useState('none');
  useEffect(() => { navigator.mediaDevices?.enumerateDevices().then(setDevices, () => {}); }, []);
  const cams = devices.filter(device => device.kind === 'videoinput'), mics = devices.filter(device => device.kind === 'audioinput');
  return <Dialog title="Open Capture Device" onClose={onClose}>
    <div className="mp-dialog">
      <label className="mp-field"><span>Video device name</span><Select value={video} onChange={event => setVideo(event.target.value)}><option value="none">None</option><option value="default">Default camera</option>{cams.filter(cam => cam.deviceId && cam.label).map(cam => <option key={cam.deviceId} value={cam.deviceId}>{cam.label}</option>)}</Select></label>
      <label className="mp-field"><span>Audio device name</span><Select value={audio} onChange={event => setAudio(event.target.value)}><option value="none">None</option><option value="default">Default microphone</option>{mics.filter(mic => mic.deviceId && mic.label).map(mic => <option key={mic.deviceId} value={mic.deviceId}>{mic.label}</option>)}</Select></label>
      <p className="mp-note">Playing a microphone through speakers can cause feedback. Use headphones.</p>
      <footer><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={video === 'none' && audio === 'none'} onClick={() => onOpen({ video: video === 'none' ? false : video === 'default' ? true : { deviceId: { exact: video } }, audio: audio === 'none' ? false : audio === 'default' ? true : { deviceId: { exact: audio } } }, video !== 'none' ? 'Capture device' : 'Audio capture')}>Play</Button></footer>
    </div>
  </Dialog>;
}

export function JumpDialog({ current, duration, onJump, onClose }: { current: number; duration: number; onJump: (time: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(formatTime(current, Math.max(duration, 3600)));
  const time = parseTime(value);
  const valid = time !== null && (!duration || time <= duration);
  return <Dialog title="Go to Time" onClose={onClose}>
    <form className="mp-dialog" onSubmit={event => { event.preventDefault(); if (valid) onJump(time!); }}>
      <label className="mp-field"><span>Go to time (H:MM:SS)</span><Input autoFocus value={value} onChange={event => setValue(event.target.value)} onFocus={event => event.target.select()} aria-invalid={!valid}/></label>
      <footer><Button type="button" onClick={() => setValue(formatTime(0, 3600))}>Reset</Button><Button variant="primary" type="submit" disabled={!valid}>OK</Button></footer>
    </form>
  </Dialog>;
}

export const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / Pause'], ['S', 'Stop'], ['N / P', 'Next / Previous'], ['F, double-click', 'Full screen'], ['Esc', 'Leave full screen'],
  ['← / →', 'Short jump (10 s)'], ['Shift + ← / →', 'Very short jump (3 s)'], ['Alt + ← / →', 'Short jump (10 s)'], ['Ctrl + ← / →', 'Medium jump (1 min)'], ['Ctrl + Alt + ← / →', 'Long jump (5 min)'],
  ['[ / ]', 'Slower / Faster'], ['- / +', 'Slower / Faster (fine)'], ['=', 'Normal speed'], ['E', 'Next frame'], ['Ctrl + T', 'Go to time'],
  ['Ctrl + ↑ / ↓, mouse wheel', 'Volume up / down'], ['M', 'Mute'], ['B', 'Cycle audio track'], ['V', 'Cycle subtitle track'],
  ['A', 'Cycle aspect ratio'], ['C', 'Cycle crop'], ['Z', 'Cycle zoom'], ['D', 'Deinterlace'], ['Shift + S', 'Take snapshot'], ['T', 'Show time'],
  ['G / H', 'Subtitle delay −/+ 50 ms'], ['J / K', 'Audio delay −/+ 50 ms'], ['L', 'Loop: off / all / one'], ['R', 'Random'], ['Shift + L', 'A→B loop'],
  ['Shift + N / Shift + P', 'Next / previous chapter'], ['Ctrl + B', 'Custom bookmarks'], ['Ctrl + P', 'Preferences'], ['Ctrl + L', 'Playlist'], ['Ctrl + H', 'Minimal interface'], ['Ctrl + E', 'Effects and filters'], ['Ctrl + I', 'Media information'],
];
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return <Dialog title="Hotkeys" onClose={onClose}><div className="mp-dialog"><dl className="mp-info mp-keys">{SHORTCUTS.map(([keys, label]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{label}</dd></div>)}</dl><footer><Button variant="primary" onClick={onClose}>Close</Button></footer></div></Dialog>;
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return <Dialog title="About Media Player" onClose={onClose}>
    <div className="mp-dialog mp-about">
      <p>Media Player plays video, audio, playlists, network streams and capture devices, with the controls, hotkeys and filters of the VLC media player.</p>
      <p>Formats your browser cannot decode are handled by FFmpeg (libavformat and libavcodec, the libraries VLC itself uses for most decoding), compiled to WebAssembly through ffmpeg.wasm and running entirely on this device.</p>
      <p className="mp-note">FFmpeg and ffmpeg.wasm are free software licensed under the GNU General Public License, version 2 or later, and include x264, x265, libvpx, LAME, Opus, Vorbis, Theora and libass. Source code: ffmpeg.org and github.com/ffmpegwasm/ffmpeg.wasm. VLC is a trademark of VideoLAN; this player is not affiliated with VideoLAN.</p>
      <footer><Button variant="primary" onClick={onClose}>Close</Button></footer>
    </div>
  </Dialog>;
}

export function PreferencesDialog({ value, onChange, initialTab = 'Interface', onClose }: { value: Preferences; onChange: (value: Preferences) => void; initialTab?: string; onClose: () => void }) {
  const [tab, setTab] = useState(initialTab);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const outputSelectable = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype || typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  useEffect(() => { if (tab === 'Audio') navigator.mediaDevices?.enumerateDevices().then(list => setDevices(list.filter(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default')), () => {}); }, [tab]);
  const set = <K extends keyof Preferences>(key: K, next: Preferences[K]) => onChange({ ...value, [key]: next });
  const jumps: [keyof Preferences['jumps'], string, string][] = [['veryShort', 'Very short jump', 'Shift + arrow'], ['short', 'Short jump', 'Arrow or Alt + arrow'], ['medium', 'Medium jump', 'Ctrl + arrow'], ['long', 'Long jump', 'Ctrl + Alt + arrow']];
  return <Dialog title="Simple Preferences" onClose={onClose}>
    <div className="mp-dialog mp-prefs">
      <Tabs tabs={['Interface', 'Audio', 'Subtitles', 'Hotkeys']} value={tab} onChange={setTab}/>
      {tab === 'Interface' && <fieldset>
        <label className="mp-field"><span>Continue playback</span><Select value={value.resume} onChange={event => set('resume', event.target.value as Preferences['resume'])}><option value="ask">Ask</option><option value="always">Always</option><option value="never">Never</option></Select></label>
        <Check label="Show media change and action messages on the video (OSD)" checked={value.osd} onChange={osd => set('osd', osd)}/>
      </fieldset>}
      {tab === 'Audio' && <fieldset>
        <label className="mp-field"><span>Maximum volume</span><Select value={String(value.maxVolume)} onChange={event => set('maxVolume', Number(event.target.value) === 2 ? 2 : 1.25)}><option value="1.25">125%</option><option value="2">200%</option></Select></label>
        <label className="mp-field"><span>Output device</span>
          <Select value={value.outputDevice} disabled={!outputSelectable} onChange={event => set('outputDevice', event.target.value)}>
            <option value="">System default</option>
            {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Output ${index + 1}`}</option>)}
          </Select>
        </label>
        {!outputSelectable && <p className="mp-note">This browser always plays through the system's default output.</p>}
        {outputSelectable && devices.length > 0 && devices.every(device => !device.label) && <p className="mp-note">Device names appear after a site has been allowed to use a microphone or camera.</p>}
      </fieldset>}
      {tab === 'Subtitles' && <fieldset>
        <Check label="Autodetect subtitle files next to the media" checked={value.autoSubtitles} onChange={autoSubtitles => set('autoSubtitles', autoSubtitles)}/>
        <label className="mp-field"><span>Font size</span><Select value={String(value.subtitleScale)} onChange={event => set('subtitleScale', Number(event.target.value))}>{SUBTITLE_SIZES.map(([scale, label]) => <option key={scale} value={scale}>{label}</option>)}</Select></label>
        <label className="mp-line"><span>Text color</span><input type="color" value={value.subtitleColor} aria-label="Subtitle text color" onChange={event => set('subtitleColor', event.target.value)}/></label>
        <Check label="Background box behind subtitles" checked={value.subtitleBackground} onChange={subtitleBackground => set('subtitleBackground', subtitleBackground)}/>
        <div className="mp-sub-preview" style={{ '--mp-sub-scale': value.subtitleScale, '--mp-sub-color': value.subtitleColor } as React.CSSProperties} data-background={value.subtitleBackground}><span>Subtitle preview</span></div>
      </fieldset>}
      {tab === 'Hotkeys' && <fieldset>
        {jumps.map(([key, label, keys]) => <label className="mp-field" key={key}><span>{label} <small>({keys})</small></span><Input type="number" min={1} max={3600} value={value.jumps[key]} onChange={event => { const seconds = Math.round(Number(event.target.value)); if (seconds >= 1 && seconds <= 3600) set('jumps', { ...value.jumps, [key]: seconds }); }}/></label>)}
        <p className="mp-note">Lengths in seconds. Help → Hotkeys lists every shortcut.</p>
      </fieldset>}
      <footer><Button onClick={() => onChange({ ...DEFAULT_PREFERENCES })}>Reset Preferences</Button><Button variant="primary" onClick={onClose}>Save</Button></footer>
    </div>
  </Dialog>;
}

export function BookmarksDialog({ bookmarks, onChange, onJump, current, onClose }: { bookmarks: Bookmark[]; onChange: (value: Bookmark[]) => void; onJump: (time: number) => void; current: number; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  return <Dialog title="Edit Bookmarks" onClose={onClose}>
    <div className="mp-dialog">
      <div className="mp-bookmarks" role="listbox" aria-label="Bookmarks">
        {bookmarks.length ? bookmarks.map((bookmark, index) => <div key={`${bookmark.name}-${bookmark.time}`} role="option" aria-selected={selected === index} className="mp-bookmark" onClick={() => setSelected(index)} onDoubleClick={() => onJump(bookmark.time)}>
          {editing === index ? <Input autoFocus defaultValue={bookmark.name} aria-label="Bookmark name" onBlur={event => { onChange(bookmarks.map((item, i) => i === index ? { ...item, name: event.target.value.trim() || item.name } : item)); setEditing(null); }} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') { event.stopPropagation(); setEditing(null); } }}/> : <span className="mp-bookmark-name">{bookmark.name}</span>}
          <span className="mp-bookmark-time">{formatTime(bookmark.time)}</span>
        </div>) : <p className="mp-note">No bookmarks yet. Create one to mark the current position.</p>}
      </div>
      <footer>
        <Button onClick={() => onChange(addBookmark(bookmarks, current))}>Create</Button>
        <Button disabled={selected === null} onClick={() => setEditing(selected)}>Rename</Button>
        <Button disabled={selected === null} onClick={() => { onChange(bookmarks.filter((_, index) => index !== selected)); setSelected(null); }}>Delete</Button>
        <Button disabled={!bookmarks.length} onClick={() => { onChange([]); setSelected(null); }}>Clear</Button>
        <Button variant="primary" disabled={selected === null} onClick={() => selected !== null && onJump(bookmarks[selected].time)}>Go</Button>
      </footer>
    </div>
  </Dialog>;
}
