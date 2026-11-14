import {
  cellAddress,
  createSheet,
  createWorkbook,
  dateToSerial,
  parseRange,
  setCell,
  type CellStyle,
  type Workbook,
} from "./model.ts";

const heading: CellStyle = {
  bold: true,
  fill: "#217346",
  color: "#ffffff",
  fontSize: 11,
};
const currency = "$#,##0.00;($#,##0.00)";

/** Deterministic fictional household budget. No live financial or personal data. */
export function createBudgetWorkbook(): Workbook {
  const workbook = createWorkbook("Monthly budget"),
    budget = workbook.sheets[0];
  budget.name = "Budget";
  const assumptions = createSheet("Assumptions");
  workbook.sheets.push(assumptions);
  workbook.createdAt = workbook.updatedAt = "2025-09-01T00:00:00.000Z";
  workbook.metadata = {
    fixture: "budget-v1",
    provenance: "Deterministic fictional sample data.",
  };
  setCell(budget, "A1", {
    value: "MONTHLY BUDGET",
    style: { bold: true, fontSize: 22, color: "#217346" },
  });
  budget.merges.push(parseRange("A1:F1"));
  budget.rows[0] = { height: 42 };
  setCell(budget, "A2", {
    value:
      "September 2025 · Fictional sample · Edit any planned or actual amount",
    style: { color: "#647067", fontSize: 10 },
  });
  budget.merges.push(parseRange("A2:F2"));
  budget.rows[1] = { height: 28 };
  ["Category", "Planned", "Actual", "Remaining", "% of plan", "Notes"].forEach(
    (value, index) =>
      setCell(budget, cellAddress(2, index), { value, style: heading }),
  );
  const rows: [string, number, number, string][] = [
    ["Housing", 1800, 1800, "Monthly rent"],
    ["Groceries", 500, 462.75, "Food and household supplies"],
    ["Transport", 220, 195.5, "Fuel and transit"],
    ["Utilities", 260, 248.9, "Electricity, water and internet"],
    ["Insurance", 190, 190, "Monthly premiums"],
    ["Dining", 180, 204.25, "Meals outside home"],
    ["Entertainment", 120, 85, "Subscriptions and activities"],
    ["Savings", 700, 700, "Planned transfer"],
  ];
  rows.forEach(([category, planned, actual, note], index) => {
    const row = index + 3,
      fill = index % 2 ? "#f0f6f2" : "#ffffff";
    const values = [
      category,
      planned,
      actual,
      `=B${row + 1}-C${row + 1}`,
      `=IFERROR(C${row + 1}/B${row + 1},0)`,
      note,
    ];
    values.forEach((value, column) => {
      const cell = setCell(budget, cellAddress(row, column), value);
      cell.style = {
        fill,
        ...(column > 0 && column < 4
          ? { numberFormat: currency }
          : column === 4
            ? { numberFormat: "0.0%" }
            : {}),
        ...(column === 5 ? { color: "#536057", fontSize: 10 } : {}),
      };
    });
  });
  setCell(budget, "A13", { value: "TOTAL", style: heading });
  for (const column of ["B", "C", "D"]) {
    const cell = setCell(budget, `${column}13`, `=SUM(${column}4:${column}11)`);
    cell.style = { ...heading, numberFormat: currency };
  }
  setCell(budget, "E13", {
    value: null,
    formula: "=IFERROR(C13/B13,0)",
    style: { ...heading, numberFormat: "0.0%" },
  });
  setCell(budget, "F13", {
    value: "Tracked across 8 categories",
    style: heading,
  });
  setCell(budget, "A15", { value: "Monthly income", style: { bold: true } });
  setCell(budget, "B15", {
    value: null,
    formula: "=Assumptions!B2",
    style: { numberFormat: currency },
  });
  setCell(budget, "A16", {
    value: "Unallocated income",
    style: { bold: true },
  });
  setCell(budget, "B16", {
    value: null,
    formula: "=B15-B13",
    style: { numberFormat: currency },
  });
  setCell(budget, "A18", {
    value:
      "Green cells contain calculated results. Input amounts must be zero or greater.",
    style: { color: "#647067", fontSize: 10 },
  });
  budget.merges.push(parseRange("A18:F18"));
  budget.columns = {
    0: { width: 168 },
    1: { width: 112 },
    2: { width: 112 },
    3: { width: 112 },
    4: { width: 104 },
    5: { width: 244 },
  };
  budget.freeze = { rows: 3, columns: 1 };
  budget.tables.push({
    id: "budget-table",
    name: "BudgetItems",
    range: parseRange("A3:F11"),
    columns: [
      "Category",
      "Planned",
      "Actual",
      "Remaining",
      "% of plan",
      "Notes",
    ],
    headerRow: true,
    totalsRow: false,
    bandedRows: true,
    style: "TableStyleMedium4",
  });
  budget.validations.push({
    id: "budget-nonnegative",
    range: parseRange("B4:C11"),
    type: "decimal",
    operator: "greaterOrEqual",
    formula1: "0",
    allowBlank: false,
    prompt: "Enter an amount of zero or greater.",
    errorTitle: "Amount must be nonnegative",
    error: "Enter a number of zero or greater.",
    errorStyle: "stop",
  });
  budget.conditionalFormats.push({
    id: "over-budget",
    range: parseRange("D4:D11"),
    type: "cellIs",
    operator: "less",
    value: 0,
    style: { fill: "#fce4d6", color: "#9c0006" },
    priority: 1,
    stopIfTrue: true,
  });
  budget.conditionalFormats.push({
    id: "within-budget",
    range: parseRange("D4:D11"),
    type: "cellIs",
    operator: "greaterOrEqual",
    value: 0,
    style: { fill: "#e2efda", color: "#217346" },
    priority: 2,
  });
  budget.charts.push({
    id: "budget-chart",
    type: "column",
    title: "Planned and actual spending",
    range: parseRange("A3:C11"),
    x: 72,
    y: 490,
    width: 650,
    height: 310,
    showLegend: true,
  });
  budget.print = {
    ...budget.print,
    orientation: "landscape",
    area: parseRange("A1:F36"),
    fitToWidth: 1,
    fitToHeight: 1,
    repeatRows: [0, 2],
    header: "&F — &A",
    footer: "Page &P of &N",
    gridlines: false,
  };
  setCell(assumptions, "A1", { value: "Assumption", style: heading });
  setCell(assumptions, "B1", { value: "Value", style: heading });
  setCell(assumptions, "A2", "Monthly income");
  setCell(assumptions, "B2", {
    value: 4800,
    style: { numberFormat: currency },
  });
  setCell(assumptions, "A3", "Budget month");
  setCell(assumptions, "B3", {
    value: dateToSerial(2025, 9, 1),
    style: { numberFormat: "yyyy-mm-dd" },
  });
  assumptions.columns = { 0: { width: 210 }, 1: { width: 140 } };
  workbook.names.push({
    name: "MonthlyIncome",
    reference: "'Assumptions'!$B$2",
  });
  return workbook;
}

