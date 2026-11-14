import test from "node:test";
import assert from "node:assert/strict";
import {
  AnalysisError,
  chartData,
  drillThrough,
  filterData,
  goalSeek,
  pivotData,
  removeDuplicates,
  runQuery,
  solve,
  sortData,
  splitDelimitedCell,
  textToColumns,
  type DataSet,
} from "../../packages/spreadsheet-engine/src/analysis.ts";

const sales: DataSet = {
  columns: ["ID", "Region", "Product", "Revenue", "Units", "Date"],
  rowIds: ["a", "b", "c", "d", "e"],
  rows: [
    {
      ID: "001",
      Region: "West",
      Product: "A",
      Revenue: 10,
      Units: 2,
      Date: "2025-01-01",
    },
    {
      ID: "002",
      Region: "East",
      Product: "B",
      Revenue: 30,
      Units: 3,
      Date: "2025-02-01",
    },
    {
      ID: "003",
      Region: "West",
      Product: "A",
      Revenue: 20,
      Units: 4,
      Date: "2025-01-20",
    },
    {
      ID: "004",
      Region: "East",
      Product: "A",
      Revenue: 40,
      Units: 4,
      Date: "2025-04-01",
    },
    {
      ID: "005",
      Region: "West",
      Product: "B",
      Revenue: null,
      Units: 1,
      Date: "2025-06-01",
    },
  ],
};

test("multi-key sorting moves whole stable records and retains row identities", () => {
  const result = sortData(sales, [
    { field: "Region" },
    { field: "Revenue", direction: "desc" },
  ]);
  assert.deepEqual(
    result.rows.map((row) => row.ID),
    ["004", "002", "003", "001", "005"],
  );
  assert.deepEqual(result.rowIds, ["d", "b", "c", "a", "e"]);
  assert.equal(result.rows[0], sales.rows[3]);
  assert.equal(sales.rows[0].ID, "001");
  const tied = sortData(sales, [{ field: "Region" }]);
  assert.deepEqual(tied.rowIds, ["b", "d", "a", "c", "e"]);
});

test("filters distinguish blanks, errors, numbers, text numerals and inclusive ranges", () => {
  const data: DataSet = {
    columns: ["v"],
    rows: [
      { v: 10 },
      { v: "10" },
      { v: null },
      { v: "" },
      { v: { type: "error", code: "#N/A" } },
      { v: 20 },
    ],
  };
  assert.equal(
    filterData(data, [{ field: "v", operator: "eq", value: 10 }]).rows.length,
    1,
  );
  assert.equal(
    filterData(data, [{ field: "v", operator: "blank" }]).rows.length,
    2,
  );
  assert.equal(
    filterData(data, [{ field: "v", operator: "error" }]).rows.length,
    1,
  );
  assert.equal(
    filterData(data, [{ field: "v", operator: "between", values: [10, 20] }])
      .rows.length,
    2,
  );
  assert.equal(
    filterData(sales, [
      { field: "Region", operator: "contains", value: "wes" },
      { field: "Revenue", operator: "gte", value: 15 },
    ]).rows[0].ID,
    "003",
  );
  assert.throws(
    () => filterData(data, [{ field: "missing", operator: "blank" }]),
    /Unknown field/,
  );
});

test("duplicates preserve first records, and text-to-columns retains leading zero identifiers", () => {
  const data: DataSet = {
    columns: ["v"],
    rows: [{ v: "A" }, { v: "a" }, { v: 1 }, { v: "1" }],
  };
  assert.equal(removeDuplicates(data).removed, 1);
  assert.deepEqual(splitDelimitedCell('001,"Doe, Jane","a""b"'), [
    "001",
    "Doe, Jane",
    'a"b',
  ]);
  assert.throws(() => splitDelimitedCell('"bad'), /Unterminated/);
  const result = textToColumns(
    {
      columns: ["csv"],
      rows: [{ csv: "001,12345678901234567890" }, { csv: "002,9" }],
    },
    "csv",
  );
  assert.equal(result.rows[0]["csv.2"], "12345678901234567890");
  assert.equal(result.rows[0].csv, "001");
});

test("pivot row/column/value areas compute real counts, averages, totals and drill-through", () => {
  const result = pivotData(sales, {
    rows: ["Region"],
    columns: ["Product"],
    values: [
      { field: "Revenue", aggregate: "sum" },
      { field: "Units", aggregate: "average" },
    ],
  });
  assert.deepEqual(result.rowKeys, [["East"], ["West"]]);
  assert.deepEqual(result.columnKeys, [["A"], ["B"]]);
  assert.deepEqual(result.cells[0][0].values, [40, 4]);
  assert.deepEqual(result.cells[1][0].values, [30, 3]);
  assert.deepEqual(result.grandTotals, [100, 2.8]);
  assert.deepEqual(result.rowTotals, [
    [70, 3.5],
    [30, 7 / 3],
  ]);
  assert.deepEqual(drillThrough(result, 1, 0).rowIds, ["a", "c"]);
  assert.deepEqual(result.data.columns, [
    "Region",
    "A / sum of Revenue",
    "A / average of Units",
    "B / sum of Revenue",
    "B / average of Units",
  ]);
  const updated = structuredClone(sales);
  updated.rows[0].Revenue = 100;
  assert.deepEqual(pivotData(updated, result.spec).grandTotals, [190, 2.8]);
});

