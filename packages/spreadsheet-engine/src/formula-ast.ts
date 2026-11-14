import { parseRange, type Range } from "./model.ts";

export type FormulaAst =
  | {
      kind: "literal";
      value: string | number | boolean | null;
      start: number;
      end: number;
    }
  | { kind: "error"; code: string; start: number; end: number }
  | { kind: "name"; name: string; start: number; end: number }
  | {
      kind: "reference";
      sheet?: string;
      range: Range;
      text: string;
      start: number;
      end: number;
    }
  | {
      kind: "structured";
      table?: string;
      column: string;
      start: number;
      end: number;
    }
  | {
      kind: "unary";
      operator: string;
      value: FormulaAst;
      start: number;
      end: number;
    }
  | {
      kind: "binary";
      operator: string;
      left: FormulaAst;
      right: FormulaAst;
      start: number;
      end: number;
    }
  | {
      kind: "call";
      callee: FormulaAst;
      args: FormulaAst[];
      start: number;
      end: number;
    }
  | { kind: "array"; rows: FormulaAst[][]; start: number; end: number };
interface Token {
  kind:
    | "number"
    | "string"
    | "error"
    | "reference"
    | "structured"
    | "name"
    | "operator"
    | "space"
    | "eof";
  text: string;
  start: number;
  end: number;
  node?: FormulaAst;
}
/** Static syntax tree for auditing, lexical scope and sparse dependency discovery.
 * Evaluation remains with the pinned LL(1) engine and its tested extensions. */
