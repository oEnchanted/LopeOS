import type ExcelJS from "exceljs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  createWorkbook,
  createSheet,
  cellAddress,
  columnName,
  parseAddress,
  parseRange,
  rangeAddress,
  usedRange,
  dateToSerial,
  newId,
} from "./model.ts";
import type {
  Workbook,
  Worksheet,
  Cell,
  CellStyle,
  Scalar,
  Range,
  ValidationRule,
} from "./model.ts";

export const IO_LIMITS = Object.freeze({
  compressedBytes: 64 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  partBytes: 128 * 1024 * 1024,
  entries: 10000,
  cells: 2_000_000,
  textBytes: 128 * 1024 * 1024,
});
export class WorkbookFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookFormatError";
  }
}
export class CompatibilityError extends Error {
  readonly warnings: string[];
  constructor(warnings: string[]) {
    super(`This conversion needs your confirmation: ${warnings.join(" ")}`);
    this.name = "CompatibilityError";
    this.warnings = warnings;
  }
}
export interface IOOptions {
  signal?: AbortSignal;
  allowLossy?: boolean;
}
export interface DelimitedOptions {
  delimiter?: "," | "\t" | ";" | "|";
  types?: Record<number, "text" | "number" | "boolean" | "auto">;
  name?: string;
  range?: Range;
  signal?: AbortSignal;
}
interface PackageEntry {
  name: string;
  compressed: number;
  expanded: number;
}
interface SourceMetadata {
  filename: string;
  packageBase64: string;
  importedWarnings: string[];
  unknownParts: string[];
  externalSources: string[];
}

function checkCancelled(signal?: AbortSignal) {
  signal?.throwIfAborted();
}
function fail(message: string): never {
  throw new WorkbookFormatError(message);
}
function safeName(name: string) {
  return (
    !!name &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !name.split("/").some((p) => p === "..") &&
    !/[\u0000-\u001f]/.test(name)
  );
}

/** Inspect ZIP metadata before any decompression/allocation. ZIP64 and encrypted archives are rejected. */
export function inspectXlsxPackage(bytes: Uint8Array): PackageEntry[] {
  if (bytes.byteLength > IO_LIMITS.compressedBytes)
    fail("This workbook exceeds the 64 MiB import limit.");
  if (bytes.length < 22) fail("The file is not a complete XLSX ZIP package.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) === 0xe011cfd0)
    fail(
      "Legacy XLS and encrypted Office files are not supported. Open an unencrypted XLSX copy.",
    );
  let end = bytes.length - 22;
  const minimum = Math.max(0, bytes.length - 65557);
  for (; end >= minimum; end--)
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    )
      break;
  if (end < minimum) fail("The XLSX ZIP directory is missing or damaged.");
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    fail("Multi-volume ZIP workbooks are not supported.");
  const count = view.getUint16(end + 10, true),
    length = view.getUint32(end + 12, true),
    offset = view.getUint32(end + 16, true);
  if (count === 65535 || length === 0xffffffff || offset === 0xffffffff)
    fail("ZIP64 workbooks are not supported.");
  if (count > IO_LIMITS.entries || offset + length > end)
    fail("The workbook ZIP directory exceeds limits or is damaged.");
  let cursor = offset,
    expandedTotal = 0;
  const names = new Set<string>(),
    entries: PackageEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      fail("A workbook ZIP directory entry is damaged.");
    const flags = view.getUint16(cursor + 8, true),
      method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true),
      expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true),
      extraLength = view.getUint16(cursor + 30, true),
      commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    if (flags & 1 || ![0, 8].includes(method))
      fail("Encrypted or unsupported ZIP compression in workbook.");
    if (
      cursor + 46 + nameLength + extraLength + commentLength >
      offset + length
    )
      fail("A ZIP filename extends outside the workbook directory.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    if (!safeName(name) || names.has(name))
      fail("The workbook contains an unsafe or duplicate ZIP part name.");
    names.add(name);
    if (local + 30 > offset || view.getUint32(local, true) !== 0x04034b50)
      fail("A workbook ZIP part header is damaged.");
    const dataStart =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    if (dataStart + compressed > offset)
      fail("A workbook ZIP part extends outside the package.");
    expandedTotal += expanded;
    if (
      expanded > IO_LIMITS.partBytes ||
      expandedTotal > IO_LIMITS.expandedBytes ||
      (expanded > 1024 * 1024 && expanded > Math.max(compressed, 1) * 2000)
    )
      fail("The workbook exceeds safe decompression limits.");
    entries.push({ name, compressed, expanded });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml"))
    fail("The file is not an XLSX spreadsheet package.");
  return entries;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16384)
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}
export function originalWorkbookBytes(
  workbook: Workbook,
): Uint8Array | undefined {
  const source = workbook.metadata?.xlsxSource as SourceMetadata | undefined;
  if (!source?.packageBase64) return undefined;
  return Uint8Array.from(atob(source.packageBase64), (character) =>
    character.charCodeAt(0),
  );
}

function assertPlain(value: unknown, depth = 0): void {
  if (depth > 64) fail("Workbook metadata is too deeply nested.");
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        fail("Workbook contains an unsafe property name.");
      assertPlain(item, depth + 1);
    }
  }
}

export function serializeWorkbook(workbook: Workbook): string {
  return JSON.stringify({
    format: "lopeos-workbook",
    schemaVersion: 1,
    workbook,
  });
}

