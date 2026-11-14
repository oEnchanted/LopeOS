# Sheets feature inventory

This inventory retains the full requested target. **Implemented** means a concrete code path and local tests exist; **partial** means a useful subset exists; **unresolved** means the dependency or semantics below are still missing. Neither a visible tab nor a library's advertised function count establishes full Excel compatibility. See `reference-baseline.md`, `analysis-compatibility.md`, the calculation registry and the file compatibility report for evidence boundaries.

| Target | Status | Evidence / remaining dependency |
| --- | --- | --- |
| Sparse typed workbook, Excel coordinate limits | Implemented | `model.ts`; cells use sparse A1 keys, not a full worksheet allocation. |
| Multiple sheets/workbooks and model/view separation | Implemented | Portable workbook/sheet identities; independent engine instance per window. |
| Native persistence, recovery and file interchange | Partial | Dedicated IO/persistence implementation and tests; see file-compatibility matrix for preservation limits. |
| Virtualized grid, active cell and range editing | Partial | `Grid.tsx`; browser interaction/a11y evidence belongs to app verification. |
| Title, save state, quick access, file operations | Implemented | App ribbon/document bar and workspace filesystem integration. |
| Reference standard ribbon tabs | Partial | Home/Insert/Page Layout/Formulas/Data/Review/View/Help; complete per-build command inventory and exact geometry remain open. |
| Ribbon collapse/overflow | Partial | App has explicit collapse and scoped overflow; native adaptive group breakpoints unverified. |
| Table/chart/pivot contextual ribbons | Partial | Context-dependent controls; full native groups/dialog coverage incomplete. |
| Picture contextual ribbon | Unresolved | Requires a supported drawing/picture editor and file-preservation model. |
| Formula bar/name box/commit/cancel/autocomplete | Partial | App editing workflow, shared reference-color outlines and signature/autocomplete helper; complete native IME/access-key behavior remains open. |
| Arrow/Tab/Enter/range/clipboard/fill | Partial | Grid interaction implementation; full browser/IME/assistive-tech matrix incomplete. |
| Row/column select, multi-range, autoscroll/context menus | Partial | Track exact browser test coverage; never infer from the grid visual alone. |
| Freeze panes/zoom/gridlines/status aggregates | Partial | App controls and model; split panes and native page views incomplete. |
| Sheet create/rename/copy/reorder/delete/hide/tab colors | Partial | App sheet workflows; cross-workbook sheet movement and all reference rewrites need validation. |
| Tokenization/parser/dependencies/worker recalculation | Partial | Dedicated calculation implementation; consult function/semantics report for unsupported grammar and performance limits. |
| Absolute/mixed/cross-sheet/structured/named references | Partial | Supported subset in reference/calculation modules; union/intersection/R1C1/legacy array compatibility must be separately established. |
| Copy/fill/insert/delete/rename reference transforms | Partial | Dedicated reference helpers and tests; complex move/sort/import combinations need differential tests. |
| Automatic/manual calculation and errors | Partial | Explicit calculation modes and errors; imported cached-value policies need compatibility report. |
| Iterative circular calculation | Unresolved | Requires configured convergence semantics and cycle-group numerical tests. |
| Dynamic arrays, spills, LET/LAMBDA | Partial | Function registry determines exact available subset; do not equate library availability to reference-version completeness. |
| Excel coercion/precision/date systems/locale | Partial | Typed values and date arithmetic; all coercion/format/locale cases need differential validation. |
| External links and queries | Partial | Preserve/report where IO supports them; automatic remote refresh absent. |
| Fonts/fill/borders/alignment/wrap/merge/sizing | Partial | Cell style model, app controls, file bridge; native theme/style/number-format completeness unresolved. |
| Conditional formatting | Partial | Rule model and app subset; icon sets, full relative formula semantics and print matching unresolved. |
| Validation | Partial | Types and app editing constraints; custom formulas, paste consistency and all Excel operator edge cases need tests. |
| Tables/structured references/styles/totals | Partial | Table model and app context; full auto-expansion/filter/export semantics need tests. |
| Stable multi-key full-record sorting | Implemented | `analysis.ts`, identity/formula/style tests. Native custom/color/icon sort unresolved. |
| Typed filters/blanks/errors/search | Partial | Engine implements conditions; compound filter UI and native calendar/top-ten workflows incomplete. |
| Duplicate removal/text-to-columns | Implemented | Complete-record dedup and quoted delimiter parsing; fixed-width/locale inference unresolved. |
| Group/outlines/subtotals | Partial | Row/column outline model and pivot subtotals; full native outline UI unresolved. |
| CSV typing/leading-zero identifiers | Implemented subset | Text splitting and typed data pipeline preserve strings; IO encoding/delimiter controls covered separately. |
| Genuine pivot aggregation/refresh/drill-through | Implemented engine; partial UI | Multi-dimensional cells, numeric aggregations, source row identity, totals and refresh tests; richer field list/design/native cache interoperability unresolved. |
| Pivot grouping/show-values-as | Partial | Numeric/ISO date groups and percent row/column/grand total; running/rank/difference modes unresolved. |
| PivotCharts | Partial | Can chart generated pivot output; dedicated persisted linkage and full native refresh/cache behavior needs implementation. |
| Slicers/timelines | Unresolved | Requires persisted filter selection model, UI and OOXML support. |
| Column/bar/line/area/scatter/pie/doughnut | Partial | Linked chart rendering and editing in app; axes/styles/labels/missing data/native relationship fidelity incomplete. |
| Combo/secondary axes/additional chart families | Unresolved | Requires chart model, rendering, dialogs and tested OOXML interchange. |
| Goal Seek | Implemented | Bounded residual-tested algorithm with explicit failure. |
| Practical constrained Solver | Implemented engine; partial UI | Bounded local search; no native Excel algorithm claim or proof of global optimum. |
| Data tables/scenarios | Unresolved | Requires persisted what-if model, recalc integration and UI. |
| Local Get & Transform steps | Implemented engine; partial UI | Typed deterministic transformations, joins/append/group/pivot/unpivot and error history. |
| Power Query M / DAX / Data Model / Power Pivot | Unresolved | No compatible runtime or model exists; not claimed. |
| Notes/hyperlinks/protection/undo | Partial | App editing model; worksheet protection is not encryption; structural undo limits documented separately. |
| Threaded comments/coauthoring/presence | Unresolved | Requires authenticated identities, concurrency, permissions and durable backend; no decorative substitute. |
| Macro/VBA/XLM/Office Scripts/Python/add-ins/COM | Unresolved | Imported code never auto-executes; preservation and loss warnings covered by file bridge. |
| XLSX/XLSM/XLSB/XLS/ODS/CSV/TSV/PDF | Varies by format/direction | Consult file matrix; unsupported formats must reject or explicitly warn. |
| Print areas/titles/breaks/margins/orientation/paper/fit | Implemented subset | Deterministic bounded pagination and shared preview/print HTML tests. |
| Chart/drawing/conditional-format print fidelity | Partial | Chart view and print share SVG and placement-aware page clipping; pictures, conditional-format print rendering and independent Excel/PDF matching remain unresolved. |
| Bounded parsing/export/cancellation | Partial | IO bounds/worker paths; synchronous analysis has checkpoints but needs worker scheduling for responsive cancellation. |
| 100,000-row analytics performance | Measured engine subset | Repeatable benchmark records actual host; browser scroll/edit/import/export memory measurements tracked separately. |
| Semantic grid/keyboard/screen readers/contrast/motion | Partial | Semantic app controls and shared material fallback; full assistive-tech audit unresolved. |
| Exact build screenshots and visual audit | Unresolved | No exact-build Windows installation/captures supplied; geometry explicitly UNVERIFIED. |
| Independent Excel round-trip and formula differential tests | Unresolved | Requires an independent pinned Excel installation or trusted externally produced corpus, beyond local self-round-trips. |

## Release condition

This implementation must be described as a substantial local spreadsheet application with recorded compatibility limits. It is **not full Excel parity**. Open rows remain part of the target and should not be deleted to make a release appear complete. No publication or deployment is part of this work.
