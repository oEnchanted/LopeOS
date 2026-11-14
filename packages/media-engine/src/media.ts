import type { ImportedMedia, FrameRate } from './types.ts';
import type { MediaAsset } from '../../movie-maker/src/model.ts';
import { LocalMediaService, probe } from './shared-codecs.ts';

export class MediaLibrary {
  readonly blobs: Map<string, Blob>;
  readonly service: LocalMediaService;
  private urls = new Map<string, string>();
  private pictures = new Map<string, Promise<ImageBitmap>>();
  constructor(blobs: Map<string, Blob> = new Map()) { this.blobs = new Map(blobs); this.service = new LocalMediaService(async id => this.get(id)); }
  set(id: string, blob: Blob) { this.release(id); if (this.blobs.has(id)) this.service.release(); this.blobs.set(id, blob); }
  get(id: string) { const blob = this.blobs.get(id); if (!blob) throw new Error('Missing media. Relink the highlighted source before playback or export.'); return blob; }
  has(id: string) { return this.blobs.has(id); }
  url(id: string) { if (!this.urls.has(id)) this.urls.set(id, URL.createObjectURL(this.get(id))); return this.urls.get(id)!; }
  image(id: string) { if (!this.pictures.has(id)) { if (this.pictures.size >= 6) { const old = this.pictures.keys().next().value!; void this.pictures.get(old)!.then(image => image.close()).catch(() => {}); this.pictures.delete(old); } this.pictures.set(id, createImageBitmap(this.get(id))); } return this.pictures.get(id)!; }
  async frame(id: string, seconds: number, width?: number) { this.get(id); const source = await this.service.frame(id, seconds, width); if (!source) throw new Error('No video frame could be decoded at this time. The source may be damaged.'); return source; }
  release(id: string) {
    const url = this.urls.get(id); if (url) URL.revokeObjectURL(url); this.urls.delete(id);
    void this.pictures.get(id)?.then(image => image.close()).catch(() => {}); this.pictures.delete(id);
  }
  dispose() { for (const id of this.blobs.keys()) this.release(id); this.service.release(); this.blobs.clear(); }
}
function extensionKind(file: File): 'image' | 'video' | 'audio' {
  if (/^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)) return 'image';
  if (/^audio\//.test(file.type) || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(file.name)) return 'audio';
  if (/^video\//.test(file.type) || /\.(mp4|mov|webm|m4v|ogv)$/i.test(file.name)) return 'video';
  throw new Error(`“${file.name}” is not a supported media container. Choose a photo, video, or audio file.`);
}
export function audioWaveform(buffer: AudioBuffer, count = 96): number[] {
  const channel = buffer.getChannelData(0); const stride = Math.max(1, Math.floor(channel.length / count));
  return Array.from({ length: count }, (_, i) => { let max = 0; for (let n = i * stride; n < Math.min(channel.length, (i + 1) * stride); n += Math.max(1, Math.floor(stride / 120))) max = Math.max(max, Math.abs(channel[n])); return max; });
}
export async function importMedia(file: File, fps: FrameRate = { num: 30, den: 1 }): Promise<ImportedMedia> {
  if (!file.size) throw new Error(`“${file.name}” is empty.`);
  if (file.size > 1024 ** 3) throw new Error('This browser editor accepts individual sources up to 1 GB. Create a smaller proxy file first.');
  const hint = extensionKind(file); const metadata = hint === 'image' ? null : await probe(file).catch(error => { throw new Error(`“${file.name}”: ${error instanceof Error ? error.message : 'Unsupported media codec.'} Convert to H.264 MP4, VP8 WebM, or WAV and import again.`); });
  const kind = metadata?.kind ?? hint; const library = new MediaLibrary(); const id = crypto.randomUUID(); library.set(id, file);
  const asset: MediaAsset = { id, name: file.name, kind, mime: file.type || 'application/octet-stream', size: file.size, durationFrames: 0, width: 0, height: 0, hasAudio: false };
  let waveform: number[] | undefined; let thumbnail = '';
  try {
    if (kind === 'image') {
      const picture = await library.image(id).catch(() => { throw new Error(`“${file.name}” cannot be decoded as a photo. Convert it to JPEG, PNG, or WebP.`); });
      asset.width = picture.width; asset.height = picture.height; asset.durationFrames = Math.round(7 * fps.num / fps.den);
      const scale = Math.min(192 / picture.width, 192 / picture.height); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(picture.width * scale)); canvas.height = Math.max(1, Math.round(picture.height * scale));
      canvas.getContext('2d')!.drawImage(picture, 0, 0, canvas.width, canvas.height); thumbnail = canvas.toDataURL('image/jpeg', .75);
    } else if (kind === 'video') {
      asset.width = metadata!.width; asset.height = metadata!.height; asset.durationFrames = Math.max(1, Math.floor(metadata!.duration * fps.num / fps.den)); asset.hasAudio = Boolean(metadata!.audioCodec);
      const source = await library.frame(id, Math.min(.1, metadata!.duration / 2), 192);
      const scale = Math.min(192 / asset.width, 192 / asset.height); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(asset.width * scale)); canvas.height = Math.max(1, Math.round(asset.height * scale)); canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height); thumbnail = canvas.toDataURL('image/jpeg', .75);
      if (asset.hasAudio) waveform = await sampleWaveform(library, id, metadata!.duration);
    } else {
      asset.hasAudio = true; asset.durationFrames = Math.max(1, Math.floor(metadata!.duration * fps.num / fps.den)); waveform = await sampleWaveform(library, id, metadata!.duration);
    }
    return { asset, blob: file, thumbnail, waveform };
  } finally { library.dispose(); }
}
async function sampleWaveform(library: MediaLibrary, id: string, duration: number, count = 96) {
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) { const time = duration * (i + .5) / count; const pcm = await library.service.audio(id, Math.max(0, time - .01), Math.min(duration, time + .01)); const channel = pcm.channels[0]; let peak = 0;
    if (channel) { const center = Math.floor(time * pcm.sampleRate) - pcm.start; for (let sample = Math.max(0, center - 480); sample < Math.min(channel.length, center + 480); sample++) peak = Math.max(peak, Math.abs(channel[sample])); }
    peaks.push(peak); if (i % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return peaks;
}
