# Movie Maker 2012 layout and feature audit

Reviewed 2026-11-13. This audit uses **Windows Movie Maker 2012, from Windows Essentials 2012**, as the layout reference. It does not mix the Windows XP/Vista timeline, Photos Video Editor or Clipchamp into the editor. LopeOS keeps its current typography, colors, spacing, accessibility behavior and shared outer glass material.

## Evidence actually inspected

The [Baden-Württemberg teacher-training tutorial](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/) explicitly identifies the 2012 product and supplies original annotated screenshots. Ten image files were downloaded and visually inspected. The [reference manifest](reference-manifest.json) records every image URL, delivered width/height and observed structures. The images are German-localized crops between 154 and 480 pixels wide; their native Windows scale and original window dimensions are unknown. They establish arrangement and command grouping, not pixel-level geometry.

| Reference | Directly observed layout |
| --- | --- |
| [Home ribbon](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/material/startansicht.PNG) | Quick access above the tabs. Clipboard, Add, AutoMovie themes, Editing, then Share. Import, camera, narration, snapshot and text controls belong together in Add. |
| [Editing workspace](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/material/videoschnitt_r.PNG) | Left preview with controls below; right contiguous filmstrips wrapping to the next row. A long clip repeats thumbnails. No permanent property inspector fills the lower-left pane. |
| [Trim workspace](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/material/zuschnitt.PNG) | A temporary trimming ribbon, start/end fields, Save trim/Cancel, and two handles below the preview. |
| [Animations](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/material/effekte_auswahl.PNG) | Transition gallery at left, duration and apply-to-all beside it, pan/zoom gallery at right. |
| [Visual Effects](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/material/men_visuell.PNG) | Effect gallery with brightness and apply-to-all at its right edge. |
| [Project](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/material/men_projekt.PNG) | Audio mixing, the four emphasis choices and fit-to-music precede the aspect-ratio group. |
| [Music Tools](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/material/toneinstellungen.PNG) | Colored contextual category above the Options tab. Sound settings, split/point commands, then exact timing fields. |
| [Text Tools](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/material/textwerkzeug.PNG) | Contextual category above Format; clipboard, font, paragraph, timing/background, effect gallery and outline controls. |
| [Source sound](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/material/musik_ton_mix.PNG) and [lanes](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/material/spurenansicht.PNG) | Waveforms and colored music/narration/text strips align with the visual strip. Selection outlines the clip, not a separate information card. |

