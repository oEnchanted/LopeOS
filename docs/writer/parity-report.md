# Writer implementation and parity report

Date: 2026-11-13. Target: Microsoft Word for Microsoft 365 on Windows, English, classic ribbon, light appearance. This is a working LopeOS application with native DOCX editing; it is **not a claim of complete Microsoft Word parity**.

## Delivered

- `lope.writer`, document associations and separate windows, integrated through the existing SDK and global command registry.
- The complete baseline tab order; compact Home groups, split controls, palettes, expanded style gallery, contextual table/picture tabs, command search, ribbon collapse and narrow-window group expansion.
- Engine-owned document state, editing transactions, selection and pagination; native DOCX import/export and body Unicode word count.
- Text/run formatting, paragraph settings and styles; lists; heading navigation and search/replace; tables and pictures; links, notes, headers/footers, page fields and updateable TOCs.
- Anchored comments with replies and resolution, separate native tracked revisions, display projections and accept/reject controls.
- Shared-filesystem save/open, optimistic versions, conflict and overwrite prompts, recovery snapshots, autosave, recent-file/session restoration and close guards.
- Complete print layout using the same engine, copied measured pages and dynamic font rules. Browser Save as PDF and a standalone verified sample PDF.
- Original regression DOCX fixtures, controlled screenshots, measured rectangles and an interactive side-by-side/opacity-overlay artifact.

## Second review

The second pass reproduces failures before fixing them, and checks the resulting DOCX content rather than relying on visual appearance alone. `tests/writer/second-pass.spec.ts` covers:

- Continuing to type at the caret after Save and after a formatting dialog.
- Changing font size while preserving existing color and strikethrough.
- Centering multiple selected paragraphs while retaining their 1.5 line spacing.
- Preparing a new File > Print preview after document edits.
- Holding a formatting dialog open until an asynchronous operation settles, including Escape handling.
- Keeping Navigation and Comments open together, keyboard resizing, and reopening a collapsed ribbon by choosing a tab.
- Displaying actual search snippets and replacing the clicked occurrence.
- Retrying AutoSave for edits made while another save is pending.
- Switching between two pictures with different dimensions, then changing only the selected picture’s height.
- Preserving selected hyperlink display text.
- Keeping a compatibility document read-only across review/view controls.
- Preserving focus in Navigation when a slow manual save finishes while the user is searching.

The UI pass refines dialog spacing and initial focus, fixes the font preview’s fallback family, adds pointer/keyboard pane resizing, improves comment cards and filters, and adds real search snippets. Menus support arrow-key opening and navigation, Escape and focus exit. Page spacing now contributes to the scroll layout. Print preview shows preparation and errors, refreshes its bytes on entry, and keeps the print frame alive through the print dialog. These changes retain the measured Home ribbon geometry.

## Preferences and animations

The Preferences window retains the user-supplied Word for Mac organization: all 16 categories, grouped icons, individual panes, search, back/forward and Show All. After feedback about its size, it now uses a compact **800×600** utility layout with a 62-pixel toolbar, 13/14-pixel labels/forms, smaller flat icon tiles and a single close action. All categories fit at normal text size, and explicit category colors prevent unreadable light-theme labels. It opens from the Writer menu, gear, File > Options and Ctrl/⌘ comma. **Its appearance follows LopeOS Light/Dark/System live**, independently of the document editor’s Office theme.

Supported preferences persist and apply through the SDK: author identity, measurement units, rulers, bookmarks and formatting marks; editor appearance, comment cards, scrollbars and group labels; AutoSave and recovery timing; literal AutoCorrect replacements; new-picture wrapping; print order, drawing objects, page backgrounds, existing TOC refresh and review display. Changing preferences does not replace the editor or undo history.

Finite transitions cover ribbon content, active tabs, menus, panes, dialogs, Backstage and Preferences. Application animations, LopeOS Reduce Motion and the device preference are combined. The document geometry and printed pages remain outside these transitions. Animation timings are not certified against a native Word recording.

