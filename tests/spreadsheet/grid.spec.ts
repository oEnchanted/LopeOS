import { test, expect, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/tests/spreadsheet/harness.html");
  await expect(
    page.getByRole("grid", { name: "Sheet1 worksheet" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).not.toHaveText("Calculating…");
}
async function select(page: Page, address: string) {
  const box = page.getByRole("textbox", { name: "Name box", exact: true });
  await box.fill(address);
  await box.press("Enter");
}
const cell = (page: Page, address: string) =>
  page.locator(`.sheets-cell[data-address="${address}"]`);

test("column drag previews continuously and commits one undoable resize", async ({
  page,
}) => {
  await open(page);
  const header = page.locator(".sheets-col-headings>div").first(),
    grip = header.locator(".sheets-col-resize"),
    bounds = await grip.boundingBox();
  expect(bounds).toBeTruthy();
  const original = (await header.boundingBox())!.width;
  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 44, bounds!.y + bounds!.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await header.boundingBox())!.width)
    .toBeGreaterThan(original + 35);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await header.boundingBox())!.width)
    .toBeCloseTo(original, 0);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(async () => (await header.boundingBox())!.width)
    .toBeGreaterThan(original + 35);
});

test("merged navigation jumps past the merged region and retains visible active focus", async ({
  page,
}) => {
  await open(page);
  await select(page, "A1:C2");
  await page
    .getByRole("button", { name: "Merge & Center", exact: true })
    .click();
  const grid = page.getByRole("grid");
  await grid.focus();
  await grid.press("ArrowRight");
  await expect(grid).toHaveAttribute("aria-activedescendant", /-D1$/);
  await select(page, "B2");
  await expect(grid).toHaveAttribute("aria-activedescendant", /-A1$/);
  await grid.press("ArrowDown");
  await expect(grid).toHaveAttribute("aria-activedescendant", /-A3$/);
});

test("formula editing keeps the formula bar focused and draws matching reference outlines", async ({
  page,
}) => {
  await open(page);
  const input = page.getByRole("textbox", { name: "Formula bar", exact: true });
  await input.click();
  await input.fill("=SUM(A1:B2)+SUM(C1:C3)");
  await expect(input).toBeFocused();
  await expect(page.locator('[data-reference="A1:B2"]')).toBeVisible();
  await expect(page.locator('[data-reference="C1:C3"]')).toBeVisible();
  await page.screenshot({
    path: "docs/spreadsheet/screenshots/formula-references.png",
  });
  await input.press("Escape");
  await expect(page.locator("[data-reference]")).toHaveCount(0);
});

test("drag selection continues scrolling while the pointer remains at the viewport edge", async ({
  page,
}) => {
  await open(page);
  const grid = page.getByRole("grid"),
    bounds = await grid.boundingBox(),
    start = await cell(page, "A2").boundingBox();
  await page.mouse.move(start!.x + 20, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(start!.x + 20, bounds!.y + bounds!.height - 3, {
    steps: 4,
  });
  const first = await grid.evaluate((element) => element.scrollTop);
  await expect
    .poll(() => grid.evaluate((element) => element.scrollTop), {
      timeout: 4000,
    })
    .toBeGreaterThan(first + 70);
  await page.mouse.up();
});

test("advertised borders render and chart print contains the shared linked SVG", async ({
  page,
}) => {
  await open(page);
  await select(page, "B2:C3");
  await page.getByRole("button", { name: "All borders", exact: true }).click();
  await expect(cell(page, "B2")).toHaveCSS("border-top-style", "solid");
  await expect(cell(page, "B2")).toHaveCSS("border-left-width", "1px");
  await page.getByRole("tab", { name: "File", exact: true }).click();
  await page
    .getByRole("button", { name: "Budget Example", exact: true })
    .click();
  const replace = page.getByRole("button", {
    name: "Continue without saving",
    exact: true,
  });
  if (await replace.isVisible()) await replace.click();
  await expect(
    page.getByRole("grid", { name: "Budget worksheet" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await page
    .getByRole("button", { name: "Print Preview", exact: true })
    .click();
  const frame = page.frameLocator('iframe[title="Workbook print preview"]');
  await expect(
    frame.locator('[data-chart-id="budget-chart"] svg'),
  ).toBeVisible();
  await expect(
    frame.getByRole("img", { name: /Planned and actual spending/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/spreadsheet/screenshots/print-with-chart.png",
  });
});
