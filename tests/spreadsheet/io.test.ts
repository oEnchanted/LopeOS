import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  createWorkbook,
  createSheet,
  parseRange,
  setCell,
} from "../../packages/spreadsheet-engine/src/model.ts";
import {
  CompatibilityError,
  WorkbookFormatError,
  IO_LIMITS,
  deserializeWorkbook,
  exportDelimited,
  exportXlsx,
  importDelimited,
  importXlsx,
  inspectXlsxPackage,
  originalWorkbookBytes,
  parseDelimited,
  serializeWorkbook,
  xlsxExportWarnings,
} from "../../packages/spreadsheet-engine/src/io.ts";
import {
  loadRecovery,
  saveRecovery,
  WorkbookStorageError,
} from "../../packages/spreadsheet-engine/src/persistence.ts";
const require = createRequire(
  new URL("../../packages/spreadsheet-engine/package.json", import.meta.url),
);
const { strFromU8, strToU8, unzipSync, zipSync } = require("fflate");
const fixture = async (name: string) =>
  new Uint8Array(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url)),
  );

test("native workbook preserves sparse cells, all metadata and explicit schema migration", () => {
  const book = createWorkbook("Portable");
  book.sheets[0].cells.XFD1048576 = {
    value: "Boundary",
    style: { bold: true },
    note: "A note",
  };
  book.metadata = { unknownSafeFeature: { list: [1, 2, 3] } };
  assert.deepEqual(deserializeWorkbook(serializeWorkbook(book)), book);
  const { schemaVersion, ...old } = book;
  assert.equal(
    deserializeWorkbook(JSON.stringify({ ...old, version: 0 })).schemaVersion,
    1,
  );
  assert.throws(
    () => deserializeWorkbook('{"__proto__":{"bad":true}}'),
    WorkbookFormatError,
  );
  assert.throws(
    () => deserializeWorkbook(JSON.stringify({ ...book, schemaVersion: 99 })),
    /schema/,
  );
  const bad = structuredClone(book);
  bad.sheets[0].cells.XFE1 = { value: 1 };
  assert.throws(() => deserializeWorkbook(serializeWorkbook(bad)), /address/);
});

test("CSV quoting, embedded newlines and CRLF roundtrip without parsing formulas", () => {
  assert.deepEqual(
    parseDelimited('Name,Notes\r\n"Ada, Jr.","first\nsecond ""quoted"""\r\n'),
    [
      ["Name", "Notes"],
      ["Ada, Jr.", 'first\nsecond "quoted"'],
    ],
  );
  const book = importDelimited(
    '00123,12345678901234567890,=1+1,TRUE\n"a,b","two\nlines",,',
  );
  const sheet = book.sheets[0];
  assert.equal(sheet.cells.A1.value, "00123");
  assert.equal(sheet.cells.B1.value, "12345678901234567890");
  assert.equal(sheet.cells.C1.value, "=1+1");
  assert.equal(sheet.cells.C1.formula, undefined);
  assert.equal(sheet.cells.D1.value, "TRUE");
  assert.equal(
    exportDelimited(sheet),
    '00123,12345678901234567890,=1+1,TRUE\r\n"a,b","two\nlines",,',
  );
  assert.throws(() => parseDelimited('a,"unterminated'), /unterminated/);
  assert.throws(() => parseDelimited('"a"tail'), /closing/);
});

test("CSV explicit per-column types and auto inference preserve identifiers", () => {
  const book = importDelimited("0012;7;TRUE;9007199254740993", {
    delimiter: ";",
    types: { 0: "auto", 1: "number", 2: "boolean", 3: "auto" },
  });
  assert.deepEqual(
    ["A1", "B1", "C1", "D1"].map((a) => book.sheets[0].cells[a].value),
    ["0012", 7, true, "9007199254740993"],
  );
  assert.throws(
    () => importDelimited("x", { types: { 0: "number" } }),
    /Expected a number/,
  );
  const sheet = createSheet();
  sheet.cells.A1 = { value: null, formula: "=SUM(1,2)", cached: 3 };
  assert.equal(exportDelimited(sheet), "3");
});

