# Spreadsheet interchange library decision

Selected **ExcelJS 4.4.0 (MIT)** for the implemented XLSX worksheet interchange, and **fflate 0.8.2 (MIT)** for package inspection, normalization and sparse XML metadata patches. Versions are pinned in `packages/spreadsheet-engine/package.json` and the workspace lockfile. Their license files remain in the installed packages. Spreadsheet calculation is a separate engine; ExcelJS does not calculate formulas.

ExcelJS exposes cells/formulas, styles, merges, table definitions, validation, notes, views and print settings. Its documented browser API and permissive license fit this repository. This is a feature selection, not an assumption of roundtrip fidelity: the tests found interoperability failures with independent openpyxl note paths and absolute relationship targets, and eager expansion of names/validation/merges. The adapter normalizes its parser copy and handles these range structures separately. ExcelJS also cannot preserve arbitrary chart/pivot/external-link packages; the native source archive and loss acknowledgement are deliberate requirements.

**SheetJS Community Edition** was considered. Its Apache 2.0 license is permissive, and its format coverage is useful, but the published distinction between CE and Pro puts several editing/style/chart workflows outside the free writer's claimed feature set. A paid Pro dependency was not assumed. **office-kit/xlsx** surfaced in discovery with broader claims; it was not selected without a pinned/reproduced browser, license and security evaluation. No compatibility credit is assigned to untested library claims.

Independent fixtures were generated using **openpyxl 3.1.5**, with **et-xmlfile 2.0.0**, installed only into a temporary verification directory. This is a test tool, not a production dependency. The tests compare actual exported package content and reopen with a different reader. They do not substitute for Microsoft Excel desktop opening, formula recalculation, or print fidelity testing.

Primary references consulted:

- [ExcelJS 4.4.0 source documentation](https://raw.githubusercontent.com/exceljs/exceljs/v4.4.0/README.md) — library API and limitations.
- [ExcelJS 4.4.0 MIT license](https://raw.githubusercontent.com/exceljs/exceljs/v4.4.0/LICENSE) — license fit.
- [SheetJS CE licensing](https://docs.sheetjs.com/docs/miscellany/license/) and [writer options](https://docs.sheetjs.com/docs/api/write-options/) — alternative evaluation.
- [Microsoft SpreadsheetML package structure](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document) — workbook/worksheet/table relationships.
- [Microsoft SpreadsheetML tables](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-tables) — table structure entry point.

Reproduce unit/interchange validation with `node --test tests/spreadsheet/io.test.ts`; this also writes the current `roundtrip-budget.xlsx`. Generate fixtures with `python3 tests/spreadsheet/fixtures/generate.py` in a Python environment containing openpyxl 3.1.5. Verify the generated roundtrip with `python3 tests/spreadsheet/fixtures/verify.py`. Run performance measurements with `node tests/spreadsheet/io-benchmark.mjs`. Browser recovery/worker checks are in `tests/spreadsheet/recovery.spec.ts` and need the Vite test harness.