test("pivot filters, calendar groups, numeric groups, subtotals and show-values-as", () => {
  const result = pivotData(sales, {
    rows: ["Region", "Product"],
    columns: [{ field: "Date", group: "quarter" }],
    values: [{ field: "Revenue", aggregate: "sum" }],
    filters: [{ field: "Revenue", operator: "notBlank" }],
  });
  assert.deepEqual(result.columnKeys, [["2025 Q1"], ["2025 Q2"]]);
  assert.deepEqual(
    result.subtotals.find((item) => item.key[0] === "East")?.values,
    [70],
  );
  assert.equal(
    result.cells
      .flat()
      .reduce((count, cell) => count + cell.sourceIndices.length, 0),
    4,
  );
  const percent = pivotData(sales, {
    rows: ["Region"],
    values: [{ field: "Revenue", aggregate: "sum" }],
    showValuesAs: "percentGrandTotal",
  });
  assert.deepEqual(
    percent.cells.map((row) => row[0].values[0]),
    [0.7, 0.3],
  );
  const buckets = pivotData(sales, {
    rows: [{ field: "Revenue", group: { interval: 25 } }],
    values: [{ field: "ID", aggregate: "count" }],
  });
  assert.deepEqual(buckets.rowKeys, [[0], [25], [null]]);
});

test("pivot averages and sample statistics ignore nonnumeric cells and propagate source errors", () => {
  const data: DataSet = {
    columns: ["g", "v"],
    rows: [
      { g: "a", v: 1 },
      { g: "a", v: 2 },
      { g: "a", v: 3 },
      { g: "a", v: "4" },
    ],
  };
  const result = pivotData(data, {
    rows: ["g"],
    values: [
      { field: "v", aggregate: "variance" },
      { field: "v", aggregate: "stdev" },
      { field: "v", aggregate: "count" },
      { field: "v", aggregate: "countNumbers" },
    ],
  });
  assert.deepEqual(result.grandTotals, [1, 1, 4, 3]);
  data.rows.push({ g: "a", v: { type: "error", code: "#REF!" } });
  assert.deepEqual(
    pivotData(data, { rows: ["g"], values: [{ field: "v", aggregate: "sum" }] })
      .grandTotals,
    [{ type: "error", code: "#REF!" }],
  );
});

test("query supports typed steps, preview history, repeatable refresh and row errors", () => {
  const source: DataSet = {
    columns: ["ID", "value"],
    rows: [
      { ID: "001", value: "12" },
      { ID: "002", value: "bad" },
      { ID: "003", value: "15" },
    ],
  };
  const typed = runQuery(source, [
    { kind: "type", column: "value", dataType: "number" },
  ]);
  assert.equal(typed.data.rows[0].ID, "001");
  assert.equal(typed.errors.length, 1);
  assert.equal(typed.errors[0].row, 1);
  const result = runQuery(source, [
    { kind: "type", column: "value", dataType: "number" },
    { kind: "filter", filters: [{ field: "value", operator: "notError" }] },
    { kind: "sort", keys: [{ field: "value", direction: "desc" }] },
    { kind: "rename", columns: { value: "Revenue" } },
    { kind: "select", columns: ["Revenue"] },
  ]);
  assert.deepEqual(result.data.rows, [{ Revenue: 15 }, { Revenue: 12 }]);
  assert.equal(result.steps.length, 5);
  assert.equal(source.rows[0].value, "12");
});

test("join retains duplicate matches, left blanks and bounded output", () => {
  const people: DataSet = {
    columns: ["id", "name"],
    rows: [
      { id: 1, name: "One" },
      { id: 2, name: "Two" },
    ],
  };
  const visits: DataSet = {
    columns: ["id", "visits"],
    rows: [
      { id: 1, visits: 4 },
      { id: 1, visits: 5 },
    ],
  };
  const result = runQuery(people, [
    { kind: "join", data: visits, left: ["id"], right: ["id"], mode: "left" },
  ]);
  assert.deepEqual(
    result.data.rows.map((row) => row["joined.visits"]),
    [4, 5, null],
  );
  assert.throws(
    () =>
      runQuery(
        people,
        [
          {
            kind: "join",
            data: visits,
            left: ["id"],
            right: ["id"],
            mode: "left",
          },
        ],
        { maxRows: 2 },
      ),
    AnalysisError,
  );
});