The nine scenarios in `preferences.spec.ts` verify live system/device themes; grid/history/search and menu/shortcut access; persistent units and intact editing history; new comment authors in DOCX; AutoCorrect through Undo/Redo and continued typing; reduced motion; AutoSave/recovery controls; picture wrapping and reversed print/PDF output; and typing immediately as closing animations begin. The shell test additionally opens the global Preferences menu.

Spelling/grammar services, AI alt text, custom revision-rendering styles, VBA, AutoText and the additional East Asian authoring tools are unavailable and have disabled controls with reasons. Recovery uses browser storage; only Documents has an editable suggested Save As path. Update Fields refreshes existing TOCs; it is not a general external-field refresh service.

## Feature and OS audit

The [Word feature audit](word-feature-audit.md) compares complete feature families with Microsoft's desktop inventory. It explicitly separates tested subsets, wired but unverified variants and unavailable workflows. Full Microsoft Word parity is not present.

This audit corrects caret Page Break and Blank Page insertion, native undo/redo selection restoration, One Page fitting in both viewport dimensions, orientation-preserving paper sizes, asymmetric margin presets, superscript/subscript toggles, live/mixed Layout values and right paragraph indents. Viewing disables formatting mutations. Opening a file makes the previous editor inert until the new document is ready; failed reads restore typing in the original document. Ribbon Paste and Symbol insertion leave the caret after the inserted content. Clipboard reads use the fresh complete native selection, and mutations reject a document that changed during clipboard access.

Preferences now searches actual option labels, supports roving keyboard focus in AutoCorrect tabs and replacement lists, preserves conflicting recovery-interval drafts across shared updates and reports the 200-rule replacement limit. It follows OS text scaling and increased contrast with visible control/focus borders. Light/Dark/System, reduced motion and shared persistence remain live. Opaque reading surfaces comply with the explicit Writer exception in `docs/design-system.md`; the outer window remains shell-owned glass. These checks do not certify every accessibility or native Word interaction.

## Verification

**62 distinct browser scenarios and 5 package unit tests passed**. The initial combined run passed 59 scenarios; its two shell-based scenarios could not load while an unrelated shared Accounts module was missing. Both passed on a targeted rerun after that module became available. Following the compact redesign, all **15 affected Preferences scenarios passed in one clean run**, including the new real-shell dimensions and category-contrast check. An earlier recheck saw one native paragraph transaction reject a revision change; that workflow then passed three repeats and the clean suite. Coverage includes nine Preferences scenarios, 26 adapter/ribbon/settings/file/document audit scenarios, 12 second-pass regressions and the original editing, engine and shell scenarios. `npm run build` and the final production smoke passed. The production smoke checks native editing, bold formatting, SDK Save acknowledgment, saved OOXML and live system-theme changes in Preferences. The machine-readable result records the runs separately in `verification.json`; production evidence is in `production-verification.json`. Browser scenarios use real Chromium and the real document adapter. File scenarios use the production runtime client against the **test-only binary filesystem contract** in `tests/writer/runtime.ts`; they do not certify deployment of a live workspace service or cloud account synchronization. The production smoke explicitly chooses the workspace root because the SDK now opens Save in browser-backed LopeDrive by default.