/** 100,000-row fixture is generated on demand, never inflated into a committed JSON file. */
export function createAnalyticsWorkbook(rowCount = 100_000): Workbook {
  if (!Number.isSafeInteger(rowCount) || rowCount < 1 || rowCount > 1_048_575)
    throw new RangeError("Fixture needs 1–1,048,575 data rows.");
  const workbook = createWorkbook("Sales analytics"),
    data = workbook.sheets[0],
    summary = createSheet("Summary");
  data.name = "Sales";
  workbook.sheets.push(summary);
  workbook.createdAt = workbook.updatedAt = "2025-09-01T00:00:00.000Z";
  workbook.metadata = {
    fixture: "analytics-v1",
    rows: rowCount,
    provenance: "Deterministic synthetic records; no remote data.",
  };
  const headers = [
    "Order ID",
    "Region",
    "Product",
    "Units",
    "Unit price",
    "Revenue",
    "Month",
  ];
  headers.forEach((value, col) =>
    setCell(data, cellAddress(0, col), { value, style: heading }),
  );
  const regions = ["East", "West", "North", "South"],
    products = ["Notebook", "Keyboard", "Monitor", "Headset", "Dock"];
  for (let index = 0; index < rowCount; index++) {
    const units = (index % 12) + 1,
      price = [5, 45, 180, 30, 90][index % 5];
    const values = [
      String(index + 1).padStart(9, "0"),
      regions[index % 4],
      products[index % 5],
      units,
      price,
      units * price,
      `2025-${String((index % 12) + 1).padStart(2, "0")}-01`,
    ];
    values.forEach((value, col) => {
      data.cells[cellAddress(index + 1, col)] = {
        value,
        ...(col === 0
          ? { style: { numberFormat: "@" } }
          : col === 4 || col === 5
            ? { style: { numberFormat: currency } }
            : {}),
      };
    });
  }
  data.columns = {
    0: { width: 132 },
    1: { width: 100 },
    2: { width: 120 },
    3: { width: 80 },
    4: { width: 110 },
    5: { width: 120 },
    6: { width: 124 },
  };
  data.freeze = { rows: 1, columns: 1 };
  data.tables.push({
    id: "sales-table",
    name: "SalesRecords",
    range: { start: { row: 0, col: 0 }, end: { row: rowCount, col: 6 } },
    columns: headers,
    headerRow: true,
    totalsRow: false,
    bandedRows: true,
    style: "TableStyleMedium4",
  });
  ["Region", "Revenue", "Orders"].forEach((value, col) =>
    setCell(summary, cellAddress(0, col), { value, style: heading }),
  );
  regions.forEach((region, index) => {
    const row = index + 2;
    setCell(summary, `A${row}`, region);
    setCell(summary, `B${row}`, {
      value: null,
      formula: `=SUMIF(Sales!B2:B${rowCount + 1},A${row},Sales!F2:F${rowCount + 1})`,
      style: { numberFormat: currency },
    });
    setCell(summary, `C${row}`, `=COUNTIF(Sales!B2:B${rowCount + 1},A${row})`);
  });
  summary.columns = { 0: { width: 140 }, 1: { width: 160 }, 2: { width: 100 } };
  summary.charts.push({
    id: "sales-chart",
    title: "Revenue by region",
    type: "column",
    range: parseRange("A1:B5"),
    x: 40,
    y: 170,
    width: 600,
    height: 300,
    showLegend: false,
  });
  summary.pivots.push({
    id: "sales-pivot",
    name: "Sales by region and product",
    sourceSheetId: data.id,
    source: data.tables[0].range,
    destination: { row: 19, col: 0 },
    rows: ["Region"],
    columns: ["Product"],
    values: [
      { field: "Revenue", aggregate: "sum" },
      { field: "Order ID", aggregate: "count" },
    ],
  });
  data.print.area = {
    start: { row: 0, col: 0 },
    end: { row: Math.min(50, rowCount), col: 6 },
  };
  data.print.repeatRows = [0, 0];
  data.print.fitToWidth = 1;
  return workbook;
}
