import {
  cellAddress,
  columnName,
  formatValue,
  normalizeRange,
  usedRange,
  type CellStyle,
  type Range,
  type Workbook,
  type Worksheet,
} from "../../../../../packages/spreadsheet-engine/src/model.ts";
import { chartPresentation } from "./chart-svg.ts";

export interface PrintPage {
  rows: number[];
  columns: number[];
  scale: number;
}
export interface PrintLayout {
  pages: PrintPage[];
  paper: { width: number; height: number };
  content: { width: number; height: number };
  range: Range;
}
const PAPER = {
  Letter: [8.5, 11],
  Legal: [8.5, 14],
  A4: [210 / 25.4, 297 / 25.4],
  A3: [297 / 25.4, 420 / 25.4],
} as const;
const MAX_PRINT_CELLS = 200_000,
  MAX_PRINT_PAGES = 300;
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const color = (value: string | undefined, fallback: string) =>
  value && /^(?:#[0-9a-f]{3,8}|[a-z]{1,24})$/i.test(value) ? value : fallback;
const finite = (
  value: number | undefined,
  fallback: number,
  min = 0,
  max = 10000,
) =>
  value !== undefined && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
const rowHeight = (sheet: Worksheet, row: number) =>
  finite(sheet.rows[row]?.height, 22, 8, 600);
const columnWidth = (sheet: Worksheet, column: number) =>
  finite(sheet.columns[column]?.width, 96, 8, 1000);
function axisOffset(
  sheet: Worksheet,
  index: number,
  axis: "row" | "column",
): number {
  const base = axis === "row" ? 22 : 96,
    properties = axis === "row" ? sheet.rows : sheet.columns;
  let offset = index * base;
  for (const [key, property] of Object.entries(properties))
    if (+key < index)
      offset +=
        (property.hidden
          ? 0
          : axis === "row"
            ? rowHeight(sheet, +key)
            : columnWidth(sheet, +key)) - base;
  return offset;
}
function axisAt(
  sheet: Worksheet,
  position: number,
  axis: "row" | "column",
): number {
  let low = 0,
    high = axis === "row" ? 1_048_575 : 16_383;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (axisOffset(sheet, middle, axis) < position) low = middle;
    else high = middle - 1;
  }
  return low;
}
function defaultPrintRange(sheet: Worksheet): Range {
  const range = usedRange(sheet);
  for (const chart of sheet.charts) {
    if (![chart.x, chart.y, chart.width, chart.height].every(Number.isFinite))
      continue;
    range.start.row = Math.min(
      range.start.row,
      axisAt(sheet, Math.max(0, chart.y), "row"),
    );
    range.start.col = Math.min(
      range.start.col,
      axisAt(sheet, Math.max(0, chart.x), "column"),
    );
    range.end.row = Math.max(
      range.end.row,
      axisAt(sheet, chart.y + chart.height, "row"),
    );
    range.end.col = Math.max(
      range.end.col,
      axisAt(sheet, chart.x + chart.width, "column"),
    );
  }
  return range;
}
function indices(
  start: number,
  end: number,
  hidden: (index: number) => boolean,
): number[] {
  const values: number[] = [];
  for (let index = start; index <= end; index++)
    if (!hidden(index)) values.push(index);
  return values;
}
function partition(
  items: number[],
  repeats: number[],
  available: number,
  size: (index: number) => number,
  breaks: number[],
): number[][] {
  const chunks: number[][] = [],
    repeated = new Set(repeats),
    breakSet = new Set(breaks),
    repeatedSize = repeats.reduce((sum, value) => sum + size(value), 0);
  if (repeatedSize >= available && items.some((value) => !repeated.has(value)))
    throw new Error(
      "Repeated print titles are larger than a page. Reduce the print titles or scaling.",
    );
  let chunk = [...repeats],
    used = repeatedSize,
    count = 0;
  for (const item of items) {
    if (repeated.has(item)) continue;
    if (count && (used + size(item) > available + 0.01 || breakSet.has(item))) {
      chunks.push(chunk);
      chunk = [...repeats];
      used = repeatedSize;
      count = 0;
    }
    chunk.push(item);
    used += size(item);
    count++;
    if (chunks.length > MAX_PRINT_PAGES)
      throw new Error(
        "Print preview exceeds 300 pages. Narrow the print area.",
      );
  }
  if (count || !chunks.length) chunks.push(chunk);
  return chunks;
}

