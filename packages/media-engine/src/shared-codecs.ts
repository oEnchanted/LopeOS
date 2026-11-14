// The converter owns this pinned dependency. Keep Movie Maker's sequence adapter
// on that single implementation; no private codec bundle or custom muxer.
export { Output, WebMOutputFormat, Mp4OutputFormat, BufferTarget, CanvasSource, AudioSampleSource, AudioSample, Input, BlobSource, ALL_FORMATS, probe, LocalMediaService, encoderCapabilities, canEncodeVideo, canEncodeAudio } from '../../media-service/src/index.ts';
