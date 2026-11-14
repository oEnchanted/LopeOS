import type { AppManifest } from '../../../../../packages/contracts/src';
import { MEDIA_EXTENSIONS, PLAYLIST_EXTENSIONS } from './formats';

export const mediaPlayerManifest: AppManifest = {
  contractVersion: 1, id: 'lope.media-player', name: 'Media Player', description: 'Play every video and audio format, playlists, network streams and subtitles.', icon: 'media-player',
  entry: () => import('./index'), defaultSize: { width: 860, height: 560 }, minSize: { width: 380, height: 260 },
  fileAssociations: [...MEDIA_EXTENSIONS, ...PLAYLIST_EXTENSIONS].map(extension => '.' + extension).concat(['video/*', 'audio/*']),
  menus: [
    { label: 'Media', items: ['media.open-file', 'media.open-multiple', 'media.open-folder', 'media.open-network', 'media.open-capture', 'media.open-clipboard', { separator: true }, 'media.save-playlist', 'media.convert', { separator: true }, 'media.quit-at-end', 'media.quit'] },
    { label: 'Playback', items: ['playback.play', 'playback.stop', 'playback.previous', 'playback.next', 'playback.record', { separator: true }, 'playback.faster', 'playback.faster-fine', 'playback.normal', 'playback.slower-fine', 'playback.slower', { separator: true }, 'playback.forward', 'playback.backward', 'playback.jump', 'playback.next-frame', 'playback.ab-loop', { separator: true }, 'playback.bookmarks', 'playback.add-bookmark', { separator: true }, 'playback.next-chapter', 'playback.previous-chapter', { separator: true }, 'playback.loop', 'playback.random'] },
    { label: 'Audio', items: ['audio.next-track', 'audio.device', { separator: true }, 'audio.stereo', 'audio.mono', 'audio.left', 'audio.right', 'audio.reverse', { separator: true }, 'audio.vis-off', 'audio.vis-spectrum', 'audio.vis-scope', 'audio.vis-vu', { separator: true }, 'audio.volume-up', 'audio.volume-down', 'audio.mute'] },
    { label: 'Video', items: ['video.fullscreen', 'video.fit', { separator: true }, 'video.zoom', 'video.aspect', 'video.crop', 'video.deinterlace', { separator: true }, 'video.rotate', 'video.flip', { separator: true }, 'video.snapshot'] },
    { label: 'Subtitle', items: ['subtitle.add', 'subtitle.next-track', 'subtitle.disable', { separator: true }, 'subtitle.delay-up', 'subtitle.delay-down', 'subtitle.delay-reset'] },
    { label: 'Tools', items: ['tools.effects', 'tools.sync', 'tools.info', 'tools.codec', { separator: true }, 'tools.preferences'] },
    { label: 'View', items: ['view.playlist', 'view.advanced', 'view.minimal', 'view.fullscreen-interface', 'view.time'] },
    { label: 'Help', items: ['help.shortcuts', 'help.about'] },
  ],
};
