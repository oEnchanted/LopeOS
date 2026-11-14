import FormulaParser from "fast-formula-parser";
import {
  cellAddress,
  cellValue,
  createSheet,
  createWorkbook,
  dateToSerial,
  error,
  getCell,
  inRange,
  inputCell,
  isError,
  MAX_COLUMNS,
  MAX_ROWS,
  normalizeRange,
  parseAddress,
  parseRange,
  rangeSize,
  serialToDate,
  setCell,
  usedRange,
  type Cell,
  type CellStyle,
  type Point,
  type Range,
  type Scalar,
  type Table,
  type Workbook,
  type Worksheet,
} from "./model.ts";
import {
  adjustFormula,
  formulaReferences,
  moveFormulaReferences,
  quoteSheet,
  renameSheetReferences,
  structuralFormula,
} from "./references.ts";
import { parseFormula, visitFormula, type FormulaAst } from "./formula-ast.ts";

const FE = FormulaParser.FormulaError;
type Ref = {
  sheet?: string;
  row?: number;
  col?: number;
  from?: { row: number; col: number };
  to?: { row: number; col: number };
};
type CalculationValue = Scalar | Scalar[][];
export interface CellEdit {
  sheetId: string;
  address: string;
  input: string | Scalar | Cell;
}
export interface CalculationReport {
  evaluated: number;
  durationMs: number;
  errors: {
    sheetId: string;
    address: string;
    code: string;
    message?: string;
  }[];
  pending: number;
}
interface Dependency {
  sheetId: string;
  range: Range;
}
interface CellDelta {
  sheetId: string;
  address: string;
  before?: Cell;
  after?: Cell;
}
type HistoryEntry =
  | {
      label: string;
      deltas: CellDelta[];
      tables?: { sheetId: string; before: Table[]; after: Table[] }[];
    }
  | { label: string; before: Workbook; after: Workbook };
const RANGE_LIMIT = 250_000;
const DEPTH_LIMIT = 128;
const HISTORY_LIMIT = 30;
const VOLATILE = /\b(?:NOW|TODAY|RAND|RANDBETWEEN|OFFSET|INDIRECT)\s*\(/i;
const aggregateNames = [
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "COUNTA",
  "COUNTBLANK",
  "PRODUCT",
];
const ownNames = [
  ...aggregateNames,
  "COUNTIFS",
  "SUMIFS",
  "AVERAGEIFS",
  "SEQUENCE",
  "FILTER",
  "SORT",
  "SORTBY",
  "UNIQUE",
  "XLOOKUP",
  "XMATCH",
  "MATCH",
  "MEDIAN",
  "LARGE",
  "SMALL",
  "STDEV.S",
  "STDEV.P",
  "VAR.S",
  "VAR.P",
  "PV",
  "FV",
  "PMT",
  "NPV",
  "NPER",
  "SUBTOTAL",
  "AGGREGATE",
  "DATE",
  "DATEVALUE",
  "DAY",
  "MONTH",
  "YEAR",
  "DAYS",
  "EDATE",
  "EOMONTH",
  "TODAY",
  "NOW",
  "LEN",
  "LENB",
  "UPPER",
  "TEXTJOIN",
  "SUBSTITUTE",
  "IFERROR",
  "IFNA",
  "LET",
  "LAMBDA",
];
const unwrap = (arg: any): any =>
  arg && typeof arg === "object" && "value" in arg ? arg.value : arg;
const flatten = (v: any): any[] => (Array.isArray(v) ? v.flat(Infinity) : [v]);
function asNumber(v: any): number {
  v = unwrap(v);
  if (Array.isArray(v)) v = v[0]?.[0];
  if (v instanceof FE) throw v;
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "boolean") return +v;
  const n = Number(v);
  if (!Number.isFinite(n)) throw FE.VALUE;
  return n;
}
function asLogical(v: any): boolean {
  if (v instanceof FE) throw v;
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string" && /^(true|false)$/i.test(v))
    return v.toLowerCase() === "true";
  throw FE.VALUE;
}
function matrix(v: any): any[][] {
  v = unwrap(v);
  return Array.isArray(v)
    ? Array.isArray(v[0])
      ? v
      : v.map((x) => [x])
    : [[v]];
}
function fromParser(v: any): Scalar {
  if (v instanceof FE) return error(v.error, v.message || undefined);
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : error("#NUM!");
  if (typeof v === "string" || typeof v === "boolean") return v;
  return error("#VALUE!", "The formula returned an unsupported value.");
}
function toParser(v: Scalar): any {
  return isError(v) ? new FE(v.code, v.message) : v;
}
function formulaLiteral(v: CalculationValue): string {
  if (Array.isArray(v))
    return (
      "{" +
      v
        .map((row) => row.map((item) => formulaLiteral(item)).join(","))
        .join(";") +
      "}"
    );
  if (v === null) return "0";
  if (isError(v)) return v.code;
  if (typeof v === "string") return '"' + v.replace(/"/g, '""') + '"';
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
function splitArguments(text: string): string[] {
  const args: string[] = [];
  let start = 0,
    depth = 0,
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') i++;
      else quote = !quote;
    }
    if (quote) continue;
    if ("({[".includes(c)) depth++;
    if (")}]".includes(c)) depth--;
    if (c === "," && depth === 0) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  args.push(text.slice(start));
  return args;
}
function replaceNames(
  formula: string,
  scope: Map<string, CalculationValue>,
): string {
  return formula.replace(
    /"(?:[^"]|"")*"|'(?:[^']|'')*'|\b[A-Za-z_][A-Za-z0-9_.]*\b/g,
    (part, offset: number) => {
      if (
        part.startsWith('"') ||
        part.startsWith("'") ||
        formula[offset + part.length] === "!" ||
        formula[offset - 1] === "!"
      )
        return part;
      const value = scope.get(part.toUpperCase());
      return value === undefined ? part : "(" + formulaLiteral(value) + ")";
    },
  );
}
function closingParen(text: string, start: number): number {
  let depth = 0,
    quoted = false;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    }
    if (quoted) continue;
    if (text[i] === "(") depth++;
    if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}
