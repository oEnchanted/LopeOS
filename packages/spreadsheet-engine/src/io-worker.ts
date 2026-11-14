import {
  importXlsx,
  exportXlsx,
  importDelimited,
  exportDelimited,
  serializeWorkbook,
  deserializeWorkbook,
} from "./io.ts";

/** A single job per worker gives cancellation a hard boundary even inside library parsing. */
self.addEventListener("message", async (event) => {
  const { operation, payload } = event.data;
  try {
    let result: unknown;
    switch (operation) {
      case "importXlsx":
        result = await importXlsx(payload.bytes, payload.filename);
        break;
      case "exportXlsx":
        result = await exportXlsx(payload.workbook, {
          allowLossy: payload.allowLossy,
        });
        break;
      case "importDelimited":
        result = importDelimited(payload.text, payload.options);
        break;
      case "exportDelimited":
        result = exportDelimited(payload.sheet, payload.options);
        break;
      case "serialize":
        result = serializeWorkbook(payload.workbook);
        break;
      case "deserialize":
        result = deserializeWorkbook(payload.text);
        break;
      default:
        throw new Error("Unknown workbook file operation.");
    }
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
        warnings:
          error && typeof error === "object" && "warnings" in error
            ? error.warnings
            : undefined,
      },
    });
  }
});
