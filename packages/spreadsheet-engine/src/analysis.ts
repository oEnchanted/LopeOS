import {
  cellAddress,
  cellValue,
  normalizeRange,
  parseAddress,
  type Scalar,
  type Worksheet,
  type Range,
  type Cell,
} from "./model.ts";
import { adjustFormula } from "./references.ts";

/** Local, deterministic data operations. This is not a Power Query M runtime. */
export type DataRow = Record<string, Scalar>;
export interface DataSet {
  columns: string[];
  rows: DataRow[];
  rowIds?: string[];
}
export interface OperationOptions {
  signal?: AbortSignal;
  maxRows?: number;
  maxCells?: number;
}
export class AnalysisError extends Error {
  code: "LIMIT" | "CANCELLED" | "FIELD" | "INPUT";
  constructor(code: AnalysisError["code"], message: string) {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
  }
}
const DEFAULT_ROWS = 1_048_576;
const DEFAULT_CELLS = 5_000_000;
const collator = new Intl.Collator("en-US", {
  numeric: false,
  sensitivity: "base",
});
const isError = (value: Scalar): value is Extract<Scalar, object> =>
  !!value && typeof value === "object";
const blank = (value: Scalar | undefined) => value == null || value === "";
const asValue = (value: Scalar | undefined): Scalar => value ?? null;
const finite = (value: Scalar | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);
const keyOf = (values: Scalar[]) =>
  JSON.stringify(
    values.map((value) =>
      isError(value) ? ["error", value.code] : [typeof value, value],
    ),
  );
export const displayDataValue = (value: Scalar | undefined): string =>
  value == null ? "" : isError(value) ? value.code : String(value);

/** The first selected row is the header. readValue may supply the calculation engine's result. */
export function sheetData(
  sheet: Worksheet,
  range: Range,
  readValue: (address: string) => Scalar = (address) =>
    cellValue(sheet.cells[address]),
  options: OperationOptions = {},
): DataSet {
  const selected = normalizeRange(range),
    width = selected.end.col - selected.start.col + 1,
    height = selected.end.row - selected.start.row;
  checkpoint(options, height, width);
  const columns: string[] = [];
  for (let col = selected.start.col; col <= selected.end.col; col++)
    columns.push(
      uniqueColumnName(
        columns,
        displayDataValue(readValue(cellAddress(selected.start.row, col))) ||
          `Column${col - selected.start.col + 1}`,
      ),
    );
  const rows: DataRow[] = [],
    rowIds: string[] = [];
  for (let row = selected.start.row + 1; row <= selected.end.row; row++) {
    if ((row & 1023) === 0) checkpoint(options);
    rows.push(
      Object.fromEntries(
        columns.map((column, index) => [
          column,
          readValue(cellAddress(row, selected.start.col + index)),
        ]),
      ),
    );
    rowIds.push(`${sheet.id}:${row}`);
  }
  return { columns, rows, rowIds };
}
/** Writes scalar query/pivot output. The caller commits the resulting sheet as one undoable transaction. */
export function applyDataToSheet(
  sheet: Worksheet,
  data: DataSet,
  start: { row: number; col: number },
  options: OperationOptions & {
    clearRange?: Range;
    preserveRows?: boolean;
  } = {},
): Range {
  if (sheet.protected)
    throw new AnalysisError("INPUT", "The worksheet is protected.");
  checkData(data, options);
  const range = {
    start,
    end: {
      row: start.row + data.rows.length,
      col: start.col + Math.max(0, data.columns.length - 1),
    },
  };
  cellAddress(range.end.row, range.end.col);
  const original =
    options.preserveRows || options.clearRange
      ? { ...sheet.cells }
      : sheet.cells;
  if (options.clearRange) {
    const cleared = normalizeRange(options.clearRange);
    for (const address of Object.keys(sheet.cells)) {
      const point = parseAddress(address);
      if (
        point.row >= cleared.start.row &&
        point.row <= cleared.end.row &&
        point.col >= cleared.start.col &&
        point.col <= cleared.end.col
      )
        delete sheet.cells[address];
    }
  }
  const put = (row: number, col: number, value: Scalar) => {
    const address = cellAddress(row, col),
      style = original[address]?.style;
    sheet.cells[address] = {
      value: structuredClone(value),
      ...(style ? { style } : {}),
    };
  };
  data.columns.forEach((column, index) =>
    put(start.row, start.col + index, column),
  );
  data.rows.forEach((row, index) => {
    if ((index & 1023) === 0) checkpoint(options);
    const id = data.rowIds?.[index],
      sourceRow =
        id === undefined ? NaN : Number(id.slice(id.lastIndexOf(":") + 1)),
      targetRow = start.row + index + 1;
    data.columns.forEach((column, col) => {
      const old =
        options.preserveRows &&
        Number.isSafeInteger(sourceRow) &&
        sourceRow >= 0
          ? original[cellAddress(sourceRow, start.col + col)]
          : undefined;
      if (old) {
        const cell = structuredClone(old);
        if (cell.formula) {
          cell.formula = adjustFormula(cell.formula, targetRow - sourceRow, 0);
          delete cell.cached;
        }
        sheet.cells[cellAddress(targetRow, start.col + col)] = cell;
      } else put(targetRow, start.col + col, asValue(row[column]));
    });
  });
  return range;
}
/** Sorts a complete selected table range, including styles/formulas. References within moved formulas follow their records. */
export function sortSheetRecords(
  sheet: Worksheet,
  range: Range,
  keys: SortKey[],
  readValue?: (address: string) => Scalar,
  options: OperationOptions = {},
): void {
  if (sheet.protected)
    throw new AnalysisError("INPUT", "The worksheet is protected.");
  const selected = normalizeRange(range);
  if (
    sheet.merges.some(
      (merge) =>
        merge.start.row <= selected.end.row &&
        merge.end.row >= selected.start.row &&
        merge.start.col <= selected.end.col &&
        merge.end.col >= selected.start.col,
    )
  )
    throw new AnalysisError(
      "INPUT",
      "Unmerge cells in the selected records before sorting.",
    );
  const source = sheetData(sheet, selected, readValue, options),
    sorted = sortData(source, keys, options);
  const copied = new Map<number, Map<number, Cell>>();
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const point = parseAddress(address);
    if (
      point.row <= selected.start.row ||
      point.row > selected.end.row ||
      point.col < selected.start.col ||
      point.col > selected.end.col
    )
      continue;
    if (!copied.has(point.row)) copied.set(point.row, new Map());
    copied.get(point.row)!.set(point.col, structuredClone(cell));
  }
  const replacement: Record<string, Cell> = {};
  sorted.rowIds?.forEach((id, index) => {
    const sourceRow = Number(id.slice(id.lastIndexOf(":") + 1)),
      targetRow = selected.start.row + index + 1;
    for (const [col, cell] of copied.get(sourceRow) ?? []) {
      if (cell.formula) {
        cell.formula = adjustFormula(cell.formula, targetRow - sourceRow, 0);
        delete cell.cached;
      }
      replacement[cellAddress(targetRow, col)] = cell;
    }
  });
  for (const [sourceRow, cells] of copied)
    for (const col of cells.keys())
      delete sheet.cells[cellAddress(sourceRow, col)];
  Object.assign(sheet.cells, replacement);
}

