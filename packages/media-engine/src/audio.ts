import { audioMixGain, type MovieProject } from '../../movie-maker/src/model.ts';
import type { MediaLibrary } from './media.ts';
import { clipStart } from './render.ts';
import { checkCancelled, frameSeconds } from './types.ts';

import type { Sound, MixBlock } from './mix-math.ts';
import { AudioMixWorker } from './mix-worker-client.ts';
export { gainAt } from './mix-math.ts';
export function soundDecisions(project: MovieProject): Sound[] {
  const sounds: Sound[] = []; let start = 0;
  for (const clip of project.clips) {
    if (clip.assetId && clip.kind === 'video' && project.assets[clip.assetId]?.hasAudio && clip.volume > 0) sounds.push({ assetId: clip.assetId, kind: 'video', start: frameSeconds(start, project.fps), duration: frameSeconds(clip.duration, project.fps), offset: frameSeconds(clip.sourceIn, project.fps), speed: clip.speed, volume: clip.volume * audioMixGain(project, 'video'), fadeIn: frameSeconds(clip.fadeIn, project.fps), fadeOut: frameSeconds(clip.fadeOut, project.fps) });
    start += clip.duration;
  }
  for (const audio of project.audio) if (audio.volume > 0) sounds.push({ assetId: audio.assetId, kind: audio.kind, start: frameSeconds(audio.start + clipStart(project, audio.clipId), project.fps), duration: frameSeconds(audio.sourceOut - audio.sourceIn, project.fps), offset: frameSeconds(audio.sourceIn, project.fps), speed: 1, volume: audio.volume * audioMixGain(project, audio.kind), fadeIn: frameSeconds(audio.fadeIn, project.fps), fadeOut: frameSeconds(audio.fadeOut, project.fps) });
  return sounds.filter(sound => sound.volume > 0);
}
/** Audio and video use identical rational-frame edit decisions and source offsets. */
export async function mixAudio(project: MovieProject, library: MediaLibrary, signal?: AbortSignal): Promise<AudioBuffer> {
  checkCancelled(signal);
  const duration = frameSeconds(project.clips.reduce((sum, clip) => sum + clip.duration, 0), project.fps);
  if (duration > 1200) throw new Error('This in-browser mixer supports movies up to 20 minutes. Split this project into shorter movies.');
  const mixed = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, Math.ceil(duration * 48000)), sampleRate: 48000 });
  const sounds = soundDecisions(project), worker = new AudioMixWorker();
  // Shared bounded PCM pages feed exactly one two-second worker job at a time.
  try {
    for (let blockStart = 0; blockStart < duration; blockStart += 2) {
      const blockEnd = Math.min(duration, blockStart + 2), sources: MixBlock['sources'] = [];
      for (const sound of sounds) {
        checkCancelled(signal); const from = Math.max(blockStart, sound.start), to = Math.min(blockEnd, sound.start + sound.duration); if (to <= from) continue;
        if (sources.length >= 64) throw new Error('This movie has more than 64 simultaneous sound segments. Remove or mute some overlapping sounds.');
        const sourceFrom = sound.offset + (from - sound.start) * sound.speed, sourceTo = sound.offset + (to - sound.start) * sound.speed;
        const pcm = await library.service.audio(sound.assetId, sourceFrom, sourceTo); checkCancelled(signal);
        if (!pcm.channels.length) throw new Error('A referenced sound track could not be decoded. Relink its source before exporting.');
        sources.push({ sound, pcm });
      }
      const first = Math.ceil(blockStart * 48000), length = Math.min(mixed.length, Math.ceil(blockEnd * 48000)) - first;
      const channels = await worker.mix({ first, length, sources, sounds, emphasis: project.emphasis }, signal); checkCancelled(signal);
      for (let channel = 0; channel < 2; channel++) mixed.getChannelData(channel).set(channels[channel], first);
    }
    return mixed;
  } finally { worker.dispose(); }
}
