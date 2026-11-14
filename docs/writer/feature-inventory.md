# Writer feature inventory

Status: **tested** means an automated behavior or output assertion exists. **Exposed** means a real public document operation is wired, but that exact variant has not received an individual regression assertion. **Unavailable** controls are disabled and explain the reason. `Mod` is Ctrl on Windows and Command on macOS; browser-reserved shortcuts have visible ribbon/global-menu alternatives.

Test keys: **E1** page-boundary/style/TOC round trip; **E2** comments/replies/revisions; **E3** spanning table; **E4** images; **E5** 50 pages; **E6** paragraph/page setup/link/footnote/header/field structures; **E7** pending review/custom-XML round trip; **U1** editing/save/reload/recovery/close; **U2** conflict/interrupted save; **U3** compatibility; **U4** dialogs/comments/search; **U5** PDF; **U6** fonts/ruler; **U7** named AutoSave; **S1** real-shell integration; **R** second-pass UI and async regression scenarios; **W** Preferences/system-theme/motion and output scenarios; **A** the adapter, ribbon, settings, file and document audit suites. These are named tests in `tests/writer/*.spec.ts`. **P** is `package.test.ts`. Visual captures are in `screenshots/`. See the broader [Word feature audit](word-feature-audit.md) for missing feature families.

