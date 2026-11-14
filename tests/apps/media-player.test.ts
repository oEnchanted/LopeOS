import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCues, extensionOf, fineRate, formatTime, isMedia, isPlaylist, nextRate, parsePlaylist, parseSubtitles, parseTime, preampGain, sanitizeCueText, serializeM3U, serializeXSPF, videoCodecString, videoLayout, webmStartTime } from '../../apps/web/src/apps/media-player/formats.ts';

test('media player recognizes VLC audio, video and playlist extensions', () => {
  for (const name of ['movie.mkv', 'clip.AVI', 'old.wmv', 'show.ts', 'song.flac', 'track.wma', 'voice.amr', 'album.ape', 'film.rmvb', 'tape.vob']) assert.ok(isMedia(name), name);
  assert.equal(isMedia('notes.txt'), false);
  assert.ok(isPlaylist('/Music/mix.m3u'));
  assert.equal(isPlaylist('https://example.com/live.m3u8'), false, 'remote HLS is a stream, not a playlist file');
  assert.equal(extensionOf('https://x.test/a.b/video.MP4?token=1'), 'mp4');
});

test('time formatting and parsing follow VLC', () => {
  assert.equal(formatTime(65), '01:05');
  assert.equal(formatTime(3723), '1:02:03');
  assert.equal(formatTime(5, 4000), '0:00:05');
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('1h2m'), 3720);
  assert.equal(parseTime('abc'), null);
});

test('playback rates step through VLC presets and fine increments', () => {
  assert.equal(nextRate(1, 1), 1.5);
  assert.equal(nextRate(1, -1), 2 / 3);
  assert.equal(nextRate(16, 1), 16);
  assert.equal(fineRate(1, 1), 1.1);
  assert.equal(fineRate(0.07, -1), 1 / 16);
});

test('subtitles parse from SRT, WebVTT, ASS, MicroDVD and SBV', () => {
  const srt = parseSubtitles('1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>Hello</i> <font color="red">world</font>\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nLine one\r\nLine two\r\n', 'a.srt');
  assert.deepEqual(srt.map(cue => [cue.start, cue.end, cue.text]), [[1.5, 3, '<i>Hello</i> world'], [4, 5, 'Line one<br>Line two']]);
  const vtt = parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nHi & bye\n', 'a.vtt');
  assert.deepEqual(vtt.map(cue => [cue.start, cue.text]), [[1, 'Hi &amp; bye']]);
  const ass = parseSubtitles('[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:04.50,Default,,0,0,0,,{\\an8}Top, with comma\\Nsecond\n', 'a.ass');
  assert.deepEqual(ass.map(cue => [cue.start, cue.end, cue.text]), [[2, 4.5, 'Top, with comma<br>second']]);
  const sub = parseSubtitles('{25}{50}First|Second\n', 'a.sub', 25);
  assert.deepEqual(sub.map(cue => [cue.start, cue.end, cue.text]), [[1, 2, 'First<br>Second']]);
  const sbv = parseSubtitles('0:00:01.000,0:00:02.000\nCaption\n', 'a.sbv');
  assert.deepEqual(sbv.map(cue => [cue.start, cue.text]), [[1, 'Caption']]);
});

test('cue text cannot inject markup', () => {
  assert.equal(sanitizeCueText('<img src=x onerror=alert(1)><b onclick="x">bold</b>'), '<b>bold</b>');
  assert.equal(sanitizeCueText('a < b > c'), 'a &lt; b &gt; c');
});

test('subtitle delay and speed shift active cues', () => {
  const cues = [{ start: 10, end: 12, text: 'x' }];
  assert.equal(activeCues(cues, 11).length, 1);
  assert.equal(activeCues(cues, 11, 2).length, 0);
  assert.equal(activeCues(cues, 13, 2).length, 1);
  assert.equal(activeCues(cues, 5.5, 0, 2).length, 1);
});

test('playlists parse M3U, PLS and XSPF and round-trip', () => {
  const m3u = parsePlaylist('#EXTM3U\n#EXTINF:123,Artist - Song\nsong.mp3\n../Video/clip.mkv\nhttps://radio.test/stream\n', 'mix.m3u', '/Music/Lists');
  assert.deepEqual(m3u, [
    { location: '/Music/Lists/song.mp3', title: 'Artist - Song', duration: 123 },
    { location: '/Music/Video/clip.mkv' },
    { location: 'https://radio.test/stream' },
  ]);
  const pls = parsePlaylist('[playlist]\nFile1=/a.mp3\nTitle1=A\nLength1=-1\nFile2=b.ogg\nNumberOfEntries=2\n', 'x.pls', '/M');
  assert.deepEqual(pls, [{ location: '/a.mp3', title: 'A', duration: undefined }, { location: '/M/b.ogg', title: undefined, duration: undefined }]);
  const xspf = serializeXSPF([{ location: '/Music/Tom & Jerry.mp3', title: 'T&J', duration: 61.5 }, { location: 'https://x.test/a.mp4' }]);
  assert.deepEqual(parsePlaylist(xspf, 'p.xspf'), [{ location: '/Music/Tom & Jerry.mp3', title: 'T&J', duration: 61.5 }, { location: 'https://x.test/a.mp4', title: undefined, duration: undefined }]);
  assert.deepEqual(parsePlaylist(serializeM3U([{ location: '/a.mp3', title: 'A', duration: 3 }]), 'a.m3u'), [{ location: '/a.mp3', title: 'A', duration: 3 }]);
});

