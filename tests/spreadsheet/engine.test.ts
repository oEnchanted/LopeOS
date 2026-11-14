import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkbook,
  createSheet,
  cellAddress,
  parseAddress,
  parseRange,
  setCell,
  dateToSerial,
  serialToDate,
  formatValue,
  MAX_ROWS,
  MAX_COLUMNS,
  isError,
  type Scalar,
} from "../../packages/spreadsheet-engine/src/model.ts";
import {
  WorkbookEngine,
  calculateWorkbook,
  supportedFunctionNames,
} from "../../packages/spreadsheet-engine/src/calculation.ts";
import {
  adjustFormula,
  formulaReferences,
} from "../../packages/spreadsheet-engine/src/references.ts";
import { functionRegistry } from "../../packages/spreadsheet-engine/src/function-registry.ts";
import {
  parseFormula,
  visitFormula,
} from "../../packages/spreadsheet-engine/src/formula-ast.ts";

const make = () => {
  const book = createWorkbook("Engine fixture"),
    engine = new WorkbookEngine(book);
  return { book, engine, sheet: book.sheets[0], id: book.activeSheetId };
};
const code = (value: Scalar) => (isError(value) ? value.code : value);

test("sparse worksheet coordinate boundaries never allocate a full grid", () => {
  assert.equal(cellAddress(MAX_ROWS - 1, MAX_COLUMNS - 1), "XFD1048576");
  assert.deepEqual(parseAddress("$XFD$1048576"), { row: 1048575, col: 16383 });
  assert.throws(() => parseAddress("XFE1"));
  assert.throws(() => parseAddress("A1048577"));
  assert.throws(() => parseAddress("A0"));
  const { engine, sheet, id } = make();
  engine.setCell(id, "XFD1048576", 7);
  engine.setCell(id, "A1", "=SUM(XFD:XFD)");
  engine.calculate();
  assert.equal(engine.value(id, "A1"), 7);
  assert.equal(Object.keys(sheet.cells).length, 2);
});
test("arithmetic precedence, boolean/text/blank distinction, coercion and Excel errors", () => {
  const { engine, id } = make();
  engine.batch([
    { sheetId: id, address: "A1", input: "'12" },
    { sheetId: id, address: "A2", input: true },
    { sheetId: id, address: "A4", input: '=""' },
  ]);
  engine.calculate();
  const cases: [string, Scalar][] = [
    ["2+3*4^2", 50],
    ["(2+3)*4", 20],
    ["10%", 0.1],
    ['"a"&"b"', "ab"],
    ["SUM(A1:A4)", 0],
    ['SUM("12",TRUE)', 13],
    ["COUNT(A1:A4)", 0],
    ["COUNTA(A1:A4)", 3],
    ["COUNTBLANK(A1:A4)", 2],
    ["ISBLANK(A3)", true],
    ["ISBLANK(A4)", false],
    ["ISNUMBER(A1)", false],
    ["ISTEXT(A1)", true],
    ["IFERROR(1/0,99)", 99],
    ["IFNA(NA(),7)", 7],
    ["ISERROR(1/0)", true],
  ];
  for (const [formula, expected] of cases)
    assert.deepEqual(engine.evaluateExpression(formula), expected, formula);
  assert.equal(code(engine.evaluateExpression("1/0") as Scalar), "#DIV/0!");
  assert.equal(
    code(engine.evaluateExpression("NOTAFUNCTION(1)") as Scalar),
    "#NAME?",
  );
  assert.equal(
    code(
      engine.evaluateExpression('WEBSERVICE("https://example.com")') as Scalar,
    ),
    "#BLOCKED!",
  );
});
test("common function fixtures use exact expected results", () => {
  const { engine, id } = make();
  for (let i = 0; i < 3; i++) {
    engine.setCell(id, `A${i + 1}`, i + 1);
    engine.setCell(id, `B${i + 1}`, (i + 1) * 10);
    engine.setCell(id, `C${i + 1}`, i ? "b" : "a");
  }
  const cases: Record<string, Scalar> = {
    "SUM({1,2,3})": 6,
    "AVERAGE({1,2,3})": 2,
    "MIN({2,1,3})": 1,
    "MAX({2,1,3})": 3,
    'COUNT({1,"text",TRUE})': 1,
    'COUNTA({1,"text",TRUE})': 3,
    "PRODUCT({2,3,4})": 24,
    'IF(2>1,"yes","no")': "yes",
    "IFS(FALSE,1,TRUE,2)": 2,
    "AND(TRUE,1)": true,
    "OR(FALSE,TRUE)": true,
    "NOT(TRUE)": false,
    'SUMIF(A1:A3,">1",B1:B3)': 50,
    'COUNTIF(A1:A3,">1")': 2,
    'SUMIFS(B1:B3,A1:A3,">1",C1:C3,"b")': 50,
    'COUNTIFS(A1:A3,">1",C1:C3,"b")': 2,
    'AVERAGEIFS(B1:B3,A1:A3,">1")': 25,
    "ROUND(1.235,2)": 1.24,
    "ROUNDUP(1.231,2)": 1.24,
    "ROUNDDOWN(1.239,2)": 1.23,
    "SUMPRODUCT({1,2},{3,4})": 11,
    'XLOOKUP("b",{"a";"b";"c"},{10;20;30})': 20,
    "VLOOKUP(2,{1,10;2,20;3,30},2,FALSE)": 20,
    "HLOOKUP(2,{1,2,3;10,20,30},2,FALSE)": 20,
    "INDEX({1,2;3,4},2,2)": 4,
    "MATCH(2,{1;2;3},0)": 2,
    "XMATCH(2,{1;2;3})": 2,
    'LEFT("abcdef",2)': "ab",
    'RIGHT("abcdef",2)': "ef",
    'MID("abcdef",2,3)': "bcd",
    'LEN("abcdef")': 6,
    'CONCAT("a","b","c")': "abc",
    'TRIM("  a   b  ")': "a b",
    'UPPER("aBc")': "ABC",
    'LOWER("aBc")': "abc",
    "MEDIAN({4,1,2,3})": 2.5,
    "LARGE({1,4,2},2)": 2,
    "SMALL({1,4,2},2)": 2,
    "STDEV.S({1,2,3})": 1,
    "STDEV.P({1,1,1})": 0,
    "VAR.S({1,2,3})": 1,
    "VAR.P({1,1,1})": 0,
    "ABS(-3)": 3,
    "SQRT(16)": 4,
    "POWER(2,4)": 16,
    "MOD(7,3)": 1,
    "NPV(0,10,20,30)": 60,
    "PV(0,10,-10)": 100,
    "FV(0,10,-10)": 100,
    "PMT(0,10,100)": -10,
    "NPER(0,-10,100)": 10,
  };
  for (const [formula, expected] of Object.entries(cases))
    assert.deepEqual(engine.evaluateExpression(formula), expected, formula);
});
test("financial numerical tolerance is explicit and function-specific", () => {
  const { engine } = make();
  const pmt = engine.evaluateExpression("PMT(0.05/12,60,10000)");
  assert.equal(typeof pmt, "number");
  assert.ok(
    Math.abs((pmt as number) - -188.7123364401099) < 1e-8,
    "PMT currency calculation absolute tolerance 1e-8",
  );
  const nper = engine.evaluateExpression("NPER(0.01,-100,1000)");
  assert.equal(typeof nper, "number");
  assert.ok(
    Math.abs((nper as number) - 10.58864445942323) < 1e-10,
    "NPER period count absolute tolerance 1e-10",
  );
});
test("dependency graph recalculates affected formulas only and catches cycles", () => {
  const { engine, id } = make();
  engine.batch([
    { sheetId: id, address: "A1", input: 2 },
    { sheetId: id, address: "B1", input: "=A1*3" },
    { sheetId: id, address: "C1", input: "=B1+1" },
    { sheetId: id, address: "D1", input: "=10+1" },
  ]);
  assert.equal(engine.calculate().evaluated, 3);
  engine.setCell(id, "A1", 4);
  assert.equal(engine.calculate().evaluated, 2);
  assert.equal(engine.value(id, "C1"), 13);
  assert.equal(engine.value(id, "D1"), 11);
  engine.setCell(id, "A1", "=C1");
  const result = engine.calculate();
  assert.ok(result.errors.some((e) => e.code === "#CIRC!"));
  assert.equal(code(engine.value(id, "A1")), "#CIRC!");
});
test("manual calculation retains cached results until explicitly recalculated", () => {
  const { engine, book, id } = make();
  engine.setCell(id, "A1", 2);
  engine.setCell(id, "B1", "=A1*2");
  engine.calculate();
  book.calculationMode = "manual";
  engine.setCell(id, "A1", 3);
  assert.equal(engine.value(id, "B1"), 4);
  assert.equal(engine.calculate().pending, 1);
  engine.calculate(true);
  assert.equal(engine.value(id, "B1"), 6);
});
test("date systems include serial 60 without timezone-dependent date arithmetic", () => {
  assert.equal(dateToSerial(1900, 1, 1), 1);
  assert.equal(dateToSerial(1900, 2, 28), 59);
  assert.equal(dateToSerial(1900, 2, 29), 60);
  assert.equal(dateToSerial(1900, 3, 1), 61);
  assert.equal(dateToSerial(1904, 1, 1, "1904"), 0);
  assert.deepEqual(serialToDate(60), {
    year: 1900,
    month: 2,
    day: 29,
    hour: 0,
    minute: 0,
    second: 0,
  });
  assert.equal(serialToDate(0).year, 1900);
  const serial = dateToSerial(2024, 2, 29);
  assert.equal(serial, 45351);
  assert.deepEqual(serialToDate(serial + 0.5), {
    year: 2024,
    month: 2,
    day: 29,
    hour: 12,
    minute: 0,
    second: 0,
  });
  const { engine, book } = make();
  for (const [f, v] of [
    ["DATE(1900,2,29)", 60],
    ["DATE(2024,2,29)", 45351],
    ['DATEVALUE("2024-02-29")', 45351],
    ["DAY(60)", 29],
    ["MONTH(60)", 2],
    ["YEAR(60)", 1900],
    ["DAYS(61,59)", 2],
    ["EDATE(45351,1)", 45380],
    ["EOMONTH(45351,1)", 45382],
  ] as const)
    assert.equal(engine.evaluateExpression(f), v, f);
  book.dateSystem = "1904";
  assert.equal(engine.evaluateExpression("DATE(1904,1,1)"), 0);
  assert.equal(engine.evaluateExpression("YEAR(0)"), 1904);
});
test("custom display formats are separate from stored values", () => {
  assert.equal(
    formatValue({ value: 12.345, style: { numberFormat: "$#,##0.00" } }),
    "$12.35",
  );
  assert.equal(
    formatValue({ value: 0.125, style: { numberFormat: "0.0%" } }),
    "12.5%",
  );
  assert.equal(
    formatValue({ value: 60, style: { numberFormat: "yyyy-mm-dd" } }),
    "1900-02-29",
  );
  assert.equal(
    formatValue(
      { value: 1234.5, style: { numberFormat: "#,##0.00" } },
      "1900",
      "de-DE",
    ),
    "1.234,50",
  );
});
test("relative absolute and mixed references copy without altering strings or function names", () => {
  assert.equal(
    adjustFormula('=A1+$A1+A$1+$A$1+"A1"', 1, 2),
    '=C2+$A2+C$1+$A$1+"A1"',
  );
  assert.equal(
    adjustFormula("='My Sheet'!A1+LOG10(A1)", 2, 1),
    "='My Sheet'!B3+LOG10(B3)",
  );
  assert.equal(adjustFormula("=A1", -1, 0), "=#REF!");
  assert.equal(formulaReferences('="A1"&"Sheet1!A2"').length, 0);
  const { engine, id, sheet } = make();
  engine.setCell(id, "A1", 3);
  engine.setCell(id, "B1", "=A1+$A$1");
  engine.copyRange(id, parseRange("B1"), { row: 1, col: 1 });
  assert.equal(sheet.cells.B2.formula, "=A2+$A$1");
  engine.setCell(id, "A2", 5);
  engine.calculate();
  assert.equal(engine.value(id, "B2"), 8);
});
test("fill series and formula fills, move references and structural range expansion", () => {
  const { engine, id } = make();
  engine.setCell(id, "A1", 2);
  engine.setCell(id, "A2", 4);
  engine.fillRange(id, parseRange("A1:A2"), parseRange("A1:A5"));
  assert.equal(engine.value(id, "A5"), 10);
  engine.setCell(id, "B1", "=SUM(A1:A5)");
  engine.copyRange(id, parseRange("A1:A5"), { row: 0, col: 2 }, { cut: true });
  assert.equal(engine.sheet().cells.B1.formula, "=SUM(C1:C5)");
  engine.calculate();
  assert.equal(engine.value(id, "B1"), 30);
  engine.insertRows(id, 2);
  assert.equal(engine.sheet().cells.B1.formula, "=SUM(C1:C6)");
  engine.deleteRows(id, 2);
  assert.equal(engine.sheet().cells.B1.formula, "=SUM(C1:C5)");
});
test("quoted sheet names and defined names survive sheet rename", () => {
  const { engine, book, id } = make(),
    second = createSheet("Quarter's Plan");
  book.sheets.push(second);
  setCell(second, "A1", 5);
  book.names.push({ name: "Rate", reference: "='Quarter''s Plan'!$A$1" });
  engine.setCell(id, "A1", "='Quarter''s Plan'!A1+Rate");
  engine.calculate();
  assert.equal(engine.value(id, "A1"), 10);
  engine.renameSheet(second.id, "Plan 2");
  assert.match(engine.sheet(id).cells.A1.formula!, /'Plan 2'!/);
  engine.calculate();
  assert.equal(engine.value(id, "A1"), 10);
});
test("tables resolve structured columns and current row", () => {
  const { engine, sheet, id } = make();
  sheet.tables.push({
    id: "table1",
    name: "Sales",
    range: parseRange("A1:B3"),
    columns: ["Product", "Amount"],
    headerRow: true,
    totalsRow: false,
    bandedRows: true,
  });
  engine.batch([
    { sheetId: id, address: "A1", input: "Product" },
    { sheetId: id, address: "B1", input: "Amount" },
    { sheetId: id, address: "A2", input: "Book" },
    { sheetId: id, address: "B2", input: 12 },
    { sheetId: id, address: "A3", input: "Pen" },
    { sheetId: id, address: "B3", input: 8 },
    { sheetId: id, address: "D1", input: "=SUM(Sales[Amount])" },
    { sheetId: id, address: "A2", input: "=[@Amount]*2" },
  ]);
  engine.calculate();
  assert.equal(engine.value(id, "D1"), 20);
  assert.equal(engine.value(id, "A2"), 24);
});
test("dynamic arrays broadcast, spill, block, clear and update downstream formulas", () => {
  const { engine, id } = make();
  engine.setCell(id, "D1", "=A3+1");
  engine.setCell(id, "A1", "=SEQUENCE(3)");
  engine.calculate();
  assert.equal(engine.value(id, "A3"), 3);
  assert.equal(engine.value(id, "D1"), 4);
  assert.throws(() => engine.setCell(id, "A2", 99), /spilled array/);
  engine.setCell(id, "A1", "=SEQUENCE(2,2,10,2)");
  engine.calculate();
  assert.equal(engine.value(id, "B2"), 16);
  assert.equal(engine.value(id, "A3"), null);
  assert.equal(engine.value(id, "D1"), 1);
  engine.setCell(id, "A1", 1);
  engine.setCell(id, "A2", 99);
  engine.setCell(id, "A1", "=SEQUENCE(3)");
  engine.calculate();
  assert.equal(code(engine.value(id, "A1")), "#SPILL!");
  engine.setCell(id, "A2", "");
  engine.calculate();
  assert.equal(engine.value(id, "A3"), 3);
  assert.deepEqual(engine.evaluateExpression("FILTER({1;2;3},{1;2;3}>1)"), [
    [2],
    [3],
  ]);
  assert.deepEqual(engine.evaluateExpression("SORT({3;1;2})"), [[1], [2], [3]]);
  assert.deepEqual(engine.evaluateExpression('SORTBY({"a";"b";"c"},{3;1;2})'), [
    ["b"],
    ["c"],
    ["a"],
  ]);
  assert.deepEqual(engine.evaluateExpression("UNIQUE({1;2;1})"), [[1], [2]]);
  assert.deepEqual(engine.evaluateExpression("TRANSPOSE({1,2;3,4})"), [
    [1, 3],
    [2, 4],
  ]);
  assert.deepEqual(engine.evaluateExpression("IF({1;0},{10;20},{30;40})"), [
    [10],
    [40],
  ]);
});
test("LET scopes, LAMBDA arguments and bounded named recursion", () => {
  const { engine, book } = make();
  assert.equal(engine.evaluateExpression("LET(x,2,LET(x,3,x+1)+x)"), 6);
  assert.equal(engine.evaluateExpression("LAMBDA(n,n+1)(4)"), 5);
  book.names.push({
    name: "factorial",
    reference: "=LAMBDA(n,IF(n<=1,1,n*factorial(n-1)))",
  });
  assert.equal(engine.evaluateExpression("factorial(6)"), 720);
  assert.equal(
    code(engine.evaluateExpression("LAMBDA(x,x+1)") as Scalar),
    "#CALC!",
  );
  assert.equal(
    code(engine.evaluateExpression("LAMBDA(x,x)(1,2)") as Scalar),
    "#VALUE!",
  );
  assert.equal(
    code(engine.evaluateExpression("LET(x,2,x)+x") as Scalar),
    "#NAME?",
  );
  book.names.push({ name: "forever", reference: "=LAMBDA(n,forever(n+1))" });
  assert.ok(isError(engine.evaluateExpression("forever(0)")));
});
test("subtotal and aggregate omit hidden rows and errors as requested", () => {
  const { engine, sheet, id } = make();
  engine.batch([
    { sheetId: id, address: "A1", input: 1 },
    { sheetId: id, address: "A2", input: 2 },
    { sheetId: id, address: "A3", input: 3 },
  ]);
  sheet.rows[1] = { hidden: true };
  assert.equal(engine.evaluateExpression("SUBTOTAL(109,A1:A3)"), 4);
  assert.equal(engine.evaluateExpression("SUBTOTAL(9,A1:A3)"), 6);
  engine.setCell(id, "A3", "=1/0");
  engine.calculate();
  assert.equal(engine.evaluateExpression("AGGREGATE(9,7,A1:A3)"), 1);
});
test("validation rejects a whole invalid batch, supports formulas and protects sheets", () => {
  const { engine, sheet, id } = make();
  sheet.validations.push({
    id: "positive",
    range: parseRange("A1:A3"),
    type: "whole",
    operator: "between",
    formula1: "1",
    formula2: "10",
    allowBlank: true,
  });
  assert.throws(
    () =>
      engine.batch([
        { sheetId: id, address: "A1", input: 3 },
        { sheetId: id, address: "A2", input: 99 },
      ]),
    /validation/,
  );
  assert.equal(engine.value(id, "A1"), null);
  engine.setCell(id, "A1", "=2+3");
  engine.calculate();
  assert.equal(engine.value(id, "A1"), 5);
  sheet.validations.push({
    id: "custom",
    range: parseRange("B1:B3"),
    type: "custom",
    formula1: "=B1>10",
  });
  assert.throws(() => engine.setCell(id, "B2", 8));
  engine.setCell(id, "B2", 11);
  assert.equal(engine.value(id, "B2"), 11);
  sheet.protected = true;
  assert.throws(() => engine.setCell(id, "C1", 1), /protected/);
  sheet.cells.C1 = { value: 1, locked: false };
  engine.setCell(id, "C1", 2);
  assert.equal(engine.value(id, "C1"), 2);
});
test("undo redo and worker results preserve document isolation", () => {
  const { engine, id } = make();
  engine.setCell(id, "A1", 1);
  engine.setCell(id, "A1", 2);
  for (let i = 0; i < 8; i++) {
    assert.equal(engine.undo(), true);
    assert.equal(engine.value(id, "A1"), 1);
    assert.equal(engine.redo(), true);
    assert.equal(engine.value(id, "A1"), 2);
  }
  engine.setCell(id, "B1", "=A1*2");
  const result = calculateWorkbook(structuredClone(engine.workbook));
  assert.equal(engine.applyCalculation(result), true);
  assert.equal(engine.value(id, "B1"), 4);
  engine.setCell(id, "A1", 3);
  assert.equal(engine.applyCalculation(result), false);
  const another = make();
  assert.equal(another.engine.applyCalculation(result), false);
  assert.equal(another.engine.value(another.id, "A1"), null);
});
test("function catalog records every discovered Microsoft entry with honest verification states", () => {
  assert.ok(functionRegistry.length >= 500);
  assert.ok(supportedFunctionNames().length >= 300);
  assert.equal(
    functionRegistry.find((f) => f.name === "SUM")?.status,
    "fixture-tested",
  );
  assert.equal(
    functionRegistry.find((f) => f.name === "CUBEVALUE")?.status,
    "unsupported",
  );
  assert.equal(
    functionRegistry.find((f) => f.name === "WEBSERVICE")?.status,
    "blocked",
  );
  assert.ok(functionRegistry.some((f) => f.status === "available-unverified"));
});
test("incremental worker snapshots preserve caches, reject staleness, and rebuild on structural changes", () => {
  const { engine, id } = make();
  engine.setCell(id, "A1", 1);
  engine.setCell(id, "B1", "=A1+1");
  engine.setCell(id, "C1", "=100+1");
  engine.calculate();
  const next = structuredClone(engine.workbook);
  next.revision++;
  next.sheets[0].cells.A1 = { value: 5 };
  assert.equal(engine.updateSnapshot(next), "incremental");
  assert.equal(engine.calculate().evaluated, 1);
  assert.equal(engine.value(id, "B1"), 6);
  assert.equal(engine.value(id, "C1"), 101);
  const structural = structuredClone(engine.workbook);
  structural.sheets[0].name = "Renamed";
  assert.equal(engine.updateSnapshot(structural), "rebuild");
  assert.equal(engine.calculate().evaluated, 2);
  engine.workbook.calculationMode = "manual";
  engine.setCell(id, "B1", "=A1+9");
  engine.setCell(id, "B1", "");
  assert.equal(engine.calculate(true).pending, 0);
});
test("formula AST preserves syntax, quoted text, arrays and static dependency references", () => {
  const ast = parseFormula("=SUM('Other Sheet'!$A$1:B2,IF(A1>0,{1;2},\"A2\"))"),
    refs: string[] = [];
  visitFormula(ast, (node) => {
    if (node.kind === "reference") refs.push(node.text);
  });
  assert.deepEqual(refs, ["'Other Sheet'!$A$1:B2", "A1"]);
  assert.equal(ast.kind, "call");
  assert.throws(() => parseFormula("=SUM(1,2"));
  const { engine, book, id } = make();
  book.names.push({ name: "addRate", reference: "=LAMBDA(n,n+A1)" });
  engine.setCell(id, "A1", 2);
  engine.setCell(id, "B1", "=addRate(3)");
  assert.equal(engine.ast(id, "B1")?.kind, "call");
  engine.calculate();
  engine.setCell(id, "A1", 5);
  assert.equal(engine.calculate().evaluated, 1);
  assert.equal(engine.value(id, "B1"), 8);
});
test("whole-row and whole-column reference transformations respect absolute marks and strings", () => {
  assert.equal(
    adjustFormula("=SUM(A:A,$B:$B,1:1,$2:$2)", 2, 1),
    "=SUM(B:B,$B:$B,3:3,$2:$2)",
  );
  const { engine, id } = make();
  engine.setCell(id, "A1", 2);
  engine.setCell(id, "C1", "=SUM(A:A)");
  engine.insertColumns(id, 0);
  assert.equal(engine.sheet().cells.D1.formula, "=SUM(B:B)");
  engine.renameSheet(id, "Data");
  engine.setCell(id, "D2", '="Data!A:A"&SUM(Data!B:B)');
  engine.renameSheet(id, "New Data");
  assert.equal(
    engine.sheet().cells.D2.formula,
    "=\"Data!A:A\"&SUM('New Data'!B:B)",
  );
});
test("SUBTOTAL and reference AGGREGATE distinguish manually hidden and filtered rows", () => {
  const { engine, id, sheet } = make();
  engine.batch(
    [1, 2, 3, 4].map((value, index) => ({
      sheetId: id,
      address: `A${index + 1}`,
      input: value,
    })),
  );
  sheet.rows[1] = { hidden: true };
  sheet.rows[2] = { filtered: true };
  assert.equal(engine.evaluateExpression("SUBTOTAL(9,A1:A4)"), 7);
  assert.equal(engine.evaluateExpression("SUBTOTAL(109,A1:A4)"), 5);
  assert.equal(engine.evaluateExpression("AGGREGATE(9,0,A1:A4)"), 7);
  assert.equal(engine.evaluateExpression("AGGREGATE(9,1,A1:A4)"), 5);
  const next = structuredClone(engine.workbook);
  next.sheets[0].rows[2].filtered = false;
  assert.equal(engine.updateSnapshot(next), "rebuild");
  assert.equal(engine.evaluateExpression("SUBTOTAL(9,A1:A4)"), 10);
});
test("table edits and pasted rows expand downward, autofill formulas, preserve values and undo metadata", () => {
  const { engine, id, sheet } = make();
  sheet.tables.push({
    id: "sales",
    name: "Sales",
    range: parseRange("A1:C2"),
    columns: ["Quantity", "Price", "Total"],
    headerRow: true,
    totalsRow: false,
    bandedRows: true,
  });
  engine.batch([
    { sheetId: id, address: "A2", input: 2 },
    { sheetId: id, address: "B2", input: 3 },
    { sheetId: id, address: "C2", input: "=A2*B2" },
    { sheetId: id, address: "E1", input: "=SUM(Sales[Total])" },
  ]);
  engine.calculate();
  engine.batch([
    { sheetId: id, address: "A3", input: 4 },
    { sheetId: id, address: "B3", input: 5 },
    { sheetId: id, address: "A4", input: 6 },
    { sheetId: id, address: "B4", input: 7 },
    { sheetId: id, address: "C4", input: 99 },
  ]);
  assert.equal(sheet.tables[0].range.end.row, 3);
  assert.equal(sheet.cells.C3.formula, "=A3*B3");
  assert.equal(sheet.cells.C4.value, 99);
  engine.calculate();
  assert.equal(engine.value(id, "E1"), 125);
  engine.undo();
  assert.equal(engine.sheet(id).tables[0].range.end.row, 1);
  assert.equal(engine.sheet(id).cells.C3, undefined);
  engine.redo();
  assert.equal(engine.sheet(id).tables[0].range.end.row, 3);
  engine.calculate();
  assert.equal(engine.value(id, "E1"), 125);
  engine.sheet(id).tables[0].totalsRow = true;
  engine.setCell(id, "A5", 8);
  assert.equal(engine.sheet(id).tables[0].range.end.row, 3);
});

