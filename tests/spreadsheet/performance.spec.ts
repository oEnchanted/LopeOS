import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
test("100,000-row workbook stays virtualized while navigating and recalculating", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "/tests/spreadsheet/harness.html?fixture=analytics&window=performance",
  );
  await expect(page.getByRole("grid", { name: "Sales worksheet" })).toBeVisible(
    { timeout: 90000 },
  );
  await expect(page.locator(".sheets-status")).not.toHaveText("Calculating…", {
    timeout: 90000,
  });
  const load = await page.evaluate(
      () => performance.now() - (window as any).fixtureReadyAt,
    ),
    domCells = await page.locator(".sheets-cell").count();
  expect(domCells).toBeLessThan(1500);
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .fill("A100000");
  const start = Date.now();
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .press("Enter");
  await expect(page.locator("[data-address=A100000]")).toHaveText("000099999");
  const navigation = Date.now() - start;
  const frames = await page.evaluate(async () => {
    const grid = document.querySelector(".sheets-grid")!,
      times: number[] = [];
    let previous = performance.now();
    for (let i = 0; i < 45; i++) {
      grid.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -44,
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      times.push(now - previous);
      previous = now;
    }
    return times;
  });
  await page.screenshot({
    path: "docs/spreadsheet/screenshots/analytics-100000.png",
  });
  await page.getByRole("textbox", { name: "Name box", exact: true }).fill("F2");
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .press("Enter");
  await page.locator("[data-address=F2]").dblclick();
  await page.getByRole("textbox", { name: "Edit F2", exact: true }).fill("100");
  const editStart = Date.now();
  await page
    .getByRole("textbox", { name: "Edit F2", exact: true })
    .press("Enter");
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const e = (window as any).sheetsTestEngine,
            s = e?.workbook.sheets.find((s: any) => s.name === "Summary");
          return s?.cells.B2.cached;
        }),
      { timeout: 90000 },
    )
    .toBe(8749675);
  const editMs = Date.now() - editStart;
  const memory = await page.evaluate(() =>
    (performance as any).memory
      ? {
          usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
          totalJSHeapSize: (performance as any).memory.totalJSHeapSize,
        }
      : null,
  );
  const sorted = [...frames].sort((a, b) => a - b);
  writeFileSync(
    "docs/spreadsheet/browser-benchmark.json",
    JSON.stringify(
      {
        host: {
          cpu: cpus()[0].model,
          memoryBytes: totalmem(),
          browser: page.context().browser()?.version(),
          viewport: { width: 1366, height: 900 },
          deviceScaleFactor: 1,
          headless: true,
        },
        rows: 100000,
        cells: 700007,
        openMs: load,
        navigationMs: navigation,
        editToDependentRecalculationMs: editMs,
        renderedCells: domCells,
        scrollFrameMs: {
          median: sorted[Math.floor(sorted.length / 2)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          max: Math.max(...frames),
        },
        memory,
        limitations: [
          "Headless synthetic input; not physical-display latency.",
          "Browser heap snapshot is not process peak memory.",
          "Single local run; no independent Excel performance comparison.",
        ],
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});
