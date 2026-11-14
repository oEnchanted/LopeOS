import test from "node:test";
import assert from "node:assert/strict";
import {
  generatePrintHTML,
  paginateSheet,
} from "../../apps/web/src/apps/spreadsheet/print.ts";
import {
  createBudgetWorkbook,
  createAnalyticsWorkbook,
} from "../../packages/spreadsheet-engine/src/fixtures.ts";
import {
  createWorkbook,
  parseRange,
  setCell,
} from "../../packages/spreadsheet-engine/src/model.ts";
import {
  applyDataToSheet,
  sheetData,
  sortSheetRecords,
} from "../../packages/spreadsheet-engine/src/analysis.ts";

test("budget fixture carries formulas, validation, table, chart, names and print settings", () => {
  const book = createBudgetWorkbook(),
    sheet = book.sheets[0];
  assert.equal(book.sheets.length, 2);
  assert.equal(sheet.cells.D4.formula, "=B4-C4");
  assert.equal(sheet.cells.B15.formula, "=Assumptions!B2");
  assert.equal(sheet.validations[0].formula1, "0");
  assert.equal(sheet.tables[0].name, "BudgetItems");
  assert.equal(sheet.charts[0].type, "column");
  assert.equal(book.names[0].name, "MonthlyIncome");
  assert.equal(paginateSheet(sheet).pages.length, 1);
});

test("100,000-row fixture has a real sparse table and linked summary formulas", () => {
  const book = createAnalyticsWorkbook(),
    data = book.sheets[0];
  assert.equal(Object.keys(data.cells).length, 700_007);
  assert.equal(data.cells.A2.value, "000000001");
  assert.equal(data.tables[0].range.end.row, 100_000);
  assert.equal(
    book.sheets[1].cells.B2.formula,
    "=SUMIF(Sales!B2:B100001,A2,Sales!F2:F100001)",
  );
  assert.equal(book.sheets[1].pivots[0].source.end.row, 100_000);
});

test("worksheet adapter keeps typed identifiers and whole-row sort preserves formulas and style", () => {
  const book = createWorkbook(),
    sheet = book.sheets[0];
  applyDataToSheet(
    sheet,
    {
      columns: ["ID", "Amount", "Double"],
      rows: [
        { ID: "001", Amount: 2, Double: null },
        { ID: "002", Amount: 1, Double: null },
      ],
    },
    { row: 0, col: 0 },
  );
  setCell(sheet, "C2", "=B2*2");
  setCell(sheet, "C3", "=B3*2");
  sheet.cells.A2.style = { fill: "#eeeeee" };
  const data = sheetData(sheet, parseRange("A1:C3"));
  assert.equal(data.rows[0].ID, "001");
  sortSheetRecords(sheet, parseRange("A1:C3"), [
    { field: "Amount", direction: "asc" },
  ]);
  assert.equal(sheet.cells.A2.value, "002");
  assert.equal(sheet.cells.A3.value, "001");
  assert.equal(sheet.cells.C2.formula, "=B2*2");
  assert.equal(sheet.cells.C3.formula, "=B3*2");
  assert.equal(sheet.cells.A3.style?.fill, "#eeeeee");
  sheet.merges.push(parseRange("A2:A3"));
  assert.throws(
    () => sortSheetRecords(sheet, parseRange("A1:C3"), [{ field: "Amount" }]),
    /Unmerge/,
  );
});

test("print preview paginates the area, repeats titles, and honors manual breaks and hidden rows", () => {
  const book = createWorkbook(),
    sheet = book.sheets[0];
  sheet.print.area = parseRange("A1:C100");
  sheet.print.repeatRows = [0, 0];
  sheet.print.rowBreaks = [10];
  sheet.rows[3] = { hidden: true };
  const layout = paginateSheet(sheet);
  assert.ok(layout.pages.length >= 3);
  assert.equal(layout.pages[0].rows.at(-1), 9);
  assert.equal(layout.pages[1].rows[0], 0);
  assert.equal(layout.pages[1].rows[1], 10);
  assert.equal(layout.pages[0].rows.includes(3), false);
  assert.equal(new Set(layout.pages.flatMap((page) => page.rows)).size, 99);
});

test("print area scaling and physical margins agree between preview and print CSS", () => {
  const book = createBudgetWorkbook(),
    sheet = book.sheets[0];
  const html = generatePrintHTML(book, sheet.id),
    layout = paginateSheet(sheet);
  assert.match(html, /@page\{size:11in 8.5in;margin:0\}/);
  assert.ok(html.includes(`transform:scale(${layout.pages[0].scale})`));
  assert.ok(html.includes("Page 1 of 1"));
  assert.ok(html.includes("Monthly budget — Budget"));
  assert.ok(html.includes('rowspan="1" colspan="6"'));
  assert.ok(html.includes('data-address="A18"'));
  assert.equal(html.includes('data-address="A37"'), false);
});

test("print escapes cell/header content and never enables workbook scripts or external requests", () => {
  const book = createWorkbook("<img src=x>"),
    sheet = book.sheets[0];
  setCell(sheet, "A1", "<script>alert(1)</script>");
  sheet.print.header = "&F &A";
  const html = generatePrintHTML(book, sheet.id);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("&lt;img src=x&gt;"));
});

test("print reports bounded-preview errors instead of allocating the Excel coordinate space", () => {
  const book = createWorkbook(),
    sheet = book.sheets[0];
  sheet.print.area = parseRange("A1:XFD1048576");
  assert.throws(() => generatePrintHTML(book, sheet.id), /200,000 cells/);
  sheet.print.area = parseRange("A1:A100");
  sheet.print.repeatRows = [0, 90];
  assert.throws(() => paginateSheet(sheet), /Repeated print titles/);
});