function checkpoint(options: OperationOptions = {}, rows = 0, columns = 0) {
  if (options.signal?.aborted)
    throw new AnalysisError("CANCELLED", "Operation cancelled.");
  if (
    rows > (options.maxRows ?? DEFAULT_ROWS) ||
    rows * columns > (options.maxCells ?? DEFAULT_CELLS)
  ) {
    throw new AnalysisError(
      "LIMIT",
      "Operation exceeds the configured row or cell limit. Narrow the source range.",
    );
  }
}
function checkData(data: DataSet, options: OperationOptions = {}) {
  checkpoint(options, data.rows.length, data.columns.length);
  if (new Set(data.columns).size !== data.columns.length)
    throw new AnalysisError("INPUT", "Data column names must be unique.");
  if (data.rowIds && data.rowIds.length !== data.rows.length)
    throw new AnalysisError(
      "INPUT",
      "Row identities must match the source row count.",
    );
}
function requireFields(data: DataSet, fields: string[]) {
  for (const field of fields)
    if (!data.columns.includes(field))
      throw new AnalysisError("FIELD", `Unknown field: ${field}`);
}
function indexed(data: DataSet, indices: number[]): DataSet {
  return {
    columns: [...data.columns],
    rows: indices.map((index) => data.rows[index]),
    ...(data.rowIds
      ? { rowIds: indices.map((index) => data.rowIds![index]) }
      : {}),
  };
}
function compare(
  a: Scalar | undefined,
  b: Scalar | undefined,
  caseSensitive = false,
): number {
  if (blank(a)) return blank(b) ? 0 : 1;
  if (blank(b)) return -1;
  const rank = (value: Scalar | undefined) =>
    typeof value === "number"
      ? 0
      : typeof value === "string"
        ? 1
        : typeof value === "boolean"
          ? 2
          : 3;
  const difference = rank(a) - rank(b);
  if (difference) return difference;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(a) - Number(b);
  const av = displayDataValue(a),
    bv = displayDataValue(b);
  return caseSensitive
    ? av < bv
      ? -1
      : av > bv
        ? 1
        : 0
    : collator.compare(av, bv);
}

export interface SortKey {
  field: string;
  direction?: "asc" | "desc";
  caseSensitive?: boolean;
}
/** Stable sort moves complete records and preserves the identity of every source row. */
export function sortData(
  data: DataSet,
  keys: SortKey[],
  options: OperationOptions = {},
): DataSet {
  checkData(data, options);
  requireFields(
    data,
    keys.map((key) => key.field),
  );
  let comparisons = 0;
  const indices = data.rows.map((_, index) => index);
  indices.sort((left, right) => {
    if ((comparisons++ & 1023) === 0) checkpoint(options);
    for (const key of keys) {
      const a = data.rows[left][key.field],
        b = data.rows[right][key.field];
      // Excel keeps blank records last in both sort directions.
      const difference =
        blank(a) || blank(b)
          ? compare(a, b)
          : compare(a, b, key.caseSensitive) *
            (key.direction === "desc" ? -1 : 1);
      if (difference) return difference;
    }
    return left - right;
  });
  return indexed(data, indices);
}

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "blank"
  | "notBlank"
  | "error"
  | "notError"
  | "in"
  | "between";