test("independently authored XLSX imports formulas, styles, notes, validation, tables, print and sheet state", async () => {
  const { workbook, warnings } = await importXlsx(
    await fixture("independent-budget.xlsx"),
    "Budget.xlsx",
  );
  const sheet = workbook.sheets[0];
  assert.equal(workbook.name, "Budget");
  assert.equal(sheet.name, "Budget 2026");
  assert.equal(sheet.cells.B2.value, 1200);
  assert.equal(sheet.cells.D2.formula, "=B2-C2");
  assert.equal(sheet.cells.B2.style?.numberFormat, "#,##0.00;[Red](#,##0.00)");
  assert.equal(sheet.cells.B2.style?.fill, "#e5f3e8");
  assert.equal(sheet.cells.B2.style?.bold, true);
  assert.equal(sheet.cells.B2.style?.borders?.bottom?.style, "double");
  assert.equal(sheet.cells.C2.note, "Reviewed estimate");
  assert.match(sheet.cells.F4.hyperlink!, /^https:/);
  assert.deepEqual(sheet.merges, [parseRange("A8:D8")]);
  assert.equal(sheet.validations.length, 2);
  assert.deepEqual(sheet.validations[0].range, parseRange("B2:C4"));
  assert.deepEqual(sheet.validations[1].values, [
    "Draft",
    "Reviewed",
    "Approved",
  ]);
  assert.equal(sheet.tables[0].name, "BudgetData");
  assert.deepEqual(sheet.tables[0].range, parseRange("A1:D4"));
  assert.equal(workbook.names[0].reference, "'Budget 2026'!$G$1");
  assert.deepEqual(sheet.freeze, { rows: 1, columns: 1 });
  assert.deepEqual(sheet.print.area, parseRange("A1:G8"));
  assert.equal(sheet.print.paperSize, "A4");
  assert.deepEqual(sheet.print.repeatRows, [0, 0]);
  assert.equal(sheet.print.orientation, "landscape");
  assert.equal(workbook.sheets[1].visibility, "hidden");
  assert.equal(sheet.conditionalFormats[0].operator, "less");
  assert.ok(warnings.some((w) => w.includes("authors")));
});

test("XLSX save/reopen preserves real formulas, styles, cached zero, notes, names, dates and table ranges", async () => {
  const { workbook } = await importXlsx(
    await fixture("independent-budget.xlsx"),
  );
  workbook.sheets[0].cells.B6.cached = 6300;
  workbook.sheets[0].cells.H1 = { value: null, formula: "=0", cached: 0 };
  workbook.calculationMode = "manual";
  const bytes = await exportXlsx(workbook, { allowLossy: true });
  const reopened = (await importXlsx(bytes)).workbook;
  const sheet = reopened.sheets[0];
  assert.equal(sheet.cells.B6.formula, "=SUM(B2:B4)");
  assert.equal(sheet.cells.B6.cached, 6300);
  assert.equal(sheet.cells.H1.cached, 0);
  assert.equal(sheet.cells.G2.value, 60);
  assert.equal(sheet.cells.C2.note, "Reviewed estimate");
  assert.equal(sheet.cells.B2.style?.bold, true);
  assert.equal(reopened.names[0].name, "TaxRate");
  assert.equal(reopened.calculationMode, "manual");
  assert.deepEqual(sheet.tables[0].range, parseRange("A1:D4"));
  assert.deepEqual(sheet.print.area, parseRange("A1:G8"));
  await writeFile(
    new URL("./fixtures/roundtrip-budget.xlsx", import.meta.url),
    bytes,
  );
});

test("1904 and historical 1900 serials never roundtrip through timezone arithmetic", async () => {
  const { workbook } = await importXlsx(await fixture("independent-1904.xlsx"));
  assert.equal(workbook.dateSystem, "1904");
  assert.equal(workbook.sheets[0].cells.A1.value, 0);
  assert.equal(workbook.sheets[0].cells.A2.value, 60);
  const after = (await importXlsx(await exportXlsx(workbook))).workbook;
  assert.equal(after.dateSystem, "1904");
  assert.equal(after.sheets[0].cells.A1.value, 0);
  assert.equal(after.sheets[0].cells.A2.value, 60);
});

test("worksheet boundary fixture remains sparse on XLSX import and export", async () => {
  const { workbook } = await importXlsx(
    await fixture("independent-boundaries.xlsx"),
  );
  assert.deepEqual(Object.keys(workbook.sheets[0].cells), ["A1", "XFD1048576"]);
  const after = (await importXlsx(await exportXlsx(workbook))).workbook;
  assert.equal(after.sheets[0].cells.XFD1048576.value, "End");
  assert.equal(Object.keys(after.sheets[0].cells).length, 2);
});