| Required workflow | Evidence |
|---|---|
| Edit across a page boundary and undo/redo | E1: semantic text equality before, after undo, and after redo across an explicit page break |
| Apply/modify heading and update TOC | E1: named style changes, native TOC field, DOCX export and reopen assertions |
| Edit a table across pages | E3: 55-row fixture, cell edit, row insertion, repeated-header structure retained |
| Insert an image and change wrapping | E4: native media part, square wrapping, resize and crop receipts plus XML assertions |
| Comments and tracked changes | E2/U4: validated anchors, reply, resolve/reopen; accept/reject replacement; hidden markup retains the revision inventory |
| Save and reload semantic structure | E1/U1: DOCX reload, text, formatting and TOC; Save As path restoration |
| PDF pagination/content | U5: three engine pages produce three PDF pages; extracted text on each page matches the corresponding chapter |
| Missing fonts / external change / interrupted save | U6/U2: visible font warning alongside save state; original remote version preserved; failed acknowledgment retains dirty state |
| Recovery and autosave | U1/U7: IndexedDB recovery across reload, close cancellation, version acknowledgment without replacing undo history |
| Representative 50-page document | E5: 50 explicit pages, deep semantic selection, final-page edit and navigation, selection retained |
| LopeOS integration | S1: real shell window, global Writer > Preferences and Format > Font commands, dirty close guard |
| Pending review / opaque metadata preservation | E7: unresolved comment, pending insertion/deletion and custom XML retained after DOCX export and reopen |
| Preferences and motion | W: live Light/Dark/System, persistent controls, author XML, AutoCorrect continuation, picture wrapping and reverse-order PDF |
| Feature and OS audit | A: native caret breaks, page fit, margins, right indent, mode guards, complete clipboard selection, insertion/history continuation, opening barriers, option search, AutoCorrect keyboard controls, shared drafts and OS text/contrast |
| Package integrity and compatibility gates | P: original OOXML generation, Unicode count, legacy/malformed refusal, opaque-object warning and bounded ZIP expansion |

Nine fixture packages also passed ZIP CRC, XML parsing and internal relationship-target checks; see `package-validation.json`. This is structural validation, not a full ECMA schema validation.

The 50-page fixture has a heading and repeated body paragraph per page. It is not a stress corpus of 50 pages of drawings, nested tables, notes and mixed sections. Manual OS-level IME, assistive-technology, drag-handle, rich clipboard and complex bidirectional interaction testing remain outstanding. No frame-rate or broad document-performance guarantee is made.

## Visual comparison

Preferences captures include `preferences-home-light.png`, `preferences-home-dark.png`, `preferences-general-light.png`, all supplied category panes, `preferences-narrow.png`, and Light/Dark at 150% OS text with increased contrast. See the reference-baseline addendum for their platform and scaling limits.

Open [visual-comparison.html](visual-comparison.html) for the official Home screenshot crop next to Writer, and an adjustable overlay. Microsoft imagery is referenced remotely and is not an application asset. `visual-measurements.json` contains actual browser rectangles.

| Alignment | Official screenshot estimate | Writer CSS px |
|---|---:|---:|
| Command region height | ~48 | 48 |
| Tab row height | ~32 | 32 |
| Ribbon height | ~101 | 101 |
| Clipboard group start | ~13 | 14 |
| Font group start | ~93 | 94 |
| Paragraph group start | ~403 | 404 |
| Styles group start | ~657 | 658 |
| Editing group start | ~1026 | 1028 |
| Letter page width | ~816 | 816 |
| Blank page left / top | ~275 / ~205 | 275 / 205 |

Reference values are measurements inferred from an official composite image, not calibrated Windows CSS pixels. Its build number, scaling and complete document are unknown. Several principal Home alignments are within about two pixels of those estimates, but **the requested two-pixel criterion is not certified across the interface**. Lucide command artwork, fallback UI fonts, account identity and unavailable services differ from Word. Other tabs, panes, dialogs, contextual ribbons and Backstage are reconstructed from documented behavior; matched native reference screenshots were not available for them.

Captured states:

- `home-blank.png`, `home-selection.png`.
- `tab-insert.png`, `tab-layout.png`, `tab-references.png`, `tab-review.png`, `tab-view.png`, and the remaining baseline tabs.
- `table.png`, `picture.png`, `navigation.png`, `comments.png`, `review.png`, `panes-together.png`.
- `font.png`, `paragraph.png`, `backstage.png`, `print.png`.
- `narrow.png`, `narrow-expanded.png`, `lopeos-integration.png`, `production.png`, `fifty-pages.png`.

The controlled internal viewport is 1366×900, device scale 1, browser zoom 100%, document zoom 100%. The narrow capture is 820×900; the shell capture is 1440×1000. The primary blank reference has its ruler hidden. The View ruler is a real, separately tested control.

## Native office validation

**Windows Word: not performed.** No authorized running Windows copy or connected Word document session was available.

