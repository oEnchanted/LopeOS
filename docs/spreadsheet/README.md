# Sheets for LopeOS

Sheets is registered as `lope.sheets` in the LopeOS application launcher and Open With routing. Launch **Sheets**, start a blank workbook, or choose **File → Budget Example** for a deterministic workbook with formulas, validation, conditional formatting, a table, and a linked chart. The app uses the shared OS window, menus, file dialogs and glass chrome; the worksheet remains opaque.

This is a substantial local spreadsheet implementation, **not full Microsoft Excel compatibility**. The original full target remains in the [feature inventory](feature-inventory.md), including unresolved capabilities and their next dependencies. See the [release report](release-report.md) before trusting interchange or claiming parity.

## Working with files

- **Save / Save As** uses the LopeOS filesystem. `.lopebook` retains the complete native model and, for imports, the original XLSX package. Writes use file versions and atomic creation to avoid silently replacing concurrent work.
- **Import Local File** reads XLSX, CSV, TSV, or `.lopebook` from the browser. XLSX parsing/export and native serialization use cancellable local workers. CSV defaults to text; select explicit numeric columns to preserve identifiers and leading zeros elsewhere.
- **Export** downloads XLSX, native, CSV, or TSV. Known XLSX losses require confirmation. CSV/TSV exports one worksheet's displayed values; formulas and formatting are lost. See the [file compatibility matrix](file-compatibility.md).
- Local recovery stores current and previous snapshots in IndexedDB. It is separate from a saved workspace file. Storage failure is reported. Each window has a separate recovery key.
- **Print Preview** and **Print / Save PDF** use the same paginated HTML and shared chart renderer. [Sample budget PDF](sample-budget.pdf) demonstrates the output; it is not an independent Excel print comparison.

## Architecture

`packages/spreadsheet-engine/src/model.ts` defines the portable sparse typed schema with Excel coordinate bounds. `calculation.ts`, `formula-ast.ts`, and `references.ts` separate formula parsing, static dependencies, dirty propagation, cycles, spills, and reference transforms from the view. Calculation runs in a dedicated incremental worker. No formula is executed as JavaScript.

`analysis.ts` implements whole-record sorting, typed filtering, transforms, genuine pivot aggregation/drill-through, Goal Seek, and bounded constrained local optimization. Query steps are a local data model, not Power Query M or DAX. The numerical worker only commits a converged result to the unchanged originating revision.

`io.ts` bridges ExcelJS and a preflighted OOXML ZIP package to the model; `io-worker-client.ts` gives hard cancellation. `persistence.ts` commits recovery transactionally. `apps/web/src/apps/spreadsheet` contains the ribbon, virtual grid, dialogs, chart view, formula assistance, and print layout. Shared Word/Quill primitives were not modified.

The virtual grid compresses its physical scroll extent while retaining the logical 1,048,576 × 16,384 address space. Sparse widths/heights, frozen headers, range selection, pointer fill, clipboard operations, keyboard navigation, IME editing, semantic grid roles, and scoped focus are implemented. Browser and assistive technology coverage is documented separately from feature availability.

## Verification

Install the workspace with its pinned pnpm version and start the usual development server. Then run:

```sh
npm run check:sheets
npm run test:sheets
```

The Playwright configuration expects a running local server at `http://127.0.0.1:5173`; use `SHEET_TEST_URL` for another address. Tests use fictional data and mocked filesystem transport, and do not require remote accounts. The 100,000-row browser test creates its fixture on demand. Source edits must be paused during browser measurements because Vite reloads invalidate a run.

Additional reproducible checks:

```sh
node tests/spreadsheet/benchmark.mjs
node tests/spreadsheet/engine-benchmark.mjs
node tests/spreadsheet/io-benchmark.mjs
node tests/spreadsheet/print-capture.mjs
```

Independent XLSX fixtures were authored/read back with openpyxl; their generator and provenance live in `tests/spreadsheet/fixtures`. That is useful interoperability evidence, but not validation in an independent Microsoft Excel installation.

## Evidence

- [Pinned reference and unverified geometry](reference-baseline.md)
- [Full target inventory](feature-inventory.md)
- [Function compatibility registry](function-compatibility.json)
- [Analysis and print semantics](analysis-compatibility.md)
- [File compatibility and conversion limits](file-compatibility.md)
- [Dependency evaluation and licenses](library-decisions.md)
- [Independent XLSX readback results](independent-xlsx-results.json)
- [Engine benchmark](engine-benchmark.json), [analysis benchmark](benchmarks.json), [file benchmark](io-benchmark.json), [browser benchmark](browser-benchmark.json)
- [IO versions and fixture checksums](io-source-manifest.json)
- [Screenshots](screenshots/)

No publishing or deployment is included.