function broadcast(
  left: any,
  right: any,
  operation: (a: any, b: any) => any,
): any {
  if (!Array.isArray(left) && !Array.isArray(right))
    return operation(left, right);
  const a = matrix(left),
    b = matrix(right),
    rows = Math.max(a.length, b.length),
    cols = Math.max(a[0]?.length ?? 0, b[0]?.length ?? 0);
  if (rows * cols > RANGE_LIMIT)
    throw new FE("#CALC!", "Array calculation limit reached.");
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      if (
        (a.length !== 1 && row >= a.length) ||
        (b.length !== 1 && row >= b.length) ||
        (a[0].length !== 1 && col >= a[0].length) ||
        (b[0].length !== 1 && col >= b[0].length)
      )
        return FE.NA;
      return operation(
        a[a.length === 1 ? 0 : row][a[0].length === 1 ? 0 : col],
        b[b.length === 1 ? 0 : row][b[0].length === 1 ? 0 : col],
      );
    }),
  );
}
/** Uses the library's LL(1) parser and dependency parser, with no eval/code execution. */
export class WorkbookEngine {
  workbook: Workbook;
  private parsers: FormulaParser[] = [];
  private dependencies = new Map<string, Dependency[]>();
  private formulaTrees = new Map<string, FormulaAst>();
  private dependents = new Map<string, Set<string>>();
  private rangeDependents = new Map<string, { range: Range; key: string }[]>();
  private dirty = new Set<string>();
  private evaluating = new Set<string>();
  private spillValues = new Map<string, Scalar>();
  private spillOwners = new Map<string, string>();
  private spillMembers = new Map<string, Set<string>>();
  private blockedSpills = new Set<string>();
  private histories: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private counter = 0;
  private expressionDepth = 0;
  private nameStack = new Set<string>();
  private valueOverrides = new Map<string, Scalar>();
  private dependencyParser = new FormulaParser.DepParser({
    onVariable: (name, sheetName) => this.namedReference(name, sheetName),
  });
  constructor(workbook: Workbook = createWorkbook()) {
    this.workbook = workbook;
    this.rebuild();
  }
  get canUndo(): boolean {
    return !!this.histories.length;
  }
  get canRedo(): boolean {
    return !!this.future.length;
  }
  sheet(id = this.workbook.activeSheetId): Worksheet {
    const sheet = this.workbook.sheets.find((s) => s.id === id);
    if (!sheet) throw new Error("Worksheet does not exist.");
    return sheet;
  }
  ast(sheetId: string, address: string): FormulaAst | undefined {
    return this.formulaTrees.get(this.key(sheetId, address));
  }
  private key(sheetId: string, address: string): string {
    return sheetId + "!" + address;
  }
  private resolveKey(key: string): [Worksheet, string] {
    const split = key.lastIndexOf("!");
    return [this.sheet(key.slice(0, split)), key.slice(split + 1)];
  }
  private findSheet(name?: string): Worksheet {
    const s = this.workbook.sheets.find(
      (sheet) =>
        sheet.name.toLowerCase() === name?.toLowerCase() || sheet.id === name,
    );
    if (!s) throw new FE("#REF!", `Worksheet ${name} is missing.`);
    return s;
  }
  private refRange(ref: Ref): Range {
    return ref.from && ref.to
      ? {
          start: { row: ref.from.row - 1, col: ref.from.col - 1 },
          end: { row: ref.to.row - 1, col: ref.to.col - 1 },
        }
      : {
          start: { row: ref.row! - 1, col: ref.col! - 1 },
          end: { row: ref.row! - 1, col: ref.col! - 1 },
        };
  }
  private namedReference(name: string, sheetName?: string): Ref | null {
    const sheet = this.workbook.sheets.find((s) => s.name === sheetName);
    const named =
      this.workbook.names.find(
        (n) =>
          n.name.toLowerCase() === name.toLowerCase() &&
          n.sheetId === sheet?.id,
      ) ??
      this.workbook.names.find(
        (n) => n.name.toLowerCase() === name.toLowerCase() && !n.sheetId,
      );
    if (!named) return null;
    const ref = formulaReferences(named.reference)[0];
    if (
      !ref ||
      ref.start > (named.reference.startsWith("=") ? 1 : 0) ||
      ref.end !== named.reference.trimEnd().length
    )
      return null;
    const a = parseAddress(ref.first),
      b = ref.last ? parseAddress(ref.last) : undefined;
    return b
      ? {
          sheet: ref.sheet ?? sheetName,
          from: { row: a.row + 1, col: a.col + 1 },
          to: { row: b.row + 1, col: b.col + 1 },
        }
      : { sheet: ref.sheet ?? sheetName, row: a.row + 1, col: a.col + 1 };
  }
  private expandStructured(
    formula: string,
    sheet: Worksheet,
    point: Point,
  ): string {
    return formula.replace(
      /"(?:[^"]|"")*"|(?:([A-Za-z_][\w.]*)\[([^\]]+)\])|\[@([^\]]+)\]/g,
      (
        match,
        tableName: string | undefined,
        column: string | undefined,
        local: string | undefined,
      ) => {
        if (match.startsWith('"')) return match;
        const source = tableName
          ? this.workbook.sheets.find((s) =>
              s.tables.some(
                (t) => t.name.toLowerCase() === tableName.toLowerCase(),
              ),
            )
          : sheet;
        const table = tableName
          ? source?.tables.find(
              (t) => t.name.toLowerCase() === tableName.toLowerCase(),
            )
          : sheet.tables.find((t) => inRange(point, t.range));
        if (!source || !table) return "#NAME?";
        const colName = (local ?? column ?? "").replace(/^@/, ""),
          col = table.columns.findIndex(
            (c) => c.toLowerCase() === colName.toLowerCase(),
          );
        if (col < 0) return "#REF!";
        const colIdx = table.range.start.col + col;
        if (local || column?.startsWith("@"))
          return quoteSheet(source.name) + "!" + cellAddress(point.row, colIdx);
        const start = table.range.start.row + (table.headerRow ? 1 : 0),
          end = table.range.end.row - (table.totalsRow ? 1 : 0);
        return end < start
          ? "#REF!"
          : quoteSheet(source.name) +
              "!" +
              cellAddress(start, colIdx) +
              ":" +
              cellAddress(end, colIdx);
      },
    );
  }
  private updateDependencies(sheet: Worksheet, address: string): void {
    const key = this.key(sheet.id, address),
      cell = sheet.cells[address];
    const previous = this.dependencies.get(key) ?? [];
    for (const dep of previous)
      if (rangeSize(dep.range) === 1)
        this.dependents
          .get(
            this.key(
              dep.sheetId,
              cellAddress(dep.range.start.row, dep.range.start.col),
            ),
          )
          ?.delete(key);
    if (previous.length)
      for (const [id, refs] of this.rangeDependents)
        this.rangeDependents.set(
          id,
          refs.filter((r) => r.key !== key),
        );
    this.dependencies.delete(key);
    this.formulaTrees.delete(key);
    if (!cell?.formula) {
      this.dirty.delete(key);
      this.blockedSpills.delete(key);
      return;
    }
    const p = parseAddress(address),
      deps: Dependency[] = [];
    try {
      const expanded = this.expandStructured(cell.formula, sheet, p),
        refs = this.dependencyParser.parse(
          expanded.slice(1),
          { row: p.row + 1, col: p.col + 1, sheet: sheet.name },
          true,
        );
      const visitedNames = new Set<string>();
      const discover = (expression: string, root = false) => {
        try {
          const tree = parseFormula(expression);
          if (root) this.formulaTrees.set(key, tree);
          visitFormula(tree, (node) => {
            if (node.kind === "reference")
              refs.push({
                sheet: node.sheet ?? sheet.name,
                from: {
                  row: node.range.start.row + 1,
                  col: node.range.start.col + 1,
                },
                to: {
                  row: node.range.end.row + 1,
                  col: node.range.end.col + 1,
                },
              });
            else if (node.kind === "name") {
              const name = this.workbook.names.find(
                (n) =>
                  n.name.toLowerCase() === node.name.toLowerCase() &&
                  (!n.sheetId || n.sheetId === sheet.id),
              );
              if (name && !visitedNames.has(name.name)) {
                visitedNames.add(name.name);
                discover(name.reference);
              }
            }
          });
        } catch {
          /* The evaluation parser remains authoritative for broader grammar. */
        }
      };
      discover(expanded, true);
      const seen = new Set<string>();
      for (const ref of refs) {
        const target = this.findSheet(ref.sheet ?? sheet.name),
          range = this.refRange(ref);
        if (
          !Number.isInteger(range.start.row) ||
          !Number.isInteger(range.start.col) ||
          range.start.row < 0 ||
          range.start.col < 0
        )
          continue;
        const identity = JSON.stringify([target.id, range]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        deps.push({ sheetId: target.id, range });
        if (rangeSize(range) === 1) {
          const dependency = this.key(
            target.id,
            cellAddress(range.start.row, range.start.col),
          );
          const set = this.dependents.get(dependency) ?? new Set<string>();
          set.add(key);
          this.dependents.set(dependency, set);
        } else {
          const list = this.rangeDependents.get(target.id) ?? [];
          list.push({ range, key });
          this.rangeDependents.set(target.id, list);
        }
      }
    } catch {
      /* Invalid formulas receive explicit errors at calculation. */
    }
    this.dependencies.set(key, deps);
  }
  rebuild(): void {
    this.dependencies.clear();
    this.formulaTrees.clear();
    this.dependents.clear();
    this.rangeDependents.clear();
    this.dirty.clear();
    this.spillValues.clear();
    this.spillOwners.clear();
    this.spillMembers.clear();
    this.blockedSpills.clear();
    for (const sheet of this.workbook.sheets)
      for (const [address, cell] of Object.entries(sheet.cells))
        if (cell.formula) {
          this.updateDependencies(sheet, address);
          this.dirty.add(this.key(sheet.id, address));
        }
  }
  /** Worker synchronization: preserve the graph and caches across ordinary edits. */
  updateSnapshot(next: Workbook): "incremental" | "rebuild" {
    const signature = (book: Workbook) =>
      JSON.stringify({
        id: book.id,
        dateSystem: book.dateSystem,
        names: book.names,
        sheets: book.sheets.map((s) => ({
          id: s.id,
          name: s.name,
          merges: s.merges,
          tables: s.tables,
          hiddenRows: Object.entries(s.rows)
            .filter(([, r]) => r.hidden || r.filtered)
            .map(([row, value]) => [row, !!value.hidden, !!value.filtered]),
        })),
      });
    if (signature(this.workbook) !== signature(next)) {
      this.workbook = next;
      this.rebuild();
      return "rebuild";
    }
    const changes: {
      sheetId: string;
      address: string;
      formulaChanged: boolean;
    }[] = [];
    for (const sheet of next.sheets) {
      const previous = this.sheet(sheet.id),
        addresses = new Set([
          ...Object.keys(previous.cells),
          ...Object.keys(sheet.cells),
        ]);
      for (const address of addresses) {
        const before = previous.cells[address],
          after = sheet.cells[address],
          formulaChanged = before?.formula !== after?.formula,
          valueChanged =
            JSON.stringify(before?.value ?? null) !==
            JSON.stringify(after?.value ?? null);
        if (formulaChanged || valueChanged)
          changes.push({ sheetId: sheet.id, address, formulaChanged });
        else if (after?.formula) after.cached = before?.cached;
      }
    }
    this.workbook = next;
    for (const change of changes) {
      if (change.formulaChanged)
        this.updateDependencies(this.sheet(change.sheetId), change.address);
      this.markDirty(this.key(change.sheetId, change.address));
    }
    return "incremental";
  }
  private markDirty(key: string): void {
    const queue = [key],
      visited = new Set<string>();
    while (queue.length) {
      const next = queue.pop()!;
      if (visited.has(next)) continue;
      visited.add(next);
      const [sheet, address] = this.resolveKey(next);
      if (sheet.cells[address]?.formula) this.dirty.add(next);
      for (const dependent of this.dependents.get(next) ?? [])
        queue.push(dependent);
      const point = parseAddress(address);
      for (const dependency of this.rangeDependents.get(sheet.id) ?? [])
        if (inRange(point, dependency.range)) queue.push(dependency.key);
      for (const spill of this.spillMembers.get(next) ?? []) {
        this.spillValues.delete(spill);
        this.spillOwners.delete(spill);
        queue.push(spill);
      }
      this.spillMembers.delete(next);
    }
    // Spill obstacles can change without being normal formula dependencies.
    for (const formulaKey of this.blockedSpills) this.dirty.add(formulaKey);
  }
  private record(entry: HistoryEntry): void {
    this.histories.push(entry);
    if (this.histories.length > HISTORY_LIMIT) this.histories.shift();
    this.future = [];
  }
  private changed(): void {
    this.workbook.revision++;
    this.workbook.updatedAt = new Date().toISOString();
  }
  setCell(
    sheetId: string,
    address: string,
    input: string | Scalar | Cell,
  ): void {
    this.batch([{ sheetId, address, input }]);
  }
  batch(edits: CellEdit[], label = "Edit cells"): void {
    if (edits.length > RANGE_LIMIT)
      throw new Error(
        `A single edit is limited to ${RANGE_LIMIT.toLocaleString()} cells.`,
      );
    const deltas: CellDelta[] = [],
      seen = new Map<string, number>();
    // Validate the entire batch before changing any value.
    for (const edit of edits) {
      const sheet = this.sheet(edit.sheetId),
        p = parseAddress(edit.address);
      if (
        sheet.protected &&
        sheet.cells[cellAddress(p.row, p.col)]?.locked !== false
      )
        throw new Error("This worksheet is protected.");
      const next = inputCell(edit.input, sheet.cells[edit.address]);
      if (sheet.validations.some((rule) => inRange(p, rule.range))) {
        const evaluated = next.formula
          ? this.evaluateExpression(next.formula, sheet, p)
          : next.value;
        const problem = this.validate(
          sheet.id,
          cellAddress(p.row, p.col),
          Array.isArray(evaluated) ? (evaluated[0]?.[0] ?? null) : evaluated,
        );
        if (problem) throw new Error(problem);
      }
      if (this.spillOwners.has(this.key(sheet.id, cellAddress(p.row, p.col))))
        throw new Error(
          "You cannot change part of a spilled array. Edit its first cell.",
        );
    }
    for (const edit of edits) {
      const sheet = this.sheet(edit.sheetId),
        p = parseAddress(edit.address),
        address = cellAddress(p.row, p.col),
        key = this.key(sheet.id, address);
      const before = sheet.cells[address]
        ? structuredClone(sheet.cells[address])
        : undefined;
      setCell(sheet, address, edit.input);
      const after = sheet.cells[address]
        ? structuredClone(sheet.cells[address])
        : undefined;
      if (seen.has(key)) deltas[seen.get(key)!].after = after;
      else {
        seen.set(key, deltas.length);
        deltas.push({ sheetId: sheet.id, address, before, after });
      }
      this.updateDependencies(sheet, address);
      this.markDirty(key);
    }
    const tables = this.expandTables(deltas);
    if (tables.length) this.rebuild();
    if (deltas.length) {
      this.record({ label, deltas, ...(tables.length ? { tables } : {}) });
      this.changed();
    }
  }
  private expandTables(
    deltas: CellDelta[],
  ): { sheetId: string; before: Table[]; after: Table[] }[] {
    const changes: { sheetId: string; before: Table[]; after: Table[] }[] = [],
      touched = new Map<string, Set<string>>(),
      deltaIndex = new Map(
        deltas.map((delta) => [this.key(delta.sheetId, delta.address), delta]),
      );
    for (const delta of deltas) {
      const cell = this.sheet(delta.sheetId).cells[delta.address];
      if (cell?.formula || (cell && cell.value !== null && cell.value !== "")) {
        const set = touched.get(delta.sheetId) ?? new Set<string>();
        set.add(delta.address);
        touched.set(delta.sheetId, set);
      }
    }
    for (const [sheetId, addresses] of touched) {
      const sheet = this.sheet(sheetId);
      if (sheet.protected) continue;
      let before: Table[] | undefined;
      for (const table of sheet.tables) {
        if (table.totalsRow) continue;
        const originalEnd = table.range.end.row;
        let end = originalEnd;
        while (end + 1 < MAX_ROWS) {
          let entered = false;
          for (
            let col = table.range.start.col;
            col <= table.range.end.col;
            col++
          )
            if (addresses.has(cellAddress(end + 1, col))) {
              entered = true;
              break;
            }
          if (!entered) break;
          const row = end + 1;
          if (
            sheet.tables.some(
              (other) =>
                other.id !== table.id &&
                row >= other.range.start.row &&
                row <= other.range.end.row &&
                table.range.start.col <= other.range.end.col &&
                table.range.end.col >= other.range.start.col,
            )
          )
            break;
          if (
            sheet.merges.some(
              (merge) =>
                row >= merge.start.row &&
                row <= merge.end.row &&
                table.range.start.col <= merge.end.col &&
                table.range.end.col >= merge.start.col,
            )
          )
            break;
          if (!before) before = structuredClone(sheet.tables);
          end = row;
          table.range.end.row = end;
          for (
            let col = table.range.start.col;
            col <= table.range.end.col;
            col++
          ) {
            const address = cellAddress(row, col),
              current = sheet.cells[address];
            if (
              current?.formula ||
              (current && current.value !== null && current.value !== "")
            )
              continue;
            const source = sheet.cells[cellAddress(row - 1, col)];
            if (!source?.formula) continue;
            const filled: Cell = {
              ...structuredClone(current ?? { value: null }),
              formula: adjustFormula(source.formula, 1, 0),
              cached: undefined,
              style: current?.style ?? structuredClone(source.style),
            };
            sheet.cells[address] = filled;
            const key = this.key(sheetId, address),
              existing = deltaIndex.get(key);
            if (existing) existing.after = structuredClone(filled);
            else {
              const delta = {
                sheetId,
                address,
                before: current ? structuredClone(current) : undefined,
                after: structuredClone(filled),
              };
              deltas.push(delta);
              deltaIndex.set(key, delta);
            }
          }
        }
      }
      if (before)
        changes.push({ sheetId, before, after: structuredClone(sheet.tables) });
    }
    return changes;
  }
  transact(label: string, mutate: (workbook: Workbook) => void): void {
    const before = structuredClone(this.workbook);
    try {
      mutate(this.workbook);
      this.changed();
      this.rebuild();
      this.record({ label, before, after: structuredClone(this.workbook) });
    } catch (e) {
      this.workbook = before;
      this.rebuild();
      throw e;
    }
  }
  undo(): boolean {
    const entry = this.histories.pop();
    if (!entry) return false;
    this.applyHistory(entry, false);
    this.future.push(entry);
    return true;
  }
  redo(): boolean {
    const entry = this.future.pop();
    if (!entry) return false;
    this.applyHistory(entry, true);
    this.histories.push(entry);
    return true;
  }
  private applyHistory(entry: HistoryEntry, forward: boolean): void {
    if ("deltas" in entry) {
      for (const d of entry.deltas) {
        const sheet = this.sheet(d.sheetId),
          cell = forward ? d.after : d.before;
        if (cell) sheet.cells[d.address] = structuredClone(cell);
        else delete sheet.cells[d.address];
      }
      for (const tables of entry.tables ?? [])
        this.sheet(tables.sheetId).tables = structuredClone(
          forward ? tables.after : tables.before,
        );
    } else
      this.workbook = structuredClone(forward ? entry.after : entry.before);
    this.changed();
    this.rebuild();
  }
  validate(sheetId: string, address: string, value: Scalar): string | null {
    const point = parseAddress(address),
      sheet = this.sheet(sheetId);
    for (const rule of sheet.validations) {
      if (
        !inRange(point, rule.range) ||
        (rule.errorStyle && rule.errorStyle !== "stop") ||
        (rule.allowBlank && (value === null || value === ""))
      )
        continue;
      let valid = true;
      if (rule.type === "list") {
        let choices: Scalar[] = rule.values ?? [];
        if (!rule.values && rule.formula1) {
          if (
            rule.formula1.startsWith('"') ||
            (rule.formula1.includes(",") && !rule.formula1.startsWith("="))
          )
            choices = rule.formula1.replace(/^"|"$/g, "").split(",");
          else
            choices = flatten(
              this.evaluateExpression(rule.formula1, sheet, point),
            );
        }
        valid = choices.some(
          (choice) =>
            String(choice ?? "").toLowerCase() ===
            String(value ?? "").toLowerCase(),
        );
      } else if (rule.type === "custom") {
        const key = this.key(sheetId, address);
        this.valueOverrides.set(key, value);
        try {
          const result = this.evaluateExpression(
            adjustFormula(
              rule.formula1 ?? "=FALSE",
              point.row - rule.range.start.row,
              point.col - rule.range.start.col,
            ),
            sheet,
            point,
          );
          valid =
            result === true || (typeof result === "number" && result !== 0);
        } finally {
          this.valueOverrides.delete(key);
        }
      } else {
        const n =
          rule.type === "textLength"
            ? String(value ?? "").length
            : typeof value === "number"
              ? value
              : NaN;
        const boundary = (text: string | undefined) =>
          text?.startsWith("=")
            ? Number(this.evaluateExpression(text, sheet, point))
            : Number(text);
        const a = boundary(rule.formula1),
          b = boundary(rule.formula2);
        valid =
          Number.isFinite(n) &&
          (rule.type !== "whole" || Number.isInteger(n)) &&
          compareConstraint(n, a, b, rule.operator ?? "between");
      }
      if (!valid)
        return (
          rule.error ??
          `The value in ${address} does not meet its data validation rule.`
        );
    }
    return null;
  }
  private denseRange(ref: Ref, defaultSheet: string): any[][] {
    const sheet = this.findSheet(ref.sheet ?? defaultSheet),
      range = this.refRange(ref);
    if (rangeSize(range) > RANGE_LIMIT)
      throw new FE(
        "#CALC!",
        `This operation needs a dense range larger than ${RANGE_LIMIT.toLocaleString()} cells. Use a bounded range.`,
      );
    const result: any[][] = [];
    for (let row = range.start.row; row <= range.end.row; row++) {
      const line: any[] = [];
      for (let col = range.start.col; col <= range.end.col; col++)
        line.push(toParser(this.value(sheet.id, cellAddress(row, col), true)));
      result.push(line);
    }
    return result;
  }
  private sparseArgument(
    arg: any,
    context: FormulaParser,
  ): { values: any[]; size: number; reference: boolean } {
    const ref: Ref | undefined = arg?.ref;
    if (!ref) {
      const raw = unwrap(arg);
      if (raw && typeof raw === "object" && !Array.isArray(raw) && !(raw instanceof FE))
        throw new FE("#VALUE!", "Union arguments are not supported here. Pass the ranges as separate arguments.");
      const values = flatten(raw);
      return {
        values,
        size: values.length,
        reference: Array.isArray(raw),
      };
    }
    const sheet = this.findSheet(ref.sheet ?? context.position.sheet),
      range = this.refRange(ref),
      values: any[] = [];
    if (rangeSize(range) === 1)
      values.push(
        toParser(
          this.value(
            sheet.id,
            cellAddress(range.start.row, range.start.col),
            true,
          ),
        ),
      );
    else if (rangeSize(range) <= 1000) {
      for (let row = range.start.row; row <= range.end.row; row++)
        for (let col = range.start.col; col <= range.end.col; col++)
          values.push(
            toParser(this.value(sheet.id, cellAddress(row, col), true)),
          );
    } else {
      for (const address of Object.keys(sheet.cells))
        if (inRange(parseAddress(address), range))
          values.push(toParser(this.value(sheet.id, address, true)));
      for (const [key, value] of this.spillValues) {
        const [s, address] = this.resolveKey(key);
        if (s.id === sheet.id && inRange(parseAddress(address), range))
          values.push(toParser(value));
      }
    }
    return { values, size: rangeSize(range), reference: true };
  }
  private aggregate(name: string, context: FormulaParser, args: any[]): number {
    const numeric: number[] = [];
    let count = 0,
      blanks = 0;
    for (const arg of args) {
      const data = this.sparseArgument(arg, context);
      blanks += data.size - data.values.length;
      for (const value of data.values) {
        if (value === null || value === undefined || value === "") {
          blanks++;
          if (value === "" && name === "COUNTA") count++;
          continue;
        }
        count++;
        if (value instanceof FE) {
          if (["COUNT", "COUNTA", "COUNTBLANK"].includes(name)) continue;
          throw value;
        }
        if (typeof value === "number") numeric.push(value);
        else if (!data.reference && typeof value === "boolean")
          numeric.push(+value);
        else if (!data.reference && typeof value === "string") {
          const number = Number(value);
          if (Number.isFinite(number)) numeric.push(number);
          else if (!["COUNT", "COUNTA", "COUNTBLANK"].includes(name))
            throw FE.VALUE;
        }
      }
    }
    if (name === "COUNT") return numeric.length;
    if (name === "COUNTA") return count;
    if (name === "COUNTBLANK") return blanks;
    if (name === "SUM") return numeric.reduce((a, b) => a + b, 0);
    if (name === "AVERAGE") {
      if (!numeric.length) throw FE.DIV0;
      return numeric.reduce((a, b) => a + b, 0) / numeric.length;
    }
    if (name === "MIN")
      return numeric.length
        ? numeric.reduce((a, b) => Math.min(a, b), Infinity)
        : 0;
    if (name === "MAX")
      return numeric.length
        ? numeric.reduce((a, b) => Math.max(a, b), -Infinity)
        : 0;
    return numeric.length ? numeric.reduce((a, b) => a * b, 1) : 0;
  }
  private parser(depth: number): FormulaParser {
    if (this.parsers[depth]) return this.parsers[depth];
    const contextFunctions: Record<string, (...args: any[]) => any> = {};
    contextFunctions.ISBLANK = (context: FormulaParser, arg: any) => {
      if (arg?.ref) {
        const sheet = this.findSheet(arg.ref.sheet ?? context.position.sheet),
          range = this.refRange(arg.ref);
        if (rangeSize(range) > RANGE_LIMIT)
          throw new FE("#CALC!", "Use a bounded ISBLANK range.");
        const values: boolean[][] = [];
        for (let row = range.start.row; row <= range.end.row; row++) {
          const line: boolean[] = [];
          for (let col = range.start.col; col <= range.end.col; col++) {
            const a = cellAddress(row, col),
              cell = sheet.cells[a];
            line.push(
              !cell?.formula &&
                (cell?.value ?? null) === null &&
                !this.spillValues.has(this.key(sheet.id, a)),
            );
          }
          values.push(line);
        }
        return rangeSize(range) === 1 ? values[0][0] : values;
      }
      const value = unwrap(arg);
      return Array.isArray(value)
        ? matrix(value).map((row) => row.map((v) => v === null))
        : value === null;
    };
    contextFunctions.IF = (
      context: FormulaParser,
      condition: any,
      yes: any,
      no: any = false,
    ) => {
      const cond = context.retrieveRef(condition);
      return broadcast(
        cond,
        broadcast(
          context.retrieveRef(yes),
          context.retrieveRef(no),
          (a, b) => ({ a, b }),
        ),
        (c, branches) => {
          try {
            return asLogical(c) ? branches.a : branches.b;
          } catch (e) {
            return e;
          }
        },
      );
    };
    for (const name of aggregateNames)
      contextFunctions[name] = (context: FormulaParser, ...args: any[]) =>
        this.aggregate(name, context, args);
    contextFunctions.SUBTOTAL = (
      context: FormulaParser,
      fn: any,
      ...args: any[]
    ) => {
      const code = asNumber(fn),
        names: Record<number, string> = {
          1: "AVERAGE",
          2: "COUNT",
          3: "COUNTA",
          4: "MAX",
          5: "MIN",
          9: "SUM",
          6: "PRODUCT",
        };
      const name = names[code % 100];
      if (!name)
        throw new FE("#NAME?", "This SUBTOTAL aggregation is not implemented.");
      const filtered: any[] = [];
      for (const arg of args) {
        if (!arg?.ref) {
          filtered.push(arg);
          continue;
        }
        const sheet = this.findSheet(arg.ref.sheet ?? context.position.sheet),
          range = this.refRange(arg.ref);
        for (const [address, cell] of Object.entries(sheet.cells)) {
          const p = parseAddress(address);
          if (
            inRange(p, range) &&
            !sheet.rows[p.row]?.filtered &&
            (!sheet.rows[p.row]?.hidden || code < 100) &&
            !cell.formula?.match(/^=SUBTOTAL\(/i)
          )
            filtered.push({
              ref: { sheet: sheet.name, row: p.row + 1, col: p.col + 1 },
            });
        }
      }
      return this.aggregate(name, context, filtered);
    };
    contextFunctions.AGGREGATE = (
      context: FormulaParser,
      fn: any,
      opt: any,
      ...args: any[]
    ) => {
      const option = asNumber(opt);
      if (![0, 1, 2, 3, 4, 5, 6, 7].includes(option)) throw FE.VALUE;
      const code = asNumber(fn);
      const names: Record<number, string> = {
        1: "AVERAGE",
        2: "COUNT",
        3: "COUNTA",
        4: "MAX",
        5: "MIN",
        6: "PRODUCT",
        9: "SUM",
      };
      if (!names[code])
        throw new FE(
          "#NAME?",
          "This AGGREGATE aggregation is not implemented.",
        );
      let values: any[] = [];
      for (const arg of args) {
        if (arg?.ref) {
          const s = this.findSheet(arg.ref.sheet ?? context.position.sheet),
            r = this.refRange(arg.ref);
          for (const [a, c] of Object.entries(s.cells)) {
            const p = parseAddress(a);
            if (
              !inRange(p, r) ||
              s.rows[p.row]?.filtered ||
              ([1, 3, 5, 7].includes(option) && s.rows[p.row]?.hidden) ||
              (option <= 3 && /^=(SUBTOTAL|AGGREGATE)\(/i.test(c.formula ?? ""))
            )
              continue;
            values.push(toParser(this.value(s.id, a, true)));
          }
        } else values.push(...flatten(unwrap(arg)));
      }
      if ([2, 3, 6, 7].includes(option))
        values = values.filter((v) => !(v instanceof FE));
      return this.aggregate(names[code], context, [values]);
    };
    const functions: Record<string, (...args: any[]) => any> = {
      WEBSERVICE: () => {
        throw new FE(
          "#BLOCKED!",
          "Network functions are disabled. Workbook calculation stays local.",
        );
      },
      RTD: () => {
        throw new FE("#BLOCKED!", "External services are not configured.");
      },
      TRIM: (arg) => {
        const value = unwrap(arg);
        if (value instanceof FE) throw value;
        return String(value ?? "")
          .replace(/^ +| +$/g, "")
          .replace(/ {2,}/g, " ");
      },
      UPPER: (arg) => {
        const value = unwrap(arg);
        if (value instanceof FE) throw value;
        return String(value ?? "").toUpperCase();
      },
      TEXTJOIN: (delimiter, ignore, ...texts) => {
        const separator = String(unwrap(delimiter) ?? ""),
          skip = asLogical(unwrap(ignore));
        const values = texts.flatMap((arg) => flatten(unwrap(arg)));
        for (const value of values) if (value instanceof FE) throw value;
        const result = values
          .filter((v) => !skip || (v !== null && v !== ""))
          .map((v) =>
            typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v ?? ""),
          )
          .join(separator);
        if (result.length > 32767) throw FE.VALUE;
        return result;
      },
      SUBSTITUTE: (text, oldText, newText, instance) => {
        const value = String(unwrap(text) ?? ""),
          old = String(unwrap(oldText) ?? ""),
          replacement = String(unwrap(newText) ?? "");
        if (!old) return value;
        if (instance === undefined) return value.split(old).join(replacement);
        const target = Math.trunc(asNumber(instance));
        if (target < 1) throw FE.VALUE;
        let index = -old.length;
        for (let n = 0; n < target; n++) {
          index = value.indexOf(old, index + old.length);
          if (index < 0) return value;
        }
        return (
          value.slice(0, index) + replacement + value.slice(index + old.length)
        );
      },
      IFERROR: (value, fallback) =>
        broadcast(unwrap(value), unwrap(fallback), (v, f) =>
          v instanceof FE ? f : v,
        ),
      IFNA: (value, fallback) =>
        broadcast(unwrap(value), unwrap(fallback), (v, f) =>
          v instanceof FE && v.error === "#N/A" ? f : v,
        ),
      DATE: (y, m, d) => {
        let year = Math.trunc(asNumber(y));
        if (year >= 0 && year < 1900) year += 1900;
        const serial = dateToSerial(
          year,
          Math.trunc(asNumber(m)),
          Math.trunc(asNumber(d)),
          this.workbook.dateSystem,
        );
        if (year < 0 || year > 9999) throw FE.NUM;
        return serial;
      },
      DATEVALUE: (v) => {
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(unwrap(v)));
        if (!m)
          throw new FE(
            "#VALUE!",
            "DATEVALUE currently accepts invariant yyyy-mm-dd dates.",
          );
        return dateToSerial(+m[1], +m[2], +m[3], this.workbook.dateSystem);
      },
      YEAR: (v) => serialToDate(asNumber(v), this.workbook.dateSystem).year,
      MONTH: (v) => serialToDate(asNumber(v), this.workbook.dateSystem).month,
      DAY: (v) => serialToDate(asNumber(v), this.workbook.dateSystem).day,
      DAYS: (a, b) => asNumber(a) - asNumber(b),
      EDATE: (s, m) => {
        const d = serialToDate(asNumber(s), this.workbook.dateSystem);
        const first = dateToSerial(
            d.year,
            d.month + asNumber(m),
            1,
            this.workbook.dateSystem,
          ),
          next = dateToSerial(
            d.year,
            d.month + asNumber(m) + 1,
            1,
            this.workbook.dateSystem,
          );
        return first + Math.min(d.day, next - first) - 1;
      },
      EOMONTH: (s, m) => {
        const d = serialToDate(asNumber(s), this.workbook.dateSystem);
        return (
          dateToSerial(
            d.year,
            d.month + asNumber(m) + 1,
            1,
            this.workbook.dateSystem,
          ) - 1
        );
      },
      TODAY: () => {
        const d = new Date();
        return dateToSerial(
          d.getFullYear(),
          d.getMonth() + 1,
          d.getDate(),
          this.workbook.dateSystem,
        );
      },
      NOW: () => {
        const d = new Date();
        return (
          dateToSerial(
            d.getFullYear(),
            d.getMonth() + 1,
            d.getDate(),
            this.workbook.dateSystem,
          ) +
          (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400
        );
      },
      SEQUENCE: (r, c, s, step) => {
        const rows = Math.trunc(asNumber(r)),
          cols = c === undefined ? 1 : Math.trunc(asNumber(c)),
          start = s === undefined ? 1 : asNumber(s),
          increment = step === undefined ? 1 : asNumber(step);
        if (rows < 1 || cols < 1) throw FE.VALUE;
        if (rows * cols > RANGE_LIMIT)
          throw new FE(
            "#CALC!",
            "The requested array exceeds the calculation limit.",
          );
        return Array.from({ length: rows }, (_, i) =>
          Array.from(
            { length: cols },
            (_, j) => start + (i * cols + j) * increment,
          ),
        );
      },
      FILTER: (array, include, empty) => {
        const data = matrix(array),
          condition = matrix(include);
        for (const v of condition.flat()) if (v instanceof FE) throw v;
        let result: any[][];
        if (condition.length === data.length && condition[0].length === 1)
          result = data.filter((_, i) => asLogical(condition[i][0]));
        else if (
          condition.length === 1 &&
          condition[0].length === data[0].length
        )
          result = data.map((row) =>
            row.filter((_, j) => asLogical(condition[0][j])),
          );
        else throw FE.VALUE;
        return result.length && result[0].length
          ? result
          : empty === undefined
            ? new FE("#CALC!", "FILTER returned an empty array.")
            : unwrap(empty);
      },
      UNIQUE: (array, byCol, exact) => {
        let data = matrix(array);
        const columns = Boolean(unwrap(byCol)),
          once = Boolean(unwrap(exact));
        if (columns) data = data[0].map((_, i) => data.map((row) => row[i]));
        const counts = new Map<string, number>();
        for (const row of data) {
          const key = JSON.stringify(
            row.map((v) => (typeof v === "string" ? v.toLowerCase() : v)),
          );
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const seen = new Set<string>(),
          result = data.filter((row) => {
            const key = JSON.stringify(
              row.map((v) => (typeof v === "string" ? v.toLowerCase() : v)),
            );
            if (seen.has(key) || (once && counts.get(key) !== 1)) return false;
            seen.add(key);
            return true;
          });
        if (!result.length)
          throw new FE("#CALC!", "UNIQUE returned an empty array.");
        return columns
          ? result[0].map((_, i) => result.map((row) => row[i]))
          : result;
      },
      SORT: (array, index, order, byCol) => {
        let data = matrix(array).map((row) => [...row]);
        const column = Boolean(unwrap(byCol));
        if (column) data = data[0].map((_, i) => data.map((row) => row[i]));
        const idx = index === undefined ? 0 : asNumber(index) - 1,
          dir = order === undefined ? 1 : asNumber(order);
        if (![1, -1].includes(dir) || idx < 0 || idx >= data[0].length)
          throw FE.VALUE;
        data.sort((a, b) => compareValues(a[idx], b[idx]) * dir);
        return column ? data[0].map((_, i) => data.map((row) => row[i])) : data;
      },
      SORTBY: (array, ...sorts) => {
        const data = matrix(array),
          orders: number[] = [],
          keys: any[][] = [];
        for (let i = 0; i < sorts.length; i += 2) {
          const key = flatten(unwrap(sorts[i]));
          if (key.length !== data.length) throw FE.VALUE;
          keys.push(key);
          const dir = sorts[i + 1] === undefined ? 1 : asNumber(sorts[i + 1]);
          if (![1, -1].includes(dir)) throw FE.VALUE;
          orders.push(dir);
        }
        return data
          .map((row, i) => ({ row, i }))
          .sort((a, b) => {
            for (let j = 0; j < keys.length; j++) {
              const cmp = compareValues(keys[j][a.i], keys[j][b.i]) * orders[j];
              if (cmp) return cmp;
            }
            return a.i - b.i;
          })
          .map((item) => item.row);
      },
      XMATCH: (lookup, array, mode, search) =>
        findMatch(
          unwrap(lookup),
          flatten(unwrap(array)),
          mode === undefined ? 0 : asNumber(mode),
          search === undefined ? 1 : asNumber(search),
        ) + 1,
      MATCH: (lookup, array, mode) => {
        const type = mode === undefined ? 1 : asNumber(mode);
        if (![-1, 0, 1].includes(type)) throw FE.VALUE;
        return (
          findMatch(
            unwrap(lookup),
            flatten(unwrap(array)),
            type === 0
              ? typeof unwrap(lookup) === "string" &&
                /[?*]/.test(unwrap(lookup))
                ? 2
                : 0
              : type === 1
                ? -1
                : 1,
            1,
          ) + 1
        );
      },
      XLOOKUP: (lookup, array, returned, missing, mode, search) => {
        const lookupValues = flatten(unwrap(array)),
          data = matrix(returned);
        let index: number;
        try {
          index = findMatch(
            unwrap(lookup),
            lookupValues,
            mode === undefined ? 0 : asNumber(mode),
            search === undefined ? 1 : asNumber(search),
          );
        } catch (e) {
          if (e === FE.NA && missing !== undefined) return unwrap(missing);
          throw e;
        }
        if (data.length === lookupValues.length)
          return data[index].length === 1 ? data[index][0] : [data[index]];
        if (data[0].length === lookupValues.length)
          return data.map((row) => [row[index]]);
        throw FE.VALUE;
      },
      SUMIFS: (sum, ...pairs) =>
        conditionalAggregate("sum", matrix(sum), pairs),
      COUNTIFS: (...pairs) => conditionalAggregate("count", undefined, pairs),
      AVERAGEIFS: (avg, ...pairs) =>
        conditionalAggregate("average", matrix(avg), pairs),
      MEDIAN: (...args) => {
        const values = numericValues(args).sort((a, b) => a - b);
        if (!values.length) throw FE.NUM;
        return (
          (values[Math.floor((values.length - 1) / 2)] +
            values[Math.floor(values.length / 2)]) /
          2
        );
      },
      LARGE: (array, k) => {
        const values = numericValues([array]).sort((a, b) => b - a),
          index = Math.ceil(asNumber(k)) - 1;
        if (index < 0 || index >= values.length) throw FE.NUM;
        return values[index];
      },
      SMALL: (array, k) => {
        const values = numericValues([array]).sort((a, b) => a - b),
          index = Math.ceil(asNumber(k)) - 1;
        if (index < 0 || index >= values.length) throw FE.NUM;
        return values[index];
      },
      "STDEV.S": (...args) => Math.sqrt(variance(numericValues(args), true)),
      "STDEV.P": (...args) => Math.sqrt(variance(numericValues(args), false)),
      "VAR.S": (...args) => variance(numericValues(args), true),
      "VAR.P": (...args) => variance(numericValues(args), false),
      PV: (rate, nper, pmt, fv, type) => {
        const r = asNumber(rate),
          n = asNumber(nper),
          p = asNumber(pmt),
          f = fv === undefined ? 0 : asNumber(fv),
          t = type === undefined ? 0 : asNumber(type);
        if (![0, 1].includes(t) || r <= -1) throw FE.NUM;
        return r === 0
          ? -f - p * n
          : -(f + (p * (1 + r * t) * ((1 + r) ** n - 1)) / r) / (1 + r) ** n;
      },
      FV: (rate, nper, pmt, pv, type) => {
        const r = asNumber(rate),
          n = asNumber(nper),
          p = asNumber(pmt),
          v = pv === undefined ? 0 : asNumber(pv),
          t = type === undefined ? 0 : asNumber(type);
        if (![0, 1].includes(t) || r <= -1) throw FE.NUM;
        return r === 0
          ? -v - p * n
          : -v * (1 + r) ** n - (p * (1 + r * t) * ((1 + r) ** n - 1)) / r;
      },
      PMT: (rate, nper, pv, fv, type) => {
        const r = asNumber(rate),
          n = asNumber(nper),
          v = asNumber(pv),
          f = fv === undefined ? 0 : asNumber(fv),
          t = type === undefined ? 0 : asNumber(type);
        if (![0, 1].includes(t) || r <= -1) throw FE.NUM;
        if (!n) throw FE.DIV0;
        return r === 0
          ? -(v + f) / n
          : (-(v * (1 + r) ** n + f) * r) / ((1 + r * t) * ((1 + r) ** n - 1));
      },
      NPER: (rate, pmt, pv, fv, type) => {
        const r = asNumber(rate),
          p = asNumber(pmt),
          v = asNumber(pv),
          f = fv === undefined ? 0 : asNumber(fv),
          t = type === undefined ? 0 : asNumber(type);
        if (![0, 1].includes(t) || r <= -1) throw FE.NUM;
        if (!r) {
          if (!p) throw FE.DIV0;
          return -(v + f) / p;
        }
        const payment = p * (1 + r * t);
        return (
          Math.log((payment - f * r) / (payment + v * r)) / Math.log(1 + r)
        );
      },
      NPV: (rate, ...values) => {
        const r = asNumber(rate);
        if (r === -1) throw FE.DIV0;
        return numericValues(values).reduce(
          (sum, v, i) => sum + v / (1 + r) ** (i + 1),
          0,
        );
      },
    };
    const parser = new FormulaParser({
      functions,
      functionsNeedContext: contextFunctions,
      onCell: (ref) => {
        if (!Number.isInteger(ref.row) || !Number.isInteger(ref.col))
          throw FE.NAME;
        const sheet = this.findSheet(ref.sheet);
        return toParser(
          this.value(sheet.id, cellAddress(ref.row! - 1, ref.col! - 1), true),
        );
      },
      onRange: (ref) => this.denseRange(ref, ref.sheet!),
      onVariable: (name, sheet) => this.namedReference(name, sheet),
    });
    parser.funsNeedContextAndNoDataRetrieve.push(
      ...aggregateNames,
      "SUBTOTAL",
      "AGGREGATE",
      "ISBLANK",
    );
    const checkResult = parser.checkFormulaResult.bind(parser);
    parser.checkFormulaResult = (result, allowArray) => {
      if (result?.ref) result = parser.retrieveRef(result);
      if (result instanceof FE) return result;
      return checkResult(result, allowArray);
    };
    const infix = parser.utils._applyInfix.bind(parser.utils),
      prefix = parser.utils._applyPrefix.bind(parser.utils),
      postfix = parser.utils._applyPostfix.bind(parser.utils);
    parser.utils._applyInfix = (a, operator, b) =>
      broadcast(a.val, b.val, (left, right) =>
        infix({ val: left, isArray: false }, operator, {
          val: right,
          isArray: false,
        }),
      );
    parser.utils._applyPrefix = (operators, value) =>
      Array.isArray(value)
        ? matrix(value).map((row) =>
            row.map((v) => prefix(operators, v, false)),
          )
        : prefix(operators, value, false);
    parser.utils._applyPostfix = (value, _array, operator) =>
      Array.isArray(value)
        ? matrix(value).map((row) =>
            row.map((v) => postfix(v, false, operator)),
          )
        : postfix(value, false, operator);
    // Scalar text operations broadcast over dynamic arrays; stringifying a matrix
    // would silently turn {"a";"b"} into the unrelated scalar "a,b".
    for (const name of ["UPPER", "LOWER", "LEN", "LENB", "LEFT", "RIGHT", "MID", "TRIM", "PROPER", "CLEAN", "SUBSTITUTE", "REPLACE", "FIND", "SEARCH", "EXACT", "REPT", "TEXT"]) {
      const original = parser.functions[name];
      if (!original) continue;
      parser.functions[name] = (...args: any[]) => {
        if (!args.some(arg => Array.isArray(unwrap(arg)))) return original(...args);
        const arrays = args.map(arg => matrix(unwrap(arg)));
        const rows = Math.max(...arrays.map(array => array.length));
        const columns = Math.max(...arrays.map(array => array[0]?.length ?? 0));
        if (rows * columns > RANGE_LIMIT) throw new FE("#CALC!", "Array calculation limit reached.");
        return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, col) => {
          if (arrays.some(array => array.length !== 1 && row >= array.length || array[0].length !== 1 && col >= array[0].length)) return FE.NA;
          const scalarArgs = args.map((arg, index) => {
            const array = arrays[index], value = array[array.length === 1 ? 0 : row][array[0].length === 1 ? 0 : col];
            return { ...arg, value, isArray: false, isRangeRef: false, isCellRef: false };
          });
          try { return original(...scalarArgs); } catch (cause) { if (cause instanceof FE) return cause; throw cause; }
        }));
      };
    }
    this.parsers[depth] = parser;
    return parser;
  }
  evaluateExpression(
    formula: string,
    sheet: Worksheet = this.sheet(),
    point: Point = { row: 0, col: 0 },
    scope = new Map<string, CalculationValue>(),
  ): CalculationValue {
    if (++this.expressionDepth > DEPTH_LIMIT) {
      this.expressionDepth--;
      return error("#NUM!", "Formula recursion limit reached.");
    }
    try {
      let expression = this.expandStructured(
        formula.replace(/^=/, ""),
        sheet,
        point,
      );
      // LET is lowered with lexical bindings before the established expression parser runs.
      const letMatch = /^\s*(?:_xlfn\.)?LET\s*\(([\s\S]*)\)\s*$/i.exec(
        expression,
      );
      if (
        letMatch &&
        closingParen(expression, expression.indexOf("(")) ===
          expression.trimEnd().length - 1
      ) {
        const args = splitArguments(letMatch[1]);
        if (args.length < 3 || args.length % 2 === 0 || args.length > 253)
          return error(
            "#VALUE!",
            "LET needs up to 126 name/value pairs and a final calculation.",
          );
        const local = new Map(scope);
        for (let i = 0; i < args.length - 1; i += 2) {
          const name = args[i].trim();
          if (
            !/^[A-Za-z_][\w.]*$/.test(name) ||
            /^[A-Za-z]{1,3}\d+$/.test(name) ||
            /^[rc]$/i.test(name)
          )
            return error("#NAME?", "Invalid LET name.");
          local.set(
            name.toUpperCase(),
            this.evaluateExpression(args[i + 1], sheet, point, local),
          );
        }
        return this.evaluateExpression(args.at(-1)!, sheet, point, local);
      }
      const call = /^\s*([A-Za-z_][\w.]*)\s*\(/.exec(expression),
        end = call ? closingParen(expression, expression.indexOf("(")) : -1;
      if (
        call &&
        call[1].toUpperCase() === "IF" &&
        end === expression.trimEnd().length - 1
      ) {
        const args = splitArguments(
          expression.slice(expression.indexOf("(") + 1, end),
        );
        if (args.length < 2 || args.length > 3) return error("#VALUE!");
        const condition = this.evaluateExpression(args[0], sheet, point, scope);
        if (!Array.isArray(condition)) {
          if (isError(condition)) return condition;
          return this.evaluateExpression(
            asLogical(condition) ? args[1] : (args[2] ?? "FALSE"),
            sheet,
            point,
            scope,
          );
        }
      }
      if (call) {
        const named = this.workbook.names.find(
          (n) =>
            n.name.toUpperCase() === call[1].toUpperCase() &&
            (!n.sheetId || n.sheetId === sheet.id) &&
            /^=?\s*(?:_xlfn\.)?LAMBDA\s*\(/i.test(n.reference),
        );
        const immediate = call[1].toUpperCase() === "LAMBDA";
        if (immediate || named) {
          const lambda = immediate
              ? expression.slice(0, end + 1)
              : named!.reference.replace(/^=/, ""),
            lambdaEnd = closingParen(lambda, lambda.indexOf("(")),
            parts = splitArguments(
              lambda.slice(lambda.indexOf("(") + 1, lambdaEnd),
            );
          let values: string[];
          if (immediate) {
            const rest = expression.slice(end + 1).trim();
            if (!rest.startsWith("("))
              return error("#CALC!", "A LAMBDA must be called with arguments.");
            const finish = closingParen(rest, 0);
            if (finish !== rest.length - 1)
              return error(
                "#VALUE!",
                "Use parentheses around an immediately called LAMBDA.",
              );
            values = splitArguments(rest.slice(1, -1));
          } else {
            if (end !== expression.trimEnd().length - 1) values = [];
            else
              values = splitArguments(
                expression.slice(expression.indexOf("(") + 1, end),
              );
          }
          if (immediate || end === expression.trimEnd().length - 1) {
            if (values.length !== parts.length - 1)
              return error("#VALUE!", "Incorrect LAMBDA argument count.");
            const local = new Map(scope);
            for (let i = 0; i < values.length; i++) {
              const name = parts[i].trim();
              if (
                !/^[A-Za-z_][\w]*$/.test(name) ||
                /^[A-Za-z]{1,3}\d+$/.test(name)
              )
                return error("#NAME?", "Invalid LAMBDA parameter.");
              local.set(
                name.toUpperCase(),
                this.evaluateExpression(values[i], sheet, point, scope),
              );
            }
            return this.evaluateExpression(parts.at(-1)!, sheet, point, local);
          }
        }
      }
      // Lower nested scoped calls before substituting outer names, preserving lexical shadowing.
      const specialNames = new Set([
        "LET",
        ...this.workbook.names
          .filter((n) => /^=?\s*LAMBDA\s*\(/i.test(n.reference))
          .map((n) => n.name.toUpperCase()),
      ]);
      const scan = /"(?:[^"]|"")*"|\b([A-Za-z_][\w.]*)\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = scan.exec(expression))) {
        if (!match[1] || !specialNames.has(match[1].toUpperCase())) continue;
        const open = expression.indexOf("(", match.index),
          close = closingParen(expression, open);
        if (close < 0) break;
        const value = this.evaluateExpression(
          expression.slice(match.index, close + 1),
          sheet,
          point,
          scope,
        );
        expression =
          expression.slice(0, match.index) +
          "(" +
          formulaLiteral(value) +
          ")" +
          expression.slice(close + 1);
        scan.lastIndex = match.index + formulaLiteral(value).length + 2;
      }
      expression = replaceNames(expression, scope);
      // Named expressions are evaluated separately with cycle protection; reference names stay references.
      const constants = new Map<string, CalculationValue>();
      for (const named of this.workbook.names) {
        if (
          (named.sheetId && named.sheetId !== sheet.id) ||
          this.namedReference(named.name, sheet.name) ||
          !new RegExp(
            `\\b${named.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
            "i",
          ).test(expression)
        )
          continue;
        if (this.nameStack.has(named.name))
          return error("#CIRC!", "Circular defined name.");
        this.nameStack.add(named.name);
        constants.set(
          named.name.toUpperCase(),
          this.evaluateExpression(named.reference, sheet, point),
        );
        this.nameStack.delete(named.name);
      }
      expression = replaceNames(expression, constants);
      if (expression.length > 32768)
        return error("#CALC!", "Formula length exceeds the calculation limit.");
      const parsed = this.parser(
        this.evaluating.size + this.expressionDepth,
      ).parse(
        expression,
        { row: point.row + 1, col: point.col + 1, sheet: sheet.name },
        true,
      );
      return Array.isArray(parsed)
        ? matrix(parsed).map((row) => row.map(fromParser))
        : fromParser(parsed);
    } catch (e) {
      if (e instanceof FE) {
        let reason = e;
        while (reason.details instanceof FE) reason = reason.details;
        return error(
          /not implemented/i.test(reason.message) ? "#NAME?" : reason.error,
          reason.message || undefined,
        );
      }
      return error(
        "#ERROR!",
        e instanceof Error ? e.message : "Invalid formula.",
      );
    } finally {
      this.expressionDepth--;
    }
  }
  value(sheetId: string, address: string, internal = false): Scalar {
    const sheet = this.sheet(sheetId),
      p = parseAddress(address),
      a = cellAddress(p.row, p.col),
      key = this.key(sheetId, a),
      cell = sheet.cells[a];
    if (this.valueOverrides.has(key)) return this.valueOverrides.get(key)!;
    if (this.spillValues.has(key)) return this.spillValues.get(key)!;
    if (!cell?.formula) return cell?.value ?? null;
    if (this.workbook.calculationMode === "manual" && !internal)
      return cell.cached ?? null;
    if (!this.dirty.has(key)) return cell.cached ?? null;
    if (this.evaluating.has(key))
      return error(
        "#CIRC!",
        "Circular reference detected. Iterative calculation is not enabled.",
      );
    if (this.evaluating.size >= DEPTH_LIMIT)
      return error("#CALC!", "Dependency depth limit reached.");
    this.evaluating.add(key);
    this.counter++;
    let result = this.evaluateExpression(cell.formula, sheet, p);
    if (Array.isArray(result)) {
      const height = result.length,
        width = Math.max(0, ...result.map((row) => row.length));
      let blocked =
        height * width > RANGE_LIMIT ||
        p.row + height > MAX_ROWS ||
        p.col + width > MAX_COLUMNS;
      for (let row = 0; row < height && !blocked; row++)
        for (let col = 0; col < width; col++) {
          if (!row && !col) continue;
          const target = cellAddress(p.row + row, p.col + col),
            existing = sheet.cells[target],
            spill = this.spillOwners.get(this.key(sheetId, target));
          if (
            (existing && (existing.value !== null || existing.formula)) ||
            (spill && spill !== key) ||
            sheet.merges.some((m) =>
              inRange({ row: p.row + row, col: p.col + col }, m),
            )
          ) {
            blocked = true;
            break;
          }
        }
      if (blocked) {
        result = error(
          "#SPILL!",
          "The array is blocked by existing cells, a merge, another spill, or the worksheet boundary.",
        );
        this.blockedSpills.add(key);
      } else {
        const affected = new Set<string>(),
          members = new Set<string>();
        for (let row = 0; row < height; row++)
          for (let col = 0; col < width; col++) {
            if (!row && !col) continue;
            const spill = this.key(
              sheetId,
              cellAddress(p.row + row, p.col + col),
            );
            this.spillValues.set(spill, result[row]?.[col] ?? null);
            this.spillOwners.set(spill, key);
            members.add(spill);
            for (const dependent of this.dependents.get(spill) ?? [])
              affected.add(dependent);
            for (const dependent of this.rangeDependents.get(sheetId) ?? [])
              if (
                inRange({ row: p.row + row, col: p.col + col }, dependent.range)
              )
                affected.add(dependent.key);
          }
        this.spillMembers.set(key, members);
        for (const dependent of affected)
          if (dependent !== key) this.markDirty(dependent);
        result = result[0]?.[0] ?? null;
      }
    }
    cell.cached = result as Scalar;
    if (!isError(cell.cached) || cell.cached.code !== "#SPILL!")
      this.blockedSpills.delete(key);
    this.dirty.delete(key);
    this.evaluating.delete(key);
    return cell.cached;
  }
  calculate(force = false): CalculationReport {
    const start = performance.now();
    this.counter = 0;
    if (this.workbook.calculationMode === "manual" && !force)
      return {
        evaluated: 0,
        durationMs: 0,
        errors: [],
        pending: this.dirty.size,
      };
    if (force) {
      this.spillValues.clear();
      this.spillOwners.clear();
      this.spillMembers.clear();
      for (const [key] of this.dependencies) this.dirty.add(key);
    } else
      for (const [key] of this.dependencies) {
        const [sheet, address] = this.resolveKey(key);
        if (VOLATILE.test(sheet.cells[address]?.formula ?? ""))
          this.markDirty(key);
      }
    let pass = 0;
    while (this.dirty.size && pass++ < 8)
      for (const key of [...this.dirty]) {
        const [sheet, address] = this.resolveKey(key);
        this.value(sheet.id, address, true);
      }
    const errors: CalculationReport["errors"] = [];
    for (const sheet of this.workbook.sheets)
      for (const [address, cell] of Object.entries(sheet.cells))
        if (isError(cell.cached))
          errors.push({
            sheetId: sheet.id,
            address,
            code: cell.cached.code,
            message: cell.cached.message,
          });
    return {
      evaluated: this.counter,
      durationMs: performance.now() - start,
      errors,
      pending: this.dirty.size,
    };
  }
  /** Accept a worker snapshot only when it corresponds to this exact document revision. */
  applyCalculation(result: ReturnType<typeof calculateWorkbook>): boolean {
    if (
      result.workbook.id !== this.workbook.id ||
      result.workbook.revision !== this.workbook.revision
    )
      return false;
    for (const source of result.workbook.sheets) {
      const target = this.workbook.sheets.find((s) => s.id === source.id);
      if (!target) continue;
      for (const [address, cell] of Object.entries(source.cells))
        if (cell.formula && target.cells[address]?.formula === cell.formula)
          target.cells[address].cached = cell.cached;
    }
    this.spillValues.clear();
    this.spillOwners.clear();
    this.spillMembers.clear();
    for (const [sheetId, entries] of Object.entries(result.spills))
      for (const item of entries) {
        const key = this.key(sheetId, item.address),
          owner = this.key(sheetId, item.owner);
        this.spillValues.set(key, item.value);
        this.spillOwners.set(key, owner);
        const members = this.spillMembers.get(owner) ?? new Set<string>();
        members.add(key);
        this.spillMembers.set(owner, members);
      }
    this.blockedSpills.clear();
    for (const item of result.report.errors)
      if (item.code === "#SPILL!")
        this.blockedSpills.add(this.key(item.sheetId, item.address));
    this.dirty.clear();
    return true;
  }
  spillEntries(
    sheetId: string,
  ): { address: string; value: Scalar; owner: string }[] {
    const result: { address: string; value: Scalar; owner: string }[] = [];
    for (const [key, value] of this.spillValues) {
      const [sheet, address] = this.resolveKey(key);
      if (sheet.id === sheetId)
        result.push({
          address,
          value,
          owner: this.spillOwners.get(key)!.split("!").at(-1)!,
        });
    }
    return result;
  }
  clearRange(sheetId: string, range: Range, all = false): void {
    const sheet = this.sheet(sheetId);
    const edits = Object.keys(sheet.cells)
      .filter((a) => inRange(parseAddress(a), range))
      .map((address) => ({
        sheetId,
        address,
        input: all
          ? ({ value: null } as Cell)
          : ({ value: null, style: sheet.cells[address].style } as Cell),
      }));
    this.batch(edits, "Clear cells");
  }
  formatRange(sheetId: string, range: Range, style: CellStyle): void {
    if (rangeSize(range) > RANGE_LIMIT)
      throw new Error("Format a smaller range or use row/column styles.");
    const sheet = this.sheet(sheetId),
      edits: CellEdit[] = [];
    for (let row = range.start.row; row <= range.end.row; row++)
      for (let col = range.start.col; col <= range.end.col; col++) {
        const address = cellAddress(row, col),
          cell = sheet.cells[address] ?? { value: null };
        edits.push({
          sheetId,
          address,
          input: { ...cell, style: { ...cell.style, ...style } },
        });
      }
    this.batch(edits, "Format cells");
  }
  copyRange(
    sheetId: string,
    source: Range,
    target: Point,
    options: {
      cut?: boolean;
      targetSheetId?: string;
      valuesOnly?: boolean;
    } = {},
  ): void {
    source = normalizeRange(source);
    if (rangeSize(source) > RANGE_LIMIT)
      throw new Error("Copy a smaller range.");
    const sheet = this.sheet(sheetId),
      targetSheet = this.sheet(options.targetSheetId ?? sheetId),
      dr = target.row - source.start.row,
      dc = target.col - source.start.col;
    if (targetSheet.protected || (options.cut && sheet.protected))
      throw new Error("This worksheet is protected.");
    const copied: Record<string, Cell | undefined> = {};
    for (let row = source.start.row; row <= source.end.row; row++)
      for (let col = source.start.col; col <= source.end.col; col++) {
        const a = cellAddress(row, col),
          b = cellAddress(row + dr, col + dc),
          cell = sheet.cells[a];
        if (cell) {
          copied[b] = structuredClone(cell);
          if (options.valuesOnly)
            copied[b] = { value: this.value(sheet.id, a) };
          else if (cell.formula && !options.cut)
            copied[b]!.formula = adjustFormula(cell.formula, dr, dc);
        } else copied[b] = undefined;
      }
    this.transact(options.cut ? "Move cells" : "Copy cells", () => {
      if (options.cut)
        for (const address of Object.keys(sheet.cells))
          if (inRange(parseAddress(address), source))
            delete sheet.cells[address];
      for (const [a, c] of Object.entries(copied)) {
        if (c) targetSheet.cells[a] = c;
        else delete targetSheet.cells[a];
      }
      if (options.cut)
        for (const s of this.workbook.sheets)
          for (const c of Object.values(s.cells))
            if (c.formula)
              c.formula = moveFormulaReferences(
                c.formula,
                s.name,
                sheet.name,
                source,
                targetSheet.name,
                target,
              );
    });
  }
  fillRange(sheetId: string, source: Range, destination: Range): void {
    const sheet = this.sheet(sheetId),
      edits: CellEdit[] = [];
    if (rangeSize(destination) > RANGE_LIMIT)
      throw new Error("Fill a smaller range.");
    const height = source.end.row - source.start.row + 1,
      width = source.end.col - source.start.col + 1;
    for (let row = destination.start.row; row <= destination.end.row; row++)
      for (let col = destination.start.col; col <= destination.end.col; col++) {
        if (inRange({ row, col }, source)) continue;
        const sr =
            source.start.row +
            ((((row - source.start.row) % height) + height) % height),
          sc =
            source.start.col +
            ((((col - source.start.col) % width) + width) % width),
          c = structuredClone(
            sheet.cells[cellAddress(sr, sc)] ?? { value: null },
          );
        if (c.formula) c.formula = adjustFormula(c.formula, row - sr, col - sc);
        else if (width === 1 && height >= 2) {
          const first = cellValue(
              sheet.cells[cellAddress(source.start.row, sc)],
            ),
            second = cellValue(
              sheet.cells[cellAddress(source.start.row + 1, sc)],
            );
          if (typeof first === "number" && typeof second === "number")
            c.value = first + (row - source.start.row) * (second - first);
        }
        edits.push({ sheetId, address: cellAddress(row, col), input: c });
      }
    this.batch(edits, "Fill cells");
  }
  renameSheet(id: string, name: string): void {
    if (
      !name.trim() ||
      name.length > 31 ||
      /[\[\]:*?/\\]/.test(name) ||
      this.workbook.sheets.some(
        (s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error(
        "Use a unique sheet name of 1–31 characters without []:*?/\\.",
      );
    this.transact("Rename sheet", () => {
      const sheet = this.sheet(id),
        old = sheet.name;
      sheet.name = name;
      for (const s of this.workbook.sheets)
        for (const c of Object.values(s.cells))
          if (c.formula)
            c.formula = renameSheetReferences(c.formula, old, name);
      for (const n of this.workbook.names)
        n.reference = renameSheetReferences(n.reference, old, name);
    });
  }
  addSheet(name?: string): Worksheet {
    let index = this.workbook.sheets.length + 1;
    while (this.workbook.sheets.some((s) => s.name === `Sheet${index}`))
      index++;
    const sheet = createSheet(name ?? `Sheet${index}`);
    if (
      this.workbook.sheets.some(
        (s) => s.name.toLowerCase() === sheet.name.toLowerCase(),
      )
    )
      throw new Error("A sheet already has that name.");
    this.transact("Add sheet", (book) => {
      book.sheets.push(sheet);
      book.activeSheetId = sheet.id;
    });
    return sheet;
  }
  deleteSheet(id: string): void {
    if (
      this.workbook.sheets.filter(
        (s) => s.visibility === "visible" && s.id !== id,
      ).length === 0
    )
      throw new Error("Keep at least one visible worksheet.");
    this.transact("Delete sheet", (book) => {
      book.sheets = book.sheets.filter((s) => s.id !== id);
      if (book.activeSheetId === id)
        book.activeSheetId = book.sheets.find(
          (s) => s.visibility === "visible",
        )!.id;
    });
  }
  private structure(
    sheetId: string,
    axis: "row" | "col",
    index: number,
    count: number,
    deleting: boolean,
  ): void {
    const sheet = this.sheet(sheetId),
      limit = axis === "row" ? MAX_ROWS : MAX_COLUMNS;
    if (sheet.protected) throw new Error("This worksheet is protected.");
    if (
      !Number.isInteger(index) ||
      !Number.isInteger(count) ||
      count < 1 ||
      index < 0 ||
      index + count > limit
    )
      throw new Error("Invalid row or column operation.");
    this.transact(
      `${deleting ? "Delete" : "Insert"} ${axis === "row" ? "rows" : "columns"}`,
      () => {
        const cells: Record<string, Cell> = {};
        for (const [a, c] of Object.entries(sheet.cells)) {
          const p = parseAddress(a);
          if (deleting && p[axis] >= index && p[axis] < index + count) continue;
          if (p[axis] >= index) p[axis] += deleting ? -count : count;
          if (p[axis] >= limit)
            throw new Error(
              "Inserting would push data beyond the worksheet boundary.",
            );
          cells[cellAddress(p.row, p.col)] = c;
        }
        sheet.cells = cells;
        const properties = axis === "row" ? sheet.rows : sheet.columns,
          next: Record<number, any> = {};
        for (const [key, value] of Object.entries(properties)) {
          let coordinate = +key;
          if (deleting && coordinate >= index && coordinate < index + count)
            continue;
          if (coordinate >= index) coordinate += deleting ? -count : count;
          if (coordinate < limit) next[coordinate] = value;
        }
        if (axis === "row") sheet.rows = next;
        else sheet.columns = next;
        for (const s of this.workbook.sheets)
          for (const c of Object.values(s.cells))
            if (c.formula)
              c.formula = structuralFormula(
                c.formula,
                s.name,
                sheet.name,
                axis,
                index,
                count,
                deleting,
              );
        const mapRange = (r: Range): Range | null => {
          const start = { ...r.start },
            end = { ...r.end };
          if (deleting) {
            if (end[axis] < index) return { start, end };
            if (start[axis] >= index + count) {
              start[axis] -= count;
              end[axis] -= count;
            } else {
              start[axis] = Math.min(start[axis], index);
              end[axis] = Math.max(index - 1, end[axis] - count);
            }
          } else {
            if (start[axis] >= index) start[axis] += count;
            if (end[axis] >= index) end[axis] += count;
          }
          return end[axis] >= start[axis] ? { start, end } : null;
        };
        sheet.merges = sheet.merges
          .map(mapRange)
          .filter((x): x is Range => !!x);
        for (const list of [
          sheet.tables,
          sheet.validations,
          sheet.conditionalFormats,
          sheet.charts,
        ])
          for (let i = list.length - 1; i >= 0; i--) {
            const range = mapRange(list[i].range);
            if (range) list[i].range = range;
            else list.splice(i, 1);
          }
        if (sheet.print.area)
          sheet.print.area = mapRange(sheet.print.area) ?? undefined;
        for (const name of this.workbook.names)
          name.reference = structuralFormula(
            name.reference,
            sheet.name,
            sheet.name,
            axis,
            index,
            count,
            deleting,
          );
      },
    );
  }
  insertRows(id: string, index: number, count = 1): void {
    this.structure(id, "row", index, count, false);
  }
  deleteRows(id: string, index: number, count = 1): void {
    this.structure(id, "row", index, count, true);
  }
  insertColumns(id: string, index: number, count = 1): void {
    this.structure(id, "col", index, count, false);
  }
  deleteColumns(id: string, index: number, count = 1): void {
    this.structure(id, "col", index, count, true);
  }
}
function compareConstraint(
  n: number,
  a: number,
  b: number,
  operator: string,
): boolean {
  switch (operator) {
    case "between":
      return n >= a && n <= b;
    case "notBetween":
      return n < a || n > b;
    case "equal":
      return n === a;
    case "notEqual":
      return n !== a;
    case "greater":
      return n > a;
    case "less":
      return n < a;
    case "greaterOrEqual":
      return n >= a;
    case "lessOrEqual":
      return n <= a;
    default:
      return false;
  }
}
function numericValues(args: any[]): number[] {
  const values: number[] = [];
  for (const arg of args) {
    const raw = unwrap(arg),
      reference = arg?.isRangeRef || arg?.isCellRef || Array.isArray(raw);
    if (raw && typeof raw === "object" && !Array.isArray(raw) && !(raw instanceof FE))
      throw new FE("#VALUE!", "Union arguments are not supported here. Pass the ranges as separate arguments.");
    for (const item of flatten(raw)) {
      if (item instanceof FE) throw item;
      if (typeof item === "number") values.push(item);
      else if (!reference && typeof item === "boolean") values.push(+item);
      else if (
        !reference &&
        typeof item === "string" &&
        item !== "" &&
        Number.isFinite(Number(item))
      )
        values.push(Number(item));
    }
  }
  return values;
}
function variance(values: number[], sample: boolean): number {
  if (values.length < (sample ? 2 : 1)) throw FE.DIV0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
    (values.length - (sample ? 1 : 0))
  );
}
function compareValues(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
}
function criterion(value: any, criteria: any): boolean {
  if (criteria instanceof FE)
    return value instanceof FE && value.error === criteria.error;
  const m = /^(<=|>=|<>|=|<|>)(.*)$/.exec(String(criteria)),
    op = m?.[1] ?? "=",
    raw = m?.[2] ?? criteria;
  let target: any = raw;
  if (
    typeof raw === "string" &&
    raw.trim() !== "" &&
    Number.isFinite(Number(raw))
  )
    target = Number(raw);
  if (
    typeof value === "string" &&
    typeof target === "string" &&
    /[?*]/.test(target)
  ) {
    const pattern = target
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/~([?*~])|([?*])/g, (_, escaped, wild) =>
        escaped ? "\\" + escaped : wild === "*" ? ".*" : ".",
      );
    const matches = new RegExp("^" + pattern + "$", "i").test(value);
    return op === "<>" ? !matches : matches;
  }
  const left = value === null ? "" : value,
    cmp = compareValues(left, target);
  switch (op) {
    case "=":
      return typeof left === typeof target
        ? cmp === 0
        : left === null && target === 0;
    case "<>":
      return cmp !== 0;
    case "<":
      return cmp < 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case ">=":
      return cmp >= 0;
    default:
      return false;
  }
}
function conditionalAggregate(
  kind: "sum" | "count" | "average",
  values: any[][] | undefined,
  pairs: any[],
): number {
  if (!pairs.length || pairs.length % 2) throw FE.VALUE;
  const ranges: any[][][] = [],
    criteria: any[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    ranges.push(matrix(pairs[i]));
    criteria.push(unwrap(pairs[i + 1]));
  }
  const rows = ranges[0].length,
    cols = ranges[0][0].length;
  if (
    ranges.some(
      (r) => r.length !== rows || r.some((row) => row.length !== cols),
    ) ||
    (values &&
      (values.length !== rows || values.some((row) => row.length !== cols)))
  )
    throw FE.VALUE;
  let count = 0,
    sum = 0;
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      if (!ranges.every((range, i) => criterion(range[row][col], criteria[i])))
        continue;
      if (kind === "count") {
        count++;
        continue;
      }
      const v = values![row][col];
      if (v instanceof FE) throw v;
      if (typeof v === "number") {
        count++;
        sum += v;
      }
    }
  if (kind === "count") return count;
  if (kind === "average") {
    if (!count) throw FE.DIV0;
    return sum / count;
  }
  return sum;
}
function findMatch(
  lookup: any,
  values: any[],
  mode: number,
  search: number,
): number {
  if (![0, -1, 1, 2].includes(mode) || ![1, -1].includes(search))
    throw new FE(
      "#VALUE!",
      "Only forward/backward linear search is supported.",
    );
  const indices = values.map((_, i) => i);
  if (search === -1) indices.reverse();
  let candidate = -1;
  for (const i of indices) {
    const v = values[i];
    if (v instanceof FE) continue;
    if (mode === 2 ? criterion(v, lookup) : compareValues(v, lookup) === 0)
      return i;
    if (
      mode === -1 &&
      compareValues(v, lookup) < 0 &&
      (candidate < 0 || compareValues(v, values[candidate]) > 0)
    )
      candidate = i;
    if (
      mode === 1 &&
      compareValues(v, lookup) > 0 &&
      (candidate < 0 || compareValues(v, values[candidate]) < 0)
    )
      candidate = i;
  }
  if (candidate < 0) throw FE.NA;
  return candidate;
}
export function calculateWorkbook(workbook: Workbook): {
  workbook: Workbook;
  report: CalculationReport;
  spills: Record<string, { address: string; value: Scalar; owner: string }[]>;
} {
  const engine = new WorkbookEngine(workbook),
    report = engine.calculate(true),
    spills: Record<
      string,
      { address: string; value: Scalar; owner: string }[]
    > = {};
  for (const sheet of workbook.sheets)
    spills[sheet.id] = engine.spillEntries(sheet.id);
  return { workbook: engine.workbook, report, spills };
}
export function supportedFunctionNames(): string[] {
  const parser = new FormulaParser();
  return [
    ...new Set([
      ...parser
        .supportedFunctions()
        .filter((name) => !["WEBSERVICE"].includes(name)),
      ...ownNames,
      "LET",
    ]),
  ].sort();
}