export interface FilterClause {
  field: string;
  operator: FilterOperator;
  value?: Scalar;
  values?: Scalar[];
  caseSensitive?: boolean;
}
export function matchesFilter(row: DataRow, clause: FilterClause): boolean {
  if (
    ![
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "contains",
      "startsWith",
      "endsWith",
      "blank",
      "notBlank",
      "error",
      "notError",
      "in",
      "between",
    ].includes(clause.operator)
  )
    throw new AnalysisError(
      "INPUT",
      `Unsupported filter operator: ${clause.operator}`,
    );
  const value = asValue(row[clause.field]);
  if (clause.operator === "blank") return blank(value);
  if (clause.operator === "notBlank") return !blank(value);
  if (clause.operator === "error") return isError(value);
  if (clause.operator === "notError") return !isError(value);
  const equal = (a: Scalar, b: Scalar) =>
    typeof a === typeof b && compare(a, b, clause.caseSensitive) === 0;
  if (clause.operator === "in")
    return (clause.values ?? []).some((item) => equal(value, item));
  if (clause.operator === "eq") return equal(value, clause.value ?? null);
  if (clause.operator === "neq") return !equal(value, clause.value ?? null);
  if (isError(value) || blank(value)) return false;
  if (["contains", "startsWith", "endsWith"].includes(clause.operator)) {
    let text = displayDataValue(value),
      pattern = displayDataValue(clause.value);
    if (!clause.caseSensitive) {
      text = text.toLocaleLowerCase("en-US");
      pattern = pattern.toLocaleLowerCase("en-US");
    }
    return clause.operator === "contains"
      ? text.includes(pattern)
      : clause.operator === "startsWith"
        ? text.startsWith(pattern)
        : text.endsWith(pattern);
  }
  if (clause.operator === "between") {
    const [low, high] = clause.values ?? [];
    return (
      low !== undefined &&
      high !== undefined &&
      typeof value === typeof low &&
      typeof value === typeof high &&
      compare(value, low) >= 0 &&
      compare(value, high) <= 0
    );
  }
  if (typeof value !== typeof clause.value) return false;
  const result = compare(value, clause.value, clause.caseSensitive);
  return clause.operator === "gt"
    ? result > 0
    : clause.operator === "gte"
      ? result >= 0
      : clause.operator === "lt"
        ? result < 0
        : result <= 0;
}
export function filterData(
  data: DataSet,
  filters: FilterClause[],
  options: OperationOptions = {},
): DataSet {
  checkData(data, options);
  requireFields(
    data,
    filters.map((filter) => filter.field),
  );
  const indices: number[] = [];
  data.rows.forEach((row, index) => {
    if ((index & 1023) === 0) checkpoint(options);
    if (filters.every((filter) => matchesFilter(row, filter)))
      indices.push(index);
  });
  return indexed(data, indices);
}
export function removeDuplicates(
  data: DataSet,
  columns = data.columns,
  options: OperationOptions = {},
): { data: DataSet; removed: number } {
  checkData(data, options);
  requireFields(data, columns);
  const seen = new Set<string>(),
    indices: number[] = [];
  data.rows.forEach((row, index) => {
    if ((index & 1023) === 0) checkpoint(options);
    const key = keyOf(
      columns.map((column) => {
        const value = asValue(row[column]);
        return typeof value === "string"
          ? value.toLocaleLowerCase("en-US")
          : value;
      }),
    );
    if (!seen.has(key)) {
      seen.add(key);
      indices.push(index);
    }
  });
  return {
    data: indexed(data, indices),
    removed: data.rows.length - indices.length,
  };
}

/** RFC-style quoted fields for a single cell; all output stays text to retain identifiers. */
export function splitDelimitedCell(input: string, delimiter = ","): string[] {
  if (
    delimiter.length !== 1 ||
    delimiter === '"' ||
    delimiter === "\n" ||
    delimiter === "\r"
  )
    throw new AnalysisError(
      "INPUT",
      "Choose a single delimiter other than a quote or newline.",
    );
  const fields: string[] = [];
  let field = "",
    quoted = false,
    closed = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === delimiter) {
      fields.push(field);
      field = "";
      closed = false;
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else if (closed && char.trim() !== "")
      throw new AnalysisError(
        "INPUT",
        "Unexpected characters after a quoted field.",
      );
    else if (!closed) field += char;
  }
  if (quoted) throw new AnalysisError("INPUT", "Unterminated quoted field.");
  fields.push(field);
  return fields;
}
export function textToColumns(
  data: DataSet,
  column: string,
  delimiter = ",",
  options: OperationOptions = {},
): DataSet {
  checkData(data, options);
  requireFields(data, [column]);
  const values = data.rows.map((row, index) => {
    if ((index & 1023) === 0) checkpoint(options);
    return splitDelimitedCell(displayDataValue(row[column]), delimiter);
  });
  const width = values.reduce((max, row) => Math.max(max, row.length), 1);
  checkpoint(options, data.rows.length, data.columns.length + width - 1);
  const names = Array.from({ length: width }, (_, index) =>
    index === 0
      ? column
      : uniqueColumnName(data.columns, `${column}.${index + 1}`),
  );
  const columns = data.columns.flatMap((name) =>
    name === column ? names : name,
  );
  return {
    columns,
    rows: data.rows.map((row, index) => ({
      ...row,
      ...Object.fromEntries(
        names.map((name, col) => [name, values[index][col] ?? ""]),
      ),
    })),
    ...(data.rowIds ? { rowIds: [...data.rowIds] } : {}),
  };
}
function uniqueColumnName(columns: string[], desired: string): string {
  let name = desired,
    index = 2;
  while (columns.includes(name)) name = `${desired}_${index++}`;
  return name;
}

export type Aggregation =
  | "sum"
  | "count"
  | "countNumbers"
  | "average"
  | "min"
  | "max"
  | "product"
  | "stdev"
  | "variance";
export interface PivotMeasure {
  field: string;
  aggregate: Aggregation;
  name?: string;
}
export type PivotField =
  | string
  | {
      field: string;
      group:
        | "year"
        | "quarter"
        | "month"
        | { interval: number; origin?: number };
    };
export interface PivotSpec {
  rows: PivotField[];
  columns?: PivotField[];
  values: PivotMeasure[];
  filters?: FilterClause[];
  showValuesAs?:
    | "value"
    | "percentGrandTotal"
    | "percentRowTotal"
    | "percentColumnTotal";
  sort?: "asc" | "desc";
}
interface Accumulator {
  count: number;
  numbers: number;
  sum: number;
  compensation: number;
  min: number;
  max: number;
  product: number;
  mean: number;
  m2: number;
  error?: Scalar;
}
const accumulator = (): Accumulator => ({
  count: 0,
  numbers: 0,
  sum: 0,
  compensation: 0,
  min: Infinity,
  max: -Infinity,
  product: 1,
  mean: 0,
  m2: 0,
});
function accumulate(state: Accumulator, value: Scalar | undefined) {
  if (blank(value)) return;
  state.count++;
  if (value && isError(value)) {
    state.error ??= value;
    return;
  }
  if (!finite(value)) return;
  state.numbers++;
  const adjusted = value - state.compensation,
    next = state.sum + adjusted;
  state.compensation = next - state.sum - adjusted;
  state.sum = next;
  state.min = Math.min(state.min, value);
  state.max = Math.max(state.max, value);
  state.product *= value;
  const delta = value - state.mean;
  state.mean += delta / state.numbers;
  state.m2 += delta * (value - state.mean);
}
function aggregateValue(
  state: Accumulator | undefined,
  aggregation: Aggregation,
): Scalar {
  if (!state)
    return aggregation === "sum" ||
      aggregation === "count" ||
      aggregation === "countNumbers"
      ? 0
      : null;
  if (aggregation === "count") return state.count;
  if (aggregation === "countNumbers") return state.numbers;
  if (state.error) return state.error;
  let result: number | null;
  switch (aggregation) {
    case "sum":
      result = state.sum;
      break;
    case "average":
      result = state.numbers ? state.mean : null;
      break;
    case "min":
      result = state.numbers ? state.min : null;
      break;
    case "max":
      result = state.numbers ? state.max : null;
      break;
    case "product":
      result = state.numbers ? state.product : null;
      break;
    case "variance":
      result = state.numbers > 1 ? state.m2 / (state.numbers - 1) : null;
      break;
    case "stdev":
      result =
        state.numbers > 1 ? Math.sqrt(state.m2 / (state.numbers - 1)) : null;
      break;
    default:
      throw new AnalysisError("INPUT", `Unsupported aggregate: ${aggregation}`);
  }
  return result === null || Number.isFinite(result)
    ? result
    : {
        type: "error",
        code: "#NUM!",
        message: "Aggregation exceeded the finite number range.",
      };
}
const fieldName = (field: PivotField) =>
  typeof field === "string" ? field : field.field;
