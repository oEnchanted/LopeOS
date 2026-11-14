import { test, expect } from "@playwright/test";
import { seedSession } from "../setup/seed-session.mjs";
import { writerFilesystem } from "../writer/runtime.ts";
import { createWorkbook } from "../../packages/spreadsheet-engine/src/model.ts";
import {
  serializeWorkbook,
  deserializeWorkbook,
} from "../../packages/spreadsheet-engine/src/io.ts";

test("Sheets manifest, native file launch, global commands, filesystem save and close guard work in LopeOS", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const filesystem = await writerFilesystem(page);
  const book = createWorkbook("Shell integration");
  book.sheets[0].cells = {
    A1: { value: "Local workbook" },
    B1: { value: 21 },
    C1: { value: null, formula: "=B1*2", cached: 42 },
  };
  filesystem.externalWrite(
    "/Documents/Shell.lopebook",
    Buffer.from(serializeWorkbook(book)),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "lope.layout.v1",
      JSON.stringify([
        {
          id: "sheets-sdk-check",
          appId: "lope.sheets",
          title: "Sheets",
          state: "normal",
          bounds: { x: 36, y: 42, width: 1366, height: 840 },
          zIndex: 1,
          launchArgs: { path: "/Documents/Shell.lopebook" },
        },
      ]),
    );
    localStorage.setItem(
      "lope.preferences.v2",
      JSON.stringify({
        version: 2,
        preferences: {
          theme: "dark",
          reduceTransparency: true,
          reduceMotion: true,
        },
      }),
    );
  });
  await seedSession(page);
  await page.goto("/");
  const app = page.locator('[data-app-id="lope.sheets"]');
  await expect(app).toBeVisible();
  await expect(app.getByRole("grid")).toBeVisible({ timeout: 30000 });
  await expect(app.locator('[data-address="A1"]')).toContainText(
    "Local workbook",
  );
  await expect(page.locator(".desktop")).toHaveAttribute("data-theme", "dark");
  await expect(
    app.getByRole("button", { name: "Save", exact: true }).first(),
  ).toBeEnabled();
  await app.locator('[data-address="B1"]').dblclick();
  await app.getByRole("textbox", { name: "Edit B1", exact: true }).fill("100");
  await app
    .getByRole("textbox", { name: "Edit B1", exact: true })
    .press("Enter");
  await expect(app.locator('[data-address="C1"]')).toContainText("200");
  await page
    .locator(".menubar")
    .getByRole("menuitem", { name: "File", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^Save/ }).first().click();
  await expect(app.getByRole("status")).toContainText("Saved to workspace");
  const saved = deserializeWorkbook(
    filesystem.files.get("/Documents/Shell.lopebook")!.data.toString(),
  );
  expect(saved.sheets[0].cells.B1.value).toBe(100);
  expect(saved.sheets[0].cells.C1.formula).toBe("=B1*2");
  expect(saved.sheets[0].cells.C1.cached).toBe(200);
  await page
    .locator(".menubar")
    .getByRole("menuitem", { name: "Format", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Format", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Format Cells", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Format Cells", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.screenshot({
    path: "docs/spreadsheet/screenshots/shell-dark-reduced-transparency.png",
  });
  await app.locator('[data-address="A2"]').dblclick();
  await app
    .getByRole("textbox", { name: "Edit A2", exact: true })
    .fill("Unsaved change");
  await app
    .getByRole("textbox", { name: "Edit A2", exact: true })
    .press("Enter");
  await app.locator(".window-titlebar .close").click();
  await expect(
    page.getByRole("dialog", { name: "Keep your changes?", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Keep your changes?", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(app).toBeVisible();
  expect(errors).toEqual([]);
});