/** Same pagination model feeds the preview iframe and browser print/PDF dialog. Units are CSS px at 96 px/in. */
export function paginateSheet(sheet: Worksheet): PrintLayout {
  const range = normalizeRange(sheet.print.area ?? defaultPrintRange(sheet));
  cellAddress(range.start.row, range.start.col);
  cellAddress(range.end.row, range.end.col);
  const cellCount =
    (range.end.row - range.start.row + 1) *
    (range.end.col - range.start.col + 1);
  if (cellCount > MAX_PRINT_CELLS)
    throw new Error(
      "Print area exceeds 200,000 cells. Set a smaller print area before previewing.",
    );
  const dimensions = PAPER[sheet.print.paperSize] ?? PAPER.Letter;
  const paper =
    sheet.print.orientation === "landscape"
      ? { width: dimensions[1] * 96, height: dimensions[0] * 96 }
      : { width: dimensions[0] * 96, height: dimensions[1] * 96 };
  const margins = sheet.print.margins,
    headerHeight = sheet.print.header ? 24 : 0,
    footerHeight = sheet.print.footer ? 24 : 0;
  const content = {
    width:
      paper.width -
      (finite(margins.left, 0.7, 0, 4) + finite(margins.right, 0.7, 0, 4)) * 96,
    height:
      paper.height -
      (finite(margins.top, 0.75, 0, 4) + finite(margins.bottom, 0.75, 0, 4)) *
        96 -
      headerHeight -
      footerHeight,
  };
  if (content.width < 48 || content.height < 48)
    throw new Error("Page margins leave too little printable space.");
  const rows = indices(
      range.start.row,
      range.end.row,
      (row) => !!sheet.rows[row]?.hidden,
    ),
    columns = indices(
      range.start.col,
      range.end.col,
      (col) => !!sheet.columns[col]?.hidden,
    );
  const repeatRows = sheet.print.repeatRows
    ? indices(
        Math.max(0, sheet.print.repeatRows[0]),
        Math.min(1_048_575, sheet.print.repeatRows[1]),
        (row) => !!sheet.rows[row]?.hidden,
      )
    : [];
  const repeatColumns = sheet.print.repeatColumns
    ? indices(
        Math.max(0, sheet.print.repeatColumns[0]),
        Math.min(16_383, sheet.print.repeatColumns[1]),
        (col) => !!sheet.columns[col]?.hidden,
      )
    : [];
  if (
    repeatRows.length * Math.max(1, columns.length) +
      repeatColumns.length * Math.max(1, rows.length) >
    MAX_PRINT_CELLS
  )
    throw new Error("Repeated print titles exceed the preview cell limit.");
  const headingWidth = sheet.print.headings ? 40 : 0,
    headingHeight = sheet.print.headings ? 22 : 0;
  const allColumns = [...new Set([...repeatColumns, ...columns])],
    allRows = [...new Set([...repeatRows, ...rows])];
  const totalWidth = allColumns.reduce(
      (sum, col) => sum + columnWidth(sheet, col),
      headingWidth,
    ),
    totalHeight = allRows.reduce(
      (sum, row) => sum + rowHeight(sheet, row),
      headingHeight,
    );
  let scale = finite(sheet.print.scale, 100, 10, 400) / 100;
  if (sheet.print.fitToWidth && sheet.print.fitToWidth > 0) {
    const count = Math.floor(sheet.print.fitToWidth),
      repeats =
        repeatColumns.reduce((sum, col) => sum + columnWidth(sheet, col), 0) +
        headingWidth;
    scale = Math.min(
      scale,
      (content.width * count) / (totalWidth + repeats * (count - 1)),
    );
  }
  if (sheet.print.fitToHeight && sheet.print.fitToHeight > 0) {
    const count = Math.floor(sheet.print.fitToHeight),
      repeats =
        repeatRows.reduce((sum, row) => sum + rowHeight(sheet, row), 0) +
        headingHeight;
    scale = Math.min(
      scale,
      (content.height * count) / (totalHeight + repeats * (count - 1)),
    );
  }
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("Invalid print scaling.");
  const rowChunks = partition(
    rows,
    repeatRows,
    content.height / scale - headingHeight,
    (row) => rowHeight(sheet, row),
    sheet.print.rowBreaks ?? [],
  );
  const columnChunks = partition(
    columns,
    repeatColumns,
    content.width / scale - headingWidth,
    (col) => columnWidth(sheet, col),
    sheet.print.columnBreaks ?? [],
  );
  if (rowChunks.length * columnChunks.length > MAX_PRINT_PAGES)
    throw new Error(
      "Print preview exceeds 300 pages. Narrow the print area or use fit to page.",
    );
  const pages = rowChunks.flatMap((rows) =>
    columnChunks.map((columns) => ({ rows, columns, scale })),
  );
  const renderedCells = pages.reduce(
    (sum, page) => sum + page.rows.length * page.columns.length,
    0,
  );
  if (renderedCells > MAX_PRINT_CELLS)
    throw new Error(
      "Print preview including repeated titles exceeds 200,000 cells. Narrow the print area.",
    );
  return { pages, paper, content, range };
}