/** Version zero (early draft) used `version` and `activeSheet`; v1 uses explicit IDs. */
export function deserializeWorkbook(text: string): Workbook {
  if (text.length > IO_LIMITS.textBytes)
    fail("The native workbook exceeds the 128 MiB input limit.");
  let envelope: any;
  try {
    envelope = JSON.parse(text);
  } catch {
    fail("This is not a valid native workbook JSON file.");
  }
  assertPlain(envelope);
  let book =
    envelope?.format === "lopeos-workbook" ? envelope.workbook : envelope;
  if (book?.version === 0 && book.schemaVersion === undefined) {
    book = {
      ...book,
      schemaVersion: 1,
      activeSheetId:
        book.activeSheetId ?? book.activeSheet ?? book.sheets?.[0]?.id,
    };
    delete book.version;
    delete book.activeSheet;
  }
  if (envelope?.format === "lopeos-workbook" && envelope.schemaVersion !== 1)
    fail("This workbook needs a newer version of LopeOS Sheets.");
  if (
    !book ||
    book.schemaVersion !== 1 ||
    typeof book.id !== "string" ||
    typeof book.name !== "string" ||
    !Array.isArray(book.sheets) ||
    !book.sheets.length ||
    book.sheets.length > 1024
  )
    fail("The native workbook schema is invalid or unsupported.");
  const ids = new Set<string>(),
    names = new Set<string>();
  let count = 0;
  for (const sheet of book.sheets) {
    if (
      !sheet ||
      typeof sheet.id !== "string" ||
      typeof sheet.name !== "string" ||
      !sheet.name ||
      sheet.name.length > 31 ||
      /[\\/?*\[\]:]/.test(sheet.name) ||
      ids.has(sheet.id) ||
      names.has(sheet.name.toLowerCase())
    )
      fail("Workbook sheet names or identifiers are invalid.");
    ids.add(sheet.id);
    names.add(sheet.name.toLowerCase());
    if (
      !sheet.cells ||
      Array.isArray(sheet.cells) ||
      typeof sheet.cells !== "object"
    )
      fail("Workbook cells must use sparse A1 addresses.");
    const defaults = createSheet(sheet.name);
    Object.assign(sheet, { ...defaults, ...sheet });
    for (const [address, item] of Object.entries(sheet.cells)) {
      try {
        parseAddress(address);
      } catch {
        fail(`Invalid cell address: ${address}.`);
      }
      if (++count > IO_LIMITS.cells)
        fail(
          "This workbook exceeds the two-million populated-cell import limit.",
        );
      if (!item || typeof item !== "object" || Array.isArray(item))
        fail(`Invalid cell at ${address}.`);
      const cell = item as Cell;
      if (
        cell.formula !== undefined &&
        (typeof cell.formula !== "string" ||
          !cell.formula.startsWith("=") ||
          cell.formula.length > 32767)
      )
        fail(`Invalid formula at ${address}.`);
      if (
        !validScalar(cell.value) ||
        (cell.cached !== undefined && !validScalar(cell.cached))
      )
        fail(`Invalid typed value at ${address}.`);
    }
    for (const merge of sheet.merges)
      if (!validRange(merge)) fail("Invalid merged range.");
    if (!["visible", "hidden", "veryHidden"].includes(sheet.visibility))
      fail("Invalid worksheet visibility.");
  }
  if (!ids.has(book.activeSheetId))
    book.activeSheetId =
      book.sheets.find((sheet: Worksheet) => sheet.visibility === "visible")
        ?.id ?? book.sheets[0].id;
  if (!book.sheets.some((sheet: Worksheet) => sheet.visibility === "visible"))
    fail("A workbook must contain a visible worksheet.");
  if (
    !["1900", "1904"].includes(book.dateSystem) ||
    !["automatic", "manual"].includes(book.calculationMode)
  )
    fail("Invalid workbook calculation or date settings.");
  if (
    !Number.isSafeInteger(book.revision) ||
    book.revision < 0 ||
    !Array.isArray(book.names)
  )
    fail("Invalid workbook revision or defined names.");
  return book as Workbook;
}

function validScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "object" &&
      !!value &&
      (value as any).type === "error" &&
      typeof (value as any).code === "string")
  );
}
function validRange(value: unknown): value is Range {
  const range = value as Range;
  return (
    !!range?.start &&
    !!range?.end &&
    [range.start, range.end].every(
      (p) =>
        Number.isInteger(p.row) &&
        p.row >= 0 &&
        p.row < 1048576 &&
        Number.isInteger(p.col) &&
        p.col >= 0 &&
        p.col < 16384,
    ) &&
    range.start.row <= range.end.row &&
    range.start.col <= range.end.col
  );
}

/** RFC 4180 quoting, CR/LF and embedded newlines. Formula-looking fields remain text. */
export function parseDelimited(
  text: string,
  delimiter: string = ",",
): string[][] {
  if (text.length > IO_LIMITS.textBytes)
    fail("The delimited file exceeds the 128 MiB import limit.");
  if (delimiter.length !== 1 || ["\r", "\n", '"'].includes(delimiter))
    fail("Choose a single delimiter character.");
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false,
    count = 0;
  function pushField() {
    if (++count > IO_LIMITS.cells)
      fail("The delimited file exceeds the two-million field limit.");
    row.push(field);
    field = "";
    closed = false;
  }
  function pushRow() {
    pushField();
    if (row.length > 16384 || rows.length >= 1048576)
      fail("The delimited file exceeds worksheet dimensions.");
    rows.push(row);
    row = [];
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === delimiter) pushField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else if (closed) fail("Unexpected text after a closing CSV quote.");
    else field += c;
  }
  if (quoted) fail("The delimited file has an unterminated quoted field.");
  if (field || row.length || closed || !rows.length) pushRow();
  return rows;
}

export function importDelimited(
  text: string,
  options: DelimitedOptions = {},
): Workbook {
  checkCancelled(options.signal);
  const rows = parseDelimited(text, options.delimiter ?? ",");
  const workbook = createWorkbook(options.name ?? "Imported data");
  const sheet = workbook.sheets[0];
  for (let r = 0; r < rows.length; r++) {
    if (r % 1000 === 0) checkCancelled(options.signal);
    for (let c = 0; c < rows[r].length; c++) {
      const raw = rows[r][c];
      if (raw === "") continue;
      const type = options.types?.[c] ?? "text";
      let value: Scalar = raw;
      const numeric =
        /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw) &&
        Number.isFinite(Number(raw));
      if (type === "number") {
        if (!numeric) fail(`Expected a number at ${cellAddress(r, c)}.`);
        value = Number(raw);
      }
      if (type === "boolean") {
        if (!/^(true|false)$/i.test(raw))
          fail(`Expected TRUE or FALSE at ${cellAddress(r, c)}.`);
        value = raw.toUpperCase() === "TRUE";
      }
      // Auto preserves leading-zero identifiers and decimal integers beyond exact IEEE-754 precision.
      if (
        type === "auto" &&
        numeric &&
        !/^[-+]?0\d/.test(raw) &&
        !(Number.isInteger(Number(raw)) && !Number.isSafeInteger(Number(raw)))
      )
        value = Number(raw);
      if (type === "auto" && /^(true|false)$/i.test(raw))
        value = raw.toUpperCase() === "TRUE";
      sheet.cells[cellAddress(r, c)] = { value };
    }
  }
  return workbook;
}