test('equalizer preamp treats 12 dB as unity like VLC presets', () => {
  assert.equal(preampGain(12), 1);
  assert.ok(Math.abs(preampGain(6) - 0.501) < 0.001);
});

test('video layout applies aspect, crop and zoom', () => {
  const box = { width: 800, height: 600 }, source = { width: 1920, height: 1080 };
  assert.deepEqual(videoLayout(box, source, { aspect: 'Default', crop: 'Default', zoom: 0, rotation: 0 }), { width: 800, height: 450, visibleWidth: 800, visibleHeight: 450 });
  const square = videoLayout(box, source, { aspect: '1:1', crop: 'Default', zoom: 0, rotation: 0 })!;
  assert.equal(square.width, 600); assert.equal(square.height, 600);
  const cropped = videoLayout(box, source, { aspect: 'Default', crop: '4:3', zoom: 0, rotation: 0 })!;
  assert.equal(cropped.visibleWidth, 800); assert.equal(cropped.visibleHeight, 600);
  assert.ok(Math.abs(cropped.width - 1066.67) < 0.01, 'the frame is scaled so the cropped region fills the box');
  const half = videoLayout(box, source, { aspect: 'Default', crop: 'Default', zoom: 0.5, rotation: 0 })!;
  assert.deepEqual([half.width, half.height], [960, 540]);
  const rotated = videoLayout(box, source, { aspect: 'Default', crop: 'Default', zoom: 0, rotation: 90 })!;
  assert.ok(Math.abs(rotated.height - 337.5) < 0.01 && rotated.width === 600);
});

test('codec strings are read from fMP4 init segments', () => {
  const box = (type: string, ...children: Uint8Array[]) => { const size = 8 + children.reduce((sum, child) => sum + child.length, 0); const out = new Uint8Array(size); new DataView(out.buffer).setUint32(0, size); out.set([...type].map(c => c.charCodeAt(0)), 4); let offset = 8; for (const child of children) { out.set(child, offset); offset += child.length; } return out; };
  const avcC = box('avcC', new Uint8Array([1, 0x64, 0x00, 0x29, 0xff]));
  const avc1 = box('avc1', new Uint8Array(78), avcC);
  const stsd = box('stsd', new Uint8Array(8), avc1);
  const init = box('moov', box('mvhd', new Uint8Array(4)), box('trak', box('tkhd', new Uint8Array(4)), box('mdia', box('minf', box('stbl', stsd)))));
  assert.equal(videoCodecString(init), 'avc1.640029');
});

test('WebM chunk start time is read from the first cluster', () => {
  const header = [0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x82, 0x06, 0x6b];
  assert.equal(webmStartTime(new Uint8Array([...header, ...cluster])), 1.643);
  assert.equal(webmStartTime(new Uint8Array(header)), null);
});

test('preferences fall back to VLC defaults for missing or malformed values', async () => {
  const { readPreferences, DEFAULT_PREFERENCES } = await import('../../apps/web/src/apps/media-player/preferences.ts');
  assert.deepEqual(readPreferences(null), DEFAULT_PREFERENCES);
  const read = readPreferences({ resume: 'always', maxVolume: 2, jumps: { short: 15, long: -4 }, subtitleScale: 9, subtitleColor: 'red', osd: false });
  assert.equal(read.resume, 'always'); assert.equal(read.maxVolume, 2); assert.equal(read.osd, false);
  assert.deepEqual(read.jumps, { veryShort: 3, short: 15, medium: 60, long: 300 });
  assert.equal(read.subtitleScale, 1); assert.equal(read.subtitleColor, '#ffffff');
});

test('bookmarks stay sorted and get unique VLC-style names', async () => {
  const { addBookmark } = await import('../../apps/web/src/apps/media-player/preferences.ts');
  const one = addBookmark([], 30.12345);
  const two = addBookmark(one, 5);
  assert.deepEqual(two, [{ name: 'Bookmark 2', time: 5 }, { name: 'Bookmark 1', time: 30.123 }]);
  assert.equal(addBookmark([{ name: 'Bookmark 2', time: 1 }], 2).at(-1)!.name, 'Bookmark 3');
});