test("whole-column validation and scoped defined expressions stay sparse and serialize correctly", async () => {
  const book = createWorkbook();
  const sheet = book.sheets[0];
  sheet.validations.push({
    id: "v1",
    type: "whole",
    operator: "between",
    range: parseRange("A1:A1048576"),
    formula1: "0",
    formula2: "10",
  });
  book.names = [
    { name: "WholeColumn", reference: "Sheet1!$A:$A" },
    { name: "LocalRate", reference: "0.075", sheetId: sheet.id },
    { name: "Computed", reference: "SUM(Sheet1!A1:A100)" },
  ];
  const bytes = await exportXlsx(book);
  const result = (await importXlsx(bytes)).workbook;
  assert.equal(result.sheets[0].validations.length, 1);
  assert.equal(result.sheets[0].validations[0].range.end.row, 1048575);
  assert.equal(Object.keys(result.sheets[0].cells).length, 0);
  assert.equal(result.names[0].reference, "Sheet1!$A:$A");
  assert.equal(result.names[1].sheetId, result.sheets[0].id);
  assert.equal(result.names[2].reference, "SUM(Sheet1!A1:A100)");
});

test("charts and unknown features require explicit lossy export; native saves retain exact original package", async () => {
  const original = await fixture("independent-budget-chart.xlsx");
  const { workbook, warnings } = await importXlsx(original);
  assert.ok(warnings.some((w) => w.includes("charts")));
  assert.ok(xlsxExportWarnings(workbook).length);
  await assert.rejects(exportXlsx(workbook), CompatibilityError);
  assert.deepEqual(
    originalWorkbookBytes(deserializeWorkbook(serializeWorkbook(workbook))),
    original,
  );
  assert.ok((await exportXlsx(workbook, { allowLossy: true })).length > 0);
});

test("macro and external-link payloads remain inert with identity and conversion loss disclosure", async () => {
  const parts = unzipSync(await fixture("independent-1904.xlsx"));
  parts["xl/vbaProject.bin"] = new Uint8Array([0, 1, 2, 3]);
  parts["xl/externalLinks/_rels/externalLink1.xml.rels"] = strToU8(
    '<Relationships><Relationship Id="rId1" Target="file:///private/payroll.xlsx" TargetMode="External"/></Relationships>',
  );
  const bytes = zipSync(parts);
  const { workbook, warnings } = await importXlsx(bytes, "Macro.xlsm");
  assert.ok(warnings.some((w) => w.includes("VBA")));
  assert.ok(warnings.some((w) => w.includes("external-link")));
  assert.deepEqual((workbook.metadata!.xlsxSource as any).externalSources, [
    "file:///private/payroll.xlsx",
  ]);
  assert.deepEqual(originalWorkbookBytes(workbook), bytes);
  await assert.rejects(exportXlsx(workbook), CompatibilityError);
});

test("external formulas cannot become dangling package references on acknowledged conversion", async () => {
  const book = createWorkbook();
  book.sheets[0].cells.A1 = {
    value: null,
    formula: "='[1]Budget'!A1",
    cached: 125,
  };
  book.sheets[0].cells.A2 = { value: null, formula: "=[1]Sheet1!B2" };
  assert.ok(
    xlsxExportWarnings(book).some((warning) =>
      warning.includes("cached values"),
    ),
  );
  await assert.rejects(exportXlsx(book), CompatibilityError);
  const after = (await importXlsx(await exportXlsx(book, { allowLossy: true })))
    .workbook;
  assert.equal(after.sheets[0].cells.A1.value, 125);
  assert.equal(after.sheets[0].cells.A1.formula, undefined);
  assert.deepEqual(after.sheets[0].cells.A2.value, {
    type: "error",
    code: "#REF!",
  });
  assert.equal(book.sheets[0].cells.A1.formula, "='[1]Budget'!A1");
});

