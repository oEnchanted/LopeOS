import { WorkbookEngine } from "../../../../../packages/spreadsheet-engine/src/calculation";
let engine: WorkbookEngine | undefined;
self.onmessage = (event) => {
  const { id, workbook, force = false } = event.data;
  try {
    if (!engine) engine = new WorkbookEngine(workbook);
    else engine.updateSnapshot(workbook);
    const report = engine.calculate(force),
      spills = Object.fromEntries(
        engine.workbook.sheets.map((sheet) => [
          sheet.id,
          engine!.spillEntries(sheet.id),
        ]),
      );
    self.postMessage({
      id,
      result: { workbook: engine.workbook, report, spills },
    });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
