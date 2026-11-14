// Formats, subtitles, playlists and VLC-compatible playback constants.
// Pure functions only, so they can be unit tested without a browser.

/** VLC's video extension list (modules/gui/qt/dialogs_provider, EXTENSIONS_VIDEO) plus raw bitstreams. */
export const VIDEO_EXTENSIONS = ['3g2', '3gp', '3gp2', '3gpp', 'amv', 'asf', 'avi', 'bik', 'bin', 'crf', 'dav', 'divx', 'drc', 'dv', 'dvr-ms', 'evo', 'f4v', 'flv', 'gvi', 'gxf', 'h264', 'h265', '264', '265', 'hevc', 'ivf', 'm1v', 'm2t', 'm2ts', 'm2v', 'm4v', 'mkv', 'mov', 'mp2v', 'mp4', 'mp4v', 'mpe', 'mpeg', 'mpeg1', 'mpeg2', 'mpeg4', 'mpg', 'mpv2', 'mts', 'mtv', 'mxf', 'mxg', 'nsv', 'nuv', 'obu', 'ogm', 'ogv', 'ogx', 'ps', 'qt', 'rec', 'rm', 'rmvb', 'rpl', 'thp', 'tod', 'ts', 'tts', 'txd', 'vob', 'vro', 'webm', 'wm', 'wmv', 'wtv', 'xesc', 'y4m'];
/** VLC's audio extension list (EXTENSIONS_AUDIO). */
export const AUDIO_EXTENSIONS = ['3ga', '669', 'a52', 'aac', 'ac3', 'adt', 'adts', 'aif', 'aifc', 'aiff', 'amb', 'amr', 'aob', 'ape', 'au', 'awb', 'caf', 'dff', 'dsf', 'dts', 'eac3', 'flac', 'gsm', 'it', 'm4a', 'm4b', 'm4p', 'mid', 'midi', 'mka', 'mlp', 'mod', 'mp1', 'mp2', 'mp3', 'mpa', 'mpc', 'mpga', 'oga', 'ogg', 'oma', 'opus', 'qcp', 'ra', 'rmi', 's3m', 'sid', 'spx', 'tak', 'thd', 'tta', 'voc', 'vqf', 'w64', 'wav', 'weba', 'wma', 'wv', 'xa', 'xm'];
export const PLAYLIST_EXTENSIONS = ['m3u', 'm3u8', 'pls', 'xspf', 'asx', 'wpl', 'cue'];
export const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'webvtt', 'ass', 'ssa', 'sub', 'sbv', 'txt'];
export const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];

