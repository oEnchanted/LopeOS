# Movie Maker capabilities and limits

Status reflects this implementation and the checked-in verification reports, not Windows Movie Maker's original feature list. Browser codec availability is tested when importing and exporting; filename extensions alone do not establish support.

| Area | Implementation | Verification / limit |
| --- | --- | --- |
| JPEG, PNG, WebP | Browser image decode, actual thumbnails | Included in the reproducible fixture |
| WebM VP8 / Opus | Shared demux/probe/decode | Two 24-second real video fixtures with sound |
| MP4 / MOV | Shared probe and browser-supported codecs | Capability dependent; phone orientation metadata passes through shared decoding. Broad device corpus not measured here |
| MP3 / AAC / FLAC | Shared probe and PCM decode | Capability dependent; codec failures offer conversion/relink guidance. No promise based on extension |
| PCM WAV | Shared PCM decode | Original music and spoken narration fixture |
| Sequence edits | Multi-select, reorder, duplicate, remove, split, source trims, still duration, speed | Integer frames and undo/redo; model tests cover clip-anchored text/audio preservation |
| Framing | Fit/fill, quarter-turn rotation, 16:9 / 4:3 / modern 9:16 | Same compositor decisions for preview and output |
| Transitions | Fade and dissolve with durations bounded by clip length | Applied inside the incoming clip; sequence length does not shrink |
| Still animation | Pan left/right, zoom in/out | Same canvas compositor for preview and export |
| Visual effects | Reset, grayscale, sepia, warm, cool, contrast, vintage | Same canvas filter path for preview and export |
| Text | Editable titles, captions, credits, font, color, size, position, outline/background, timing, fade/rise/scroll | Clip anchors retain intended placement after reorder; split handles straddling captions |
| AutoMovie-style themes | Editable transition/effect/pan-zoom/title/music-fade decisions | No flattened intermediate movie |
| Sound | Source video, music and narration; trim, timing, volume, fade, emphasis ducking | AudioContext clock for playback; same mixer decisions for offline audio |
| Narration | On-demand microphone, pause/stop, review/delete, import | Permission denial is recoverable; microphone tracks stop on completion/close |
| Projects | Versioned `.lopemovie`; `.lopemoviebundle` embeds originals with SHA-256 | 256 MB portable media limit; no WLMP compatibility claim |
| Autosave | Atomic IndexedDB media/project transaction | Reload and injected quota failure tested |
| Offline export | WebCodecs VP8 + Opus in real WebM; H.264 + AAC in real MP4, muxed by the shared service | 720p/1080p and custom; support checked before rendering; output independently reopened |
| MP4 export | Preferred where the actual H.264/AAC encoders are available; WebM alternative remains | 9-second 720p/30 fps MP4 verified with 270 packets, AVC/AAC tracks and audible decoded sound; full 180-second fixture verified as WebM |
| 4K | No dedicated measured preset | Custom dimensions remain constrained by encoder capability and memory budget |
| Stabilization | Not included | No cosmetic zoom pretending to stabilize footage |
| Publishing | Files and browser download | No obsolete social-service buttons or account integrations |
| Historical visual fidelity | 2012-inspired ribbon and wrapping storyboard | Exact tab grouping, geometry and pixel parity **UNVERIFIED** without matched source capture |

The renderer imports sources up to 1 GB individually. Export buffers are capped at an estimated 512 MB; audio mixing is capped at 20 minutes and uses bounded source PCM pages. PCM mixing runs in a dedicated worker in two-second blocks with one request in flight, preserving source cache buffers; a pure fallback uses the same arithmetic. Worker/fallback and pre-worker output comparisons have zero sample error, and cancellation/disposal are tested in [audio-worker-verification.json](audio-worker-verification.json). Browser storage estimates are advisory, with actual transaction failures reported. Import probing, decoder work and offline encoding are asynchronous, and render work yields between bounded frame batches. The canvas compositor remains on the main thread; this revision does not claim a fully worker-hosted compositor. Performance at 4K or with a large camera-file corpus is unmeasured.

Waveform thumbnails use 96 sampled points across a source and a bounded PCM cache; they are source previews, not a sample-accurate audio editor. The current source-backed frame service handles orientation and pixel aspect ratio, but the sample corpus does not establish correctness for every phone vendor's metadata or variable-frame-rate recording.

The automated frame comparison allows ordinary lossy-codec differences. It is evidence for the tested frame points, not a pixel-identical proof for all effects and media. Human novice usability, actual exhausted physical disks, real device microphone drivers, cross-browser codec coverage and high-DPI historical screenshot parity remain unverified.
