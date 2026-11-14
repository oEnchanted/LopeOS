import {
  CompatibilityError,
  WorkbookFormatError,
  type DelimitedOptions,
  type IOOptions,
} from "./io.ts";
import type { Workbook, Worksheet } from "./model.ts";

function runFileJob<T>(
  operation: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./io-worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
      clearTimeout(timeout);
    };
    const abort = () => {
      cleanup();
      reject(
        new DOMException("Workbook file operation cancelled", "AbortError"),
      );
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new WorkbookFormatError(
          "The workbook file operation exceeded two minutes and was stopped. Try a smaller workbook.",
        ),
      );
    }, 120000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      if (event.data.error) {
        const data = event.data.error;
        const error =
          data.name === "CompatibilityError"
            ? new CompatibilityError(data.warnings ?? [data.message])
            : data.name === "WorkbookFormatError"
              ? new WorkbookFormatError(data.message)
              : new Error(data.message);
        reject(error);
      } else resolve(event.data.result as T);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Workbook file worker failed."));
    };
    try {
      worker.postMessage({ operation, payload });
    } catch (error) {
      cleanup();
      reject(error);
    }
    if (signal?.aborted) abort();
  });
}

export function importXlsxOffthread(
  bytes: Uint8Array,
  filename = "Workbook.xlsx",
  options: IOOptions = {},
): Promise<{ workbook: Workbook; warnings: string[] }> {
  return runFileJob("importXlsx", { bytes, filename }, options.signal);
}
export function exportXlsxOffthread(
  workbook: Workbook,
  options: IOOptions = {},
): Promise<Uint8Array> {
  return runFileJob(
    "exportXlsx",
    { workbook, allowLossy: options.allowLossy },
    options.signal,
  );
}
export function importDelimitedOffthread(
  text: string,
  options: DelimitedOptions = {},
): Promise<Workbook> {
  const { signal, ...settings } = options;
  return runFileJob("importDelimited", { text, options: settings }, signal);
}
export function exportDelimitedOffthread(
  sheet: Worksheet,
  options: DelimitedOptions = {},
): Promise<string> {
  const { signal, ...settings } = options;
  return runFileJob("exportDelimited", { sheet, options: settings }, signal);
}
export function serializeWorkbookOffthread(
  workbook: Workbook,
  signal?: AbortSignal,
): Promise<string> {
  return runFileJob("serialize", { workbook }, signal);
}
export function deserializeWorkbookOffthread(
  text: string,
  signal?: AbortSignal,
): Promise<Workbook> {
  return runFileJob("deserialize", { text }, signal);
}