test("Text-formatted cells preserve leading zeros, long identifiers and formula-looking input", () => {
  const { engine, id, sheet } = make();
  sheet.cells.A1 = { value: null, style: { numberFormat: "@" } };
  engine.setCell(id, "A1", "00012345678901234567890");
  assert.equal(engine.value(id, "A1"), "00012345678901234567890");
  engine.setCell(id, "A1", "=SUM(1,2)");
  assert.equal(engine.value(id, "A1"), "=SUM(1,2)");
  assert.equal(sheet.cells.A1.formula, undefined);
  engine.setCell(id, "A1", "TRUE");
  assert.equal(engine.value(id, "A1"), "TRUE");
  engine.setCell(id, "A1", "'0012");
  assert.equal(engine.value(id, "A1"), "0012");
});

test("unsupported union aggregates fail explicitly and scalar text functions broadcast arrays", () => {
  const { engine, id } = make();
  engine.setCell(id, "A1", 2);
  engine.setCell(id, "A2", 3);
  assert.equal(code(engine.evaluateExpression("SUM((A1,A2))") as Scalar), "#VALUE!");
  assert.equal(code(engine.evaluateExpression("NPV(0,(A1,A2))") as Scalar), "#VALUE!");
  assert.equal(engine.evaluateExpression("SUM(A1,A2)"), 5);
  assert.deepEqual(engine.evaluateExpression('UPPER({"a";"b"})'), [["A"], ["B"]]);
  assert.deepEqual(engine.evaluateExpression('LOWER({"AB";"CD"})'), [["ab"], ["cd"]]);
  assert.deepEqual(engine.evaluateExpression('LEFT({"ab";"cd"},1)'), [["a"], ["c"]]);
  assert.deepEqual(engine.evaluateExpression('LEN({"one";"four"})'), [[3], [4]]);
  assert.deepEqual(engine.evaluateExpression('TRIM({" a  b ";" c "})'), [["a b"], ["c"]]);
});
