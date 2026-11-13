# Writer reference baseline

Fixed on 2026-11-12, before UI implementation. Target: **Word for Microsoft 365, Windows desktop, English (United States), White / light appearance, classic expanded ribbon**. The application identity is LopeOS Writer; Microsoft artwork and branding are not application assets.

## Evidence and conditions

- Primary visual: [Microsoft, The new look of Office](https://support.microsoft.com/en-us/office/foundations-experiences/the-new-look-of-office), Windows section, [official screenshot](https://support.microsoft.com/en-us/office/media/office-visual-refresh.png). Word occupies the lower window, source pixels x=120–1486, y=580–879. Aptos (Body) 11 is visible. Tabs: File, Home, Insert, Draw, Design, Layout, References, Mailings, Review, View, Help. Windows 11 is depicted. Publication build number and display scaling are **not supplied**.
- [Customize the ribbon](https://support.microsoft.com/en-us/word/customize-the-ribbon-in-word) informs grouping and collapse behavior. Its annotated Calibri ribbon image predates the visual refresh and is **excluded from geometry/color comparisons**.
- [Explore and navigate Word](https://support.microsoft.com/en-us/accessibility/word/use-a-screen-reader-to-explore-and-navigate-word), [shortcuts](https://support.microsoft.com/en-us/accessibility/word/keyboard-shortcuts-in-word), [track changes](https://support.microsoft.com/en-us/word/training/track-changes-in-word), [modern comments](https://support.microsoft.com/en-us/word/modern-comments-in-word), [pagination](https://support.microsoft.com/en-us/word/keep-text-together-in-word), and [TOC](https://support.microsoft.com/en-us/word/training/insert-a-table-of-contents) are behavior references, not pixel references.
- Controlled internal captures: Chromium, 1366×900 viewport and application content, device scale 1, browser zoom 100%, document zoom 100%. Shell integration is separately captured at 1440×1000. Letter 8.5×11 in, 1 in margins. Narrow capture: 820×900 viewport. The ruler is initially hidden, matching the primary screenshot; it can be enabled from View.
- Windows Word is unavailable here. A Mac Word installation exists; any validation with it must be labeled **Mac Word**, never Windows reference validation.

## Measured / inferred geometry

The official Word window is approximately 1366 source pixels wide. Command/title region ~48 px; tab row ~32 px; ribbon ~101 px. Ribbon label text ~11 px; command text ~12 px; tabs ~14 px. Home groups start near source x=133 (Clipboard), 213 (Font), 523 (Paragraph), 777 (Styles), 1146 (Editing). Group separators are 1 px. Canvas is approximately #f0f0f0, ribbon #fff, title/tab surface #f3f3f3, active tab underline blue. Letter page is 816×1056 CSS px at 96 dpi. These are source-image estimates; no claim of native DPI calibration or a two-pixel parity pass is made. The outer LopeOS titlebar is excluded from reference comparison.

## State coverage to capture

| State | Reference evidence | Implementation artifact |
|---|---|---|
| Blank / Home | Primary official screenshot | screenshots/home-blank.png |
| Populated / selected text | Behavior documentation; no matched screenshot | screenshots/home-selection.png |
| Insert / Layout / References / Review / View | Command docs; exact geometry uncertain | screenshots/tab-*.png |
| Table / picture contextual tabs | Public engine commands; geometry uncertain | screenshots/table.png, picture.png |
| Navigation / results | Accessibility and search behavior | screenshots/navigation.png |
| Comments / tracked changes | Modern comments / track changes docs | screenshots/review.png |
| Font / Paragraph dialogs | Windows conventions; uncalibrated | screenshots/font.png, paragraph.png |
| Backstage / print preview | File workflows; uncalibrated | screenshots/backstage.png, print.png |
| Narrow ribbon / collapsed groups | Ribbon collapse documentation | screenshots/narrow.png |

All states without a matched Windows screenshot remain reconstructed, not visually certified. See parity-report.md for actual verification and remaining limits.

## Preferences and motion addendum — 2026-11-13

The user supplied Word for Mac Preferences screenshots: the category grid, General, View, Edit, Spelling & Grammar, AutoCorrect, Accessibility, East Asian Languages, Save, Print, Track Changes, User Information, Security, File Locations and Privacy. These are the reference for the separate Preferences surface. The document editor retains the original Windows classic-ribbon baseline.

Following the user's feedback that Preferences was too large, its default size is **800×600 CSS pixels** with a 62-pixel toolbar. It uses 13-pixel category labels, 14-pixel form text, 36-pixel icon tiles, back/forward navigation, Show All and search. The three groups and all 16 categories fit without scrolling at normal desktop text size. The inner modal has a single close action; LopeOS owns the outer window controls. Narrow layouts and larger OS text scroll and adapt within the available window. Lucide SVGs with original, subdued color treatments replace native Office artwork. The supplied screenshots inform the organization; their unknown edition/build and scaling do not establish CSS dimensions or pixel parity.

The user's later instruction takes precedence over the screenshots' dark appearance: Preferences follows the resolved **LopeOS system theme**. Changing Light/Dark, or the device color scheme while LopeOS uses System, updates the open window without resetting its pane or form state. The editor's Office theme remains a separate choice.

UI motion uses finite 110–170 ms fades, short translations and pane-width transitions. The references are static screenshots, so these timings are implementation choices, not measured native Word animation timings. App animation settings, LopeOS Reduce Motion, and the device's reduced-motion preference are honored. Document layout, text, caret coordinates and exported pages are not animated.

See `screenshots/preferences-home-light.png`, `preferences-home-dark.png`, `preferences-general-light.png`, the individual `preferences-*.png` panes, and `preferences-narrow.png`.
