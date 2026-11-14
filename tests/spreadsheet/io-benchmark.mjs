import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import {
  importDelimited,
  importXlsx,
  exportXlsx,
  exportDelimited,
} from "../../packages/spreadsheet-engine/src/io.ts";
import { parseRange } from "../../packages/spreadsheet-engine/src/model.ts";
const measurements = [];
async function measure(name, fn) {
  const start = performance.now();
  const result = await fn();
  measurements.push({
    operation: name,
    elapsedMs: Math.round((performance.now() - start) * 100) / 100,
    rssMiBAfter: Math.round((process.memoryUsage().rss / 1048576) * 100) / 100,
  });
  return result;
}
const csv =
  "Region,Units,Amount\n" +
  Array.from(
    { length: 100000 },
    (_, i) =>
      `${["North", "South", "East", "West"][i % 4]},${(i % 100) + 1},${(((i % 100) + 1) * 19.95).toFixed(2)}`,
  ).join("\n");
const book = await measure("Import 100000-row, 3-column CSV as text", () =>
  importDelimited(csv, { name: "Deterministic analytics" }),
);
book.sheets[0].tables = [
  {
    id: "analytics",
    name: "Analytics",
    range: parseRange("A1:C100001"),
    columns: ["Region", "Units", "Amount"],
    headerRow: true,
    totalsRow: false,
    bandedRows: true,
  },
];
const bytes = await measure("Export 100000-row XLSX table", () =>
  exportXlsx(book),
);
const imported = await measure("Import 100000-row XLSX table", () =>
  importXlsx(bytes),
);
const output = await measure("Export 100000-row CSV", () =>
  exportDelimited(imported.workbook.sheets[0]),
);
const report = {
  environment: {
    node: process.version,
    platform: os.platform(),
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model,
    totalMemoryGiB: Math.round(os.totalmem() / 1073741824),
  },
  dataset: {
    rows: 100000,
    columns: 3,
    populatedCells: Object.keys(book.sheets[0].cells).length,
    table: true,
    xlsxBytes: bytes.length,
    csvBytes: csv.length,
  },
  measurements,
  maximumResidentSetKiB: process.resourceUsage().maxRSS,
  validation: {
    reopenedCells: Object.keys(imported.workbook.sheets[0].cells).length,
    tableName: imported.workbook.sheets[0].tables[0].name,
    csvRows: output.split("\r\n").length,
  },
  notes: [
    "Node process timings, not browser scrolling latency.",
    "XLSX library buffers the entire bounded package.",
    "Maximum RSS is the process high-water mark, including all preceding phases.",
  ],
};
await writeFile(
  new URL("../../docs/spreadsheet/io-benchmark.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