export const extensionOf = (name: string) => { const clean = name.split(/[?#]/)[0]; const dot = clean.lastIndexOf('.'); return dot < 0 || dot < clean.lastIndexOf('/') ? '' : clean.slice(dot + 1).toLowerCase(); };
export const isMedia = (name: string) => MEDIA_EXTENSIONS.includes(extensionOf(name));
export const isAudioName = (name: string) => AUDIO_EXTENSIONS.includes(extensionOf(name));
export const isPlaylist = (name: string) => PLAYLIST_EXTENSIONS.includes(extensionOf(name)) && !/^https?:/i.test(name);
export const isSubtitle = (name: string) => SUBTITLE_EXTENSIONS.includes(extensionOf(name)) && extensionOf(name) !== 'txt';
export const displayName = (location: string) => { try { const decoded = decodeURIComponent(location.split(/[?#]/)[0]); return decoded.split(/[\\/]/).filter(Boolean).pop() || location; } catch { return location.split('/').pop() || location; } };
export const titleFromName = (name: string) => displayName(name).replace(/\.[^.]+$/, '');

/** VLC's time display: mm:ss under an hour, h:mm:ss above. */
export function formatTime(seconds: number, reference = seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds), h = Math.floor(whole / 3600), m = Math.floor(whole / 60) % 60, s = whole % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return h > 0 || reference >= 3600 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
/** Accepts "90", "1:30", "01:02:03" and "1h2m3s". */
export function parseTime(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  const units = value.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/i);
  if (units && (units[1] || units[2] || units[3])) return (+(units[1] || 0)) * 3600 + (+(units[2] || 0)) * 60 + (+(units[3] || 0));
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(value)) return null;
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

/** VLC's discrete playback rates used by the Faster and Slower actions. */
export const RATES = [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3, 4, 8, 16];
export const MIN_RATE = 1 / 16, MAX_RATE = 16;
export function nextRate(rate: number, direction: 1 | -1) {
  if (direction > 0) return RATES.find(value => value > rate + 1e-6) ?? MAX_RATE;
  return [...RATES].reverse().find(value => value < rate - 1e-6) ?? MIN_RATE;
}
export const fineRate = (rate: number, direction: 1 | -1) => Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round((rate + direction * 0.1) * 100) / 100));
export const formatRate = (rate: number) => `${rate.toFixed(2)}x`;

/** VLC's volume step (12.8/256 of full scale). Jump lengths and the volume ceiling are preferences. */
export const VOLUME_STEP = 0.05;

export const ASPECT_RATIOS = ['Default', '16:9', '4:3', '1:1', '16:10', '2.21:1', '2.35:1', '2.39:1', '5:4'] as const;
export const CROP_RATIOS = ['Default', '16:10', '16:9', '4:3', '1.85:1', '2.21:1', '2.35:1', '2.39:1', '5:3', '5:4', '1:1'] as const;
export const ZOOM_MODES = [{ label: 'Fit window', value: 0 }, { label: '1:4 Quarter', value: 0.25 }, { label: '1:2 Half', value: 0.5 }, { label: '1:1 Original', value: 1 }, { label: '2:1 Double', value: 2 }] as const;
export const ratioValue = (ratio: string) => { if (ratio === 'Default') return null; const [w, h] = ratio.split(':').map(Number); return w > 0 && h > 0 ? w / h : null; };

/** Lay a video out the way VLC's vout does: aspect override, then crop, then fit or fixed zoom. */
export function videoLayout(box: { width: number; height: number }, source: { width: number; height: number }, options: { aspect: string; crop: string; zoom: number; rotation: number }) {
  if (!source.width || !source.height || !box.width || !box.height) return null;
  const quarter = options.rotation % 180 !== 0;
  const displayAspect = ratioValue(options.aspect) ?? source.width / source.height;
  const cropAspect = ratioValue(options.crop);
  // Visible (cropped) fraction of the frame in each axis.
  let cropX = 1, cropY = 1;
  if (cropAspect) { if (cropAspect < displayAspect) cropX = cropAspect / displayAspect; else cropY = displayAspect / cropAspect; }
  const visibleAspect = displayAspect * cropX / cropY;
  const boxW = quarter ? box.height : box.width, boxH = quarter ? box.width : box.height;
  let visibleW: number, visibleH: number;
  if (options.zoom > 0) { visibleH = source.height * cropY * options.zoom; visibleW = visibleH * visibleAspect; }
  else if (boxW / boxH > visibleAspect) { visibleH = boxH; visibleW = boxH * visibleAspect; }
  else { visibleW = boxW; visibleH = boxW / visibleAspect; }
  return { width: visibleW / cropX, height: visibleH / cropY, visibleWidth: visibleW, visibleHeight: visibleH };
}

// ---------- Subtitles ----------
export interface Cue { start: number; end: number; text: string }

const timestamp = (value: string) => {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match) return NaN;
  return (+(match[1] || 0)) * 3600 + +match[2] * 60 + +match[3] + (match[4] ? +match[4].padEnd(3, '0') / 1000 : 0);
};
/** Keep <b>, <i>, <u> and line breaks; drop every other tag. */
export function sanitizeCueText(text: string) {
  return text.replace(/&(?!(?:amp|lt|gt|quot|#\d+);)/g, '&amp;').replace(/<(\/?)([biu])(?:\s[^>]*)?>/gi, '\u0001$1$2\u0002').replace(/<\/?[a-z][^>]*>/gi, '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u0001/g, '<').replace(/\u0002/g, '>').replace(/\r?\n/g, '<br>');
}

function parseSrtLike(text: string) {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((line, index) => index > 0 || line.trim());
    const timing = lines.findIndex(line => line.includes('-->'));
    if (timing < 0) continue;
    const [from, to] = lines[timing].split('-->');
    const start = timestamp(from), end = timestamp(to.trim().split(/\s+/)[0]);
    const body = lines.slice(timing + 1).join('\n').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && body) cues.push({ start, end, text: sanitizeCueText(body) });
  }
  return cues;
}
function parseAss(text: string) {
  const cues: Cue[] = [];
  let format: string[] = [];
  let inEvents = false;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) { inEvents = /^\[events\]$/i.test(line); continue; }
    if (!inEvents) continue;
    if (/^format:/i.test(line)) { format = line.slice(7).split(',').map(part => part.trim().toLowerCase()); continue; }
    if (!/^dialogue:/i.test(line) || !format.length) continue;
    const fields = line.slice(9).trim().split(',');
    const value = (name: string) => fields[format.indexOf(name)] ?? '';
    const body = fields.slice(format.indexOf('text')).join(',');
    const start = timestamp(value('start')), end = timestamp(value('end'));
    const plain = body.replace(/\{[^}]*\\i1[^}]*\}/g, '<i>').replace(/\{[^}]*\\i0[^}]*\}/g, '</i>').replace(/\{[^}]*\\b1[^}]*\}/g, '<b>').replace(/\{[^}]*\\b0[^}]*\}/g, '</b>').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && plain) cues.push({ start, end, text: sanitizeCueText(plain) });
  }
  return cues;
}
function parseMicroDvd(text: string, fps: number) {
  const cues: Cue[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const match = line.match(/^\{(\d+)\}\{(\d+)\}(.*)$/);
    if (!match) continue;
    const body = match[3].replace(/\{[^}]*\}/g, '').split('|').join('\n').trim();
    if (body) cues.push({ start: +match[1] / fps, end: +match[2] / fps, text: sanitizeCueText(body) });
  }
  return cues;
}
function parseSbv(text: string) {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const [timing, ...lines] = block.trim().split('\n');
    const [from, to] = (timing || '').split(',');
    const start = timestamp(from || ''), end = timestamp(to || '');
    if (Number.isFinite(start) && Number.isFinite(end) && lines.length) cues.push({ start, end, text: sanitizeCueText(lines.join('\n')) });
  }
  return cues;
}
/** Parse SubRip, WebVTT, SSA/ASS, MicroDVD and SubViewer (SBV) subtitles. */
export function parseSubtitles(text: string, name = '', fps = 25): Cue[] {
  const body = text.replace(/^﻿/, '');
  const extension = extensionOf(name);
  let cues: Cue[];
  if (/^\s*\[script info\]/i.test(body) || extension === 'ass' || extension === 'ssa') cues = parseAss(body);
  else if (/^\s*\{\d+\}\{\d+\}/.test(body)) cues = parseMicroDvd(body, fps || 25);
  else if (extension === 'sbv' || /^\s*\d+:\d+:\d+\.\d+,\d+:\d+:\d+\.\d+\s*$/m.test(body) && !body.includes('-->')) cues = parseSbv(body);
  else cues = parseSrtLike(body.replace(/^WEBVTT[^\n]*\n/, ''));
  return cues.sort((a, b) => a.start - b.start);
}
/** Cues active at a time, after VLC's subtitle delay (seconds) and speed factor. */
export function activeCues(cues: Cue[], time: number, delay = 0, speed = 1) {
  const t = (time - delay) * speed;
  return cues.filter(cue => cue.start <= t && cue.end > t);
}

