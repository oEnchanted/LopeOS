import { WorkbookEngine } from "../../../../../packages/spreadsheet-engine/src/calculation.ts";
import {
  goalSeek,
  solve,
  type SolverConstraint,
} from "../../../../../packages/spreadsheet-engine/src/analysis.ts";
import {
  parseAddress,
  cellAddress,
  cellValue,
  type Workbook,
} from "../../../../../packages/spreadsheet-engine/src/model.ts";

export interface NumericalRequest {
  kind: "goal" | "solver";
  workbook: Workbook;
  sheetId: string;
  values: Record<string, string>;
}
export interface NumericalResult {
  success: boolean;
  message: string;
  addresses: string[];
  variables: number[];
  objective: number;
  maxViolation?: number;
  residual?: number;
  evaluations: number;
  status: string;
}

/** Runs on an isolated workbook snapshot. Only the caller can commit accepted inputs to the live workbook. */
export function runNumerical({
  kind,
  workbook,
  sheetId,
  values,
}: NumericalRequest): NumericalResult {
  const engine = new WorkbookEngine(workbook),
    sheet = engine.sheet(sheetId);
  const address = (text: string) => {
    const point = parseAddress(text.trim());
    return cellAddress(point.row, point.col);
  };
  const target = address(values.target);
  if (!sheet.cells[target]?.formula)
    throw new Error("The objective must be a formula cell.");
  const addresses = (
    kind === "goal" ? [values.variable] : values.variables.split(",")
  ).map(address);
  if (new Set(addresses).size !== addresses.length)
    throw new Error("Each changing cell must be listed only once.");
  if (addresses.some((a) => sheet.cells[a]?.formula))
    throw new Error(
      "Changing cells must contain numeric inputs, not formulas.",
    );
  const initial = addresses.map((a) => {
    const value = cellValue(sheet.cells[a]);
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error(`${a} must contain a finite number.`);
    return value;
  });
  if (
    workbook.sheets.some((source) =>
      Object.values(source.cells).some(
        (cell) =>
          cell.formula &&
          /\b(?:RAND|RANDBETWEEN|RANDARRAY|NOW)\s*\(/i.test(
            cell.formula.replace(/"(?:[^"]|"")*"/g, ""),
          ),
      ),
    )
  )
    throw new Error(
      "Numerical analysis requires deterministic formulas. Replace random or NOW formulas with fixed values first.",
    );
  let previous: readonly number[] | undefined,
    objective = NaN;
  const evaluate = (variables: readonly number[]) => {
    if (
      previous &&
      variables.every((value, index) => Object.is(value, previous![index]))
    )
      return objective;
    engine.batch(
      addresses.map((address, index) => ({
        sheetId,
        address,
        input: variables[index],
      })),
    );
    engine.calculate(true);
    const value = engine.value(sheetId, target);
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error("The objective did not calculate to a finite number.");
    previous = [...variables];
    objective = value;
    return value;
  };
  if (kind === "goal") {
    const outcome = goalSeek(
      (input) => evaluate([input]),
      Number(values.value),
      initial[0],
      {
        min: Number(values.min),
        max: Number(values.max),
        maxEvaluations: 1000,
      },
    );
    return {
      success: outcome.success,
      status: outcome.status,
      message: outcome.message,
      addresses,
      variables: [outcome.input],
      objective: outcome.value,
      residual: outcome.residual,
      evaluations: outcome.evaluations,
    };
  }
  const constraints: SolverConstraint[] = String(values.constraints ?? "")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const match =
        /^\s*(\$?[a-z]+\$?\d+)\s*(<=|>=|=)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*$/i.exec(
          line,
        );
      if (!match) throw new Error(`Invalid constraint: ${line}`);
      const cell = address(match[1]);
      return {
        relation: match[2] as "<=" | ">=" | "=",
        value: Number(match[3]),
        evaluate: (variables: readonly number[]) => {
          evaluate(variables);
          const value = engine.value(sheetId, cell);
          if (typeof value !== "number" || !Number.isFinite(value))
            throw new Error(
              `Constraint ${cell} did not evaluate to a finite number.`,
            );
          return value;
        },
      };
    });
  if (values.direction !== "min" && values.direction !== "max")
    throw new Error("Choose a minimum or maximum objective.");
  const outcome = solve(
    {
      objective: evaluate,
      initial,
      bounds: addresses.map(() => ({
        min: Number(values.min),
        max: Number(values.max),
      })),
      direction: values.direction,
      constraints,
    },
    { maxEvaluations: 5000, maxIterations: 1000 },
  );
  return { ...outcome, addresses };
}

if (typeof self !== "undefined")
  self.onmessage = (event) => {
    try {
      self.postMessage({ result: runNumerical(event.data) });
    } catch (error) {
      self.postMessage({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