function groupedValue(row: DataRow, field: PivotField): Scalar {
  const value = asValue(row[fieldName(field)]);
  if (typeof field === "string" || blank(value) || isError(value)) return value;
  if (typeof field.group === "object") {
    const { interval, origin = 0 } = field.group;
    if (
      !(interval > 0) ||
      !Number.isFinite(interval) ||
      !Number.isFinite(origin)
    )
      throw new AnalysisError(
        "INPUT",
        "Group interval must be positive and finite.",
      );
    return finite(value)
      ? origin + Math.floor((value - origin) / interval) * interval
      : value;
  }
  // ISO calendar strings only. Serial dates must be explicitly converted using the workbook date system.
  const match =
    typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match)
    return {
      type: "error",
      code: "#VALUE!",
      message: "Date grouping requires ISO YYYY-MM-DD text.",
    };
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const monthDays = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1])
    return { type: "error", code: "#VALUE!", message: "Invalid ISO date." };
  return field.group === "year"
    ? year
    : field.group === "quarter"
      ? `${year} Q${Math.ceil(month / 3)}`
      : `${match[1]}-${match[2]}`;
}
export interface PivotCell {
  values: Scalar[];
  sourceIndices: number[];
}
export interface PivotResult {
  spec: PivotSpec;
  rowKeys: Scalar[][];
  columnKeys: Scalar[][];
  cells: PivotCell[][];
  rowTotals: Scalar[][];
  columnTotals: Scalar[][];
  grandTotals: Scalar[];
  subtotals: { key: Scalar[]; values: Scalar[]; sourceIndices: number[] }[];
  data: DataSet;
  source: DataSet;
}
/** A pivot groups and aggregates source records; refresh by rerunning with the persisted spec. */
export function pivotData(
  data: DataSet,
  spec: PivotSpec,
  options: OperationOptions = {},
): PivotResult {
  checkData(data, options);
  if (!spec.values.length)
    throw new AnalysisError("INPUT", "Choose at least one value field.");
  const columnFields = spec.columns ?? [];
  if (
    new Set(spec.rows.map(fieldName)).size !== spec.rows.length ||
    new Set(columnFields.map(fieldName)).size !== columnFields.length
  )
    throw new AnalysisError(
      "INPUT",
      "A field cannot appear twice in the same pivot area.",
    );
  requireFields(data, [
    ...spec.rows.map(fieldName),
    ...columnFields.map(fieldName),
    ...spec.values.map((value) => value.field),
    ...(spec.filters ?? []).map((filter) => filter.field),
  ]);
  const rowMap = new Map<string, Scalar[]>(),
    columnMap = new Map<string, Scalar[]>();
  const groups = new Map<
    string,
    { states: Accumulator[]; sourceIndices: number[] }
  >();
  const rowStates = new Map<string, Accumulator[]>(),
    colStates = new Map<string, Accumulator[]>();
  const subtotalMap = new Map<
    string,
    { key: Scalar[]; states: Accumulator[]; sourceIndices: number[] }
  >();
  const grand = spec.values.map(accumulator);
  const fresh = () => spec.values.map(accumulator);
  data.rows.forEach((row, index) => {
    if ((index & 1023) === 0) checkpoint(options);
    if (!(spec.filters ?? []).every((filter) => matchesFilter(row, filter)))
      return;
    const rowKey = spec.rows.map((field) => groupedValue(row, field)),
      colKey = columnFields.map((field) => groupedValue(row, field));
    const rk = keyOf(rowKey),
      ck = keyOf(colKey),
      key = JSON.stringify([rk, ck]);
    rowMap.set(rk, rowKey);
    columnMap.set(ck, colKey);
    checkpoint(
      options,
      rowMap.size,
      Math.max(1, columnMap.size) * spec.values.length,
    );
    if (!groups.has(key))
      groups.set(key, { states: fresh(), sourceIndices: [] });
    if (!rowStates.has(rk)) rowStates.set(rk, fresh());
    if (!colStates.has(ck)) colStates.set(ck, fresh());
    const group = groups.get(key)!;
    group.sourceIndices.push(index);
    spec.values.forEach((measure, m) => {
      const value = row[measure.field];
      accumulate(group.states[m], value);
      accumulate(rowStates.get(rk)![m], value);
      accumulate(colStates.get(ck)![m], value);
      accumulate(grand[m], value);
    });
    for (let length = 1; length < rowKey.length; length++) {
      const prefix = rowKey.slice(0, length),
        key = keyOf(prefix);
      if (!subtotalMap.has(key))
        subtotalMap.set(key, {
          key: prefix,
          states: fresh(),
          sourceIndices: [],
        });
      const subtotal = subtotalMap.get(key)!;
      subtotal.sourceIndices.push(index);
      spec.values.forEach((measure, m) =>
        accumulate(subtotal.states[m], row[measure.field]),
      );
    }
  });
  const orderKeys = (a: Scalar[], b: Scalar[]) => {
    for (let index = 0; index < a.length; index++) {
      const difference = compare(a[index], b[index]);
      if (difference) return difference * (spec.sort === "desc" ? -1 : 1);
    }
    return 0;
  };
  const rowKeys = [...rowMap.values()].sort(orderKeys),
    columnKeys = [...columnMap.values()].sort(orderKeys);
  if (!columnKeys.length) columnKeys.push([]);
  const valuesOf = (states: Accumulator[] | undefined) =>
    spec.values.map((measure, index) =>
      aggregateValue(states?.[index], measure.aggregate),
    );
  const grandTotals = valuesOf(grand),
    rowTotals = rowKeys.map((key) => valuesOf(rowStates.get(keyOf(key)))),
    columnTotals = columnKeys.map((key) => valuesOf(colStates.get(keyOf(key))));
  const cells: PivotCell[][] = rowKeys.map((rowKey, ri) =>
    columnKeys.map((colKey, ci) => {
      const group = groups.get(JSON.stringify([keyOf(rowKey), keyOf(colKey)]));
      const values = valuesOf(group?.states).map((value, index) => {
        const denominator =
          spec.showValuesAs === "percentGrandTotal"
            ? grandTotals[index]
            : spec.showValuesAs === "percentRowTotal"
              ? rowTotals[ri][index]
              : spec.showValuesAs === "percentColumnTotal"
                ? columnTotals[ci][index]
                : undefined;
        if (denominator === undefined) return value;
        if (isError(value)) return value;
        return finite(value) && finite(denominator) && denominator !== 0
          ? value / denominator
          : { type: "error" as const, code: "#DIV/0!" };
      });
      return { values, sourceIndices: group?.sourceIndices ?? [] };
    }),
  );
  const outputColumns = spec.rows.map(fieldName);
  const measureColumns = columnKeys.map((key) =>
    spec.values.map((measure) => {
      const name = uniqueColumnName(
        outputColumns,
        [
          ...key.map(displayDataValue),
          measure.name ?? `${measure.aggregate} of ${measure.field}`,
        ]
          .filter(Boolean)
          .join(" / "),
      );
      outputColumns.push(name);
      return name;
    }),
  );
  const outputRows = rowKeys.map((key, ri) => {
    const row: DataRow = Object.fromEntries(
      spec.rows.map((field, index) => [fieldName(field), key[index]]),
    );
    measureColumns.forEach((names, ci) =>
      names.forEach((name, mi) => {
        Object.defineProperty(row, name, {
          value: cells[ri][ci].values[mi],
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }),
    );
    return row;
  });
  return {
    spec,
    rowKeys,
    columnKeys,
    cells,
    rowTotals,
    columnTotals,
    grandTotals,
    subtotals: [...subtotalMap.values()].map((item) => ({
      key: item.key,
      values: valuesOf(item.states),
      sourceIndices: item.sourceIndices,
    })),
    data: { columns: outputColumns, rows: outputRows },
    source: data,
  };
}
export function drillThrough(
  pivot: PivotResult,
  row: number,
  column: number,
): DataSet {
  const cell = pivot.cells[row]?.[column];
  if (!cell) throw new AnalysisError("INPUT", "Choose a populated pivot cell.");
  return indexed(pivot.source, cell.sourceIndices);
}

export type QueryStep =
  | { kind: "filter"; filters: FilterClause[] }
  | { kind: "select"; columns: string[] }
  | { kind: "rename"; columns: Record<string, string> }
  | { kind: "sort"; keys: SortKey[] }
  | { kind: "distinct"; columns?: string[] }
  | {
      kind: "type";
      column: string;
      dataType: "text" | "number" | "boolean" | "date";
    }
  | { kind: "split"; column: string; delimiter: string }
  | { kind: "append"; data: DataSet }
  | {
      kind: "join";
      data: DataSet;
      left: string[];
      right: string[];
      mode?: "inner" | "left";
      prefix?: string;
    }
  | { kind: "group"; by: PivotField[]; values: PivotMeasure[] }
  | { kind: "pivot"; spec: PivotSpec }
  | { kind: "unpivot"; columns: string[]; attribute?: string; value?: string }
  | { kind: "take"; count: number };
export interface QueryResult {
  data: DataSet;
  steps: {
    index: number;
    kind: QueryStep["kind"];
    rows: number;
    columns: number;
  }[];
  errors: { row: number; field: string; error: Scalar }[];
}
export function runQuery(
  source: DataSet,
  steps: QueryStep[],
  options: OperationOptions = {},
): QueryResult {
  checkData(source, options);
  let data = source;
  const history: QueryResult["steps"] = [];
  steps.forEach((step, index) => {
    checkpoint(options);
    switch (step.kind) {
      case "filter":
        data = filterData(data, step.filters, options);
        break;
      case "sort":
        data = sortData(data, step.keys, options);
        break;
      case "distinct":
        data = removeDuplicates(data, step.columns, options).data;
        break;
      case "split":
        data = textToColumns(data, step.column, step.delimiter, options);
        break;
      case "select": {
        requireFields(data, step.columns);
        if (new Set(step.columns).size !== step.columns.length)
          throw new AnalysisError("INPUT", "Selected columns must be unique.");
        data = {
          ...data,
          columns: [...step.columns],
          rows: data.rows.map((row) =>
            Object.fromEntries(
              step.columns.map((column) => [column, asValue(row[column])]),
            ),
          ),
        };
        break;
      }
      case "rename": {
        requireFields(data, Object.keys(step.columns));
        const columns = data.columns.map(
          (column) => step.columns[column] ?? column,
        );
        if (new Set(columns).size !== columns.length)
          throw new AnalysisError(
            "INPUT",
            "Renaming would create duplicate column names.",
          );
        data = {
          ...data,
          columns,
          rows: data.rows.map((row) =>
            Object.fromEntries(
              data.columns.map((column, i) => [
                columns[i],
                asValue(row[column]),
              ]),
            ),
          ),
        };
        break;
      }
      case "type": {
        requireFields(data, [step.column]);
        data = {
          ...data,
          rows: data.rows.map((row) => ({
            ...row,
            [step.column]: convertType(
              asValue(row[step.column]),
              step.dataType,
            ),
          })),
        };
        break;
      }
      case "append": {
        checkData(step.data, options);
        const columns = [...new Set([...data.columns, ...step.data.columns])];
        checkpoint(
          options,
          data.rows.length + step.data.rows.length,
          columns.length,
        );
        data = {
          columns,
          rows: [...data.rows, ...step.data.rows].map((row) =>
            Object.fromEntries(
              columns.map((column) => [column, asValue(row[column])]),
            ),
          ),
          rowIds: [
            ...data.rows.map((_, i) => `left:${data.rowIds?.[i] ?? i}`),
            ...step.data.rows.map(
              (_, i) => `right:${step.data.rowIds?.[i] ?? i}`,
            ),
          ],
        };
        break;
      }
      case "join":
        data = joinData(data, step, options);
        break;
      case "group":
        data = pivotData(
          data,
          { rows: step.by, values: step.values },
          options,
        ).data;
        break;
      case "pivot":
        data = pivotData(data, step.spec, options).data;
        break;
      case "unpivot": {
        requireFields(data, step.columns);
        const retained = data.columns.filter(
            (column) => !step.columns.includes(column),
          ),
          attribute = step.attribute ?? "Attribute",
          value = step.value ?? "Value";
        if (
          attribute === value ||
          retained.includes(attribute) ||
          retained.includes(value)
        )
          throw new AnalysisError(
            "INPUT",
            "Unpivot output names must be distinct from the retained columns.",
          );
        checkpoint(
          options,
          data.rows.length * step.columns.length,
          retained.length + 2,
        );
        const columns = [...retained, attribute, value],
          rows: DataRow[] = [],
          rowIds: string[] = [];
        data.rows.forEach((row, i) => {
          if ((i & 1023) === 0) checkpoint(options);
          for (const column of step.columns) {
            rows.push({
              ...Object.fromEntries(
                retained.map((key) => [key, asValue(row[key])]),
              ),
              [attribute]: column,
              [value]: asValue(row[column]),
            });
            rowIds.push(`${data.rowIds?.[i] ?? i}:${column}`);
          }
        });
        data = { columns, rows, rowIds };
        break;
      }
      case "take": {
        if (!Number.isSafeInteger(step.count) || step.count < 0)
          throw new AnalysisError(
            "INPUT",
            "Row count must be a nonnegative integer.",
          );
        data = {
          ...data,
          rows: data.rows.slice(0, step.count),
          ...(data.rowIds ? { rowIds: data.rowIds.slice(0, step.count) } : {}),
        };
        break;
      }
      default:
        throw new AnalysisError(
          "INPUT",
          `Unsupported query transformation: ${(step as { kind?: string }).kind}`,
        );
    }
    checkData(data, options);
    history.push({
      index,
      kind: step.kind,
      rows: data.rows.length,
      columns: data.columns.length,
    });
  });
  const errors: QueryResult["errors"] = [];
  data.rows.forEach((row, index) =>
    data.columns.forEach((field) => {
      const value = row[field];
      if (value && isError(value))
        errors.push({ row: index, field, error: value });
    }),
  );
  return { data, steps: history, errors };
}
function convertType(
  value: Scalar,
  type: "text" | "number" | "boolean" | "date",
): Scalar {
  if (value === null || isError(value)) return value;
  if (type === "text") return displayDataValue(value);
  if (
    type === "number" &&
    (typeof value === "number" ||
      (typeof value === "string" &&
        /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())))
  ) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  if (type === "boolean") {
    if (value === true || value === false) return value;
    if (typeof value === "string" && /^(true|false)$/i.test(value))
      return value.toLowerCase() === "true";
  }
  if (
    type === "date" &&
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isError(groupedValue({ date: value }, { field: "date", group: "year" }))
  )
    return value;
  return {
    type: "error",
    code: "#VALUE!",
    message: `Cannot convert “${displayDataValue(value)}” to ${type}.`,
  };
}
function joinData(
  data: DataSet,
  step: Extract<QueryStep, { kind: "join" }>,
  options: OperationOptions,
): DataSet {
  checkData(step.data, options);
  requireFields(data, step.left);
  requireFields(step.data, step.right);
  if (!step.left.length || step.left.length !== step.right.length)
    throw new AnalysisError(
      "INPUT",
      "Join requires the same positive number of keys on each side.",
    );
  const rightNames: string[] = [],
    columns = [...data.columns];
  for (const column of step.data.columns) {
    const name = uniqueColumnName(
      columns,
      `${step.prefix ?? "joined."}${column}`,
    );
    rightNames.push(name);
    columns.push(name);
  }
  const buckets = new Map<string, number[]>();
  step.data.rows.forEach((row, index) => {
    if ((index & 1023) === 0) checkpoint(options);
    const key = keyOf(step.right.map((field) => asValue(row[field])));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(index);
  });
  const rows: DataRow[] = [],
    rowIds: string[] = [];
  data.rows.forEach((row, index) => {
    if ((index & 1023) === 0) checkpoint(options);
    const matches =
      buckets.get(keyOf(step.left.map((field) => asValue(row[field])))) ?? [];
    const include = matches.length ? matches : step.mode === "left" ? [-1] : [];
    for (const right of include) {
      checkpoint(options, rows.length + 1, columns.length);
      rows.push({
        ...row,
        ...Object.fromEntries(
          step.data.columns.map((column, i) => [
            rightNames[i],
            right === -1 ? null : asValue(step.data.rows[right][column]),
          ]),
        ),
      });
      rowIds.push(
        `${data.rowIds?.[index] ?? index}:${step.data.rowIds?.[right] ?? right}`,
      );
    }
  });
  return { columns, rows, rowIds };
}

export interface ChartData {
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
  sourceRows: number[];
}
export function chartData(
  data: DataSet,
  label: string,
  series: string[],
  options: OperationOptions & { maxPoints?: number } = {},
): ChartData {
  checkData(data, options);
  requireFields(data, [label, ...series]);
  if (data.rows.length > (options.maxPoints ?? 10_000))
    throw new AnalysisError(
      "LIMIT",
      "Chart has too many points. Aggregate or filter the source first.",
    );
  return {
    labels: data.rows.map((row) => displayDataValue(row[label])),
    series: series.map((name) => ({
      name,
      values: data.rows.map((row) =>
        finite(row[name]) ? (row[name] as number) : null,
      ),
    })),
    sourceRows: data.rows.map((_, index) => index),
  };
}

export interface GoalSeekOptions {
  min?: number;
  max?: number;
  tolerance?: number;
  maxIterations?: number;
  maxEvaluations?: number;
  signal?: AbortSignal;
}
export interface GoalSeekResult {
  success: boolean;
  status:
    | "converged"
    | "iteration-limit"
    | "no-bracket"
    | "invalid-value"
    | "cancelled";
  input: number;
  value: number;
  residual: number;
  iterations: number;
  evaluations: number;
  message: string;
}
/** Safeguarded secant/bisection. A successful result always meets the residual tolerance. */
export function goalSeek(
  evaluate: (input: number) => number,
  target: number,
  initial = 0,
  options: GoalSeekOptions = {},
): GoalSeekResult {
  const min = options.min ?? -1e12,
    max = options.max ?? 1e12,
    tolerance = options.tolerance ?? 1e-8,
    maxIterations = options.maxIterations ?? 100,
    maxEvaluations = options.maxEvaluations ?? 500;
  if (
    !Number.isFinite(target) ||
    !Number.isFinite(initial) ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min >= max ||
    !(tolerance > 0) ||
    !Number.isInteger(maxIterations) ||
    maxIterations < 1 ||
    !Number.isInteger(maxEvaluations) ||
    maxEvaluations < 1
  )
    throw new AnalysisError(
      "INPUT",
      "Invalid Goal Seek bounds, target, or iteration settings.",
    );
  let evaluations = 0,
    iterations = 0,
    bestX = Math.min(max, Math.max(min, initial)),
    bestValue = NaN,
    bestResidual = Infinity;
  const result = (
    status: GoalSeekResult["status"],
    message: string,
  ): GoalSeekResult => ({
    success: status === "converged",
    status,
    input: bestX,
    value: bestValue,
    residual: bestResidual,
    iterations,
    evaluations,
    message,
  });
  const sample = (x: number) => {
    if (options.signal?.aborted || evaluations >= maxEvaluations) return NaN;
    evaluations++;
    let value: number;
    try {
      value = evaluate(x);
    } catch {
      return NaN;
    }
    if (!Number.isFinite(value)) return NaN;
    const residual = value - target;
    if (Math.abs(residual) < bestResidual) {
      bestResidual = Math.abs(residual);
      bestX = x;
      bestValue = value;
    }
    return residual;
  };
  const center = bestX,
    fcenter = sample(center);
  if (options.signal?.aborted)
    return result(
      "cancelled",
      "Goal Seek cancelled. No result has been committed.",
    );
  if (bestResidual <= tolerance)
    return result(
      "converged",
      "Target reached within the requested tolerance.",
    );
  let low = center,
    high = center,
    flow = fcenter,
    fhigh = fcenter,
    step = Math.max(1, Math.abs(center) * 0.1),
    bracket = false;
  for (let expand = 0; expand < 50 && evaluations < maxEvaluations; expand++) {
    if (options.signal?.aborted)
      return result("cancelled", "Goal Seek cancelled.");
    const left = Math.max(min, center - step),
      right = Math.min(max, center + step);
    const fl = left === low ? flow : sample(left),
      fr = right === high ? fhigh : sample(right);
    if (bestResidual <= tolerance)
      return result(
        "converged",
        "Target reached within the requested tolerance.",
      );
    if (
      Number.isFinite(fl) &&
      Number.isFinite(fcenter) &&
      Math.sign(fl) !== Math.sign(fcenter)
    ) {
      low = left;
      flow = fl;
      high = center;
      fhigh = fcenter;
      bracket = true;
      break;
    }
    if (
      Number.isFinite(fr) &&
      Number.isFinite(fcenter) &&
      Math.sign(fr) !== Math.sign(fcenter)
    ) {
      low = center;
      flow = fcenter;
      high = right;
      fhigh = fr;
      bracket = true;
      break;
    }
    low = left;
    flow = fl;
    high = right;
    fhigh = fr;
    if (
      Number.isFinite(fl) &&
      Number.isFinite(fr) &&
      Math.sign(fl) !== Math.sign(fr)
    ) {
      bracket = true;
      break;
    }
    if (left === min && right === max) break;
    step *= 2;
  }
  if (!bracket)
    return result(
      Number.isFinite(bestValue) ? "no-bracket" : "invalid-value",
      "No finite sign-changing bracket was found. Try a different start or bounds; no solution is claimed.",
    );
  for (
    iterations = 1;
    iterations <= maxIterations && evaluations < maxEvaluations;
    iterations++
  ) {
    if (options.signal?.aborted)
      return result("cancelled", "Goal Seek cancelled.");
    let candidate = high - (fhigh * (high - low)) / (fhigh - flow);
    if (
      !Number.isFinite(candidate) ||
      candidate <= low + (high - low) * 0.1 ||
      candidate >= high - (high - low) * 0.1
    )
      candidate = low + (high - low) / 2;
    const value = sample(candidate);
    if (!Number.isFinite(value))
      return result(
        "invalid-value",
        "The formula returned a nonfinite value inside the search bracket.",
      );
    if (bestResidual <= tolerance)
      return result(
        "converged",
        "Target reached within the requested tolerance.",
      );
    if (Math.sign(value) === Math.sign(flow)) {
      low = candidate;
      flow = value;
    } else {
      high = candidate;
      fhigh = value;
    }
    if (
      high === low ||
      (candidate === low &&
        Math.abs(high - low) <= Number.EPSILON * Math.max(1, Math.abs(low)))
    )
      break;
  }
  iterations = Math.min(iterations, maxIterations);
  return result(
    "iteration-limit",
    "The evaluation or iteration limit was reached before the target tolerance.",
  );
}

export interface SolverConstraint {
  evaluate: (variables: readonly number[]) => number;
  relation: "<=" | ">=" | "=";
  value: number;
}
export interface SolverProblem {
  objective: (variables: readonly number[]) => number;
  initial: number[];
  bounds: { min: number; max: number }[];
  constraints?: SolverConstraint[];
  direction?: "min" | "max";
}
export interface SolverOptions {
  tolerance?: number;
  constraintTolerance?: number;
  maxIterations?: number;
  maxEvaluations?: number;
  signal?: AbortSignal;
}
export interface SolverResult {
  success: boolean;
  status:
    | "converged"
    | "infeasible"
    | "iteration-limit"
    | "invalid-value"
    | "cancelled";
  variables: number[];
  objective: number;
  maxViolation: number;
  iterations: number;
  evaluations: number;
  message: string;
}
/** Box-constrained pattern search with an increasing quadratic penalty. Local convergence only; not Excel's Solver algorithms. */
export function solve(
  problem: SolverProblem,
  options: SolverOptions = {},
): SolverResult {
  const dimensions = problem.initial.length,
    tolerance = options.tolerance ?? 1e-7,
    constraintTolerance = options.constraintTolerance ?? 1e-6,
    maxIterations = options.maxIterations ?? 3000,
    maxEvaluations = options.maxEvaluations ?? 50_000;
  if (
    dimensions < 1 ||
    dimensions > 16 ||
    problem.bounds.length !== dimensions ||
    problem.initial.some((value) => !Number.isFinite(value)) ||
    problem.bounds.some(
      (bound) =>
        !Number.isFinite(bound.min) ||
        !Number.isFinite(bound.max) ||
        bound.min >= bound.max,
    ) ||
    !(tolerance > 0) ||
    !(constraintTolerance > 0) ||
    !Number.isInteger(maxIterations) ||
    maxIterations < 1 ||
    !Number.isInteger(maxEvaluations) ||
    maxEvaluations < 1 ||
    problem.constraints?.some(
      (constraint) => !Number.isFinite(constraint.value),
    )
  )
    throw new AnalysisError(
      "INPUT",
      "Solver needs 1–16 finite variables with finite lower and upper bounds and valid limits.",
    );
  let variables = problem.initial.map((value, i) =>
      Math.min(problem.bounds[i].max, Math.max(problem.bounds[i].min, value)),
    ),
    evaluations = 0,
    iterations = 0;
  let current = { objective: NaN, violation: Infinity, penalty: Infinity };
  const result = (
    status: SolverResult["status"],
    message: string,
  ): SolverResult => ({
    success: status === "converged",
    status,
    variables,
    objective: current.objective,
    maxViolation: current.violation,
    iterations,
    evaluations,
    message,
  });
  const evaluate = (values: number[], weight: number) => {
    if (evaluations >= maxEvaluations || options.signal?.aborted)
      return { objective: NaN, violation: Infinity, penalty: Infinity };
    evaluations++;
    try {
      const objective = problem.objective(values);
      if (!Number.isFinite(objective))
        return { objective, violation: Infinity, penalty: Infinity };
      let squared = 0,
        violation = 0;
      for (const constraint of problem.constraints ?? []) {
        const value = constraint.evaluate(values);
        if (!Number.isFinite(value))
          return { objective, violation: Infinity, penalty: Infinity };
        const residual = value - constraint.value,
          excess =
            constraint.relation === "="
              ? Math.abs(residual)
              : constraint.relation === "<="
                ? Math.max(0, residual)
                : Math.max(0, -residual);
        squared += excess * excess;
        violation = Math.max(violation, excess);
      }
      return {
        objective,
        violation,
        penalty:
          objective * (problem.direction === "max" ? -1 : 1) + weight * squared,
      };
    } catch {
      return { objective: NaN, violation: Infinity, penalty: Infinity };
    }
  };
  let converged = false;
  for (const weight of [
    1, 100, 10_000, 1_000_000, 100_000_000, 10_000_000_000,
  ]) {
    current = evaluate(variables, weight);
    if (options.signal?.aborted)
      return result(
        "cancelled",
        "Solver cancelled. No result has been committed.",
      );
    if (!Number.isFinite(current.penalty))
      return result(
        evaluations >= maxEvaluations ? "iteration-limit" : "invalid-value",
        "The objective or constraints could not be evaluated within the configured limits.",
      );
    let steps = problem.bounds.map((bound) => (bound.max - bound.min) / 8),
      stable = false;
    while (iterations < maxIterations && evaluations < maxEvaluations) {
      if (options.signal?.aborted)
        return result("cancelled", "Solver cancelled.");
      iterations++;
      let improved = false;
      for (let dim = 0; dim < dimensions; dim++) {
        let best = current,
          bestVariables = variables;
        for (const direction of [-1, 1]) {
          const candidate = [...variables];
          candidate[dim] = Math.min(
            problem.bounds[dim].max,
            Math.max(
              problem.bounds[dim].min,
              candidate[dim] + direction * steps[dim],
            ),
          );
          if (candidate[dim] === variables[dim]) continue;
          const trial = evaluate(candidate, weight);
          if (trial.penalty < best.penalty) {
            best = trial;
            bestVariables = candidate;
          }
        }
        if (bestVariables !== variables) {
          current = best;
          variables = bestVariables;
          improved = true;
        }
      }
      if (!improved) steps = steps.map((step) => step / 2);
      if (
        steps.every(
          (step, i) => step <= tolerance * Math.max(1, Math.abs(variables[i])),
        )
      ) {
        stable = true;
        break;
      }
    }
    if (stable && current.violation <= constraintTolerance) {
      converged = true;
      break;
    }
    if (iterations >= maxIterations || evaluations >= maxEvaluations) break;
  }
  if (converged)
    return result(
      "converged",
      "A feasible local solution reached the step and constraint tolerances. Global optimality is not established.",
    );
  if (iterations >= maxIterations || evaluations >= maxEvaluations)
    return result(
      "iteration-limit",
      "Solver reached its configured limit; no converged solution is claimed.",
    );
  return result(
    "infeasible",
    "The search did not find a solution satisfying the constraints. This does not prove the model is infeasible.",
  );
}
