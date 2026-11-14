import { writeFile } from "node:fs/promises";
import os from "node:os";
import assert from "node:assert/strict";
import { createWorkbook } from "../../packages/spreadsheet-engine/src/model.ts";
import { WorkbookEngine } from "../../packages/spreadsheet-engine/src/calculation.ts";
import { functionRegistry } from "../../packages/spreadsheet-engine/src/function-registry.ts";
const rows = 100_000,
  book = createWorkbook("100000-row calculation fixture"),
  sheet = book.sheets[0];
let start = performance.now();
for (let row = 1; row <= rows; row++) {
  sheet.cells[`A${row}`] = { value: row };
  sheet.cells[`B${row}`] = { value: null, formula: `=A${row}*2` };
}
sheet.cells.C1 = { value: null, formula: "=SUM(B:B)" };
const fixtureMs = performance.now() - start;
start = performance.now();
const engine = new WorkbookEngine(book);
const graphBuildMs = performance.now() - start;
const full = engine.calculate();
assert.equal(engine.value(sheet.id, "C1"), rows * (rows + 1));
start = performance.now();
engine.setCell(sheet.id, "A50000", 50001);
const incremental = engine.calculate();
const editToRecalcMs = performance.now() - start;
assert.equal(engine.value(sheet.id, "C1"), rows * (rows + 1) + 2);
assert.equal(incremental.evaluated, 2);
const result = {
  measuredAt: new Date().toISOString(),
  hardware: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    node: process.version,
  },
  fixture: {
    rows,
    occupiedCells: Object.keys(sheet.cells).length,
    formulas: rows + 1,
  },
  timingsMs: {
    fixture: fixtureMs,
    dependencyGraph: graphBuildMs,
    fullCalculation: full.durationMs,
    editToRecalc: editToRecalcMs,
    incrementalCalculation: incremental.durationMs,
  },
  evaluated: { full: full.evaluated, incremental: incremental.evaluated },
  memory: {
    ...process.memoryUsage(),
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
  },
  notes: [
    "Node process measurements, not browser scrolling or physical-display latency.",
    "One deterministic run; full calculation includes 100,000 dependent formulas and a sparse whole-column SUM.",
    "Peak RSS is operating-system-reported process peak; no GPU memory is measured.",
  ],
};
await writeFile(
  new URL("../../docs/spreadsheet/engine-benchmark.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
await writeFile(
  new URL(
    "../../docs/spreadsheet/function-compatibility.json",
    import.meta.url,
  ),
  JSON.stringify(
    {
      catalogSource:
        "https://support.microsoft.com/en-us/excel/excel-functions-alphabetical",
      catalogConsulted: "2026-11-13",
      library: {
        name: "fast-formula-parser",
        version: "1.0.19",
        license: "MIT",
      },
      tests: "tests/spreadsheet/engine.test.ts",
      differentialExcelTests: false,
      notes:
        "Fixture-tested means deterministic local assertions pass. It does not certify complete Excel semantics.",
      functions: functionRegistry,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(result, null, 2));
