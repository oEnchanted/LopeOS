# Spreadsheet file compatibility

This is an implementation matrix for LopeOS Sheets, not a claim of Excel equivalence. The native `.lopebook` JSON format is the lossless editable format for features modeled by this application. XLSX is a separately tested interchange format. Validation results are in `independent-xlsx-results.json`, generated using openpyxl 3.1.5; no installed Microsoft Excel was available for application-level roundtrip verification.

| Format | Import | Export | Behavior and remaining work |
| --- | --- | --- | --- |
| LopeOS native workbook JSON | Yes | Yes | Versioned sparse typed workbook, migrations from early v0, all model fields, and the exact original imported XLSX/XLSM package retained as inert base64. Rejects unsupported versions and invalid typed cells. |
| XLSX, unencrypted Transitional OOXML | Yes | Yes | ExcelJS 4.4.0 plus bounded package preflight, sparse names/validation/merge handling, relationship normalization, and explicit conversion warnings. Tested against independent openpyxl fixtures. Strict OOXML and arbitrary package layouts remain unverified. |
| XLSM | Read worksheet data | No XLSM writer | VBA/XLM payloads stay inert in the retained original package. Converting to XLSX explicitly warns that macros are omitted. The source file can be recovered unchanged. No code execution or VBA compatibility. |
| XLSB | No | No | Requires a real binary-workbook parser/writer. |
| Legacy XLS | No | No | Compound-document signatures rejected with a conversion message. |
| ODS | No | No | Requires an ODF spreadsheet parser/writer. |
| CSV / TSV / semicolon / pipe-delimited text | Yes | Yes | Quoted fields, escaped quotes, embedded newlines, CRLF, and BOM handling. Import defaults to text; explicit column types preserve identifiers when selected. Export is one selected sheet/range, using cached formula values. Formatting and workbook structures are lost. |
| PDF | No workbook import | Browser print workflow | Fixed layout output, not an editable workbook. Print renderer and browser-generated PDF are separate from XLSX interchange. |
| Encrypted workbook / ZIP | No | No | Explicit rejection. Worksheet protection is an edit restriction and does not provide encryption. |

| XLSX feature | Read / write status | Evidence or limitation |
| --- | --- | --- |
| Strings, numbers, booleans, errors, blanks | Implemented | Shared and inline strings delegated to ExcelJS; independently authored inline-string fixture passes. |
| A1 formulas and cached values | Implemented | Formula source preserved, cached zero retained, cross-sheet source compared independently. Calculation compatibility is tracked separately. |
| Shared formulas | Imported as per-cell formula expressions | Library expands actual formula records, not the whole logical sheet. Complex array/data-table formula metadata remains unverified. |
| Number formats, common fonts/fills/borders/alignment | Implemented subset | RGB/theme colors resolved; bold, numeric formats, solid fills, double border independently verified. Theme source retained. Gradient fills, rich text runs, uncommon borders/alignment values are flattened or unmodeled. |
| 1900 / 1904 date systems | Implemented | Raw OOXML numeric serials retained, including serial 60. No local-time conversion used for serial arithmetic. Python dates cannot represent fictional 1900-02-29; the verification checks raw numeric XML separately. |
| Merged regions | Implemented, sparse | Import bypasses library range expansion; export writes range metadata without materializing blank cells. |
| Rows/columns and freeze panes | Implemented subset | Dimensions, hiding, outline levels, styles, frozen row/column counts. Filtered rows export as manually hidden rows only after an explicit warning; the filter distinction/criteria are not exported, so SUBTOTAL/AGGREGATE may recalculate differently. Pixel/Excel width conversion uses an approximate 7 px character width and 5 px padding. Split-pane geometry is disclosed as a loss. |
| Defined names | Implemented source preservation | Workbook/scoped names, constant expressions, A1 ranges, and whole-column references survive serialization without cell expansion. Function evaluation remains the engine's compatibility target. |
| Data validation | Implemented model types | List, whole, decimal, date, text length, custom formula; ranges kept sparse. Conditional error behavior is an application concern, tested separately. |
| Tables | Implemented subset | Table name, range, headers, totals-row flag, banded style, and cell content. Filter criteria, sort state, calculated-column metadata, per-column totals metadata, and table extensions are unmodeled. |
| Conditional formatting | Implemented subset | Cell comparisons, text, duplicates, expression, 2-color scales, and basic data bars. Unsupported rule types/extensions warn; thresholds and complex icon sets are not certified. |
| Legacy notes | Text implemented | Plain and rich note text parsed from package XML. Authors and text-run styling are disclosed losses. Threaded comments remain original-file-only. |
| Hyperlinks | Implemented | HTTP(S), mailto, tel, document/relative links. Unsafe URI schemes removed from editable cells; original source retained. No links are fetched during import. |
| Print settings | Implemented subset | Area, repeated titles, paper, orientation, margins, scale/fit, gridlines/headings, basic headers/footers and row breaks. Only first of multiple print areas; column breaks need native format. |
| Charts, images, drawing anchors | Original-file-only on import | The native model's linked charts render in Sheets, but no native-to-OOXML chart writer is claimed. XLSX conversion requires loss acknowledgement. |
| Pivot tables/caches/slicers/timelines | Original-file-only on import | Native pivot results export as cells. Excel pivot field definitions and refresh metadata are not generated. |
| External workbook links / queries / data model | Original-file-only relationships | External source identities and cached/formula source stay in native workbooks, with no refresh/network activity. After explicit lossy-export acknowledgement, external formulas become cached values (or #REF! if no cache), avoiding dangling links in the regenerated XLSX. Updating connections is not implemented. |
| Macros, custom XML/ribbon, digital signatures | Original-file-only | Never run; source bytes retained. Conversion warnings identify these losses. |
| Worksheet protection | Implemented edit flag | Export uses an empty password edit restriction. Password hashes/authentication and encryption are not preserved or claimed. |

`xlsxExportWarnings(workbook)` identifies detected conversion losses. `exportXlsx` throws `CompatibilityError` unless those losses are acknowledged with `allowLossy: true`. The native workbook always retains the original source package, and `originalWorkbookBytes` returns it unchanged. Unknown package parts are not blindly grafted into a regenerated ZIP because their relationship identifiers could then refer to different content. Detection of unmodeled extensions is conservative and is not exhaustive OOXML validation; verify important originals in Excel before replacing them.

File workers provide a hard cancellation boundary, with a two-minute time ceiling. ZIP preflight rejects unsafe/duplicate part names, invalid directories, encrypted/unsupported compression, ZIP64, excessive expansion, DTD/entity declarations, and out-of-bounds row/cell coordinates. Limits are 64 MiB compressed, 256 MiB expanded total, 128 MiB per part, 10,000 parts and two million populated cells. Limits protect normal browser use; they are not a guarantee that every allowed input fits a low-memory device. ExcelJS buffers the package, and the recorded 100,000-row fixture reached approximately 770 MiB process RSS across sequential import/export operations.

IndexedDB recovery commits current and previous snapshots together. Explicit errors cover storage quota exhaustion, unavailable storage, stale expected revisions, and corrupt snapshots. Portable saves through the LopeOS file service remain necessary when browser storage is unavailable. Recovery is local to the browser profile and is not a cloud backup or collaboration mechanism.