English contextual names are corroborated by the version-labeled [2016 Cuesta College handout mirror](https://manualzz.com/doc/28789725/microsoft-movie-maker-user-manual): **Video Tools → Edit**, **Music Tools → Options**, **Narration Tools → Options**, and **Text Tools → Format**. The mirror is not an official Microsoft manual; the institutional screenshot evidence takes precedence for placement.

## Command inventory and implementation review

The following is the checklist for the LopeOS adaptation. “Adaptation” identifies a deliberate modern replacement, not an original Microsoft command. Full names and counts of every historical preset are not claimed: the available captures do not expose the complete expanded galleries.

| Area | Features to preserve or supply | Review result |
| --- | --- | --- |
| File and quick access | New/open/save/save-as, recent/recoverable projects, undo/redo, separate project and rendered movie, import from device | Existing project, portable bundle and local recovery paths. Native file selection is the modern device-import path. |
| Home / Clipboard | Cut, copy, paste selected clips; preserve linked text/audio | Being added in this revision. Duplicate remains an additional shortcut. |
| Home / Add | Multi-file video/photo import, music at beginning or current point, webcam recording, recorded/imported narration, frame snapshot, title/caption/credits | Import/text/narration already implemented; webcam, snapshot and insertion variants are revision gaps to close. |
| Home / AutoMovie | Editable theme decisions, including transitions, text, still movement and music fitting/fades | Existing themes are editable; gallery is being expanded. No claim of Microsoft's exact preset output. |
| Home / Editing | Rotate left/right, remove, select all | Rotation/removal implemented; select-all needs its visible ribbon position. |
| Home / Share | Render/save movie, audio-only output, destination choices | MP4/H.264/AAC where available, WebM alternative, Files/download. Obsolete publishing accounts are intentionally replaced. |
| Animations | Transition presets/duration, apply-to-all, pan/zoom presets and apply-to-all, expanded galleries | Existing small galleries are being expanded; bulk application is being added. |
| Visual Effects | Preset gallery, live preview, brightness, apply-to-all, multiple ordered effects | Existing single effects are being expanded with brightness and ordered combinations. |
| Project / Audio | Audio mix, emphasize narration/video/music/none, fit pictures to music | Emphasis already mixes/ducks; mix balance and fit-to-music are being added. |
| Project / Aspect | Widescreen 16:9, standard 4:3 | Implemented. Portrait is labeled a modern addition. |
| View | Time zoom in/out/reset, independent thumbnail size, waveforms, full-screen preview | Existing zoom/waveforms/fullscreen; separate thumbnail size and reference group order are revision gaps to close. |
| Video Tools / Edit | Source sound volume/fades, speed, still/title duration/background, split, trim tool, start/end points | Existing editing decisions work; dedicated trim workspace and authentic group order are being added. |
| Music and Narration / Options | Volume/fades; split; project start time; source in/out; set start time/points at playhead | Existing numeric trims/timing/fades work; split and playhead commands are being added. |
| Text Tools / Format | Font/size/color, bold/italic, paragraph alignment, transparency, background, start/duration, animation gallery, outline thickness/color | Existing basics work; richer formatting and animation choices are being added. |
| Storyboard | Duration-proportional wrapping strips, movable playhead, selection, clip reorder, aligned source/music/narration/text bands | Existing padded cards are being replaced by reference-shaped strips; file information remains available through selection/labels. |
| Local editing engine | Non-destructive source decisions, playback/export agreement, local cache, autosave, recovery, undo | Implemented and separately tested; the redesign must preserve this behavior. |

The revision checklist is an implementation audit, not a blanket claim that every original Windows feature or preset has been reproduced. Its final status must be reconciled with the new verification report.

## Features easy to miss in a visual clone

The [2012 release-era Microsoft community description](https://learn.microsoft.com/en-us/answers/questions/2554842/whats-new-in-movie-maker-2012), corroborated by [Microsoft's announcement](https://blogs.windows.com/windowsexperience/2012/08/07/introducing-the-new-windows-photo-gallery-and-movie-maker/), identifies narration during video playback, audio from video files, priority mixing, automatic recovery and proxy preparation. These are behavior requirements, not decorative buttons. The Windows 8 version also supplied stabilization and rolling-shutter correction; these are separate capabilities and must not be conflated.

The [institutional audio tutorial](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/ton.html) distinguishes insertion at the movie start from insertion at the playhead, and shows movable audio starts and exact source endpoints. Music and narration should retain those controls even with the simpler storyboard.

The [text tutorial](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/text.html) demonstrates editing text in the preview and moving/resizing its box. Text duration is independent of the background clip and may cross a cut. A font selector plus three fixed positions is useful but is not full original text-placement parity.

The [effect tutorial](https://lehrerfortbildung-bw.de/st_digital/medienwerkstatt/multimedia/video/moviemaker/anzeigeeffekt.html) establishes preview-on-hover, multi-selection, brightness and apply-to-all. [Microsoft's community discussion](https://learn.microsoft.com/en-nz/answers/questions/2553023/windows-movie-maker-animations-transitions) places Multiple Effects under the expanded gallery, allowing effects to be combined in order. A larger row of isolated filters alone does not close that gap.

The 2012 version also supported **Save movie → Audio only**, with M4A/WMA output, as explicitly distinguished from 2011 in this [Microsoft-hosted community answer](https://learn.microsoft.com/en-us/answers/questions/2526130/how-to-edit-cut-and-save-only-music-using-movie-ma). A browser-native audio output format is a reasonable adaptation; removing the output mode entirely would omit a feature.

The [University of Aberdeen guide](https://www.abdn.ac.uk/toolkit/documents/uploads/movie-maker-editing.pdf) and a [Movie Maker 2012 support discussion](https://learn.microsoft.com/en-us/answers/questions/2658469/windows-movie-maker-audio-waveforms-disappeared) corroborate separate time zoom and thumbnail sizing, a draggable playhead and selection borders. The Aberdeen guide's cached text was readable, but its live PDF URL returned 404 during this review; its image geometry was not inspected.

## Deliberate adaptations and remaining limits

- Modern LopeOS chrome replaces Windows Aero; no old installer, login or social-publishing service is implied.
- Files/download replace the former online Share gallery. Camera/microphone access is requested only when recording is invoked; import works through local files.
- Project documents remain `.lopemovie` and portable `.lopemoviebundle`. No renamed JSON is advertised as WLMP.
- MP4 and WebM are real encoded outputs. WMV, Windows DVD Maker, FireWire tape control and legacy Windows codecs are not browser features and are not represented by inert commands.
- If translation-based stabilization is offered, label it accurately and expose crop/analysis consequences. It must not claim Microsoft's separate rolling-shutter/wobble correction or full affine camera correction.
- There is no evidence that professional multitrack compositing, keyframe curves, chroma key or picture-in-picture belong in the 2012 baseline; they remain outside this simple app.
- The complete historical preset count/order and exact rendered appearance remain unverified. Named functional families can be supplied without claiming every Microsoft preset is identical.

Layout structure is now supported by inspected reference images. Exact pixel parity is still unverified because the sources are resized crops with unknown native DPI; this limitation no longer means the tab/group arrangement itself is unknown.
