import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkbook,
  parseRange,
  setCell,
  type Chart,
} from "../../packages/spreadsheet-engine/src/model.ts";
import { chartPresentation } from "../../apps/web/src/apps/spreadsheet/chart-svg.ts";
import {
  generatePrintHTML,
  paginateSheet,
} from "../../apps/web/src/apps/spreadsheet/print.ts";
import { runNumerical } from "../../apps/web/src/apps/spreadsheet/numerical.worker.ts";

function sample(type: Chart["type"] = "column") {
  const workbook = createWorkbook("Chart fixture"),
    sheet = workbook.sheets[0];
  [
    ["Category", "One", "Two"],
    ["A", 10, 30],
    ["B", 20, 40],
    ["C", 30, 50],
  ].forEach((row, r) =>
    row.forEach((value, c) =>
      setCell(sheet, `${String.fromCharCode(65 + c)}${r + 1}`, value),
    ),
  );
  const chart: Chart = {
    id: "test-chart",
    title: "Linked values",
    type,
    range: parseRange("A1:C4"),
    x: 20,
    y: 120,
    width: 600,
    height: 320,
    showLegend: true,
  };
  sheet.charts.push(chart);
  return { workbook, sheet, chart };
}

test("shared chart renderer displays linked series and updates after cell edits", () => {
  const { sheet, chart } = sample();
  assert.deepEqual(
    chartPresentation(chart, sheet).series[0].values,
    [10, 20, 30],
  );
  setCell(sheet, "B3", 99);
  assert.deepEqual(
    chartPresentation(chart, sheet).series[0].values,
    [10, 99, 30],
  );
  assert.match(chartPresentation(chart, sheet).svg, /One — B: 99/);
});

test("line and area gaps do not join across blanks, strings or formula errors", () => {
  const { sheet, chart } = sample("area");
  setCell(sheet, "B3", null);
  setCell(sheet, "C3", { type: "error", code: "#N/A" });
  const result = chartPresentation(chart, sheet);
  assert.deepEqual(result.series[0].values, [10, null, 30]);
  assert.equal(result.svg.includes("<polyline"), false);
  assert.equal(result.svg.includes("<polygon"), false);
});

test("bar chart spacing uses series count and numeric axes, with exact zero-length zero values", () => {
  const { sheet, chart } = sample("bar");
  const result = chartPresentation(chart, sheet);
  assert.ok(result.svg.includes('height="26.3333"'));
  setCell(sheet, "B2", 0);
  assert.match(
    chartPresentation(chart, sheet).svg,
    /width="0" height="26.3333"/,
  );
});

test("scatter uses underlying numeric x values, while invalid pie input reports an error", () => {
  const { sheet, chart } = sample("scatter");
  assert.match(chartPresentation(chart, sheet).error ?? "", /numeric x/);
  setCell(sheet, "A2", { value: 1, style: { numberFormat: "$0.00" } });
  setCell(sheet, "A3", 2);
  setCell(sheet, "A4", 3);
  assert.equal(chartPresentation(chart, sheet).error, undefined);
  assert.ok(chartPresentation(chart, sheet).svg.includes("<circle"));
  chart.type = "pie";
  setCell(sheet, "B2", -1);
  assert.match(chartPresentation(chart, sheet).error ?? "", /nonnegative/);
});

test("chart markup escapes untrusted cell labels and title text", () => {
  const { sheet, chart } = sample();
  chart.title = "<script>unsafe</script>";
  setCell(sheet, "A2", '<image href="https://invalid.example">');
  const result = chartPresentation(chart, sheet);
  assert.equal(result.svg.includes("<script>"), false);
  assert.equal(result.svg.includes("<image "), false);
  assert.ok(result.svg.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
});

test("print includes the identical linked chart SVG and extends the default range to drawings", () => {
  const { workbook, sheet, chart } = sample();
  const layout = paginateSheet(sheet),
    html = generatePrintHTML(workbook, sheet.id);
  assert.ok(layout.range.end.row >= 19);
  assert.ok(html.includes(chartPresentation(chart, sheet).svg));
  assert.ok(html.includes('data-chart-id="test-chart"'));
  sheet.print.area = parseRange("A1:C4");
  assert.equal(
    generatePrintHTML(workbook, sheet.id).includes(
      'data-chart-id="test-chart"',
    ),
    false,
  );
});

test("charts that cross printed page breaks are clipped onto both pages", () => {
  const { workbook, sheet, chart } = sample();
  chart.y = 130;
  chart.height = 320;
  sheet.print.rowBreaks = [10];
  const html = generatePrintHTML(workbook, sheet.id);
  assert.equal((html.match(/data-chart-id="test-chart"/g) ?? []).length, 2);
});

test("numerical worker reports the changing input separately from the calculated target", () => {
  const workbook = createWorkbook(),
    sheet = workbook.sheets[0];
  setCell(sheet, "A1", 2);
  setCell(sheet, "B1", "=A1*3");
  const result = runNumerical({
    kind: "goal",
    workbook,
    sheetId: sheet.id,
    values: {
      target: "$b$1",
      variable: "a1",
      value: "30",
      min: "0",
      max: "100",
    },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.addresses, ["A1"]);
  assert.equal(result.variables[0], 10);
  assert.equal(result.objective, 30);
});

test("numerical worker rejects duplicate variables and nondeterministic models", () => {
  const workbook = createWorkbook(),
    sheet = workbook.sheets[0];
  setCell(sheet, "A1", 2);
  setCell(sheet, "B1", "=A1*3");
  assert.throws(
    () =>
      runNumerical({
        kind: "solver",
        workbook,
        sheetId: sheet.id,
        values: {
          target: "B1",
          variables: "A1,a1",
          min: "0",
          max: "100",
          direction: "min",
        },
      }),
    /only once/,
  );
  setCell(sheet, "C1", "=RAND()");
  assert.throws(
    () =>
      runNumerical({
        kind: "goal",
        workbook,
        sheetId: sheet.id,
        values: {
          target: "B1",
          variable: "A1",
          value: "30",
          min: "0",
          max: "100",
        },
      }),
    /deterministic/,
  );
});
