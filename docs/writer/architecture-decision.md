# ADR: Writer document engine and integration

Date: 2026-11-12. Status: implemented and exercised locally.

## Decision

Use **SuperDoc 2.30.0**, through `packages/document-engine/src/index.ts`, with a LopeOS-owned classic ribbon. The engine dependency is isolated in `packages/document-engine/package.json` and pinned by its package lock. ZIP creation and package inspection use **fflate 0.8.2** (MIT).

A generic contenteditable editor would require separate pagination, OOXML conversion, annotations, revision handling, and layout-aware selections. SuperDoc was evaluated with actual three-page, 55-row table, Unicode, missing-font, and 50-page DOCX fixtures before committing to its public API. The vertical slice edits across a page boundary, changes a named heading style, updates a TOC, exports a DOCX, reopens it, and checks visible text and structures. Tests are in `tests/writer`.

The selected package contains two separately licensed components:

| Component | Exact version | License / source |
|---|---|---|
| SuperDoc browser integration and UI | 2.30.0 | AGPL-3.0; [repository](https://github.com/superdoc/docx-editor), [licensing](https://docs.superdoc.dev/resources/license) |
| `@superdoc/docx-engine` | 0.29.0 | **Proprietary**, license dated 2026-07-14; [canonical terms](https://docs.superdoc.dev/resources/docx-engine-license), included `DOCX-ENGINE-LICENSE.md` and `NOTICE.md` |
| fflate | 0.8.2 | MIT, included LICENSE |
| Lucide icons | existing workspace dependency | ISC, existing application icon system |

The AGPL label on the top-level npm package does **not** describe the proprietary engine dependency. This is an integration powered by that dependency, using its documented public interfaces; it is not an independent replacement of the underlying engine. No proprietary engine source is incorporated into Writer source, no Microsoft font files are copied, no commercial license is purchased, and no project-wide relicensing is performed. Operating or distributing the integration requires an applicable licensing route for both SuperDoc components. No site was published or deployed by this task.

## Boundaries

| Responsibility | Owner |
|---|---|
| Authoritative semantic state | Engine-owned OOXML package and document API |
| Selection, text transactions, IME and history | Engine selection/input APIs; public selection captures, including opaque validation tokens |
| Layout | Engine page model, font metrics, sections, paragraph keeps, table fragmentation, headers and footers |
| Ribbon / dialogs / side panes | Scoped React components in `apps/web/src/apps/writer` |
| Command state | Public `superdoc.ui` state; disabled reasons and mixed values come from the selection |
| Import / export | Native DOCX bytes, without an HTML round trip |
| Files | Shared SDK `readBinary`, `writeBinary`, stat versions and invalidation subscription |
| Recovery | Local IndexedDB, keyed by shell window ID; versioned binary document snapshots |
| Printing / PDF | A second complete, non-virtualized layout from the exported DOCX; painted pages, CSSOM font rules and measured positions are reused in the print document |

The rendered editor DOM is a projection. Reading its page rectangles supplies visible-page status and print geometry; it never becomes the editing source of truth. Document zoom is independent of browser zoom. Printing uses named CSS pages with the engine's actual dimensions, including different sizes by section. Browser Print / Save as PDF is the export interface; the automated suite also creates a standalone PDF and extracts text from each page.

## Public API adaptation

The installed browser facade omits `invoke()` at runtime despite declaring it. The adapter resolves the documented public operation path with its owning object and checks the returned receipt. It does not reach into editor or worker internals. Public controller selection snapshots can lag an immediate keyboard command; dialogs take a fresh `selection.current()` capture and a bounded range preview. Comment creation checks the frozen endpoints and document revision, then passes a fresh opaque target unchanged. Stale captures fail without moving the anchor.

Section dimensions and margins use **inches**. Paragraph spacing/indentation/tab inputs use **twips**; named style sizes use half-points, while inline font controls use points. Conversion belongs at the adapter/UI boundary and is checked in exported XML. Paragraph dialog changes resolve every selected paragraph through the public range API. A single indentation operation uses its native setter; multiple properties or paragraphs use one batch transaction. Font, paragraph, style, table and picture dialogs write only the fields the user changed. Picture resize supplies both required dimensions, taking the untouched one from a fresh public image read.

## File safety and lifecycle

- `lope.writer` is registered through `shell/extensions.ts`; DOCX/DOTX associations, separate document windows, SDK global menus and per-window commands use the existing contract. The shared contract was sufficient; no new shell services were introduced.
- Save As is create-only first. Replacing an existing destination requires a concrete filename prompt and an optimistic version. A changed source blocks ordinary Save and offers Reload or Save a Copy.
- Saved revision advances only after the filesystem acknowledges a version. Edits made while export/save is in flight remain dirty. Interrupted writes retain the in-memory document; a later conflict cannot silently overwrite the server file.
- AutoSave writes named editable workspace documents after inactivity. Unsaved documents receive a recovery copy. Recovery status is distinct from a successful workspace save. IndexedDB writes and deletes are serialized. Busy save/recovery work is retried; session epochs prevent a discarded recovery export from reappearing.
- Save As updates metadata without replacing the editor, preserving selection and undo history. Session restoration follows the latest saved path, including after Save As; New clears the previous path.
- Before-close and browser-unload guards preserve dirty documents. Close prompts, dialogs and menus provide focus restoration and keyboard access. Subscriptions, timers, renderers and command registrations are released on unmount.
- Macro, embedded-object, unusual field, chart, SmartArt, imported-subdocument and protected-document cases receive compatibility messages. Risky sources offer read-only or copy workflows. Legacy/encrypted packages are refused with conversion guidance. Neither route overwrites the original.
- ZIP expansion and entry counts are checked before decompression. The package inspector accepts up to 32 MiB compressed / 128 MiB expanded; the **shared runtime currently limits transfers to 8 MiB**, which remains the effective workspace-save limit.

## Integration notes for the architecture owner

The only shell registration change is the Writer import and manifest entry in `extensions.ts`, alongside the other owners' extensions. Root package scripts and dependency inputs were left to their owner. A fresh checkout can install the isolated engine with `npm ci --prefix packages/document-engine --ignore-scripts`; the shared pnpm lockfile now also includes the engine workspace importer and pinned dependency graph. Keep the engine lazy-loaded: its production JS chunk is substantial. Telemetry is explicitly disabled and document content is not sent to a collaboration, AI, proofing or cloud service.

## Preferences and UI motion — 2026-11-13

`writer.preferences` uses the existing SDK settings namespace. AutoSave retains its established `writer.autosave` key. The Preferences surface reads the shared SDK system preference store for its theme and Reduce Motion; it does not maintain a competing panel-theme setting. Existing stored panel-theme fields are ignored.

View changes use the engine's public ruler, bookmark, formatting-mark and measurement-unit interfaces. Author updates use public `setUser`; new comments and revisions receive the new author. The editor remains mounted, preserving content and undo history. Centimeter dialog inputs convert back to inches/twips at the existing boundary. New pictures use the selected wrap mode through public image operations. Print preferences flow into the actual iframe HTML, including reverse order and drawing omission; existing TOCs can be refreshed before preview.

Optional AutoCorrect observes native keyboard/input gestures without cancelling input. It reads a short semantic range, applies a literal replacement with `expectedRevision`, and skips stale selections, paste gestures and composition. The document engine owns the replacement and history transaction. Matching public transaction IDs restore the known correction caret on Undo/Redo; this prevents continuation before the trailing space. The dictionary is local and bounded. Manual OS-level IME acceptance remains outstanding.

CSS transitions affect application surfaces. Closing surfaces remain mounted briefly before their existing close handler runs. Reduced-motion settings bypass the delay and disable UI motion. No animation is applied to the engine's document geometry or to printed pages.

## Feature and OS audit — 2026-11-13

Preferences also reads the shared OS text-size and contrast preferences. Its opaque surfaces are explicitly allowed by `docs/design-system.md`; larger text wraps and scrolls instead of scaling the dialog geometry. Search indexes the pane's option labels before the pane has mounted. AutoCorrect tabs and replacement lists use roving keyboard focus, and recovery interval drafts detect conflicting shared changes.

Page Break and Blank Page use public native OOXML insertion at the semantic caret, with one/two `w:br` page breaks in a single native history transaction. Tracked break insertion is not supported, so these commands require Editing mode. Paste/Symbol use public native text insertion, including selected-range replacement in Reviewing. Native receipt effects determine the resulting caret; the installed engine's tracked replacement receipt omits those effects, so its resolved semantic point plus documented literal UTF-16 length is used for that specific path. Native transaction IDs retain undo/redo caret endpoints in a bounded map. Public acknowledged viewport geometry supplies a host-scroll fallback when native navigation cannot scroll the host. No proprietary engine implementation was inspected or changed.
