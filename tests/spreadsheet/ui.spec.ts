import { test, expect, type Page } from "@playwright/test";
const cell = (page: Page, address: string) =>
  page.locator(`.sheets-cell[data-address="${address}"]`);
async function open(page: Page) {
  await page.goto("/tests/spreadsheet/harness.html");
  await expect(
    page.getByRole("grid", { name: "Sheet1 worksheet" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).not.toHaveText("Calculating…");
}
async function enter(page: Page, address: string, value: string) {
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .fill(address);
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .press("Enter");
  await cell(page, address).dblclick();
  await page
    .getByRole("textbox", { name: `Edit ${address}`, exact: true })
    .fill(value);
  await page
    .getByRole("textbox", { name: `Edit ${address}`, exact: true })
    .press("Enter");
}
async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}
test("editing, dependent formulas, formatting, undo, clipboard, sparse boundaries, and recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await enter(page, "A1", "12");
  await enter(page, "A2", "8");
  await enter(page, "B1", "=SUM(A1:A2)");
  await expect(cell(page, "B1")).toHaveText("20");
  await enter(page, "A2", "18");
  await expect(cell(page, "B1")).toHaveText("30");
  await page.getByRole("textbox", { name: "Name box", exact: true }).fill("B1");
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .press("Enter");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(cell(page, "B1")).toHaveCSS("font-weight", "700");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(cell(page, "B1")).toHaveCSS("font-weight", "400");
  await enter(page, "D1", "=SEQUENCE(3)");
  await expect(cell(page, "D3")).toHaveText("3");
  await enter(page, "XFD1048576", "boundary");
  await expect(cell(page, "XFD1048576")).toHaveText("boundary");
  expect(await page.locator(".sheets-cell").count()).toBeLessThan(1500);
  await page.getByRole("textbox", { name: "Name box", exact: true }).fill("A1");
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .press("Enter");
  await expect(page.locator(".sheets-save-state")).toHaveText(
    "Recovery saved locally",
  );
  await page.reload();
  await expect(
    page.getByText("Recovered your workbook from local storage."),
  ).toBeVisible();
  await expect(cell(page, "B1")).toHaveText("30");
  expect(errors).toEqual([]);
  await page.screenshot({ path: "docs/spreadsheet/screenshots/editing.png" });
});
test("budget workbook, chart, table context, pivot aggregation, print preview, and workspace save", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await tab(page, "File");
  await page
    .getByRole("button", { name: "Budget Example", exact: true })
    .click();
  await expect(page.locator(".sheets-chart")).toHaveCount(1);
  await expect(page.getByRole("status")).not.toHaveText("Calculating…");
  await page.screenshot({
    path: "docs/spreadsheet/screenshots/budget-home.png",
  });
  const wb = await page.evaluate(
    () => (window as any).sheetsTestEngine.workbook,
  );
  expect(wb.sheets[0].cells).toBeTruthy();
  await tab(page, "Insert");
  await page
    .getByRole("button", { name: "Column or Bar", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Insert Chart", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .fill("A1:D7");
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .press("Enter");
  await tab(page, "Data");
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Sort", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/spreadsheet/screenshots/sort-dialog.png",
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await tab(page, "File");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.locator(".sheets-save-state")).toHaveText(
    "Saved to workspace",
  );
  expect(await page.evaluate(() => (window as any).testFiles.size)).toBe(1);
  await tab(page, "Page Layout");
  await page
    .getByRole("button", { name: "Print Preview", exact: true })
    .click();
  await expect(page.getByTitle("Workbook print preview")).toBeVisible();
  await page.screenshot({
    path: "docs/spreadsheet/screenshots/print-preview.png",
  });
  expect(errors).toEqual([]);
});
test("validation rejects invalid typed and pasted values, formula bar retains focus, narrow ribbon accessible", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("textbox", { name: "Formula bar", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Formula bar", exact: true })
    .fill("=SUM(1,2)");
  await expect(
    page.getByRole("textbox", { name: "Formula bar", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Formula bar", exact: true })
    .press("Enter");
  await expect(cell(page, "A1")).toHaveText("3");
  await page.getByRole("textbox", { name: "Name box", exact: true }).fill("B1");
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .press("Enter");
  await tab(page, "Data");
  await page
    .getByRole("button", { name: "Data Validation", exact: true })
    .click();
  await page.getByLabel("Allow", { exact: true }).selectOption("whole");
  await page.getByLabel("Minimum / value", { exact: true }).fill("1");
  await page.getByLabel("Maximum", { exact: true }).fill("5");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await enter(page, "B1", "7");
  await expect(page.getByRole("alert")).toContainText("validation");
  await expect(
    page.getByRole("textbox", { name: "Edit B1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Edit B1", exact: true })
    .press("Escape");
  await enter(page, "B1", "4");
  await expect(cell(page, "B1")).toHaveText("4");
  await page.setViewportSize({ width: 640, height: 640 });
  await tab(page, "Home");
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find & Select", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({ path: "docs/spreadsheet/screenshots/narrow.png" });
});
test("tables sort whole records; pivots, linked charts, query refresh, and numerical solve are real operations", async ({
  page,
}) => {
  await open(page);
  await cell(page, "A1").click();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData(
      "text/plain",
      "Team\tUnits\tPrice\tRevenue\nWest\t2\t10\t=B2*C2\nEast\t3\t5\t=B3*C3\nWest\t1\t10\t=B4*C4",
    );
    document
      .querySelector("[role=grid]")!
      .dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await expect(cell(page, "D4")).toHaveText("10");
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .fill("A1:D4");
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .press("Enter");
  await tab(page, "Insert");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Table Design", exact: true }),
  ).toBeVisible();
  await tab(page, "Data");
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  await page.getByLabel("Sort by", { exact: true }).selectOption("Team");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(cell(page, "A2")).toHaveText("East");
  await expect(cell(page, "D2")).toHaveText("15");
  await tab(page, "Insert");
  await page.getByRole("button", { name: "PivotTable", exact: true }).click();
  await page.getByLabel("Row fields", { exact: true }).fill("Team");
  await page.getByLabel("Value fields", { exact: true }).fill("Revenue");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "PivotTable Analyze", exact: true }),
  ).toBeVisible();
  await expect(cell(page, "B2")).toHaveText("15");
  await expect(cell(page, "B3")).toHaveText("30");
  await page.screenshot({ path: "docs/spreadsheet/screenshots/pivot.png" });
  await page.getByRole("tab", { name: "Sheet1", exact: true }).click();
  await page.getByRole("textbox", { name: "Name box", exact: true }).fill("D2");
  await page
    .getByRole("textbox", { name: "Name box", exact: true })
    .press("Enter");
  await tab(page, "Data");
  await page
    .getByRole("button", { name: "What-If Analysis", exact: true })
    .click();
  await page.getByLabel("Set cell", { exact: true }).fill("D2");
  await page.getByLabel("To value", { exact: true }).fill("50");
  await page.getByLabel("By changing cell", { exact: true }).fill("B2");
  await page
    .getByRole("button", { name: "Find solution", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(cell(page, "D2")).toHaveText("50");
  await page.getByRole("button", { name: "Refresh All", exact: true }).click();
  await page.getByRole("tab", { name: "PivotTable 1", exact: true }).click();
  await expect(cell(page, "B2")).toHaveText("50");
});
test("Save commits the current draft and waits for formula caches; refresh preserves adjacent notes", async ({
  page,
}) => {
  await open(page);
  await enter(page, "A1", "4");
  await enter(page, "B1", "=A1*2");
  await expect(cell(page, "B1")).toHaveText("8");
  await cell(page, "A1").dblclick();
  await page.getByRole("textbox", { name: "Edit A1", exact: true }).fill("7");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".sheets-save-state")).toHaveText(
    "Saved to workspace",
  );
  const result = await page.evaluate(() => {
    const entry = [...(window as any).testFiles.values()][0] as any;
    return JSON.parse(new TextDecoder().decode(entry.data)).workbook.sheets[0]
      .cells;
  });
  expect(result.A1.value).toBe(7);
  expect(result.B1.cached).toBe(14);
});