export function exportDelimited(
  sheet: Worksheet,
  options: DelimitedOptions = {},
): string {
  checkCancelled(options.signal);
  const range = options.range ?? usedRange(sheet);
  if (!range) return "";
  if (!validRange(range)) fail("Invalid CSV export range.");
  if (
    (range.end.row - range.start.row + 1) *
      (range.end.col - range.start.col + 1) >
    IO_LIMITS.cells
  )
    fail(
      "The CSV rectangle exceeds two million fields. Select a smaller range.",
    );
  const delimiter = options.delimiter ?? ",";
  const quote = (value: Scalar) => {
    const text =
      value === null
        ? ""
        : typeof value === "object"
          ? value.code
          : typeof value === "boolean"
            ? value
              ? "TRUE"
              : "FALSE"
            : String(value);
    return text.includes(delimiter) || /["\r\n]/.test(text)
      ? `"${text.replaceAll('"', '""')}"`
      : text;
  };
  const rows: string[] = [];
  for (let r = range.start.row; r <= range.end.row; r++) {
    if (r % 1000 === 0) checkCancelled(options.signal);
    const row: string[] = [];
    for (let c = range.start.col; c <= range.end.col; c++) {
      const cell = sheet.cells[cellAddress(r, c)];
      row.push(
        quote(cell?.formula ? (cell.cached ?? null) : (cell?.value ?? null)),
      );
    }
    rows.push(row.join(delimiter));
  }
  return rows.join("\r\n");
}

const DEFAULT_THEME = [
  "FFFFFF",
  "000000",
  "EEECE1",
  "1F497D",
  "4F81BD",
  "C0504D",
  "9BBB59",
  "8064A2",
  "4BACC6",
  "F79646",
  "0000FF",
  "800080",
];
function colorHex(color: any, theme = DEFAULT_THEME): string | undefined {
  if (!color) return undefined;
  let value: string | undefined =
    color.argb?.slice(-6) ??
    (Number.isInteger(color.theme) ? theme[color.theme] : undefined);
  if (color.indexed !== undefined)
    value = [
      "000000",
      "FFFFFF",
      "FF0000",
      "00FF00",
      "0000FF",
      "FFFF00",
      "FF00FF",
      "00FFFF",
    ][color.indexed % 8];
  if (!value || !/^[0-9a-f]{6}$/i.test(value)) return undefined;
  if (color.tint)
    value = value
      .match(/../g)!
      .map((channel) => {
        const n = parseInt(channel, 16);
        return Math.round(
          color.tint < 0 ? n * (1 + color.tint) : n + (255 - n) * color.tint,
        )
          .toString(16)
          .padStart(2, "0");
      })
      .join("");
  return "#" + value.toLowerCase();
}
function excelColor(value?: string): { argb: string } | undefined {
  return value && /^#[0-9a-f]{6}$/i.test(value)
    ? { argb: "FF" + value.slice(1).toUpperCase() }
    : undefined;
}
function importStyle(
  style: Partial<ExcelJS.Style> | undefined,
  theme: string[],
): CellStyle | undefined {
  if (!style) return undefined;
  const result: CellStyle = {},
    font = style.font,
    alignment = style.alignment;
  if (font)
    Object.assign(result, {
      fontFamily: font.name,
      fontSize: font.size,
      bold: font.bold,
      italic: font.italic,
      underline: !!font.underline,
      strike: font.strike,
      color: colorHex(font.color, theme),
    });
  if (style.numFmt) result.numberFormat = style.numFmt;
  if (style.fill?.type === "pattern" && style.fill.pattern === "solid")
    result.fill = colorHex(style.fill.fgColor, theme);
  if (alignment)
    Object.assign(result, {
      horizontal: ["left", "right", "center", "justify"].includes(
        alignment.horizontal ?? "",
      )
        ? alignment.horizontal
        : undefined,
      vertical: alignment.vertical,
      wrap: alignment.wrapText,
      indent: alignment.indent,
      rotation:
        typeof alignment.textRotation === "number"
          ? alignment.textRotation
          : undefined,
    });
  if (style.border) {
    result.borders = {};
    for (const edge of ["top", "bottom", "left", "right"] as const) {
      const border = style.border[edge];
      if (border?.style)
        result.borders[edge] = {
          style: [
            "thin",
            "medium",
            "thick",
            "dashed",
            "dotted",
            "double",
          ].includes(border.style)
            ? (border.style as any)
            : "thin",
          color: colorHex(border.color, theme) ?? "#000000",
        };
    }
    if (!Object.keys(result.borders).length) delete result.borders;
  }
  return Object.values(result).some((value) => value !== undefined)
    ? result
    : undefined;
}
function exportStyle(style?: CellStyle): Partial<ExcelJS.Style> {
  if (!style) return {};
  const result: Partial<ExcelJS.Style> = {
    font: {
      name: style.fontFamily ?? "Aptos",
      size: style.fontSize ?? 11,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      strike: style.strike,
      color: excelColor(style.color),
    },
    alignment: {
      horizontal: style.horizontal,
      vertical: style.vertical,
      wrapText: style.wrap,
      indent: style.indent,
      textRotation: style.rotation,
    },
  };
  if (style.numberFormat) result.numFmt = style.numberFormat;
  if (style.fill)
    result.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: excelColor(style.fill),
    };
  if (style.borders) {
    result.border = {};
    for (const edge of ["top", "bottom", "left", "right"] as const) {
      const border = style.borders[edge];
      if (border)
        result.border[edge] = {
          style: border.style,
          color: excelColor(border.color),
        };
    }
  }
  return result;
}
function scalarFromExcel(
  value: any,
  dateSystem: "1900" | "1904",
  originalNumber?: number,
): Scalar {
  if (value === null || value === undefined) return null;
  if (value instanceof Date)
    return (
      originalNumber ??
      dateToSerial(
        value.getUTCFullYear(),
        value.getUTCMonth() + 1,
        value.getUTCDate(),
        dateSystem,
      ) +
        (value.getUTCHours() * 3600 +
          value.getUTCMinutes() * 60 +
          value.getUTCSeconds()) /
          86400
    );
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  )
    return value;
  if (value.error) return { type: "error", code: value.error };
  if (value.richText)
    return value.richText.map((run: any) => run.text ?? "").join("");
  if (value.text !== undefined) return String(value.text);
  return null;
}
function scalarToExcel(value: Scalar | undefined): any {
  return value && typeof value === "object"
    ? { error: value.code }
    : (value ?? null);
}
function safeHyperlink(value: string): boolean {
  return (
    /^(https?:|mailto:|tel:|#)/i.test(value) ||
    (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//"))
  );
}
const OPERATOR_TO_EXCEL: Record<string, string> = {
  greater: "greaterThan",
  less: "lessThan",
  greaterOrEqual: "greaterThanOrEqual",
  lessOrEqual: "lessThanOrEqual",
};
const OPERATOR_FROM_EXCEL = Object.fromEntries(
  Object.entries(OPERATOR_TO_EXCEL).map(([key, value]) => [value, key]),
);
function xmlEntities(text: string): string {
  return text
    .replace(
      /&(quot|apos|lt|gt|amp);/g,
      (_, key: string) =>
        ({ quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" })[key]!,
    )
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}
function xmlAttributes(text: string): Record<string, string> {
  return Object.fromEntries(
    [...text.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [
      match[1],
      xmlEntities(match[2]),
    ]),
  );
}
function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function packageTarget(owner: string, target: string): string {
  const path = target.startsWith("/") ? [] : owner.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") path.pop();
    else if (segment && segment !== ".") path.push(segment);
  }
  return path.join("/");
}

/** ExcelJS 4.4 assumes its own comment/VML filenames and relative relationship targets.
 * Normalize only the parser's working copy; the original package remains byte-for-byte available.
 */
function parserPackage(parts: Record<string, Uint8Array>): Uint8Array {
  const aliases = new Map<string, string>();
  let comment = 10000,
    vml = 10000;
  for (const name of Object.keys(parts)) {
    if (/^xl\/comments\/[^/]+\.xml$/.test(name))
      aliases.set(name, `xl/comments${++comment}.xml`);
    if (
      /^xl\/drawings\/[^/]+\.vml$/.test(name) &&
      !/^xl\/drawings\/vmlDrawing\d+\.vml$/.test(name)
    )
      aliases.set(name, `xl/drawings/vmlDrawing${++vml}.vml`);
  }
  const normalized: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(parts)) {
    if (
      /^xl\/drawings\/.*\.(xml|rels)$/.test(name) ||
      /^xl\/(charts|media)\//.test(name)
    )
      continue;
    // ExcelJS expands names and validation ranges into individual cells. Parse them sparsely ourselves.
    if (name === "xl/workbook.xml") {
      normalized[name] = strToU8(
        strFromU8(bytes).replace(
          /<definedNames\b[^>]*>[\s\S]*?<\/definedNames>/g,
          "",
        ),
      );
      continue;
    }
    if (!name.endsWith(".rels")) {
      normalized[aliases.get(name) ?? name] = bytes;
      continue;
    }
    const owner = name.replace("/_rels/", "/").replace(/\.rels$/, ""),
      directory = owner.split("/").slice(0, -1);
    const xml = strFromU8(bytes).replace(
      /<(?:\w+:)?Relationship\b[^>]*\/?\s*>/g,
      (tag) => {
        if (/TargetMode="External"/.test(tag)) return tag;
        return tag.replace(/Target="([^"]+)"/, (_, target: string) => {
          const segments = target.startsWith("/") ? [] : [...directory];
          for (const segment of xmlEntities(target).split("/")) {
            if (segment === "..") segments.pop();
            else if (segment && segment !== ".") segments.push(segment);
          }
          const resolved =
            aliases.get(segments.join("/")) ?? segments.join("/");
          const to = resolved.split("/"),
            from = [...directory];
          while (from.length && to.length && from[0] === to[0]) {
            from.shift();
            to.shift();
          }
          return `Target="${[...from.map(() => ".."), ...to].join("/")}"`;
        });
      },
    );
    normalized[name] = strToU8(xml);
  }
  return zipSync(normalized, { level: 1 });
}

