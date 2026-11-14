import SSF from "fast-formula-parser/ssf/ssf.js";
/** Portable spreadsheet schema. All geometry is zero based; cell keys are invariant A1. */
export const MAX_ROWS = 1_048_576;
export const MAX_COLUMNS = 16_384;
export const SCHEMA_VERSION = 1;
export interface CellError {
  type: "error";
  code: string;
  message?: string;
}
export type Scalar = string | number | boolean | null | CellError;
export interface Point {
  row: number;
  col: number;
}
export interface Range {
  start: Point;
  end: Point;
}
export interface CellBorder {
  style: "thin" | "medium" | "thick" | "dashed" | "dotted" | "double";
  color: string;
}
export interface CellStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  fill?: string;
  numberFormat?: string;
  horizontal?: "left" | "center" | "right" | "justify";
  vertical?: "top" | "middle" | "bottom";
  wrap?: boolean;
  indent?: number;
  rotation?: number;
  borders?: Partial<Record<"top" | "right" | "bottom" | "left", CellBorder>>;
}
export interface Cell {
  value: Scalar;
  formula?: string;
  cached?: Scalar;
  style?: CellStyle;
  note?: string;
  hyperlink?: string;
  locked?: boolean;
}
export interface RowProperties {
  height?: number;
  hidden?: boolean;
  filtered?: boolean;
  outlineLevel?: number;
  style?: CellStyle;
}
export interface ColumnProperties {
  width?: number;
  hidden?: boolean;
  outlineLevel?: number;
  style?: CellStyle;
}
export interface Table {
  id: string;
  name: string;
  range: Range;
  columns: string[];
  headerRow: boolean;
  totalsRow: boolean;
  bandedRows: boolean;
  style?: string;
  filters?: Record<string, string[]>;
}
export interface DefinedName {
  name: string;
  reference: string;
  sheetId?: string;
  comment?: string;
}
export interface ValidationRule {
  id: string;
  range: Range;
  type: "list" | "whole" | "decimal" | "date" | "textLength" | "custom";
  operator?:
    | "between"
    | "notBetween"
    | "equal"
    | "notEqual"
    | "greater"
    | "less"
    | "greaterOrEqual"
    | "lessOrEqual";
  values?: string[];
  formula1?: string;
  formula2?: string;
  allowBlank?: boolean;
  prompt?: string;
  errorTitle?: string;
  error?: string;
  errorStyle?: "stop" | "warning" | "information";
}
export interface ConditionalFormatRule {
  id: string;
  range: Range;
  type:
    | "cellIs"
    | "containsText"
    | "duplicateValues"
    | "colorScale"
    | "dataBar"
    | "expression";
  operator?: ValidationRule["operator"];
  formula?: string;
  value?: Scalar;
  value2?: Scalar;
  style?: CellStyle;
  colors?: string[];
  priority: number;
  stopIfTrue?: boolean;
}
export interface Chart {
  id: string;
  type: "column" | "bar" | "line" | "area" | "scatter" | "pie" | "doughnut";
  title: string;
  range: Range;
  x: number;
  y: number;
  width: number;
  height: number;
  showLegend?: boolean;
  showLabels?: boolean;
}
export interface Pivot {
  id: string;
  name: string;
  sourceSheetId: string;
  source: Range;
  destination: Point;
  rows: string[];
  columns: string[];
  values: {
    field: string;
    aggregate: "sum" | "count" | "average" | "min" | "max";
  }[];
  filters?: Record<string, Scalar[]>;
}
export interface PrintSettings {
  orientation: "portrait" | "landscape";
  paperSize: "A4" | "Letter" | "Legal" | "A3";
  margins: { top: number; bottom: number; left: number; right: number };
  scale: number;
  fitToWidth?: number;
  fitToHeight?: number;
  area?: Range;
  repeatRows?: [number, number];
  repeatColumns?: [number, number];
  header?: string;
  footer?: string;
  gridlines?: boolean;
  headings?: boolean;
  rowBreaks?: number[];
  columnBreaks?: number[];
}
export interface Worksheet {
  id: string;
  name: string;
  cells: Record<string, Cell>;
  rows: Record<number, RowProperties>;
  columns: Record<number, ColumnProperties>;
  merges: Range[];
  tables: Table[];
  validations: ValidationRule[];
  conditionalFormats: ConditionalFormatRule[];
  charts: Chart[];
  pivots: Pivot[];
  visibility: "visible" | "hidden" | "veryHidden";
  freeze: { rows: number; columns: number };
  print: PrintSettings;
  showGridlines: boolean;
  protected: boolean;
  tabColor?: string;
}
export interface Workbook {
  schemaVersion: 1;
  id: string;
  name: string;
  sheets: Worksheet[];
  activeSheetId: string;
  dateSystem: "1900" | "1904";
  calculationMode: "automatic" | "manual";
  names: DefinedName[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}
export function newId(prefix = "id"): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}
export function createSheet(name = "Sheet1"): Worksheet {
  return {
    id: newId("sheet"),
    name,
    cells: {},
    rows: {},
    columns: {},
    merges: [],
    tables: [],
    validations: [],
    conditionalFormats: [],
    charts: [],
    pivots: [],
    visibility: "visible",
    freeze: { rows: 0, columns: 0 },
    showGridlines: true,
    protected: false,
    print: {
      orientation: "portrait",
      paperSize: "Letter",
      margins: { top: 0.75, bottom: 0.75, left: 0.7, right: 0.7 },
      scale: 100,
    },
  };
}
export function createWorkbook(name = "Book1"): Workbook {
  const sheet = createSheet(),
    now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: newId("book"),
    name,
    sheets: [sheet],
    activeSheetId: sheet.id,
    dateSystem: "1900",
    calculationMode: "automatic",
    names: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}