// ---------- Playlists ----------
export interface PlaylistEntry { location: string; title?: string; duration?: number }

function resolveLocation(location: string, base: string) {
  const value = location.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    if (/^file:/i.test(value)) { try { return decodeURIComponent(new URL(value).pathname); } catch { return value; } }
    return value;
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return normalized;
  const parts = [...base.split('/').filter(Boolean), ...normalized.split('/')];
  const stack: string[] = [];
  for (const part of parts) { if (part === '..') stack.pop(); else if (part && part !== '.') stack.push(part); }
  return '/' + stack.join('/');
}
const decodeXml = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(+code)).replace(/&amp;/g, '&');
const encodeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Parse M3U/M3U8, PLS, XSPF, ASX, WPL and CUE playlists. `base` is the playlist's folder. */
export function parsePlaylist(text: string, name: string, base = '/'): PlaylistEntry[] {
  const body = text.replace(/^﻿/, '');
  const extension = extensionOf(name);
  const entries: PlaylistEntry[] = [];
  if (extension === 'xspf' || /<playlist[\s>]/i.test(body) && /xspf/i.test(body)) {
    for (const track of body.match(/<track>[\s\S]*?<\/track>/gi) ?? []) {
      const location = track.match(/<location>([\s\S]*?)<\/location>/i)?.[1];
      if (!location) continue;
      const title = track.match(/<title>([\s\S]*?)<\/title>/i)?.[1], duration = track.match(/<duration>(\d+)<\/duration>/i)?.[1];
      entries.push({ location: resolveLocation(decodeXml(location), base), title: title ? decodeXml(title) : undefined, duration: duration ? +duration / 1000 : undefined });
    }
    return entries;
  }
  if (extension === 'asx' || /<asx[\s>]/i.test(body)) {
    for (const entry of body.match(/<entry>[\s\S]*?<\/entry>/gi) ?? []) {
      const href = entry.match(/<ref\s+href\s*=\s*"([^"]+)"/i)?.[1];
      if (href) entries.push({ location: resolveLocation(decodeXml(href), base), title: entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1] });
    }
    return entries;
  }
  if (extension === 'wpl' || /<smil[\s>]/i.test(body)) {
    for (const match of body.matchAll(/<media\s+src\s*=\s*"([^"]+)"/gi)) entries.push({ location: resolveLocation(decodeXml(match[1]), base) });
    return entries;
  }
  if (extension === 'pls' || /^\s*\[playlist\]/i.test(body)) {
    const values = new Map<string, string>();
    for (const line of body.split(/\r?\n/)) { const match = line.match(/^\s*(File|Title|Length)(\d+)\s*=\s*(.*)$/i); if (match) values.set(match[1].toLowerCase() + match[2], match[3].trim()); }
    for (let index = 1; index < 100000; index++) {
      const file = values.get('file' + index);
      if (!file) { if (index > 1 && !values.has('file' + (index + 1))) break; continue; }
      const length = Number(values.get('length' + index));
      entries.push({ location: resolveLocation(file, base), title: values.get('title' + index), duration: length > 0 ? length : undefined });
    }
    return entries;
  }
  if (extension === 'cue') {
    const file = body.match(/^\s*FILE\s+"([^"]+)"/im)?.[1];
    return file ? [{ location: resolveLocation(file, base), title: body.match(/^\s*TITLE\s+"([^"]+)"/im)?.[1] }] : [];
  }
  let info: { title?: string; duration?: number } = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const match = line.match(/^#EXTINF:\s*(-?\d+(?:\.\d+)?)[^,]*,(.*)$/i);
      if (match) info = { duration: +match[1] > 0 ? +match[1] : undefined, title: match[2].trim() || undefined };
      continue;
    }
    entries.push({ location: resolveLocation(line, base), ...info });
    info = {};
  }
  return entries;
}
export function serializeM3U(entries: PlaylistEntry[]) {
  return ['#EXTM3U', ...entries.flatMap(entry => [`#EXTINF:${Math.round(entry.duration ?? -1)},${entry.title ?? titleFromName(entry.location)}`, entry.location])].join('\n') + '\n';
}
export function serializeXSPF(entries: PlaylistEntry[], title = 'Playlist') {
  const tracks = entries.map(entry => `\t\t<track>\n\t\t\t<location>${encodeXml(/^[a-z][a-z0-9+.-]*:/i.test(entry.location) ? entry.location : 'file://' + encodeURI(entry.location))}</location>\n${entry.title ? `\t\t\t<title>${encodeXml(entry.title)}</title>\n` : ''}${entry.duration ? `\t\t\t<duration>${Math.round(entry.duration * 1000)}</duration>\n` : ''}\t\t</track>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<playlist xmlns="http://xspf.org/ns/0/" version="1">\n\t<title>${encodeXml(title)}</title>\n\t<trackList>\n${tracks}\n\t</trackList>\n</playlist>\n`;
}

// ---------- Equalizer ----------
/** VLC's default equalizer bands (Hz). */
export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
export const EQ_BAND_LABELS = ['60 Hz', '170 Hz', '310 Hz', '600 Hz', '1 KHz', '3 KHz', '6 KHz', '12 KHz', '14 KHz', '16 KHz'];
/** VLC's built-in presets (modules/audio_filter/equalizer_presets.h): preamp, then ten band gains in dB. */
export const EQ_PRESETS: Record<string, { name: string; preamp: number; bands: number[] }> = {
  flat: { name: 'Flat', preamp: 12, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  classical: { name: 'Classical', preamp: 12, bands: [0, 0, 0, 0, 0, 0, -7.2, -7.2, -7.2, -9.6] },
  club: { name: 'Club', preamp: 6, bands: [0, 0, 8, 5.6, 5.6, 5.6, 3.2, 0, 0, 0] },
  dance: { name: 'Dance', preamp: 5, bands: [9.6, 7.2, 2.4, 0, 0, -5.6, -7.2, -7.2, 0, 0] },
  fullbass: { name: 'Full bass', preamp: 5, bands: [-8, 9.6, 9.6, 5.6, 1.6, -4, -8, -10.4, -11.2, -11.2] },
  fullbasstreble: { name: 'Full bass and treble', preamp: 4, bands: [7.2, 5.6, 0, -7.2, -4.8, 1.6, 8, 11.2, 12, 12] },
  fulltreble: { name: 'Full treble', preamp: 3, bands: [-9.6, -9.6, -9.6, -4, 2.4, 11.2, 16, 16, 16, 16.8] },
  headphones: { name: 'Headphones', preamp: 4, bands: [4.8, 11.2, 5.6, -3.2, -2.4, 1.6, 4.8, 9.6, 12.8, 14.4] },
  largehall: { name: 'Large Hall', preamp: 5, bands: [10.4, 10.4, 5.6, 5.6, 0, -4.8, -4.8, -4.8, 0, 0] },
  live: { name: 'Live', preamp: 7, bands: [-4.8, 0, 4, 5.6, 5.6, 5.6, 4, 2.4, 2.4, 2.4] },
  party: { name: 'Party', preamp: 6, bands: [7.2, 7.2, 0, 0, 0, 0, 0, 0, 7.2, 7.2] },
  pop: { name: 'Pop', preamp: 6, bands: [-1.6, 4.8, 7.2, 8, 5.6, 0, -2.4, -2.4, -1.6, -1.6] },
  reggae: { name: 'Reggae', preamp: 8, bands: [0, 0, 0, -5.6, 0, 6.4, 6.4, 0, 0, 0] },
  rock: { name: 'Rock', preamp: 5, bands: [8, 4.8, -5.6, -8, -3.2, 4, 8.8, 11.2, 11.2, 11.2] },
  ska: { name: 'Ska', preamp: 6, bands: [-2.4, -4.8, -4, 0, 4, 5.6, 8.8, 9.6, 11.2, 9.6] },
  soft: { name: 'Soft', preamp: 5, bands: [4.8, 1.6, 0, -2.4, 0, 4, 8, 9.6, 11.2, 12] },
  softrock: { name: 'Soft rock', preamp: 7, bands: [4, 4, 2.4, 0, -4, -5.6, -3.2, 0, 2.4, 8.8] },
  techno: { name: 'Techno', preamp: 5, bands: [8, 5.6, 0, -5.6, -4.8, 0, 8, 9.6, 9.6, 8.8] },
};
/** VLC's preamp scale treats 12 dB as unity (the Flat preset is transparent). */
export const preampGain = (preamp: number) => Math.pow(10, (preamp - 12) / 20);

// ---------- Codec strings ----------
const hex = (value: number) => value.toString(16).padStart(2, '0').toUpperCase();
function findBox(data: Uint8Array, path: string[], start = 0, end = data.length): [number, number] | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const [name, ...rest] = path;
  // Sample entries carry fixed headers before their child boxes.
  const skip: Record<string, number> = { stsd: 8, avc1: 78, avc3: 78, hvc1: 78, hev1: 78, mp4a: 28 };
  for (let offset = start; offset + 8 <= end;) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    let header = 8;
    if (size === 1) { size = Number(view.getBigUint64(offset + 8)); header = 16; } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) return null;
    if (type === name) {
      const bodyStart = offset + header + (skip[type] ?? 0);
      return rest.length ? findBox(data, rest, bodyStart, offset + size) : [offset + header, offset + size];
    }
    offset += size;
  }
  return null;
}
/** Read the RFC 6381 codec string for the first H.264/HEVC sample entry in an fMP4 init segment. */
export function videoCodecString(init: Uint8Array): string | null {
  const moov = findBox(init, ['moov']); if (!moov) return null;
  const view = new DataView(init.buffer, init.byteOffset, init.byteLength);
  const stsd = ['mdia', 'minf', 'stbl', 'stsd'];
  for (let offset = moov[0]; offset + 8 <= moov[1];) {
    const size = view.getUint32(offset), type = String.fromCharCode(...init.subarray(offset + 4, offset + 8));
    if (size < 8) return null;
    if (type === 'trak') {
      for (const entry of ['avc1', 'avc3']) {
        const avcC = findBox(init, [...stsd, entry, 'avcC'], offset + 8, offset + size);
        if (avcC) return `${entry}.${hex(init[avcC[0] + 1])}${hex(init[avcC[0] + 2])}${hex(init[avcC[0] + 3])}`;
      }
      for (const entry of ['hvc1', 'hev1']) {
        const hvcC = findBox(init, [...stsd, entry, 'hvcC'], offset + 8, offset + size);
        if (!hvcC) continue;
        const b = init.subarray(hvcC[0]);
        const space = ['', 'A', 'B', 'C'][b[1] >> 6], tier = (b[1] & 0x20) ? 'H' : 'L', profile = b[1] & 0x1f;
        let compat = (b[2] << 24 | b[3] << 16 | b[4] << 8 | b[5]) >>> 0, reversed = 0;
        for (let bit = 0; bit < 32; bit++) { reversed = (reversed << 1) | (compat & 1); compat >>>= 1; }
        const constraints = [...b.subarray(6, 12)]; while (constraints.length && constraints.at(-1) === 0) constraints.pop();
        return `${entry}.${space}${profile}.${(reversed >>> 0).toString(16).toUpperCase()}.${tier}${b[12]}${constraints.map(value => '.' + hex(value)).join('')}`;
      }
    }
    offset += size;
  }
  return null;
}