export async function importXlsx(
  bytes: Uint8Array,
  filename = "Workbook.xlsx",
  options: IOOptions = {},
): Promise<{ workbook: Workbook; warnings: string[] }> {
  checkCancelled(options.signal);
  const entries = inspectXlsxPackage(bytes);
  const parts = unzipSync(bytes);
  checkCancelled(options.signal);
  for (const [name, value] of Object.entries(parts))
    if (
      /\.(xml|rels)$/i.test(name) &&
      /<!DOCTYPE|<!ENTITY/i.test(strFromU8(value))
    )
      fail("DTD and entity declarations are not accepted in workbook XML.");
  let declaredCells = 0;
  for (const [name, value] of Object.entries(parts))
    if (/^xl\/worksheets\/.*\.xml$/.test(name)) {
      const xml = strFromU8(value);
      for (const match of xml.matchAll(/<c\b([^>]*)>/g)) {
        const address = xmlAttributes(match[1]).r;
        if (address) parseAddress(address);
        if (++declaredCells > IO_LIMITS.cells)
          fail(
            "The workbook exceeds the two-million populated-cell import limit.",
          );
      }
      for (const match of xml.matchAll(/<row\b([^>]*)>/g)) {
        const row = Number(xmlAttributes(match[1]).r);
        if (!Number.isInteger(row) || row < 1 || row > 1048576)
          fail("A worksheet row exceeds Excel coordinate limits.");
      }
    }
  const warnings = new Set<string>();
  const unsupportedPatterns: [RegExp, string][] = [
    [
      /vbaProject|macrosheets|dialogsheets/i,
      "VBA/XLM macro payloads are retained only in the original-file recovery. They are never executed and will be removed by XLSX export.",
    ],
    [
      /^xl\/(charts|media)\/|^xl\/drawings\/.*(?:\.xml|\.rels)$/,
      "Imported charts, drawings, and pictures are retained in the original file only; XLSX conversion cannot preserve them.",
    ],
    [
      /^xl\/(pivotTables|pivotCache|slicers|slicerCaches|timelines)\//,
      "Imported PivotTables, caches, slicers, and timelines are retained in the original file only.",
    ],
    [
      /^xl\/(connections|queryTables|model|externalLinks)/,
      "Connections, Data Model, and external-link relationships are retained in the original file only. Sources are never contacted.",
    ],
    [
      /^xl\/(threadedComments|persons)\//,
      "Threaded comments and authors are retained in the original file only.",
    ],
    [
      /^(customXml|customUI|_xmlsignatures)\//,
      "Custom XML, ribbon extensions, and digital signatures are retained in the original file only.",
    ],
  ];
  const modeledPart =
    /^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(?:core|app)\.xml|xl\/(?:workbook|styles|sharedStrings|calcChain)\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/theme\/[^/]+\.xml|xl\/worksheets\/(?:[^/]+\.xml|_rels\/[^/]+\.xml\.rels)|xl\/tables\/[^/]+\.xml|xl\/comments\d+\.xml|xl\/comments\/[^/]+\.xml|xl\/drawings\/[^/]+\.vml)$/;
  const unknownParts = entries
    .filter(
      (entry) => !entry.name.endsWith("/") && !modeledPart.test(entry.name),
    )
    .map((entry) => entry.name);
  for (const [pattern, message] of unsupportedPatterns)
    if (entries.some((entry) => pattern.test(entry.name)))
      warnings.add(message);
  if (
    unknownParts.some(
      (name) => !unsupportedPatterns.some(([pattern]) => pattern.test(name)),
    )
  )
    warnings.add(
      "Additional unmodeled package parts are retained in the original file only and will not be included in XLSX conversion.",
    );
  const stylesXml = parts["xl/styles.xml"]
    ? strFromU8(parts["xl/styles.xml"])
    : "";
  if (
    /<gradientFill\b|horizontal="(?:fill|distributed|centerContinuous)"|textRotation="255"|underline val="(?:double|singleAccounting|doubleAccounting)"/.test(
      stylesXml,
    )
  )
    warnings.add(
      "Gradient fills and advanced alignment/text-decoration styles are retained in the original file only; common cell formatting is preserved.",
    );
  for (const [name, bytes] of Object.entries(parts))
    if (
      /^xl\/tables\/[^/]+\.xml$/.test(name) &&
      /<(?:filterColumn|sortState|calculatedColumnFormula)\b|totalsRowFunction=/.test(
        strFromU8(bytes),
      )
    )
      warnings.add(
        "Table filter/sort criteria and calculated/totals-column metadata are retained in the original file only; table cells and basic range/style are preserved.",
      );
  const sources: string[] = [];
  for (const [name, data] of Object.entries(parts))
    if (/^xl\/externalLinks\/.*\.rels$/.test(name))
      for (const match of strFromU8(data).matchAll(/Target="([^"]+)"/g))
        sources.push(xmlEntities(match[1]));
  const themeText = parts["xl/theme/theme1.xml"]
    ? strFromU8(parts["xl/theme/theme1.xml"])
    : "";
  const extractedTheme = [
    ...themeText.matchAll(
      /<a:(?:srgbClr\s+val|sysClr\s+[^>]*lastClr)="([0-9A-Fa-f]{6})"/g,
    ),
  ]
    .slice(0, 12)
    .map((m) => m[1]);
  const theme =
    extractedTheme.length === 12
      ? [
          extractedTheme[1],
          extractedTheme[0],
          extractedTheme[3],
          extractedTheme[2],
          ...extractedTheme.slice(4),
        ]
      : DEFAULT_THEME;
  const Excel = (await import("exceljs")).default;
  checkCancelled(options.signal);
  const source = new Excel.Workbook();
  try {
    await source.xlsx.load(parserPackage(parts) as any, {
      ignoreNodes: ["dataValidations", "mergeCells", "drawing", "picture"],
    });
  } catch (error) {
    fail(
      `XLSX parsing failed: ${error instanceof Error ? error.message : "invalid package"}`,
    );
  }
  checkCancelled(options.signal);
  const workbook = createWorkbook(filename.replace(/\.(xlsx|xlsm)$/i, ""));
  workbook.dateSystem = source.properties.date1904 ? "1904" : "1900";
  workbook.sheets = [];
  workbook.metadata = {
    xlsxSource: {
      filename,
      packageBase64: encodeBase64(bytes),
      importedWarnings: [],
      unknownParts,
      externalSources: sources,
    } satisfies SourceMetadata,
    xlsxThemes: (source as any)._themes,
  };
  const rawWorkbook = strFromU8(parts["xl/workbook.xml"]);
  const definedNames: Record<string, string>[] = [
    ...rawWorkbook.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g),
  ].map((match) => ({
    ...xmlAttributes(match[1]),
    reference: xmlEntities(match[2]),
  }));
  const relationships = Object.fromEntries(
    [
      ...strFromU8(
        parts["xl/_rels/workbook.xml.rels"] ?? new Uint8Array(),
      ).matchAll(/<Relationship\b([^>]*)\/?\s*>/g),
    ].map((match) => {
      const attr = xmlAttributes(match[1]);
      return [attr.Id, attr.Target];
    }),
  );
  const sheetPaths = Object.fromEntries(
    [...rawWorkbook.matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map((match) => {
      const attr = xmlAttributes(match[1]);
      const path = relationships[attr["r:id"]] ?? "";
      return [attr.name, path.startsWith("/") ? path.slice(1) : "xl/" + path];
    }),
  );
  workbook.calculationMode = /calcMode="manual"/.test(rawWorkbook)
    ? "manual"
    : "automatic";
  let cellCount = 0;
  for (const input of source.worksheets) {
    checkCancelled(options.signal);
    const sheet = createSheet(input.name);
    workbook.sheets.push(sheet);
    sheet.visibility = input.state;
    sheet.tabColor = colorHex(input.properties.tabColor, theme);
    sheet.protected = !!(input as any).sheetProtection?.sheet;
    const sheetPath =
      sheetPaths[input.name] ?? `xl/worksheets/sheet${input.id}.xml`;
    const xml = parts[sheetPath] ? strFromU8(parts[sheetPath]) : "";
    const rawNumbers = new Map<string, number>();
    for (const cell of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const address = cell[1].match(/\br="([^"]+)"/)?.[1],
        value = cell[2].match(/<v>([^<]*)<\/v>/)?.[1];
      if (
        address &&
        value !== undefined &&
        !/\bt="(?:s|str|b|e|inlineStr)"/.test(cell[1]) &&
        Number.isFinite(Number(value))
      )
        rawNumbers.set(address, Number(value));
    }
    if (/<(?:\w+:)?extLst\b/.test(xml))
      warnings.add(
        "Worksheet extension metadata is retained in the original file only.",
      );
    input.eachRow({ includeEmpty: false }, (row) => {
      if (row.number > 1048576)
        fail("A worksheet row exceeds Excel coordinate limits.");
      if (
        row.height !== undefined ||
        row.hidden ||
        row.outlineLevel ||
        Object.keys((row as any).style ?? {}).length
      )
        sheet.rows[row.number - 1] = {
          height: row.height === undefined ? undefined : (row.height * 4) / 3,
          hidden: row.hidden,
          outlineLevel: row.outlineLevel,
          style: importStyle((row as any).style, theme),
        };
      row.eachCell({ includeEmpty: false }, (item) => {
        if (++cellCount > IO_LIMITS.cells)
          fail(
            "The workbook exceeds the two-million populated-cell import limit.",
          );
        if (item.isMerged && item.master.address !== item.address) return;
        parseAddress(item.address);
        const cell: Cell = {
          value: scalarFromExcel(
            item.value,
            workbook.dateSystem,
            rawNumbers.get(item.address),
          ),
        };
        if (item.formula) {
          cell.formula = "=" + item.formula;
          cell.value = null;
          cell.cached = scalarFromExcel(
            item.result,
            workbook.dateSystem,
            rawNumbers.get(item.address),
          );
        }
        if (
          item.value &&
          typeof item.value === "object" &&
          "shareType" in item.value &&
          item.value.shareType === "array"
        )
          warnings.add(
            "Legacy array-formula region metadata is retained in the original file only; the anchor formula source is kept.",
          );
        cell.style = importStyle(item.style, theme);
        if (item.note)
          cell.note =
            typeof item.note === "string"
              ? item.note
              : (item.note.texts?.map((run) => run.text).join("") ?? "");
        if (item.hyperlink) {
          if (safeHyperlink(item.hyperlink)) cell.hyperlink = item.hyperlink;
          else
            warnings.add(
              "Unsafe hyperlink schemes were removed from editable cells; the original file remains available.",
            );
        }
        if (item.protection?.locked !== undefined)
          cell.locked = item.protection.locked;
        if (
          item.value &&
          typeof item.value === "object" &&
          "richText" in item.value
        )
          warnings.add(
            "In-cell rich text is flattened to plain text; content is kept, run-specific formatting is not.",
          );
        sheet.cells[item.address] = cell;
      });
    });
    const sheetRels = parts[sheetPath.replace(/\/([^/]+)$/, "/_rels/$1.rels")];
    if (sheetRels)
      for (const match of strFromU8(sheetRels).matchAll(
        /<Relationship\b([^>]*)\/?\s*>/g,
      )) {
        const relationship = xmlAttributes(match[1]);
        if (!relationship.Type?.endsWith("/comments")) continue;
        const commentXml = parts[packageTarget(sheetPath, relationship.Target)];
        if (!commentXml) continue;
        for (const comment of strFromU8(commentXml).matchAll(
          /<comment\b([^>]*)>([\s\S]*?)<\/comment>/g,
        )) {
          const { ref } = xmlAttributes(comment[1]);
          if (!ref) continue;
          parseAddress(ref);
          const text = [...comment[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
            .map((m) => xmlEntities(m[1]))
            .join("");
          sheet.cells[ref] ??= { value: null };
          sheet.cells[ref].note = text;
        }
        warnings.add(
          "Legacy note text is preserved; original authors and text-run formatting are retained only in the original file.",
        );
      }
    (input.columns ?? []).forEach((column, index) => {
      if (
        column &&
        (column.width !== undefined ||
          column.hidden ||
          column.outlineLevel ||
          Object.keys(column.style ?? {}).length)
      )
        sheet.columns[index] = {
          width: column.width === undefined ? undefined : column.width * 7 + 5,
          hidden: column.hidden,
          outlineLevel: column.outlineLevel,
          style: importStyle(column.style, theme),
        };
    });
    sheet.merges = [...xml.matchAll(/<mergeCell\b([^>]*)\/?\s*>/g)].map(
      (match) => parseRange(xmlAttributes(match[1]).ref),
    );
    const view = input.views[0];
    if (view) {
      sheet.showGridlines = view.showGridLines !== false;
      if (view.state === "frozen")
        sheet.freeze = { rows: view.ySplit ?? 0, columns: view.xSplit ?? 0 };
      if (view.state === "split")
        warnings.add(
          "Split-pane geometry is retained in the original file only; frozen panes are supported.",
        );
    }
    const setup = input.pageSetup;
    sheet.print = {
      orientation: setup.orientation ?? "portrait",
      paperSize:
        ({ 9: "A4", 8: "A3", 5: "Legal" } as const)[
          setup.paperSize as 9 | 8 | 5
        ] ?? "Letter",
      margins: setup.margins
        ? {
            top: setup.margins.top,
            bottom: setup.margins.bottom,
            left: setup.margins.left,
            right: setup.margins.right,
          }
        : sheet.print.margins,
      scale: setup.scale ?? 100,
      fitToWidth: setup.fitToPage ? setup.fitToWidth : undefined,
      fitToHeight: setup.fitToPage ? setup.fitToHeight : undefined,
      gridlines: setup.showGridLines,
      headings: setup.showRowColHeaders,
      header: input.headerFooter?.oddHeader,
      footer: input.headerFooter?.oddFooter,
    };
    for (const name of definedNames.filter(
      (entry) => Number(entry.localSheetId) === workbook.sheets.length - 1,
    )) {
      const references = name.reference
        .split(/,(?=(?:'[^']*'|[^']*)!)/)
        .map((ref) => ref.slice(ref.lastIndexOf("!") + 1));
      if (name.name === "_xlnm.Print_Area") {
        try {
          sheet.print.area = parseRange(references[0]);
          if (references.length > 1)
            warnings.add("Only the first print area is editable and exported.");
        } catch {
          warnings.add("A nonrectangular print area was not imported.");
        }
      }
      if (name.name === "_xlnm.Print_Titles")
        for (const reference of references) {
          if (/^\$?\d+:\$?\d+$/.test(reference)) {
            const r = reference
              .replaceAll("$", "")
              .split(":")
              .map((n) => Number(n) - 1);
            sheet.print.repeatRows = [r[0], r[1]];
          }
          if (/^\$?[A-Z]+:\$?[A-Z]+$/.test(reference)) {
            const c = reference
              .replaceAll("$", "")
              .split(":")
              .map((n) => parseAddress(n + "1").col);
            sheet.print.repeatColumns = [c[0], c[1]];
          }
        }
    }
    sheet.print.rowBreaks = ((input.model as any).rowBreaks ?? []).map(
      (b: any) => b.id - 1,
    );
    for (const match of xml.matchAll(
      /<dataValidation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/dataValidation>)/g,
    )) {
      const attr = xmlAttributes(match[1]);
      const validation: Record<string, any> = {
        ...attr,
        allowBlank: attr.allowBlank === "1" || attr.allowBlank === "true",
        formulae: [1, 2].map((n) => {
          const raw = (match[2] ?? "").match(
            new RegExp(`<formula${n}[^>]*>([\\s\\S]*?)<\\/formula${n}>`),
          )?.[1];
          return raw === undefined ? undefined : xmlEntities(raw);
        }),
      };
      const reference = attr.sqref;
      if (!reference) continue;
      for (const ref of reference.split(/\s+/)) {
        if (
          ![
            "list",
            "whole",
            "decimal",
            "date",
            "textLength",
            "custom",
          ].includes(validation.type)
        ) {
          warnings.add(
            "An unsupported validation type was retained only in the original file.",
          );
          continue;
        }
        const list =
          validation.type === "list" &&
          /^".*"$/.test(String(validation.formulae?.[0] ?? ""))
            ? String(validation.formulae[0]).slice(1, -1).split(",")
            : undefined;
        sheet.validations.push({
          id: newId("validation"),
          range: parseRange(ref),
          type: validation.type,
          operator: (OPERATOR_FROM_EXCEL[validation.operator] ??
            validation.operator) as ValidationRule["operator"],
          values: list,
          formula1: list
            ? undefined
            : validation.formulae?.[0] === undefined
              ? undefined
              : String(validation.formulae[0]),
          formula2:
            validation.formulae?.[1] === undefined
              ? undefined
              : String(validation.formulae[1]),
          allowBlank: validation.allowBlank,
          prompt: validation.prompt,
          errorTitle: validation.errorTitle,
          error: validation.error,
          errorStyle: validation.errorStyle,
        });
      }
    }
    for (const tableData of input.getTables()) {
      const table = (tableData as any).table;
      const range = parseRange(table.tableRef ?? table.ref);
      sheet.tables.push({
        id: newId("table"),
        name: table.name,
        range,
        columns: table.columns.map((c: any) => c.name),
        headerRow: table.headerRow !== false,
        totalsRow: !!table.totalsRow,
        bandedRows: table.style?.showRowStripes !== false,
        style: table.style?.theme,
      });
    }
    for (const formatting of (input as any).conditionalFormattings ?? []) {
      for (const rule of formatting.rules ?? []) {
        const types = [
          "cellIs",
          "containsText",
          "duplicateValues",
          "colorScale",
          "dataBar",
          "expression",
        ];
        if (!types.includes(rule.type)) {
          warnings.add(
            "Unsupported conditional-format rules are retained only in the original file.",
          );
          continue;
        }
        for (const ref of formatting.ref.split(/\s+/))
          sheet.conditionalFormats.push({
            id: newId("format"),
            range: parseRange(ref),
            type: rule.type,
            priority: rule.priority ?? 1,
            stopIfTrue: rule.stopIfTrue,
            operator: (OPERATOR_FROM_EXCEL[rule.operator] ??
              rule.operator) as ValidationRule["operator"],
            formula:
              rule.type === "expression"
                ? String(rule.formulae?.[0] ?? "")
                : undefined,
            value: rule.formulae?.[0] ?? rule.text,
            value2: rule.formulae?.[1],
            colors: rule.color?.map((color: any) => colorHex(color, theme)),
            style: importStyle(rule.style, theme),
          });
      }
    }
  }
  if (!workbook.sheets.length) fail("The workbook has no readable worksheets.");
  const active = source.views[0]?.activeTab ?? 0;
  workbook.activeSheetId =
    workbook.sheets[active]?.id ??
    workbook.sheets.find((sheet) => sheet.visibility === "visible")?.id ??
    workbook.sheets[0].id;
  for (const entry of definedNames)
    if (entry.name && !entry.name.startsWith("_xlnm."))
      workbook.names.push({
        name: entry.name,
        reference: entry.reference,
        sheetId:
          entry.localSheetId === undefined
            ? undefined
            : workbook.sheets[Number(entry.localSheetId)]?.id,
        comment: entry.comment,
      });
  (workbook.metadata.xlsxSource as SourceMetadata).importedWarnings = [
    ...warnings,
  ];
  return { workbook, warnings: [...warnings] };
}

