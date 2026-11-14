# Movie Maker editing decisions

These additions are optional version-1 fields. Existing `.lopemovie` and portable projects retain their original defaults and reopen without migration. The renderer remains shared by preview, snapshots and offline output. Historical preset names are an organizational reference; the custom implementations are not a claim of pixel-identical Microsoft effect algorithms.

## Galleries and commands

`packages/movie-maker/src/galleries.ts` exports entries `{ id, label, group }` for `transitionPresets` (21), `effectPresets` (24), `panZoomPresets` (27), `textAnimationPresets` (10), and `themePresets` (the seven original-style categories plus the LopeOS Journey theme). Each entry has an actual rendering operation. `TransitionKind`, `Effect`, `PanZoom`, `TextAnimation` and `AutoMovieTheme` are derived from those IDs.

`applyToAll(project, sourceClipId, 'transitions' | 'panZoom' | 'effects')` copies only that family of decisions. Pan/zoom applies to photos. The first segment has no incoming transition. `effectiveTransition` bounds durations by both neighbors while retaining the requested duration.

`fitToMusic(project)` adjusts photo and title-card durations to the end of the music. Video source trims and speeds remain unchanged. Integer-frame rounding is distributed exactly, linked caption times scale with their photo, and anchored music is preserved at its previous absolute start. It reports an actionable error when the soundtrack is shorter than the fixed video footage or no adjustable photo/title exists.

`splitAudio(project, trackId, absoluteFrame)` divides a lane at the playhead while retaining continuous source samples. `trimAudioToPlayhead(project, trackId, absoluteFrame, 'start' | 'end')` retains the selected side and maintains the correct project offset. Sound lanes can reference an audio asset or a video asset with an actual audio track.

## Clip fields

| Field | Meaning |
| --- | --- |
| `effects?: Effect[]` | Up to eight ordered effects. When absent, the original single `effect` applies. An empty list means no effects. |
| `brightness?: number` | From -1 (black) through 0 (unchanged) to +1 (double brightness). Applied after the ordered stack. |
| `backgroundColor?: string` | Hexadecimal full-card/letterbox color. Absent uses the existing dark background. |
| `stabilization?: StabilizationData` | Measured source-frame translations and crop. Applies only to the analyzed source and time range; see the stabilization report. |

Simple filters use Canvas filtering. Ordered effects that require pixels use bounded reusable frame surfaces: posterize, threshold, Sobel edge detection, pixelation, mirrors, hue animation and authored fades. `effectPreviewFilter(clip)` returns the CSS-compatible portion for lightweight storyboard thumbnails; the actual preview canvas evaluates the complete stack.

Wipes, directional slides, shape reveals, blinds, checkerboards and deterministic pixel dissolves use real frame composition. Pan/zoom presets use explicit focal points and directional transforms. They are not thumbnail-only animations.

## Text fields

`TextStyle` accepts optional `bold`, `italic`, `alignment` (`left`, `center`, `right`), `opacity` (0–1), and hexadecimal `outlineColor`. Absent fields retain previous rendering.

`x` and `y` are normalized coordinates of the text-box center; `boxWidth` is a fraction of the picture width (0.1–1). When coordinates are absent, the existing top/center/bottom positioning remains. Text wraps inside this width; font size and geometry scale with output dimensions.

For a title card, `text.start` and `text.duration` are local project frames independent of its visual background duration. Text may remain over following clips. When omitted, it starts at the beginning and lasts for the background clip. Captions use their existing required `start`/`duration` timeline fields; these are evaluated once, not applied a second time as title timing. `TextStyle.background` paints behind the text box, distinct from the full clip background color.

## Audio mix

Optional `project.audioMix` ranges from 0 (video sound only) to 1 (music/narration only). The default midpoint preserves the previous full gain of each family. Moving away from the center attenuates the opposite family. `audioMixGain(project, kind)` is incorporated into `soundDecisions` before worker mixing, so preview and export agree. Completely muted segments do not trigger emphasis ducking.

## Verification

- `tests/movie-maker/features.test.ts`: eight model checks cover all gallery IDs, backward-compatible parsing, richer text/geometry/timing, multiple effects, bulk edits, fit-to-music rounding, audio split/trim, video sound imports, mix endpoints and theme decisions.
- `tests/movie-maker/features-browser.mjs`: renders every gallery entry, checks actual animation/change, verifies different stack orders produce different pixels, and tests independent title timing across a visual cut.
- `features-verification.json`: independently decoded output at six checkpoints differs from the preview by approximately 0.45–1.44 color values out of 255. `features-output.webm` is the three-second rendered fixture.

Video frame requests include a bounded 0.51 ms adjustment for WebM's millisecond timestamp quantization. This avoids selecting the previous sample when a nominal frame time rounds upward in the container, while retaining the same source-time decisions for preview and export.
