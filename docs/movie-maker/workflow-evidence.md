# Workflow evidence

The browser workflow uses Playwright Chromium at 1280 × 800 CSS pixels, device scale 1, light appearance and default 100% zoom. The screenshots were visually inspected after capture. The editor and shared packages are real; filesystem/dialog context in the standalone harness is a deterministic SDK test host. This is automated operator evidence, not a study with a human beginner. No site was published.

| Capture | Observed state |
| --- | --- |
| [Empty editor](screenshots/empty-1280.png) | Home ribbon, clear import action, left preview, right empty storyboard and sample entry point |
| [Three-minute project](screenshots/workspace-1280.png) | 12 segments, real source thumbnails, selected photo, playhead, transition durations, text/music/narration strips and caption in preview |
| [Export settings](screenshots/export-settings.png) | Real format choice, audio, custom dimensions/frame rate/bitrate; no horizontal dialog overflow |
| [Finished movie](screenshots/export-complete.png) | Validated four-second movie, output dimensions/frame rate, file size and working Files/download destinations |
| [Compact workspace](screenshots/compact-640.png) | 640 × 700 CSS pixels; preview, editable title and wrapping storyboard remain reachable, ribbon scrolls |
| [Forced colors](screenshots/high-contrast-640.png) | Forced-colors plus reduced-motion preferences applied |
| [200% equivalent layout](screenshots/zoom-200-equivalent.png) | 640 × 400 CSS pixels at device scale 2, corresponding to the available layout area of 1280 × 800 at 200%; keyboard selection and visible focus checked. This is an equivalent viewport test, not a captured browser zoom-menu setting |

The complete workflow loads the sample, edits a visible effect and checks actual pixels, undoes/redoes, adjusts duration, reorders by drag and context menu, splits a video, edits a caption and music timing, uses keyboard navigation, saves through Files and reloads. It then starts a new project, imports two pictures plus a real video, trims, adds a title/music, plays the synchronized preview and downloads a genuine four-second WebM. The dialog overflow identified during screenshot review was corrected and rechecked before the final captures.

Separate engine evidence verifies the full 180-second 720p/30 fps output, all 5,400 packets, VP8/Opus tracks and nonzero decoded audio. Eight time checkpoints compare decoded export pixels to the shared preview compositor. The largest mean absolute color-channel difference was 5.04/255 at animated credits; the other points were 0.72–1.34/255. An additional nine-second MP4 output independently validates H.264/AAC and audible sound.

Audio mixing uses a bounded PCM worker. Dedicated regression checks find zero sample difference against the pure fallback and previous mixer, preserve source buffers and verify cancellation. The final isolated production workflow also observes an actual worker launch and checks that its emitted hashed JavaScript URL resolves successfully; the canvas compositor remains on the main thread.

Failure tests cover corrupt/unsupported import, a denied microphone, permission completing after the dialog closes or app unmounts, actual generated narration pause/resume/stop/review/delete, inactive tracks after completion, repeated version-aware save, external save conflict, simulated local quota exhaustion, transactional rollback, missing media, relinking, undoable relinking, deleting an unavailable clip, and cancelled export. Reports distinguish injected failures from physical-device behavior.

Historical geometry cannot be compared pixel-for-pixel: no 2012 reference screenshot at a known window size and scale was available from the supplied official pages. The 1280 × 800 capture protocol is ready for a future version-matched comparison; historical visual parity remains **UNVERIFIED**.