**Mac Word: attempted, not validated.** An installed Word 16.115 copy was asked to open only the generated `roundtrip.docx`, read its text and close that fixture without saving. The AppleEvent timed out. No native Word rendering or successful native reopen is claimed. Browser/OOXML/PDF checks are reported separately from native office validation; no LibreOffice validation is claimed.

## Exact remaining limitations

1. Draw/ink, full themes, WordArt/text-box creation, charts/SmartArt authoring, mail merge, citation management, indexes, comparison and protection authoring remain unavailable. Their tab/group positions remain visible with accurate disabled states. Research, cloud collaboration, AI, proofing, dictation, add-ins and account sharing have no connected provider.
2. Font/size pickers use compact native selects. Tooltips, live gallery hover previews, full Office theme palettes, every split-button variant, full KeyTips, and all responsive collapse thresholds do not reproduce native Word behavior exactly. Context menus are supplied by the engine. Font and Paragraph dialogs cover a useful subset of their native equivalents. Some contextual-tab enable/disable transitions follow the current command context rather than the complete native Word state machine.
3. Paragraph dialog changes apply to all paragraph blocks covered by the captured selection, in a single transaction. Only changed fields are written. The dialog reads the first paragraph’s settings; it does not fully display every mixed paragraph property. Character styles are limited to the supplied Emphasis command. Detailed style creation, linked-style relationships and all outline numbering templates are not exposed.
4. Navigation can remain open alongside Comments, Styles or Revisions. At narrow widths, the right pane overlays the workspace. Search snippets and navigation headings are bounded to 1,000 entries; Select All's directory read is bounded to 20,000 top-level blocks. Repeated page thumbnails are schematic navigation controls, not miniature page renderings.
5. Table properties expose column width, first-row repeat, simple shading and border controls. Complex border styles, every row option and arbitrary nested-table layout have not received full parity validation. Individual merge/split/column/delete variants are real engine commands but remain marked **Exposed**, rather than individually certified, in the inventory.
6. Picture properties provide an explicit picture chooser, size, symmetric crop, inline/square/top-and-bottom wrapping and floating-anchor lock. They do not provide Word's full crop handles, arbitrary per-edge crop form, tight/through wrapping UI or complete position/anchor dialog.
7. Header/footer text authoring targets the first section and appends to existing content. Page setup controls apply to all sections; only Letter/A4, portrait/landscape, standard/custom margins and one-to-three equal columns are exposed. Page Break and Blank Page use native caret breaks in Editing mode; tracked break insertion is unsupported by the installed engine. The complete break gallery and per-section editing UI remain incomplete.
8. Word count covers body text; the native Word Count dialog's complete text-box/note inclusion controls are not reproduced. Spell/grammar and language services are unavailable. Fonts are requested by logical name, substitutions are reported, and no Microsoft font is bundled. Different available fonts can change wrapping and pagination.
9. Macro execution, encrypted packages, legacy DOC conversion and embedded-object editing are unsupported. Risky input offers read-only/copy routes, and originals cannot be overwritten through that conversion route. Opaque package preservation beyond the exercised parts remains an engine compatibility boundary, not a universal lossless-round-trip guarantee.
10. Workspace transfer limits remain 8 MiB. Recovery depends on this browser's IndexedDB and cannot recover keystrokes committed after the last completed snapshot. A cleared browser profile removes local recovery data. Existing-file conflicts need Reload or Save As; there is no merge editor.
11. PDF export uses browser printing. Three-page content/pagination is verified; font embedding, printer drivers, every mixed-section case and large-document print resource usage are not certified. The complete print renderer consumes more memory than the virtualized editor.
12. SuperDoc's production engine is a substantial lazy-loaded dependency. Its top-level UI is AGPL-3.0 and its DOCX Engine 0.29.0 has a separate proprietary license. See [the architecture decision](architecture-decision.md) before selecting a distribution/deployment route. This task did not publish or deploy the application.

The [feature inventory](feature-inventory.md) distinguishes working tested workflows, real exposed commands and unavailable controls, so unverified variants are not presented as complete parity.
