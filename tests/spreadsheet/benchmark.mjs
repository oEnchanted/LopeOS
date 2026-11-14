import { performance } from "node:perf_hooks";
import os from "node:os";
import { writeFile } from "node:fs/promises";
import {
  chartData,
  filterData,
  pivotData,
  runQuery,
  sheetData,
  sortData,
} from "../../packages/spreadsheet-engine/src/analysis.ts";
import {
  createAnalyticsWorkbook,
  createBudgetWorkbook,
} from "../../packages/spreadsheet-engine/src/fixtures.ts";
import { generatePrintHTML } from "../../apps/web/src/apps/spreadsheet/print.ts";

const timings = [];
function measured(name, fn) {
  const before = process.memoryUsage(),
    start = performance.now(),
    result = fn(),
    elapsedMs = performance.now() - start,
    after = process.memoryUsage();
  timings.push({
    name,
    elapsedMs: +elapsedMs.toFixed(3),
    heapUsedBeforeBytes: before.heapUsed,
    heapUsedAfterBytes: after.heapUsed,
    rssAfterBytes: after.rss,
  });
  return result;
}
const workbook = measured(
  "Generate 100,000-row workbook, 700,007 source cells",
  () => createAnalyticsWorkbook(100_000),
);
const source = measured(
  "Read 100,000 typed records from the sparse worksheet",
  () => sheetData(workbook.sheets[0], workbook.sheets[0].tables[0].range),
);
const pivotSpec = {
  rows: ["Region"],
  columns: ["Product"],
  values: [
    { field: "Revenue", aggregate: "sum" },
    { field: "Order ID", aggregate: "count" },
  ],
};
for (let run = 1; run <= 3; run++) {
  measured(`Stable Region/Revenue sort ${run}`, () =>
    sortData(source, [
      { field: "Region" },
      { field: "Revenue", direction: "desc" },
    ]),
  );
  measured(`Revenue >= 500 filter ${run}`, () =>
    filterData(source, [{ field: "Revenue", operator: "gte", value: 500 }]),
  );
  const pivot = measured(`4 x 5 pivot with sum/count ${run}`, () =>
    pivotData(source, pivotSpec),
  );
  if (pivot.grandTotals[1] !== 100_000)
    throw new Error("Benchmark pivot count is incorrect.");
  measured(`Query filter/group/sort ${run}`, () =>
    runQuery(source, [
      {
        kind: "filter",
        filters: [{ field: "Units", operator: "gt", value: 4 }],
      },
      {
        kind: "group",
        by: ["Region"],
        values: [{ field: "Revenue", aggregate: "sum", name: "Revenue" }],
      },
      { kind: "sort", keys: [{ field: "Revenue", direction: "desc" }] },
    ]),
  );
  measured(`Chart from aggregated pivot ${run}`, () =>
    chartData(pivot.data, "Region", [pivot.data.columns[1]]),
  );
}
const budget = createBudgetWorkbook();
const html = measured("Paginate and generate budget print preview", () =>
  generatePrintHTML(budget, budget.sheets[0].id),
);
const report = {
  measuredAt: new Date().toISOString(),
  runtime: process.version,
  platform: os.platform(),
  release: os.release(),
  arch: os.arch(),
  cpu: os.cpus()[0]?.model ?? "unknown",
  logicalCores: os.cpus().length,
  systemMemoryBytes: os.totalmem(),
  fixture: {
    rows: 100_000,
    columns: 7,
    sourceCells: 700_007,
    printHTMLBytes: Buffer.byteLength(html),
  },
  scope:
    "Synchronous Node engine operations. Timings include allocations and natural GC. Memory values are snapshots, not measured process peak memory. This does not measure browser scroll/edit latency, worker transfer, XLSX IO or an independent Excel installation.",
  timings,
};
await writeFile(
  new URL("../../docs/spreadsheet/benchmarks.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      hardware: report.cpu,
      runtime: report.runtime,
      rows: report.fixture.rows,
      timings: timings.map(({ name, elapsedMs }) => ({ name, elapsedMs })),
    },
    null,
    2,
  ),
);