test("very large merged regions remain metadata instead of allocating blank cells", async () => {
  const book = createWorkbook();
  book.sheets[0].cells.A1 = { value: "Sparse merge" };
  book.sheets[0].merges = [parseRange("A1:XFD1048576")];
  const after = (await importXlsx(await exportXlsx(book))).workbook;
  assert.equal(Object.keys(after.sheets[0].cells).length, 1);
  assert.deepEqual(after.sheets[0].merges, book.sheets[0].merges);
});

test("malformed archives, unsafe names, oversized expansion, DTD and unsupported formats fail before editing", async () => {
  assert.throws(
    () => inspectXlsxPackage(new Uint8Array([1, 2, 3])),
    WorkbookFormatError,
  );
  const bytes = await fixture("independent-1904.xlsx");
  assert.throws(
    () => inspectXlsxPackage(bytes.subarray(0, bytes.length - 1)),
    /directory/,
  );
  const unsafe = zipSync({
    ...unzipSync(bytes),
    "../evil.xml": strToU8("<evil/>"),
  });
  assert.throws(() => inspectXlsxPackage(unsafe), /unsafe/);
  const parts = unzipSync(bytes);
  parts["xl/workbook.xml"] = strToU8(
    '<!DOCTYPE foo [<!ENTITY test SYSTEM "file:///etc/passwd">]>' +
      strFromU8(parts["xl/workbook.xml"]),
  );
  await assert.rejects(importXlsx(zipSync(parts)), /DTD/);
  const huge = bytes.slice();
  const view = new DataView(huge.buffer);
  let directory = -1;
  for (let i = 0; i < huge.length - 46; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      directory = i;
      break;
    }
  assert.ok(directory >= 0);
  view.setUint32(directory + 24, IO_LIMITS.partBytes + 1, true);
  assert.throws(() => inspectXlsxPackage(huge), /decompression/);
  await assert.rejects(
    importXlsx(
      zipSync({
        mimetype: strToU8("application/vnd.oasis.opendocument.spreadsheet"),
      }),
    ),
    /not an XLSX/,
  );
});

test("filtered rows remain hidden in XLSX and loss of filter semantics requires acknowledgement", async () => {
  const book = createWorkbook("Filtered data");
  const sheet = book.sheets[0];
  sheet.cells = {
    A1: { value: "Amount" },
    A2: { value: 20 },
    A3: { value: 30 },
    A4: { value: null, formula: "=SUBTOTAL(9,A2:A3)", cached: 30 },
  };
  sheet.rows[1] = { filtered: true };
  sheet.rows[2] = { hidden: true };
  const native = deserializeWorkbook(serializeWorkbook(book));
  assert.equal(native.sheets[0].rows[1].filtered, true);
  assert.equal(native.sheets[0].rows[1].hidden, undefined);
  assert.ok(xlsxExportWarnings(book).some((warning) => warning.includes("SUBTOTAL and AGGREGATE may recalculate differently")));
  await assert.rejects(exportXlsx(book), CompatibilityError);
  const reopened = (await importXlsx(await exportXlsx(book, { allowLossy: true }))).workbook;
  assert.equal(reopened.sheets[0].rows[1].hidden, true);
  assert.equal(reopened.sheets[0].rows[2].hidden, true);
  assert.equal(reopened.sheets[0].rows[1].filtered, undefined);
  assert.equal(reopened.sheets[0].cells.A4.formula, "=SUBTOTAL(9,A2:A3)");
  assert.equal(reopened.sheets[0].cells.A4.cached, 30);
  delete sheet.rows[1].filtered;
  sheet.tables = [{ id: "table1", name: "Data", range: parseRange("A1:A3"), columns: ["Amount"], headerRow: true, totalsRow: false, bandedRows: true, filters: { Amount: ["30"] } }];
  assert.ok(xlsxExportWarnings(book).some((warning) => warning.includes("AutoFilter criteria")));
});

test("cancellation and unavailable recovery fail explicitly without success claims", async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(
    importXlsx(await fixture("independent-1904.xlsx"), "Book.xlsx", { signal }),
    { name: "AbortError" },
  );
  await assert.rejects(exportXlsx(createWorkbook(), { signal }), {
    name: "AbortError",
  });
  await assert.rejects(
    saveRecovery(createWorkbook()),
    (error: unknown) =>
      error instanceof WorkbookStorageError && error.reason === "unavailable",
  );
  await assert.rejects(loadRecovery("missing"), WorkbookStorageError);
});