export function cloneWorkbook(workbook: Workbook): Workbook {
  return structuredClone(workbook);
}
export function error(code: string, message?: string): CellError {
  return { type: "error", code, ...(message ? { message } : {}) };
}
export function isError(value: unknown): value is CellError {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "error"
  );
}
export function columnName(col: number): string {
  if (!Number.isInteger(col) || col < 0 || col >= MAX_COLUMNS)
    throw new RangeError("Column is outside A:XFD.");
  let n = col + 1,
    text = "";
  while (n) {
    n--;
    text = String.fromCharCode(65 + (n % 26)) + text;
    n = Math.floor(n / 26);
  }
  return text;
}
export function cellAddress(row: number, col: number): string {
  if (!Number.isInteger(row) || row < 0 || row >= MAX_ROWS)
    throw new RangeError("Row is outside 1:1048576.");
  return columnName(col) + (row + 1);
}
export function parseAddress(address: string): Point {
  const m = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(address.trim());
  if (!m) throw new RangeError(`Invalid cell address: ${address}`);
  let col = 0;
  for (const c of m[1].toUpperCase()) col = col * 26 + c.charCodeAt(0) - 64;
  const row = Number(m[2]) - 1;
  if (row >= MAX_ROWS || col > MAX_COLUMNS)
    throw new RangeError(`Address outside worksheet: ${address}`);
  return { row, col: col - 1 };
}
export function normalizeRange(range: Range): Range {
  return {
    start: {
      row: Math.min(range.start.row, range.end.row),
      col: Math.min(range.start.col, range.end.col),
    },
    end: {
      row: Math.max(range.start.row, range.end.row),
      col: Math.max(range.start.col, range.end.col),
    },
  };
}
export function parseRange(text: string): Range {
  const parts = text.trim().split(":");
  if (parts.length > 2) throw new RangeError("Invalid range.");
  if (
    /^\$?[A-Z]+$/i.test(parts[0]) &&
    parts[1] &&
    /^\$?[A-Z]+$/i.test(parts[1])
  )
    return normalizeRange({
      start: { row: 0, col: parseAddress(parts[0] + "1").col },
      end: { row: MAX_ROWS - 1, col: parseAddress(parts[1] + "1").col },
    });
  if (/^\d+$/.test(parts[0]) && parts[1] && /^\d+$/.test(parts[1]))
    return normalizeRange({
      start: { row: parseAddress("A" + parts[0]).row, col: 0 },
      end: { row: parseAddress("A" + parts[1]).row, col: MAX_COLUMNS - 1 },
    });
  return normalizeRange({
    start: parseAddress(parts[0]),
    end: parseAddress(parts[1] ?? parts[0]),
  });
}
export function rangeAddress(range: Range): string {
  const r = normalizeRange(range);
  const a = cellAddress(r.start.row, r.start.col),
    b = cellAddress(r.end.row, r.end.col);
  return a === b ? a : `${a}:${b}`;
}
export function inRange(point: Point, range: Range): boolean {
  return (
    point.row >= range.start.row &&
    point.row <= range.end.row &&
    point.col >= range.start.col &&
    point.col <= range.end.col
  );
}
export function rangeSize(range: Range): number {
  return (
    (range.end.row - range.start.row + 1) *
    (range.end.col - range.start.col + 1)
  );
}
export function getCell(sheet: Worksheet, address: string): Cell | undefined {
  const p = parseAddress(address);
  return sheet.cells[cellAddress(p.row, p.col)];
}
export function inputCell(
  input: string | Scalar | Cell,
  previous?: Cell,
): Cell {
  if (
    input !== null &&
    typeof input === "object" &&
    !isError(input) &&
    "value" in input
  )
    return structuredClone(input);
  const result: Cell = {
    ...(previous?.style ? { style: structuredClone(previous.style) } : {}),
    ...(previous?.note ? { note: previous.note } : {}),
    value: input as Scalar,
  };
  if (typeof input === "string") {
    if (input.startsWith("'")) result.value = input.slice(1);
    else if (previous?.style?.numberFormat === "@")
      result.value = input === "" ? null : input;
    else if (input.startsWith("=")) {
      result.formula = input;
      result.value = null;
    } else if (input === "") result.value = null;
    else if (/^(true|false)$/i.test(input))
      result.value = input.toLowerCase() === "true";
    else if (
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(input.trim()) &&
      Number.isFinite(Number(input))
    )
      result.value = Number(input);
    else if (/^[+-]?(?:\d+\.?\d*|\.\d+)%$/.test(input.trim())) {
      result.value = Number(input.trim().slice(0, -1)) / 100;
      result.style = { ...result.style, numberFormat: "0.00%" };
    }
  }
  return result;
}
export function setCell(
  sheet: Worksheet,
  address: string,
  input: string | Scalar | Cell,
): Cell {
  const p = parseAddress(address),
    key = cellAddress(p.row, p.col),
    cell = inputCell(input, sheet.cells[key]);
  if (
    cell.value === null &&
    !cell.formula &&
    !cell.style &&
    !cell.note &&
    !cell.hyperlink
  )
    delete sheet.cells[key];
  else sheet.cells[key] = cell;
  return cell;
}
export function cellValue(cell?: Cell): Scalar {
  return cell ? (cell.formula ? (cell.cached ?? null) : cell.value) : null;
}
export function usedRange(sheet: Worksheet): Range {
  let maxRow = 0,
    maxCol = 0,
    minRow = MAX_ROWS - 1,
    minCol = MAX_COLUMNS - 1;
  const keys = Object.keys(sheet.cells);
  if (!keys.length)
    return { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } };
  for (const key of keys) {
    const p = parseAddress(key);
    maxRow = Math.max(maxRow, p.row);
    maxCol = Math.max(maxCol, p.col);
    minRow = Math.min(minRow, p.row);
    minCol = Math.min(minCol, p.col);
  }
  return {
    start: { row: minRow, col: minCol },
    end: { row: maxRow, col: maxCol },
  };
}
/** Gregorian civil arithmetic; no local-time Date arithmetic in date serials. */
function civilDays(year: number, month: number, day: number): number {
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400),
    yoe = year - era * 400;
  const doy =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return (
    era * 146097 +
    yoe * 365 +
    Math.floor(yoe / 4) -
    Math.floor(yoe / 100) +
    doy -
    719468
  );
}
function daysCivil(z: number): { year: number; month: number; day: number } {
  z += 719468;
  const era = Math.floor(z / 146097),
    doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  );
  let year = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)),
    mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1,
    month = mp + (mp < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  return { year, month, day };
}
export function dateToSerial(
  year: number,
  month: number,
  day: number,
  system: "1900" | "1904" = "1900",
): number {
  if (system === "1900" && year === 1900 && month === 2 && day === 29)
    return 60;
  year += Math.floor((month - 1) / 12);
  month = ((((month - 1) % 12) + 12) % 12) + 1;
  const days = civilDays(year, month, 1) + day - 1;
  return system === "1904"
    ? days - civilDays(1904, 1, 1)
    : days - civilDays(1899, 12, 31) + (days >= civilDays(1900, 3, 1) ? 1 : 0);
}
export function serialToDate(
  serial: number,
  system: "1900" | "1904" = "1900",
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const day = Math.floor(serial),
    fraction = Math.round((serial - day) * 86400),
    date =
      system === "1900" && day === 60
        ? { year: 1900, month: 2, day: 29 }
        : system === "1900" && day === 0
          ? { year: 1900, month: 1, day: 0 }
          : daysCivil(
              day +
                (system === "1904"
                  ? civilDays(1904, 1, 1)
                  : civilDays(1899, 12, 31) - (day > 60 ? 1 : 0)),
            );
  return {
    ...date,
    hour: Math.floor(fraction / 3600),
    minute: Math.floor((fraction % 3600) / 60),
    second: fraction % 60,
  };
}
export function formatValue(
  cell?: Cell,
  dateSystem: "1900" | "1904" = "1900",
  locale = "en-US",
): string {
  const value = cellValue(cell);
  if (value === null) return "";
  if (isError(value)) return value.code;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value !== "number") return String(value);
  const format = cell?.style?.numberFormat ?? "General";
  if (!Number.isFinite(value)) return "#NUM!";
  if (format === "@") return String(value);
  if (format === "General") return Number(value.toPrecision(15)).toString();
  const section =
    format.split(";")[value < 0 ? 1 : value === 0 ? 2 : 0] ??
    format.split(";")[0];
  if (
    /[ymdhis]/i.test(section.replace(/"[^"]*"|\[[^\]]*\]/g, "")) &&
    !/E[+-]/i.test(section)
  ) {
    if (value < 0) return "########";
    const d = serialToDate(value, dateSystem),
      pad = (n: number) => String(n).padStart(2, "0");
    const months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ],
      days = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
    const weekday =
        (((Math.floor(value) + (dateSystem === "1904" ? 1462 : 0) - 1) % 7) +
          7) %
        7,
      ampm = /AM\/PM|A\/P/i.test(section);
    let lastToken = "";
    return section.replace(
      /"[^"]*"|\\.|AM\/PM|A\/P|\[[hms]+\]|y+|m+|d+|h+|s+|\[[^\]]*\]|_[^ ]|\*./gi,
      (token, offset: number) => {
        if (token[0] === '"') return token.slice(1, -1);
        if (token[0] === "\\") return token.slice(1);
        if (token[0] === "_" || token[0] === "*") return "";
        const lower = token.toLowerCase();
        if (/^\[[hms]+\]$/.test(lower)) {
          const units = lower[1] === "h" ? 24 : lower[1] === "m" ? 1440 : 86400;
          return String(Math.floor(value * units + 1e-8));
        }
        if (lower[0] === "[") return "";
        if (lower === "am/pm") return d.hour >= 12 ? "PM" : "AM";
        if (lower === "a/p") return d.hour >= 12 ? "P" : "A";
        if (lower[0] === "y") {
          lastToken = "y";
          return lower.length <= 2
            ? pad(d.year % 100)
            : String(d.year).padStart(4, "0");
        }
        if (lower[0] === "d") {
          lastToken = "d";
          return lower.length === 1
            ? String(d.day)
            : lower.length === 2
              ? pad(d.day)
              : lower.length === 3
                ? days[weekday].slice(0, 3)
                : days[weekday];
        }
        if (lower[0] === "h") {
          lastToken = "h";
          const hour = ampm ? d.hour % 12 || 12 : d.hour;
          return lower.length === 1 ? String(hour) : pad(hour);
        }
        if (lower[0] === "s") {
          lastToken = "s";
          return lower.length === 1 ? String(d.second) : pad(d.second);
        }
        const minutes =
          lastToken === "h" ||
          /^\s*:\s*s/i.test(section.slice(offset + token.length));
        lastToken = minutes ? "minute" : "m";
        if (minutes)
          return lower.length === 1 ? String(d.minute) : pad(d.minute);
        return lower.length === 1
          ? String(d.month)
          : lower.length === 2
            ? pad(d.month)
            : lower.length === 3
              ? months[d.month - 1].slice(0, 3)
              : lower.length === 4
                ? months[d.month - 1]
                : months[d.month - 1][0];
      },
    );
  }
  // The established SSF formatter handles conditional sections, scaling, fractions,
  // scientific notation, quoted literals and escaped symbols. Serial-date arithmetic
  // is handled above to keep it independent of the host timezone.
  if (locale === "en-US" || !/^[$€£¥#0,.%();\[\]A-Za-z+\- ]+$/.test(format)) {
    try {
      return SSF.format(format, value, { date1904: dateSystem === "1904" });
    } catch {
      return `#FORMAT!`;
    }
  }
  const decimals = section.match(/\.([0#]+)/)?.[1] ?? "",
    min = (decimals.match(/0/g) ?? []).length,
    max = Math.min(20, decimals.length),
    percent = section.includes("%");
  const absolute = section.includes("(") ? Math.abs(value) : value,
    currency = section.match(/[$€£¥]/)?.[0];
  let result = new Intl.NumberFormat(locale, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: section.includes(","),
    ...(percent ? { style: "percent" } : {}),
  }).format(absolute);
  if (currency) result = currency + result;
  if (value < 0 && section.includes("(")) result = "(" + result + ")";
  return result;
}