function styleCSS(style: CellStyle | undefined): string {
  if (!style) return "";
  const properties: string[] = [];
  if (style.fontFamily)
    properties.push(
      `font-family:${style.fontFamily.replace(/[^\w ,.-]/g, "")}`,
    );
  if (style.fontSize)
    properties.push(`font-size:${finite(style.fontSize, 11, 6, 200)}pt`);
  if (style.bold) properties.push("font-weight:700");
  if (style.italic) properties.push("font-style:italic");
  if (style.underline || style.strike)
    properties.push(
      `text-decoration:${[style.underline && "underline", style.strike && "line-through"].filter(Boolean).join(" ")}`,
    );
  if (style.color) properties.push(`color:${color(style.color, "#000")}`);
  if (style.fill) properties.push(`background:${color(style.fill, "#fff")}`);
  if (
    style.horizontal &&
    ["left", "center", "right", "justify"].includes(style.horizontal)
  )
    properties.push(`text-align:${style.horizontal}`);
  if (style.vertical && ["top", "middle", "bottom"].includes(style.vertical))
    properties.push(`vertical-align:${style.vertical}`);
  if (style.wrap)
    properties.push("white-space:pre-wrap;overflow-wrap:anywhere");
  if (style.indent)
    properties.push(`padding-left:${4 + finite(style.indent, 0, 0, 30) * 8}px`);
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const border = style.borders?.[side];
    if (border)
      properties.push(
        `border-${side}:${border.style === "thick" ? 3 : border.style === "medium" || border.style === "double" ? 2 : 1}px ${["dashed", "dotted", "double"].includes(border.style) ? border.style : "solid"} ${color(border.color, "#000")}`,
      );
  }
  return properties.join(";");
}
function pageTable(
  workbook: Workbook,
  sheet: Worksheet,
  page: PrintPage,
): string {
  const skip = new Set<string>(),
    merges = new Map<
      string,
      { rows: number; columns: number; address: string }
    >();
  for (const merge of sheet.merges) {
    const rows = page.rows.filter(
        (row) => row >= merge.start.row && row <= merge.end.row,
      ),
      columns = page.columns.filter(
        (col) => col >= merge.start.col && col <= merge.end.col,
      );
    if (!rows.length || !columns.length) continue;
    const address = cellAddress(rows[0], columns[0]);
    merges.set(address, {
      rows: rows.length,
      columns: columns.length,
      address: cellAddress(merge.start.row, merge.start.col),
    });
    for (const row of rows)
      for (const column of columns)
        if (cellAddress(row, column) !== address)
          skip.add(cellAddress(row, column));
  }
  const headings = sheet.print.headings;
  const columns = `${headings ? '<col style="width:40px">' : ""}${page.columns.map((col) => `<col style="width:${columnWidth(sheet, col)}px">`).join("")}`;
  const head = headings
    ? `<thead><tr style="height:22px"><th aria-label="Corner"></th>${page.columns.map((col) => `<th>${columnName(col)}</th>`).join("")}</tr></thead>`
    : "";
  const rows = page.rows
    .map(
      (row) =>
        `<tr style="height:${rowHeight(sheet, row)}px">${headings ? `<th>${row + 1}</th>` : ""}${page.columns
          .map((col) => {
            const address = cellAddress(row, col);
            if (skip.has(address)) return "";
            const merge = merges.get(address),
              cell = sheet.cells[merge?.address ?? address];
            const style = {
              ...sheet.columns[col]?.style,
              ...sheet.rows[row]?.style,
              ...cell?.style,
            };
            const formatted = formatValue(cell, workbook.dateSystem),
              alignment = style.horizontal
                ? ""
                : typeof (cell?.formula ? cell.cached : cell?.value) ===
                    "number"
                  ? ";text-align:right"
                  : "";
            const rotation = finite(style.rotation, 0, -90, 90);
            return `<td data-address="${address}"${merge ? ` rowspan="${merge.rows}" colspan="${merge.columns}"` : ""} style="${escape(styleCSS(style) + alignment)}">${rotation ? `<span style="display:inline-block;transform:rotate(${-rotation}deg)">${escape(formatted)}</span>` : escape(formatted)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const width = page.columns.reduce(
    (sum, col) => sum + columnWidth(sheet, col),
    headings ? 40 : 0,
  );
  return `<table class="${sheet.print.gridlines ? "with-grid" : ""}" style="width:${width}px"><colgroup>${columns}</colgroup>${head}<tbody>${rows}</tbody></table>`;
}
function printText(
  text: string | undefined,
  workbook: Workbook,
  sheet: Worksheet,
  page: number,
  count: number,
): string {
  return escape(
    (text ?? "").replace(
      /&&|&[PNAFD]/g,
      (token) =>
        ({
          "&&": "&",
          "&P": String(page),
          "&N": String(count),
          "&A": sheet.name,
          "&F": workbook.name,
          "&D": workbook.updatedAt.slice(0, 10),
        })[token] ?? token,
    ),
  );
}

/** Split discontinuous repeated-title/body coordinates into clipped drawing fragments. */
function chartFragments(
  workbook: Workbook,
  sheet: Worksheet,
  page: PrintPage,
): string {
  const runs = (indices: number[], axis: "row" | "column", heading: number) => {
    const result: { source: number; position: number; size: number }[] = [];
    let position = heading;
    for (const index of indices) {
      const source = axisOffset(sheet, index, axis),
        size =
          axis === "row" ? rowHeight(sheet, index) : columnWidth(sheet, index),
        previous = result.at(-1);
      if (previous && Math.abs(previous.source + previous.size - source) < 0.01)
        previous.size += size;
      else result.push({ source, position, size });
      position += size;
    }
    return result;
  };
  const rows = runs(page.rows, "row", sheet.print.headings ? 22 : 0),
    columns = runs(page.columns, "column", sheet.print.headings ? 40 : 0),
    fragments: string[] = [];
  for (const chart of sheet.charts) {
    if (
      ![chart.x, chart.y, chart.width, chart.height].every(Number.isFinite) ||
      chart.width <= 0 ||
      chart.height <= 0
    )
      continue;
    const presentation = chartPresentation(chart, sheet, workbook.dateSystem);
    for (const row of rows)
      for (const column of columns) {
        if (
          chart.x + chart.width <= column.source ||
          chart.x >= column.source + column.size ||
          chart.y + chart.height <= row.source ||
          chart.y >= row.source + row.size
        )
          continue;
        fragments.push(
          `<div class="print-chart-clip" style="left:${column.position}px;top:${row.position}px;width:${column.size}px;height:${row.size}px"><figure class="print-chart" data-chart-id="${escape(chart.id)}" style="left:${chart.x - column.source}px;top:${chart.y - row.source}px;width:${chart.width}px;height:${chart.height}px"><strong>${escape(chart.title)}</strong><div class="print-chart-graphic">${presentation.svg}</div>${presentation.notice ? `<small>${escape(presentation.notice)}</small>` : ""}</figure></div>`,
        );
      }
  }
  return fragments.join("");
}

/** Generates local fixed-layout HTML; browser Save as PDF prints this exact document. */
export function generatePrintHTML(workbook: Workbook, sheetId: string): string {
  const sheet = workbook.sheets.find((item) => item.id === sheetId);
  if (!sheet) throw new Error("The selected worksheet no longer exists.");
  const layout = paginateSheet(sheet),
    margins = sheet.print.margins;
  const pages = layout.pages
    .map(
      (page, index) =>
        `<section class="print-page" aria-label="Page ${index + 1} of ${layout.pages.length}"><header>${printText(sheet.print.header, workbook, sheet, index + 1, layout.pages.length)}</header><div class="print-content"><div class="print-scaler" style="transform:scale(${page.scale});width:${layout.content.width / page.scale}px;height:${layout.content.height / page.scale}px">${pageTable(workbook, sheet, page)}${chartFragments(workbook, sheet, page)}</div></div><footer>${printText(sheet.print.footer, workbook, sheet, index + 1, layout.pages.length)}</footer></section>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'"><title>${escape(workbook.name)} — ${escape(sheet.name)}</title><style>
*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;background:#e7e7e7;color:#111}.print-page{position:relative;break-after:page;page-break-after:always;width:${layout.paper.width}px;height:${layout.paper.height}px;margin:20px auto;background:#fff;padding:${finite(margins.top, 0.75, 0, 4) * 96}px ${finite(margins.right, 0.7, 0, 4) * 96}px ${finite(margins.bottom, 0.75, 0, 4) * 96}px ${finite(margins.left, 0.7, 0, 4) * 96}px;overflow:hidden}.print-page:last-child{break-after:auto;page-break-after:auto}header{height:${sheet.print.header ? 24 : 0}px;font-size:10pt;white-space:pre}footer{height:${sheet.print.footer ? 24 : 0}px;font-size:10pt;white-space:pre;text-align:center;padding-top:4px}.print-content{width:${layout.content.width}px;height:${layout.content.height}px;overflow:hidden}.print-scaler{transform-origin:top left;position:relative}.print-chart-clip{position:absolute;overflow:hidden;pointer-events:none}.print-chart{position:absolute;display:flex;flex-direction:column;overflow:hidden;margin:0;background:#fff;border:1px solid #cbd2ce}.print-chart>strong{display:block;padding:8px 13px;min-height:28px;font-size:15px;font-weight:500;color:#374a3f}.print-chart-graphic{flex:1;min-height:0}.print-chart>small{font-size:9px;text-align:center;color:#6d7670}table{border-collapse:collapse;table-layout:fixed;font-size:11pt}td,th{padding:2px 4px;white-space:pre;overflow:hidden;max-width:0;vertical-align:middle;border:1px solid transparent}td{height:inherit}th{font-weight:400;color:#555;background:#f5f5f5;text-align:center;border-color:#ccc}.with-grid td{border-color:#d7d7d7} @page{size:${layout.paper.width / 96}in ${layout.paper.height / 96}in;margin:0}@media print{body{background:#fff}.print-page{margin:0;box-shadow:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>${pages}</body></html>`;
}
