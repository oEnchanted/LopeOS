import type { AppManifest } from "../../../../../packages/contracts/src";

export const spreadsheetManifest: AppManifest = {
  contractVersion: 1,
  id: "lope.sheets",
  name: "Sheets",
  icon: "sheets",
  description: "Calculate, organize, and analyze spreadsheet workbooks.",
  entry: () => import("./index"),
  singleton: false,
  defaultSize: { width: 1366, height: 840 },
  minSize: { width: 540, height: 400 },
  fileAssociations: [
    ".xlsx",
    ".lopebook",
    ".csv",
    ".tsv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  menus: [
    { label: "Sheets", items: ["sheets.preferences", { separator: true }, "sheets.compatibility"] },
    {
      label: "File",
      items: [
        "sheets.new",
        "sheets.open",
        "sheets.save",
        "sheets.save-as",
        "sheets.export",
        { separator: true },
        "sheets.print",
        "sheets.preferences",
      ],
    },
    {
      label: "Edit",
      items: [
        "sheets.undo",
        "sheets.redo",
        { separator: true },
        "sheets.cut",
        "sheets.copy",
        "sheets.paste",
        "sheets.find",
        "sheets.replace",
        "sheets.goto",
      ],
    },
    {
      label: "Format",
      items: [
        "sheets.format",
        "sheets.bold",
        "sheets.italic",
        "sheets.underline",
        "sheets.validation",
        "sheets.conditional",
      ],
    },
    {
      label: "Data",
      items: [
        "sheets.sort",
        "sheets.filter",
        "sheets.table",
        "sheets.pivot",
        "sheets.query",
        "sheets.goal-seek",
      ],
    },
    {
      label: "View",
      items: [
        "sheets.gridlines",
        "sheets.freeze",
        "sheets.collapse",
        "sheets.compatibility",
      ],
    },
  ],
};
