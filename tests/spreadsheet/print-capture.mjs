import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { createBudgetWorkbook } from "../../packages/spreadsheet-engine/src/fixtures.ts";
import { WorkbookEngine } from "../../packages/spreadsheet-engine/src/calculation.ts";
import {
  generatePrintHTML,
  paginateSheet,
} from "../../apps/web/src/apps/spreadsheet/print.ts";

const workbook = createBudgetWorkbook(),
  engine = new WorkbookEngine(workbook);
engine.calculate(true);
const html = generatePrintHTML(workbook, workbook.activeSheetId);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1120, height: 880 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({
    path: "docs/spreadsheet/screenshots/budget-print-page.png",
    fullPage: true,
  });
  await page.pdf({
    path: "docs/spreadsheet/sample-budget.pdf",
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
  });
  await writeFile(
    "docs/spreadsheet/print-capture.json",
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        browser: browser.version(),
        platform: os.platform(),
        arch: os.arch(),
        viewport: { width: 1120, height: 880 },
        deviceScaleFactor: 1,
        fixture: "budget-v1",
        workbook: workbook.name,
        worksheet: workbook.sheets[0].name,
        worksheetZoom: 100,
        language: "en-US",
        layout: paginateSheet(workbook.sheets[0]),
        output:
          "Chromium print-to-PDF of the identical generated preview document. No independent Excel PDF comparison.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Captured one budget preview page and generated docs/spreadsheet/sample-budget.pdf.",
  );
} finally {
  await browser.close();
}