export function xlsxExportWarnings(workbook: Workbook): string[] {
  const warnings = new Set<string>(
    (workbook.metadata?.xlsxSource as SourceMetadata | undefined)
      ?.importedWarnings ?? [],
  );
  if (workbook.sheets.some((sheet) => sheet.charts.length))
    warnings.add(
      "Charts created in Sheets are kept in the native workbook, but are not yet serialized as editable Excel charts.",
    );
  if (workbook.sheets.some((sheet) => sheet.pivots.length))
    warnings.add(
      "Pivot results are exported as worksheet cells; pivot field definitions and refresh behavior require a native workbook.",
    );
  if (workbook.sheets.some((sheet) => sheet.print.columnBreaks?.length))
    warnings.add(
      "Manual column page breaks require the native workbook and are not exported.",
    );
  if (
    workbook.sheets.some(
      (sheet) =>
        Object.values(sheet.rows).some((row) => row.filtered) ||
        sheet.tables.some((table) => Object.keys(table.filters ?? {}).length > 0),
    ) ||
    Object.keys((workbook.metadata?.filters as object | undefined) ?? {}).length > 0
  )
    warnings.add(
      "Filtered rows export as manually hidden rows. AutoFilter criteria and the filtered-versus-hidden distinction are not preserved, so SUBTOTAL and AGGREGATE may recalculate differently. Save a native workbook to retain the exact filter state.",
    );
  if (
    workbook.sheets.some((sheet) =>
      Object.values(sheet.cells).some(
        (cell) => cell.formula && externalFormula(cell.formula),
      ),
    )
  )
    warnings.add(
      "External-workbook formulas will be replaced by their cached values during XLSX conversion; missing caches become #REF!. The native workbook keeps the formula source.",
    );
  return [...warnings];
}