| Command / feature | Location | Operation / enabled condition | Shortcut | Status / coverage |
|---|---|---|---|---|
| Preferences | Writer menu; gear; File > Options | Category grid, search, back/forward, immediate SDK persistence | Mod+, | W; light/dark/narrow captures |
| Settings appearance | Preferences | Live LopeOS Light/Dark/System, text size and increased contrast; opaque content treatment | — | W/A, light/dark/150% contrast captures |
| Interface animations | Ribbon, menus, panes, dialogs, Preferences | Finite UI transitions; app, LopeOS and device reduced-motion controls | — | W |
| Author information | Preferences > User Information | New comment/revision author; contact profile stored locally | — | W, comments.xml author verified |
| AutoCorrect | Preferences > AutoCorrect | Local literal replacements after typed word boundary; native undo/redo | Mod+Z / Redo | W, DOCX continuation verified |
| Print settings | Preferences > Print | Reverse pages, drawing objects, page background, existing TOC refresh, review display | — | W, actual iframe and three-page PDF verified |
| New | File > New; global File | Guard dirty state, create native blank DOCX | Mod+N | Tested U1 (guard); exposed New workflow |
| Open | File > Open; global File | SDK file dialog; binary DOCX preflight; previous editor inert during read; failed read restores editing | Mod+O | Tested U1–U3/A |
| Save | Quick Access; File; global File | Binary optimistic write after engine ready | Mod+S | Tested U1/U2/R (caret restoration) |
| Save As | File > Save As; global File | Create-only or confirmed versioned replacement | Mod+Shift+S | Tested U1–U3 |
| Recent documents | File > Home/Open | Reopen SDK path; latest saved path is restored | — | Tested U1; list visually captured |
| AutoSave / recovery | Command area / recovery banner | Named file autosave; IndexedDB for dirty documents | — | Tested U1/U7/R (retry while saving) |
| Export DOCX | File > Export | Native review-preserving package download | — | Engine export tested E1–E7 |
| Print / PDF | File > Print/Export; global File | Complete page layout, named page sizes, browser dialog | Mod+P | Tested U5/R, page count/text and fresh preview |
| Undo / redo | Quick Access; global Edit | Engine history state | Mod+Z, Mod+Shift+Z / Ctrl+Y (engine) | Tested E1/U1 |
| Cut / copy / paste | Home > Clipboard; global Edit | Browser clipboard permission; fresh complete selection; text transfer; guarded document version | Mod+X/C/V | A, long-selection Copy/Cut, Cut undo, Paste continuation; native rich clipboard not separately exercised |
| Paste options | Home > Clipboard split button | Paste Text / clipboard information | — | Exposed |
| Format Painter | Home > Clipboard | Engine format-copy mode, valid selection | — | Exposed; persistent mode not individually tested |
| Font family / size | Home > Font; Font dialog | Live selection/pending typing format; Mixed when nonuniform | Mod+D opens Font | Size/selection/save tested U1/R; untouched color/strike retained; family exposed |
| Bold / italic / underline | Home > Font; global Format | Selection-aware inline marks / pending format | Mod+B/I/U (engine) | Bold tested U1; other marks exposed |
| Underline variants | Home > Font split button | Single/double/dotted/dash on selected text | — | Exposed |
| Strikethrough / super/subscript | Home > Font | Native run properties; super/subscript toggles back to baseline | — | Super/subscript DOCX and undo A; strikethrough exposed |
| Font color / highlight | Home > Font palettes | Native color/highlight; retain model selection | — | Exposed, palettes captured |
| Clear formatting | Home > Font | Inline reset | Mod+Space (engine permitting) | Exposed; inline formatting only |
| Change Case | Home > Font | Disabled: formatting-preserving complete-range conversion unavailable | — | Unavailable; explicit state verified A |
| Alignment | Home > Paragraph; Paragraph dialog | Left/center/right/justify, selected paragraphs | Mod+L/E/R/J (engine) | Batch and selected-paragraph preservation tested E6/R |
| Spacing / indents / tabs | Home > Paragraph; Layout; Paragraph dialog | Unit conversions; spacing, left/right indent and tab stop; live/mixed Layout values | — | Structure E6; dialog UI U4/A; saved right indent A |
| Keeps / widow-orphan / page break before | Paragraph > Line and Page Breaks | Native paragraph keep/flow properties | — | E6; manual variants exposed |
| Paragraph borders / shading | Paragraph dialog | Bottom border and color presets | — | Exposed; detailed border editor not implemented |
| Bullets / numbering / list levels | Home > Paragraph split menus | Native lists; increase/decrease nesting | Mod+Shift+L (engine permitting) | Exposed |
| Paragraph styles | Home gallery / Styles pane | Normal, No Spacing, Heading 1–3, Title | Mod+Alt+1/2/3 (engine permitting) | E1; gallery/pane captured |
| Modify style | Home > More styles > Modify | Native style run definition, affects linked paragraphs | — | Definition/TOC tested E1 |
| Character style | Home > More styles > Emphasis | Native `w:rStyle` on selected runs | — | Exposed |
| Update style from selection | Styles pane | Public style-update operation | — | Exposed |
| Find / replace | Home > Editing; Navigation | Engine search, match case, next/previous, one/all replacements | Mod+F/H | Search U4/R; clicked occurrence replacement R; Replace All exposed |
| Select All | Home > Editing > Select | Semantic start/end selection through public API | Mod+A (engine) | Native keyboard selection U1; menu exposed |
| Navigation headings / pages | View > Navigation Pane; status bar | Model heading directory, bounded reveal; page navigation | F6 region cycle | Captured; deep selection/navigation E5 |
| Independent panes | Navigation on left; Styles/Comments/Revisions on right | Pointer/keyboard resize; right pane overlays at narrow sizes | Arrow keys on separator | Tested R; panes-together.png |
| Formatting marks | Home > Paragraph; global View | Engine formatting-mark visibility | Mod+Shift+8 | Exposed |
| Word count / language | Status; Review | Unicode body word count; language/provider availability | — | P; U1/U6 |
| Table insertion | Insert > Table | Native table after current block, 1–20 columns / 1–100 rows | — | Captured; model table edits E3 |
| Editable cells / row & column operations | Table Layout | Current table/cell context; insert/delete row/column/table | Tab in editor | Cell + row operation and spanning output tested E3; other variants exposed |
| Merge / split | Table Layout > Merge | Valid cell range or current cell | — | Exposed |
| Width / shading / borders / repeat header | Table Properties / Table Design | Native table/cell operations and first-row repeat | — | Repeated header preserved E3; authoring variants exposed |
| Table resizing | Document contextual overlay | Engine drag handles | — | Provided by engine; manual drag not separately verified |
| Picture insertion / file drop | Insert > Pictures; document drop | PNG/JPEG/WebP/GIF up to 8 MiB; natural proportions; native media part; canonical inserted ID | — | Image action/pointer suites; saved XML and undo |
| Picture selection / resizing | Document; Picture Format | Clicked canonical picture; native eight handles; proportional corner resize at document zoom | — | Inline/floating pointer tests at 100/150%; DOCX dimensions and undo |
| Picture movement / layout | Document; nearby Layout Options; Picture Format | Inline text caret/reanchor; floating drag, edge scroll, cross-page placement; five wrap/layer choices; precise page position | Arrows nudge; Shift coarse / axis; Esc cancels | Image action/pointer suites; physical geometry, saved positions and history |
| Picture crop / alt text | Picture Format; Properties | Per-edge/corner crop; correct percentages; reset; preserved untouched properties; native alt description | Enter applies / Esc cancels crop | Image suites; pixel checks, XML, undo, print clone; anchor lock remains exposed |
| Hyperlink | Insert > Link; global Insert | Native relationship; http/https/mailto validation | Mod+K | E6 |
| Symbol | Insert > Symbols | Native literal text insertion/replacement with caret continuation and history | — | A, UI continuation and native Editing/Reviewing insertion/replacement |
| Headers / footers | Insert > Header & Footer | Append text in first section, retain existing content | — | E6; append dialog exposed |
| Page numbers | Insert > Page Number | Live PAGE fields; top-right/bottom-center or removal | — | E6 |
| Footnotes / endnotes | References > Footnotes | Native note part and reference at collapsed caret | — | Footnote E6; endnote exposed |
| Table of contents | References > Table of Contents / Update Table | Heading-driven native field; insert/update existing | — | E1 |
| Margins / orientation / size / columns | Layout > Page Setup | All sections; per-edge margin presets; Letter/A4 preserving orientation; 1–3 columns | — | Margins E6/A; landscape/A4 A; columns exposed |
| Page Break / Blank Page | Insert > Pages; Layout > Breaks | One/two native page breaks at caret; native history; Editing mode required | — | A, pagination/XML/continued typing/round trip |
| Section breaks | Layout > Breaks | New next-page/continuous section | — | Exposed |
| Comments | Review > New Comment / Comments | Frozen validated anchor, reply, resolve/reopen | Mod+Alt+M | E2/U4 |
| Track Changes | Review > Tracking; global Review | Suggesting mode, native insert/delete/format revision structures | Mod+Shift+E | E2; native typing/capture screenshot |
| Display for Review | Review > Tracking | Review/final/original projection; data retained | — | E2 verifies unchanged revision inventory when hidden |
| Accept / reject | Review > Changes / Reviewing pane | Selected revision, explicit queue row, or all | — | Selected accept/reject E2; all variants exposed |
| Ruler | View > Show | Live margin ruler; off in primary blank reference | — | U6 |
| Document zoom / fit width / One Page | View; status bar | Engine zoom; One Page fits both available viewport dimensions | — | One Page A, multiple viewports and zooms; other controls exposed |
| Read Mode / Print Layout | View; status bar | Actual viewing/editing state; character changes disabled while viewing | — | A, active state and formatting dialog guards |
| Ribbon collapse / keyboard tabs / search | Ribbon; command area | Collapsed groups below 920px; roving tab focus; command search | Mod+F1; F6; Alt+Q | Narrow screenshots; collapse/reopen and pane resizing tested R |
| Backstage | File | Home/New/Open/Info/Save/Save As/Print/Export/Account/Options | Esc returns | Captured; file workflows tested U1–U5 |
| Connected features | Share/account, Voice, Editor, Research, add-ins | Accurate unavailable state without an integration | — | Disabled or availability dialog; captured |
| Draw / themes / mail merge / citations / compare / protection authoring | Their original tabs/groups | Layout retained, availability reason supplied | — | Unavailable; no simulated success |

Remaining detailed behaviors, compatibility boundaries and evidence are in `parity-report.md`.