/** Read an EBML variable-length integer; returns [value, length]. */
function vint(data: Uint8Array, offset: number, keepMarker = false): [number, number] {
  const first = data[offset];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || offset + length > data.length) return [NaN, 1];
  let value = keepMarker ? first : first & (0xff >> length);
  for (let index = 1; index < length; index++) value = value * 256 + data[offset + index];
  return [value, length];
}
function findId(data: Uint8Array, id: number[], from = 0) {
  outer: for (let offset = from; offset + id.length <= data.length; offset++) {
    for (let index = 0; index < id.length; index++) if (data[offset + index] !== id[index]) continue outer;
    return offset;
  }
  return -1;
}
/** Start time (seconds) of the first Cluster in a WebM chunk, so it can be placed on the timeline. */
export function webmStartTime(data: Uint8Array): number | null {
  let scale = 1_000_000;
  const scaleAt = findId(data, [0x2a, 0xd7, 0xb1]);
  if (scaleAt >= 0) {
    const [size, sizeLength] = vint(data, scaleAt + 3);
    let value = 0; for (let index = 0; index < size; index++) value = value * 256 + data[scaleAt + 3 + sizeLength + index];
    if (value > 0) scale = value;
  }
  const cluster = findId(data, [0x1f, 0x43, 0xb6, 0x75]);
  if (cluster < 0) return null;
  const [, clusterSizeLength] = vint(data, cluster + 4);
  const timecodeAt = cluster + 4 + clusterSizeLength;
  if (data[timecodeAt] !== 0xe7) return null;
  const [size, sizeLength] = vint(data, timecodeAt + 1);
  let value = 0; for (let index = 0; index < size; index++) value = value * 256 + data[timecodeAt + 1 + sizeLength + index];
  return value * scale / 1e9;
}
