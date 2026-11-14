import { supportedFunctionNames } from "./calculation.ts";
import { microsoftFunctionCatalog } from "./function-catalog.ts";

export interface FunctionCompatibility {
  name: string;
  category: string;
  introduced: string;
  status: "fixture-tested" | "available-unverified" | "unsupported" | "blocked";
  signature: string;
  arraySupport: "tested" | "scalar" | "unverified";
  errors: string;
  notes: string;
  source: string;
}
const signatures: Record<string, string> = {
  SUM: "SUM(number1, [number2], …)",
  AVERAGE: "AVERAGE(number1, [number2], …)",
  MIN: "MIN(number1, [number2], …)",
  MAX: "MAX(number1, [number2], …)",
  COUNT: "COUNT(value1, [value2], …)",
  COUNTA: "COUNTA(value1, [value2], …)",
  COUNTBLANK: "COUNTBLANK(range)",
  IF: "IF(logical_test, value_if_true, [value_if_false])",
  IFS: "IFS(logical_test1, value_if_true1, …)",
  IFERROR: "IFERROR(value, value_if_error)",
  IFNA: "IFNA(value, value_if_na)",
  AND: "AND(logical1, [logical2], …)",
  OR: "OR(logical1, [logical2], …)",
  NOT: "NOT(logical)",
  SUMIF: "SUMIF(range, criteria, [sum_range])",
  SUMIFS: "SUMIFS(sum_range, criteria_range1, criteria1, …)",
  COUNTIF: "COUNTIF(range, criteria)",
  COUNTIFS: "COUNTIFS(criteria_range1, criteria1, …)",
  AVERAGEIFS: "AVERAGEIFS(average_range, criteria_range1, criteria1, …)",
  ROUND: "ROUND(number, num_digits)",
  ROUNDUP: "ROUNDUP(number, num_digits)",
  ROUNDDOWN: "ROUNDDOWN(number, num_digits)",
  SUMPRODUCT: "SUMPRODUCT(array1, [array2], …)",
  SUBTOTAL: "SUBTOTAL(function_num, ref1, …)",
  AGGREGATE: "AGGREGATE(function_num, options, ref1, …)",
  XLOOKUP:
    "XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])",
  XMATCH: "XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])",
  VLOOKUP: "VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])",
  HLOOKUP: "HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])",
  INDEX: "INDEX(array, row_num, [column_num])",
  MATCH: "MATCH(lookup_value, lookup_array, [match_type])",
  LEFT: "LEFT(text, [num_chars])",
  RIGHT: "RIGHT(text, [num_chars])",
  MID: "MID(text, start_num, num_chars)",
  LEN: "LEN(text)",
  CONCAT: "CONCAT(text1, [text2], …)",
  CONCATENATE: "CONCATENATE(text1, [text2], …)",
  TRIM: "TRIM(text)",
  TEXT: "TEXT(value, format_text)",
  DATE: "DATE(year, month, day)",
  DATEVALUE: "DATEVALUE(date_text)",
  DAY: "DAY(serial_number)",
  MONTH: "MONTH(serial_number)",
  YEAR: "YEAR(serial_number)",
  EDATE: "EDATE(start_date, months)",
  EOMONTH: "EOMONTH(start_date, months)",
  TODAY: "TODAY()",
  NOW: "NOW()",
  FILTER: "FILTER(array, include, [if_empty])",
  SORT: "SORT(array, [sort_index], [sort_order], [by_col])",
  SORTBY: "SORTBY(array, by_array1, [sort_order1], …)",
  UNIQUE: "UNIQUE(array, [by_col], [exactly_once])",
  SEQUENCE: "SEQUENCE(rows, [columns], [start], [step])",
  LET: "LET(name1, name_value1, …, calculation)",
  LAMBDA: "LAMBDA([parameter1, …], calculation)",
  MEDIAN: "MEDIAN(number1, [number2], …)",
  LARGE: "LARGE(array, k)",
  SMALL: "SMALL(array, k)",
  "STDEV.S": "STDEV.S(number1, [number2], …)",
  "STDEV.P": "STDEV.P(number1, [number2], …)",
  "VAR.S": "VAR.S(number1, [number2], …)",
  "VAR.P": "VAR.P(number1, [number2], …)",
  PV: "PV(rate, nper, pmt, [fv], [type])",
  FV: "FV(rate, nper, pmt, [pv], [type])",
  PMT: "PMT(rate, nper, pv, [fv], [type])",
  NPER: "NPER(rate, pmt, pv, [fv], [type])",
  NPV: "NPV(rate, value1, [value2], …)",
};
// This set corresponds to assertions in tests/spreadsheet/engine.test.ts. It is NOT Excel differential certification.
const tested = new Set(
  "SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK PRODUCT IF IFERROR IFNA IFS AND OR NOT SUMIF SUMIFS COUNTIF COUNTIFS AVERAGEIFS ROUND ROUNDUP ROUNDDOWN SUMPRODUCT SUBTOTAL AGGREGATE XLOOKUP VLOOKUP HLOOKUP INDEX MATCH XMATCH LEFT RIGHT MID LEN CONCAT TRIM UPPER LOWER DATE DATEVALUE DAY MONTH YEAR DAYS EDATE EOMONTH FILTER SORT SORTBY UNIQUE SEQUENCE LET LAMBDA MEDIAN LARGE SMALL STDEV.S STDEV.P VAR.S VAR.P PV FV PMT NPER NPV ABS SQRT POWER MOD ISBLANK ISNUMBER ISTEXT ISERROR NA TRANSPOSE".split(
    " ",
  ),
);
const arrays = new Set(
  "SEQUENCE FILTER SORT SORTBY UNIQUE TRANSPOSE LET LAMBDA XLOOKUP IFERROR IFNA".split(
    " ",
  ),
);
const blocked = new Set([
  "WEBSERVICE",
  "RTD",
  "IMAGE",
  "CALL",
  "REGISTER.ID",
  "STOCKHISTORY",
  "TRANSLATE",
  "DETECTLANGUAGE",
]);
const notes: Record<string, string> = {
  LET: "Lexical scopes and nested calls tested; no reference-valued bindings or closures.",
  LAMBDA:
    "Immediate calls and named recursion tested. 128 expression levels; higher-order MAP/REDUCE/BYROW and returning closures are unsupported.",
  XLOOKUP:
    "Exact, wildcard and next-smaller/next-larger linear matches; search_mode 1/-1. Binary search modes are explicit #VALUE! errors.",
  XMATCH:
    "Linear forward/backward search only; binary search modes are explicit #VALUE! errors.",
  DATEVALUE:
    "Invariant yyyy-mm-dd input only; locale-specific date text remains unsupported.",
  SUBTOTAL:
    "Aggregations 1,2,3,4,5,6,9 and their 100-series. Filtered rows are always omitted; manually hidden rows are omitted only by 100-series codes.",
  AGGREGATE:
    "Reference-form aggregations 1,2,3,4,5,6,9, options 0–7. Array-form k aggregations unsupported.",
  FILTER:
    "Bounded dense arrays; maximum 250,000 output/input cells. Empty result is #CALC! unless if_empty provided.",
  SUM: "Whole-column/whole-row references traverse sparse occupied cells.",
};
const available = new Set(supportedFunctionNames());
export const functionRegistry: FunctionCompatibility[] =
  microsoftFunctionCatalog.map((item) => ({
    name: item.name,
    category: item.category,
    introduced: item.version,
    status: blocked.has(item.name)
      ? "blocked"
      : tested.has(item.name)
        ? "fixture-tested"
        : available.has(item.name)
          ? "available-unverified"
          : "unsupported",
    signature: signatures[item.name] ?? `${item.name}(…)`,
    arraySupport: arrays.has(item.name)
      ? "tested"
      : tested.has(item.name)
        ? "scalar"
        : "unverified",
    errors: blocked.has(item.name)
      ? "#BLOCKED! / #NAME?"
      : !available.has(item.name)
        ? "#NAME?"
        : "Excel error values propagate; cases and bounds vary by function.",
    notes:
      notes[item.name] ??
      (blocked.has(item.name)
        ? "No network or imported code execution during calculation."
        : available.has(item.name)
          ? "Engine availability is not proof of complete Excel semantics. See test evidence."
          : "Requires a compatible implementation and differential fixtures."),
    source:
      "https://support.microsoft.com/en-us/excel/excel-functions-alphabetical",
  }));
export const functionRegistryByName = new Map(
  functionRegistry.map((entry) => [entry.name, entry]),
);
export function functionSuggestions(
  prefix: string,
  limit = 12,
): FunctionCompatibility[] {
  return functionRegistry
    .filter(
      (entry) =>
        entry.name.startsWith(prefix.toUpperCase()) &&
        (entry.status === "fixture-tested" ||
          entry.status === "available-unverified"),
    )
    .slice(0, limit);
}