export function tokenizeFormula(formula: string): Token[] {
  const tokens: Token[] = [];
  let index = formula.startsWith("=") ? 1 : 0;
  while (index < formula.length) {
    const tail = formula.slice(index),
      start = index;
    let match: RegExpExecArray | null;
    if ((match = /^\s+/.exec(tail))) {
      index += match[0].length;
      tokens.push({ kind: "space", text: match[0], start, end: index });
      continue;
    }
    if ((match = /^"(?:[^"]|"")*"/.exec(tail))) {
      index += match[0].length;
      tokens.push({
        kind: "string",
        text: match[0],
        start,
        end: index,
        node: {
          kind: "literal",
          value: match[0].slice(1, -1).replace(/""/g, '"'),
          start,
          end: index,
        },
      });
      continue;
    }
    if (
      (match =
        /^#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|SPILL!|CALC!|CIRC!|BLOCKED!|GETTING_DATA)/i.exec(
          tail,
        ))
    ) {
      index += match[0].length;
      tokens.push({
        kind: "error",
        text: match[0],
        start,
        end: index,
        node: {
          kind: "error",
          code: match[0].toUpperCase(),
          start,
          end: index,
        },
      });
      continue;
    }
    const ref =
      /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Za-z]{1,3}\$?[1-9]\d*(?::\$?[A-Za-z]{1,3}\$?[1-9]\d*)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?[1-9]\d*:\$?[1-9]\d*)/.exec(
        tail,
      );
    if (ref && !/[\w.(\[]/.test(tail[ref[0].length] ?? "")) {
      try {
        const range = parseRange(ref[3].replace(/\$/g, ""));
        index += ref[0].length;
        tokens.push({
          kind: "reference",
          text: ref[0],
          start,
          end: index,
          node: {
            kind: "reference",
            sheet: ref[1]?.replace(/''/g, "'") ?? ref[2],
            range,
            text: ref[0],
            start,
            end: index,
          },
        });
        continue;
      } catch {
        /* May be a defined name, e.g. XFE1. */
      }
    }
    if ((match = /^(?:([A-Za-z_][\w.]*))?\[([^\]]+)\]/.exec(tail))) {
      index += match[0].length;
      tokens.push({
        kind: "structured",
        text: match[0],
        start,
        end: index,
        node: {
          kind: "structured",
          table: match[1],
          column: match[2],
          start,
          end: index,
        },
      });
      continue;
    }
    if ((match = /^(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?/.exec(tail))) {
      index += match[0].length;
      tokens.push({
        kind: "number",
        text: match[0],
        start,
        end: index,
        node: { kind: "literal", value: Number(match[0]), start, end: index },
      });
      continue;
    }
    if ((match = /^[A-Za-z_\\][A-Za-z0-9_.\\]*/.exec(tail))) {
      index += match[0].length;
      const upper = match[0].toUpperCase();
      tokens.push({
        kind: "name",
        text: match[0],
        start,
        end: index,
        node:
          upper === "TRUE" || upper === "FALSE"
            ? { kind: "literal", value: upper === "TRUE", start, end: index }
            : { kind: "name", name: match[0], start, end: index },
      });
      continue;
    }
    if ((match = /^(?:<=|>=|<>|[+\-*/^&=<>%():,;{}@#])/.exec(tail))) {
      index += match[0].length;
      tokens.push({ kind: "operator", text: match[0], start, end: index });
      continue;
    }
    throw new SyntaxError(
      `Unrecognized formula token at character ${index + 1}.`,
    );
  }
  tokens.push({ kind: "eof", text: "", start: index, end: index });
  return tokens;
}
const precedence: Record<string, number> = {
  "=": 10,
  "<>": 10,
  "<": 10,
  ">": 10,
  "<=": 10,
  ">=": 10,
  "&": 20,
  "+": 30,
  "-": 30,
  "*": 40,
  "/": 40,
  "^": 50,
  ",": 70,
  " ": 80,
  ":": 90,
};
export function parseFormula(formula: string): FormulaAst {
  const tokens = tokenizeFormula(formula);
  let index = 0,
    depth = 0;
  const current = () => tokens[index],
    skip = () => {
      while (current().kind === "space") index++;
    };
  const expression = (minimum = 0, stops = new Set<string>()): FormulaAst => {
    if (++depth > 256)
      throw new SyntaxError("Formula syntax nesting exceeds 256 levels.");
    skip();
    let token = current(),
      left: FormulaAst;
    if (token.text === "+" || token.text === "-" || token.text === "@") {
      index++;
      const value = expression(60, stops);
      left = {
        kind: "unary",
        operator: token.text,
        value,
        start: token.start,
        end: value.end,
      };
    } else if (token.text === "(") {
      index++;
      left = expression(0, new Set([")"]));
      skip();
      if (current().text !== ")")
        throw new SyntaxError("A closing parenthesis is missing.");
      index++;
    } else if (token.text === "{") {
      index++;
      const rows: FormulaAst[][] = [[]];
      while (current().text !== "}") {
        rows.at(-1)!.push(expression(0, new Set([",", ";", "}"])));
        skip();
        if (current().text === ",") index++;
        else if (current().text === ";") {
          index++;
          rows.push([]);
        } else if (current().text !== "}")
          throw new SyntaxError("Invalid array constant.");
      }
      const end = current().end;
      index++;
      left = { kind: "array", rows, start: token.start, end };
    } else if (token.node) {
      left = token.node;
      index++;
    } else
      throw new SyntaxError(
        `Expected a value at character ${token.start + 1}.`,
      );
    while (true) {
      token = current();
      if (token.kind === "space") {
        const save = index;
        skip();
        const next = current();
        if (
          !stops.has(next.text) &&
          ["reference", "name", "structured"].includes(next.kind) &&
          80 >= minimum
        ) {
          const right = expression(81, stops);
          left = {
            kind: "binary",
            operator: " ",
            left,
            right,
            start: left.start,
            end: right.end,
          };
          continue;
        }
        if (next.text !== "(") token = next;
        else if (left.kind === "name" || left.kind === "call") token = next;
        else {
          index = save;
          break;
        }
      }
      if (token.kind === "eof" || stops.has(token.text)) break;
      if (token.text === "(") {
        index++;
        const args: FormulaAst[] = [];
        skip();
        while (current().text !== ")") {
          if (current().text === ",") {
            args.push({
              kind: "literal",
              value: null,
              start: current().start,
              end: current().start,
            });
            index++;
            continue;
          }
          args.push(expression(0, new Set([",", ")"])));
          skip();
          if (current().text === ",") {
            index++;
            skip();
            if (current().text === ")")
              args.push({
                kind: "literal",
                value: null,
                start: current().start,
                end: current().start,
              });
          } else if (current().text !== ")")
            throw new SyntaxError("Invalid function arguments.");
        }
        const end = current().end;
        index++;
        left = { kind: "call", callee: left, args, start: left.start, end };
        continue;
      }
      if (token.text === "%" || token.text === "#") {
        index++;
        left = {
          kind: "unary",
          operator: token.text,
          value: left,
          start: left.start,
          end: token.end,
        };
        continue;
      }
      const level = precedence[token.text];
      if (level === undefined || level < minimum) break;
      index++;
      const right = expression(level + 1, stops);
      left = {
        kind: "binary",
        operator: token.text,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
    depth--;
    return left;
  };
  const result = expression();
  skip();
  if (current().kind !== "eof")
    throw new SyntaxError(
      `Unexpected token at character ${current().start + 1}.`,
    );
  return result;
}
export function visitFormula(
  ast: FormulaAst,
  visitor: (node: FormulaAst) => void,
): void {
  visitor(ast);
  if (ast.kind === "binary") {
    visitFormula(ast.left, visitor);
    visitFormula(ast.right, visitor);
  } else if (ast.kind === "unary") visitFormula(ast.value, visitor);
  else if (ast.kind === "call") {
    visitFormula(ast.callee, visitor);
    for (const arg of ast.args) visitFormula(arg, visitor);
  } else if (ast.kind === "array")
    for (const row of ast.rows)
      for (const item of row) visitFormula(item, visitor);
}
