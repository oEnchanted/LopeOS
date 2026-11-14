import { test, expect } from "@playwright/test";

const url =
  process.env.SHEET_TEST_URL ??
  "http://127.0.0.1:5173/tests/spreadsheet/harness.html";
test.beforeEach(async ({ page }) => {
  await page.goto(url);
});

test("transactional recovery retains previous committed snapshot and isolates keys", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createWorkbook } = await import(
      "/packages/spreadsheet-engine/src/model.ts"
    );
    const { saveRecovery, loadRecovery, listRecoveries, removeRecovery } =
      await import("/packages/spreadsheet-engine/src/persistence.ts");
    const book = createWorkbook("Recovery test");
    const key = "test-" + crypto.randomUUID();
    const second = "test-" + crypto.randomUUID();
    try {
      book.sheets[0].cells.A1 = { value: "first" };
      book.revision = 1;
      await saveRecovery(book, { key });
      book.sheets[0].cells.A1 = { value: "second" };
      book.revision = 2;
      await saveRecovery(book, { key, expectedRevision: 1 });
      const other = createWorkbook("Independent");
      other.sheets[0].cells.A1 = { value: 99 };
      await saveRecovery(other, { key: second });
      const current = await loadRecovery(key),
        previous = await loadRecovery(key, true),
        independent = await loadRecovery(second),
        list = await listRecoveries();
      return {
        current: current?.sheets[0].cells.A1.value,
        previous: previous?.sheets[0].cells.A1.value,
        other: independent?.sheets[0].cells.A1.value,
        listed: list.some((row) => row.key === key && row.revision === 2),
      };
    } finally {
      await removeRecovery(key);
      await removeRecovery(second);
    }
  });
  expect(result).toEqual({
    current: "second",
    previous: "first",
    other: 99,
    listed: true,
  });
});

test("stale window cannot overwrite a newer committed recovery", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createWorkbook } = await import(
      "/packages/spreadsheet-engine/src/model.ts"
    );
    const { saveRecovery, loadRecovery, removeRecovery } = await import(
      "/packages/spreadsheet-engine/src/persistence.ts"
    );
    const book = createWorkbook("Conflict");
    const key = "test-" + crypto.randomUUID();
    book.revision = 4;
    try {
      await saveRecovery(book, { key });
      book.revision = 3;
      let reason = "";
      try {
        await saveRecovery(book, { key, expectedRevision: 2 });
      } catch (error) {
        reason = (error as any).reason;
      }
      return { reason, revision: (await loadRecovery(key))?.revision };
    } finally {
      await removeRecovery(key);
    }
  });
  expect(result).toEqual({ reason: "conflict", revision: 4 });
});

test("quota failure is explicit and leaves the prior snapshot intact", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createWorkbook } = await import(
      "/packages/spreadsheet-engine/src/model.ts"
    );
    const { saveRecovery, loadRecovery, removeRecovery } = await import(
      "/packages/spreadsheet-engine/src/persistence.ts"
    );
    const key = "test-" + crypto.randomUUID(),
      book = createWorkbook("Storage full");
    book.revision = 1;
    await saveRecovery(book, { key });
    const put = IDBObjectStore.prototype.put;
    let reason = "",
      message = "";
    try {
      IDBObjectStore.prototype.put = function () {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      };
      book.revision = 2;
      await saveRecovery(book, { key });
    } catch (error) {
      reason = (error as any).reason;
      message = (error as Error).message;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    try {
      return { reason, message, revision: (await loadRecovery(key))?.revision };
    } finally {
      await removeRecovery(key);
    }
  });
  expect(result.reason).toBe("quota");
  expect(result.message).toContain("still in memory");
  expect(result.revision).toBe(1);
});

test("browser worker performs real XLSX save/reopen and supports hard cancellation", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createWorkbook } = await import(
      "/packages/spreadsheet-engine/src/model.ts"
    );
    const { exportXlsxOffthread, importXlsxOffthread } = await import(
      "/packages/spreadsheet-engine/src/io-worker-client.ts"
    );
    const book = createWorkbook("Worker fixture");
    book.sheets[0].cells.A1 = { value: 41 };
    book.sheets[0].cells.B1 = { value: null, formula: "=A1+1", cached: 42 };
    const bytes = await exportXlsxOffthread(book),
      reopened = await importXlsxOffthread(bytes);
    const controller = new AbortController();
    const pending = exportXlsxOffthread(book, { signal: controller.signal });
    controller.abort();
    let cancelled = "";
    try {
      await pending;
    } catch (error) {
      cancelled = (error as Error).name;
    }
    return {
      value: reopened.workbook.sheets[0].cells.B1.cached,
      formula: reopened.workbook.sheets[0].cells.B1.formula,
      cancelled,
    };
  });
  expect(result).toEqual({
    value: 42,
    formula: "=A1+1",
    cancelled: "AbortError",
  });
});
