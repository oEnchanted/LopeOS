# Picture interaction review

2026-11-13. The picture UI now connects the painted object to its canonical document identity and native operations. Native document state, pagination, saved OOXML and history remain authoritative.

- Clicking an existing picture opens Picture Format and targets that picture in Properties, including reopened pictures and identical pictures in a fully painted paragraph.
- Native eight-handle resizing is retained. Pointer tests verify inline/floating corner resizing at 100% and 150%, proportional dimensions, saved extents and Undo/Redo.
- Floating pictures drag with a visible preview, page-center guides, Shift axis constraints and Alt to bypass snapping. Inline pictures show a drop caret and reanchor in text. Edge scrolling supports movement onto another page. Escape cancels, outside drops cancel, and Viewing prevents edits.
- The nearby Layout Options panel offers inline, square, top/bottom, behind-text and in-front placement, plus precise page positions in the selected measurement unit. Arrow keys nudge floating pictures; Shift uses larger steps. Floating controls use the shared OS glass material, live theme, text size and contrast.
- Crop handles edit individual edges/corners. Enter/Done applies; Escape/Cancel preserves the original. Properties exposes four independent crop percentages, preserves untouched edges and dimensions, and supports alt text. Reset Crop restores the source frame.
- File drops insert native image parts. Natural proportions are preserved, and newly inserted pictures are identified by their new canonical ID instead of choosing the last document picture.

Two underlying bugs were corrected: crop inputs use percentages (`10` means 10%), and cross-page native drop handlers previously ran before the application gesture. The custom gesture now takes ownership before native drop handling while leaving native resizing intact.

The installed painter does not display saved source crops itself. A decorative, noninteractive crop mirror now reflects fresh public image properties without changing the native hitbox or document model. Print waits for native image assets and clones that same crop presentation. Pixel checks cover 100%/150%, reset, disposal, source changes, and cropped images on an offscreen print page.

The new image suites contain **31 scenarios**. Evidence includes real pointer input, physical positions, crop pixels, saved DOCX structures, read-only guards and native history. The production smoke also inserts, wraps, drags, crops and saves a picture. See [verification.json](verification.json) for the final combined results.

Remaining boundaries: conversion/wrapping and cross-page reanchoring/positioning can use separate native history transactions, so a cross-page move may require two Undo actions. Rotation rendering, tight/through wrap editing, multi-object grouping, and complete Word anchor/layer controls are not implemented. Ambiguous partially painted/repeated story images are rejected rather than editing a different picture. Native media-source replacement can temporarily retain its old painted asset; no replacement-source command is exposed. Full native Word and assistive-technology validation remain outstanding.

References: [Microsoft picture resizing](https://support.microsoft.com/en-us/word/change-the-size-of-a-picture-shape-text-box-or-wordart-in-word), [picture layout and movement](https://support.microsoft.com/en-gb/word/wrap-text-and-move-pictures-in-word?ns=wdwaenduser&version=16).

Previews: [Layout Options](screenshots/picture-layout-options.png), [drag preview](screenshots/picture-drag-preview.png), [crop handles](screenshots/picture-crop-preview.png), [cropped picture](screenshots/picture-cropped.png).