function externalFormula(formula: string): boolean {
  return /(?:'(?:[^']|'')*\[[^\]]+\](?:[^']|'')*'|\[[^\]]+\][A-Za-z_][\w.]*|\[[^\]]+\])!/.test(
    formula.replace(/"(?:[^"]|"")*"/g, ""),
  );
}

export async function exportXlsx(
  workbook: Workbook,
  options: IOOptions = {},
): Promise<Uint8Array> {
  checkCancelled(options.signal);
  const warnings = xlsxExportWarnings(workbook);
  if (warnings.length && !options.allowLossy)
    throw new CompatibilityError(warnings);
  const Excel = (await import("exceljs")).default;
  checkCancelled(options.signal);
  const output = new Excel.Workbook();
  output.creator = "LopeOS Sheets";
  output.lastModifiedBy = "LopeOS Sheets";
  output.properties.date1904 = workbook.dateSystem === "1904";
  output.calcProperties.fullCalcOnLoad = true;
  (output.calcProperties as any).calcMode =
    workbook.calculationMode === "manual" ? "manual" : "auto";
  if (workbook.metadata?.xlsxThemes)
    (output as any)._themes = workbook.metadata.xlsxThemes;
  output.views = [
    {
      x: 0,
      y: 0,
      width: 12000,
      height: 8000,
      firstSheet: 0,
      activeTab: Math.max(
        0,
        workbook.sheets.findIndex(
          (sheet) => sheet.id === workbook.activeSheetId,
        ),
      ),
      visibility: "visible",
    },
  ];
  let count = 0;
  for (const sheet of workbook.sheets) {
    checkCancelled(options.signal);
    const target = output.addWorksheet(sheet.name, {
      state: sheet.visibility,
      properties: { tabColor: excelColor(sheet.tabColor) },
      views: [
        {
          state:
            sheet.freeze.rows || sheet.freeze.columns ? "frozen" : "normal",
          xSplit: sheet.freeze.columns,
          ySplit: sheet.freeze.rows,
          showGridLines: sheet.showGridlines,
        } as ExcelJS.WorksheetView,
      ],
    });
    for (const [index, row] of Object.entries(sheet.rows)) {
      const item = target.getRow(Number(index) + 1);
      if (row.height !== undefined) item.height = (row.height * 3) / 4;
      item.hidden = !!(row.hidden || row.filtered);
      item.outlineLevel = row.outlineLevel ?? 0;
      (item as any).style = exportStyle(row.style);
    }
    for (const [index, column] of Object.entries(sheet.columns)) {
      const item = target.getColumn(Number(index) + 1);
      item.width =
        column.width === undefined
          ? undefined
          : Math.max(0, (column.width - 5) / 7);
      item.hidden = !!column.hidden;
      item.outlineLevel = column.outlineLevel ?? 0;
      item.style = exportStyle(column.style);
    }
    for (const table of sheet.tables) {
      const { start, end } = table.range;
      if (
        (end.row - start.row + 1) * (end.col - start.col + 1) >
        IO_LIMITS.cells
      )
        fail("A table exceeds the two-million-cell export limit.");
      const rows: any[][] = [];
      for (
        let row = start.row + (table.headerRow ? 1 : 0);
        row <= end.row - (table.totalsRow ? 1 : 0);
        row++
      ) {
        const values: any[] = [];
        for (let col = start.col; col <= end.col; col++) {
          const cell = sheet.cells[cellAddress(row, col)];
          values.push(scalarToExcel(cell?.formula ? cell.cached : cell?.value));
        }
        rows.push(values);
      }
      target.addTable({
        name: table.name,
        ref: cellAddress(start.row, start.col),
        headerRow: table.headerRow,
        totalsRow: table.totalsRow,
        style: {
          theme: (table.style as any) ?? "TableStyleMedium2",
          showRowStripes: table.bandedRows,
        },
        columns: table.columns.map((name) => ({ name, filterButton: true })),
        rows,
      });
    }
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (++count > IO_LIMITS.cells)
        fail(
          "The workbook exceeds the two-million populated-cell export limit.",
        );
      if (count % 10000 === 0) {
        checkCancelled(options.signal);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      parseAddress(address);
      const item = target.getCell(address);
      item.value =
        cell.formula && externalFormula(cell.formula)
          ? scalarToExcel(cell.cached ?? { type: "error", code: "#REF!" })
          : cell.formula
            ? {
                formula: cell.formula.slice(1),
                result: scalarToExcel(cell.cached),
              }
            : cell.hyperlink && safeHyperlink(cell.hyperlink)
              ? {
                  text: cell.value === null ? "" : String(cell.value),
                  hyperlink: cell.hyperlink,
                }
              : scalarToExcel(cell.value);
      item.style = exportStyle(cell.style);
      if (cell.note) item.note = cell.note;
      if (cell.locked !== undefined) item.protection = { locked: cell.locked };
    }
    for (const validation of sheet.validations)
      (target as any).dataValidations.add(rangeAddress(validation.range), {
        type: validation.type,
        operator:
          OPERATOR_TO_EXCEL[validation.operator ?? ""] ?? validation.operator,
        allowBlank: validation.allowBlank,
        formulae: validation.values
          ? [`"${validation.values.join(",")}"`]
          : [validation.formula1, validation.formula2]
              .filter((value) => value !== undefined)
              .map((value) => {
                const text = String(value);
                return text.startsWith("=")
                  ? text.slice(1)
                  : /^[-+]?\d+(?:\.\d+)?$/.test(text)
                    ? Number(text)
                    : text;
              }),
        showInputMessage: !!validation.prompt,
        prompt: validation.prompt,
        showErrorMessage: true,
        error: validation.error,
        errorTitle: validation.errorTitle,
        errorStyle: validation.errorStyle ?? "stop",
      });
    for (const format of sheet.conditionalFormats) {
      const rule: any = {
        type: format.type,
        priority: format.priority,
        stopIfTrue: format.stopIfTrue,
        operator: OPERATOR_TO_EXCEL[format.operator ?? ""] ?? format.operator,
        style: exportStyle(format.style),
      };
      if (format.type === "expression")
        rule.formulae = [(format.formula ?? "").replace(/^=/, "")];
      else if (format.type === "containsText") {
        rule.operator = "containsText";
        rule.text = String(format.value ?? "");
      } else if (format.type === "colorScale") {
        rule.cfvo = [{ type: "min" }, { type: "max" }];
        rule.color = (format.colors ?? ["#f8696b", "#63be7b"])
          .slice(0, 2)
          .map(excelColor);
      } else if (format.type === "dataBar") {
        rule.cfvo = [{ type: "min" }, { type: "max" }];
        rule.color = excelColor(format.colors?.[0] ?? "#638ec6");
      } else
        rule.formulae = [format.value, format.value2]
          .filter((value) => value !== undefined)
          .map(String);
      target.addConditionalFormatting({
        ref: rangeAddress(format.range),
        rules: [rule],
      });
    }
    const print = sheet.print;
    target.pageSetup = {
      orientation: print.orientation,
      paperSize: { Letter: 1, Legal: 5, A3: 8, A4: 9 }[print.paperSize],
      margins: { ...print.margins, header: 0.3, footer: 0.3 },
      scale: print.scale,
      fitToPage:
        print.fitToWidth !== undefined || print.fitToHeight !== undefined,
      fitToWidth: print.fitToWidth,
      fitToHeight: print.fitToHeight,
      showGridLines: print.gridlines,
      showRowColHeaders: print.headings,
      printArea: print.area ? rangeAddress(print.area) : undefined,
      printTitlesRow: print.repeatRows?.map((row) => row + 1).join(":"),
      printTitlesColumn: print.repeatColumns?.map(columnName).join(":"),
    } as ExcelJS.PageSetup;
    target.headerFooter.oddHeader = print.header ?? "";
    target.headerFooter.oddFooter = print.footer ?? "";
    for (const row of print.rowBreaks ?? [])
      target.getRow(row + 1).addPageBreak();
    if (sheet.protected)
      await target.protect("", {
        selectLockedCells: true,
        selectUnlockedCells: true,
        spinCount: 1,
      });
  }
  checkCancelled(options.signal);
  const generated = unzipSync(new Uint8Array(await output.xlsx.writeBuffer()));
  for (let i = 0; i < workbook.sheets.length; i++) {
    const sheet = workbook.sheets[i];
    if (!sheet.merges.length) continue;
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    const mergeXml = `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((range) => `<mergeCell ref="${rangeAddress(range)}"/>`).join("")}</mergeCells>`;
    // mergeCells precedes conditionalFormatting/dataValidations/hyperlinks/printing per SpreadsheetML.
    const xml = strFromU8(generated[path]);
    const next =
      /<(conditionalFormatting|dataValidations|hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|drawing|tableParts|extLst)\b/.exec(
        xml,
      );
    generated[path] = strToU8(
      next
        ? xml.slice(0, next.index) + mergeXml + xml.slice(next.index)
        : xml.replace("</worksheet>", mergeXml + "</worksheet>"),
    );
  }
  let workbookXml = strFromU8(generated["xl/workbook.xml"]);
  const namesXml = workbook.names
    .map(
      (name) =>
        `<definedName name="${escapeXml(name.name)}"${
          name.sheetId
            ? ` localSheetId="${Math.max(
                0,
                workbook.sheets.findIndex((sheet) => sheet.id === name.sheetId),
              )}"`
            : ""
        }${name.comment ? ` comment="${escapeXml(name.comment)}"` : ""}>${escapeXml(name.reference.replace(/^=/, ""))}</definedName>`,
    )
    .join("");
  if (namesXml)
    workbookXml = workbookXml.includes("</definedNames>")
      ? workbookXml.replace("</definedNames>", namesXml + "</definedNames>")
      : workbookXml.replace(
          "<calcPr",
          `<definedNames>${namesXml}</definedNames><calcPr`,
        );
  workbookXml = workbookXml.replace(
    /<calcPr\b/,
    `<calcPr calcMode="${workbook.calculationMode === "manual" ? "manual" : "auto"}"`,
  );
  generated["xl/workbook.xml"] = strToU8(workbookXml);
  const result = zipSync(generated, { level: 6 });
  checkCancelled(options.signal);
  return result;
}
