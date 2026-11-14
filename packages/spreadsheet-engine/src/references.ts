import {
  cellAddress,
  MAX_COLUMNS,
  MAX_ROWS,
  parseAddress,
  type Point,
  type Range,
} from "./model.ts";
import { parseFormula, visitFormula, type FormulaAst } from "./formula-ast.ts";

export interface FormulaReference {
  start: number;
  end: number;
  text: string;
  sheet?: string;
  first: string;
  last?: string;
}
/** Lex reference spans without touching string literals, function names or identifiers. */
export function formulaReferences(formula: string): FormulaReference[] {
  const refs: FormulaReference[] = [];
  for (let i = 0; i < formula.length; ) {
    if (formula[i] === '"') {
      i++;
      while (i < formula.length) {
        if (formula[i++] === '"') {
          if (formula[i] === '"') i++;
          else break;
        }
      }
      continue;
    }
    if (i && /[A-Za-z0-9_.\[\]]/.test(formula[i - 1])) {
      i++;
      continue;
    }
    const tail = formula.slice(i),
      m =
        /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Za-z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Za-z]{1,3}\$?[1-9]\d*))?/.exec(
          tail,
        );
    if (m && !/[A-Za-z0-9_.(\[]/.test(tail[m[0].length] ?? "")) {
      try {
        parseAddress(m[3]);
        if (m[4]) parseAddress(m[4]);
        refs.push({
          start: i,
          end: i + m[0].length,
          text: m[0],
          sheet: m[1]?.replace(/''/g, "'") ?? m[2],
          first: m[3],
          last: m[4],
        });
        i += m[0].length;
        continue;
      } catch {
        /* an ordinary name, not an A1 reference */
      }
    }
    if (formula[i] === "'") {
      i++;
      while (i < formula.length) {
        if (formula[i++] === "'") {
          if (formula[i] === "'") i++;
          else break;
        }
      }
    } else i++;
  }
  return refs;
}
export function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}
type WholeReference = Extract<FormulaAst, { kind: "reference" }> & {
  axis: "row" | "col";
  first: string;
  last: string;
};
function wholeReferences(formula: string): WholeReference[] {
  const refs: WholeReference[] = [];
  try {
    visitFormula(parseFormula(formula), (node) => {
      if (node.kind !== "reference") return;
      const part = node.text.slice(node.text.lastIndexOf("!") + 1),
        m = /^(\$?[A-Z]+):(\$?[A-Z]+)$|^(\$?\d+):(\$?\d+)$/i.exec(part);
      if (m)
        refs.push({
          ...node,
          axis: m[1] ? "col" : "row",
          first: m[1] ?? m[3],
          last: m[2] ?? m[4],
        });
    });
  } catch {
    /* Preserve expressions outside the static grammar unchanged. */
  }
  return refs;
}
function shiftWholePart(
  part: string,
  axis: "row" | "col",
  delta: number,
  absolute = false,
): string {
  if (part.startsWith("$") && !absolute) return part;
  const number =
      axis === "row"
        ? Number(part.replace("$", "")) - 1
        : parseAddress(part + "1").col,
    next = number + delta;
  if (next < 0 || next >= (axis === "row" ? MAX_ROWS : MAX_COLUMNS))
    return "#REF!";
  return (
    (part.startsWith("$") ? "$" : "") +
    (axis === "row" ? String(next + 1) : cellAddress(0, next).slice(0, -1))
  );
}
function shiftAddress(
  address: string,
  rowDelta: number,
  colDelta: number,
  absolute = false,
): string {
  const m = /^(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(address)!;
  const p = parseAddress(address),
    row = p.row + (m[3] && !absolute ? 0 : rowDelta),
    col = p.col + (m[1] && !absolute ? 0 : colDelta);
  if (row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLUMNS)
    return "#REF!";
  const a = cellAddress(row, col),
    n = a.search(/\d/);
  return m[1] + a.slice(0, n) + m[3] + a.slice(n);
}
export function adjustFormula(
  formula: string,
  rowDelta: number,
  colDelta: number,
): string {
  const refs = formulaReferences(formula);
  let result = formula;
  for (const ref of refs.reverse()) {
    const a = shiftAddress(ref.first, rowDelta, colDelta),
      b = ref.last ? shiftAddress(ref.last, rowDelta, colDelta) : undefined;
    const text =
      a === "#REF!" || b === "#REF!"
        ? "#REF!"
        : (ref.sheet ? quoteSheet(ref.sheet) + "!" : "") +
          a +
          (b ? ":" + b : "");
    result = result.slice(0, ref.start) + text + result.slice(ref.end);
  }
  for (const ref of wholeReferences(result).reverse()) {
    const delta = ref.axis === "row" ? rowDelta : colDelta,
      a = shiftWholePart(ref.first, ref.axis, delta),
      b = shiftWholePart(ref.last, ref.axis, delta);
    const text =
      a === "#REF!" || b === "#REF!"
        ? "#REF!"
        : (ref.sheet ? quoteSheet(ref.sheet) + "!" : "") + a + ":" + b;
    result = result.slice(0, ref.start) + text + result.slice(ref.end);
  }
  return result;
}
export function renameSheetReferences(
  formula: string,
  oldName: string,
  newName: string,
): string {
  let result = formula;
  for (const ref of formulaReferences(formula).reverse())
    if (ref.sheet?.toLowerCase() === oldName.toLowerCase())
      result =
        result.slice(0, ref.start) +
        quoteSheet(newName) +
        "!" +
        ref.first +
        (ref.last ? ":" + ref.last : "") +
        result.slice(ref.end);
  for (const ref of wholeReferences(result).reverse())
    if (ref.sheet?.toLowerCase() === oldName.toLowerCase())
      result =
        result.slice(0, ref.start) +
        quoteSheet(newName) +
        "!" +
        ref.first +
        ":" +
        ref.last +
        result.slice(ref.end);
  return result;
}
export function moveFormulaReferences(
  formula: string,
  formulaSheet: string,
  sourceSheet: string,
  range: Range,
  targetSheet: string,
  target: Point,
): string {
  let result = formula;
  for (const ref of formulaReferences(formula).reverse()) {
    if ((ref.sheet ?? formulaSheet).toLowerCase() !== sourceSheet.toLowerCase())
      continue;
    const a = parseAddress(ref.first),
      b = ref.last ? parseAddress(ref.last) : a;
    if (
      a.row < range.start.row ||
      a.col < range.start.col ||
      b.row > range.end.row ||
      b.col > range.end.col
    )
      continue;
    const dr = target.row - range.start.row,
      dc = target.col - range.start.col;
    const text =
      (targetSheet !== formulaSheet || ref.sheet
        ? quoteSheet(targetSheet) + "!"
        : "") +
      shiftAddress(ref.first, dr, dc, true) +
      (ref.last ? ":" + shiftAddress(ref.last, dr, dc, true) : "");
    result = result.slice(0, ref.start) + text + result.slice(ref.end);
  }
  return result;
}
export function structuralFormula(
  formula: string,
  formulaSheet: string,
  changedSheet: string,
  axis: "row" | "col",
  index: number,
  count: number,
  deleting = false,
): string {
  let result = formula;
  for (const ref of formulaReferences(formula).reverse()) {
    if (
      (ref.sheet ?? formulaSheet).toLowerCase() !== changedSheet.toLowerCase()
    )
      continue;
    const map = (address: string, endpoint: "first" | "last") => {
      const p = parseAddress(address),
        coordinate = p[axis];
      let delta = coordinate >= index ? count : 0;
      if (deleting) {
        if (coordinate >= index + count) delta = -count;
        else if (coordinate >= index) {
          if (!ref.last) return "#REF!";
          delta = (endpoint === "first" ? index : index - 1) - coordinate;
        } else delta = 0;
      }
      return shiftAddress(
        address,
        axis === "row" ? delta : 0,
        axis === "col" ? delta : 0,
        true,
      );
    };
    const a = map(ref.first, "first"),
      b = ref.last ? map(ref.last, "last") : undefined;
    let text =
      a === "#REF!" || b === "#REF!"
        ? "#REF!"
        : (ref.sheet ? quoteSheet(ref.sheet) + "!" : "") +
          a +
          (b ? ":" + b : "");
    if (
      b &&
      a !== "#REF!" &&
      b !== "#REF!" &&
      parseAddress(a)[axis] > parseAddress(b)[axis]
    )
      text = "#REF!";
    result = result.slice(0, ref.start) + text + result.slice(ref.end);
  }
  for (const ref of wholeReferences(result).reverse()) {
    if (
      ref.axis !== axis ||
      (ref.sheet ?? formulaSheet).toLowerCase() !== changedSheet.toLowerCase()
    )
      continue;
    const coordinate = (part: string) =>
      axis === "row"
        ? Number(part.replace("$", "")) - 1
        : parseAddress(part + "1").col;
    const map = (part: string, end: boolean) => {
      const current = coordinate(part);
      let delta = current >= index ? count : 0;
      if (deleting)
        delta =
          current >= index + count
            ? -count
            : current >= index
              ? (end ? index - 1 : index) - current
              : 0;
      return shiftWholePart(part, axis, delta, true);
    };
    const first = map(ref.first, false),
      last = map(ref.last, true),
      text =
        first === "#REF!" ||
        last === "#REF!" ||
        coordinate(first) > coordinate(last)
          ? "#REF!"
          : (ref.sheet ? quoteSheet(ref.sheet) + "!" : "") + first + ":" + last;
    result = result.slice(0, ref.start) + text + result.slice(ref.end);
  }
  return result;
}