test("append aligns columns; unpivot and group produce actual transformed records", () => {
  const source: DataSet = {
    columns: ["name", "Jan", "Feb"],
    rows: [
      { name: "A", Jan: 1, Feb: 3 },
      { name: "B", Jan: 2, Feb: 4 },
    ],
  };
  const result = runQuery(source, [
    { kind: "unpivot", columns: ["Jan", "Feb"] },
    {
      kind: "group",
      by: ["Attribute"],
      values: [{ field: "Value", aggregate: "sum", name: "Total" }],
    },
  ]);
  assert.deepEqual(result.data.rows, [
    { Attribute: "Feb", Total: 7 },
    { Attribute: "Jan", Total: 3 },
  ]);
  const appended = runQuery(source, [
    {
      kind: "append",
      data: { columns: ["name", "Mar"], rows: [{ name: "C", Mar: 7 }] },
    },
  ]);
  assert.deepEqual(appended.data.rows[2], {
    name: "C",
    Jan: null,
    Feb: null,
    Mar: 7,
  });
});

test("chart data links to numeric values while retaining gaps for text/blanks/errors", () => {
  const result = chartData(sales, "ID", ["Revenue"]);
  assert.deepEqual(result.labels, ["001", "002", "003", "004", "005"]);
  assert.deepEqual(result.series[0].values, [10, 30, 20, 40, null]);
  assert.throws(
    () => chartData(sales, "ID", ["Revenue"], { maxPoints: 4 }),
    /too many points/,
  );
});

test("Goal Seek converges on a nonlinear formula and measures target residual", () => {
  const result = goalSeek((x) => x * x, 2, 1);
  assert.equal(result.success, true);
  assert.ok(Math.abs(result.input - Math.SQRT2) < 1e-8);
  assert.ok(result.residual <= 1e-8);
  assert.ok(result.evaluations <= 500);
  assert.equal(goalSeek((x) => x + 7, 4, 0).input, -3);
});

test("Goal Seek never reports success for impossible targets, discontinuities or invalid formulas", () => {
  assert.equal(goalSeek((x) => x * x, -1, 0).success, false);
  assert.equal(goalSeek(() => NaN, 0, 0).status, "invalid-value");
  assert.equal(
    goalSeek((x) => (x < 0 ? -1 : 1), 0, 0.2, { maxIterations: 50 }).success,
    false,
  );
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    goalSeek((x) => x, 0, 1, { signal: controller.signal }).status,
    "cancelled",
  );
});

test("Solver reaches a known box-constrained local minimum with explicit tolerances", () => {
  const result = solve({
    objective: ([x, y]) => (x - 3) ** 2 + (y + 2) ** 2,
    initial: [0, 0],
    bounds: [
      { min: -10, max: 10 },
      { min: -10, max: 10 },
    ],
  });
  assert.equal(result.success, true, result.message);
  assert.ok(Math.abs(result.variables[0] - 3) < 1e-5);
  assert.ok(Math.abs(result.variables[1] + 2) < 1e-5);
  assert.ok(result.objective < 1e-10);
  assert.match(result.message, /Global optimality is not established/);
});

test("Solver checks nonlinear constraints and reports unreachable constraints honestly", () => {
  const result = solve({
    objective: ([x]) => (x - 3) ** 2,
    initial: [0],
    bounds: [{ min: 0, max: 10 }],
    constraints: [{ evaluate: ([x]) => x, relation: "<=", value: 2 }],
  });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.ok(result.variables[0] <= 2 + 1e-6);
  assert.ok(Math.abs(result.variables[0] - 2) < 1e-5);
  const impossible = solve({
    objective: ([x]) => x,
    initial: [1],
    bounds: [{ min: 0, max: 2 }],
    constraints: [{ evaluate: ([x]) => x, relation: ">=", value: 3 }],
  });
  assert.equal(impossible.success, false);
  assert.ok(impossible.maxViolation >= 1);
});

test("100,000 deterministic records sort, filter, pivot and refresh within bounded structures", () => {
  const count = 100_000;
  const data: DataSet = {
    columns: ["ID", "Region", "Revenue"],
    rows: Array.from({ length: count }, (_, index) => ({
      ID: index,
      Region: ["East", "West", "North", "South"][index % 4],
      Revenue: index % 100,
    })),
    rowIds: Array.from({ length: count }, (_, index) => String(index)),
  };
  const sorted = sortData(data, [
    { field: "Region" },
    { field: "Revenue", direction: "desc" },
  ]);
  assert.equal(sorted.rows.length, count);
  const filtered = filterData(data, [
    { field: "Revenue", operator: "gte", value: 50 },
  ]);
  assert.equal(filtered.rows.length, 50_000);
  const pivot = pivotData(data, {
    rows: ["Region"],
    values: [
      { field: "Revenue", aggregate: "sum" },
      { field: "ID", aggregate: "count" },
    ],
  });
  assert.deepEqual(pivot.grandTotals, [4_950_000, count]);
  assert.equal(pivot.cells.length, 4);
  assert.equal(drillThrough(pivot, 0, 0).rows.length, 25_000);
  data.rows[0].Revenue = 200;
  assert.equal(pivotData(data, pivot.spec).grandTotals[0], 4_950_200);
  assert.throws(
    () => pivotData(data, pivot.spec, { maxRows: 50_000 }),
    /limit/,
  );
});
