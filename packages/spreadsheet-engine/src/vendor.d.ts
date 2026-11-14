declare module "fast-formula-parser" {
  interface Ref {
    sheet?: string;
    row?: number;
    col?: number;
    from?: { row: number; col: number };
    to?: { row: number; col: number };
  }
  class FormulaError extends Error {
    constructor(code: string, message?: string);
    error: string;
    details?: unknown;
    static VALUE: FormulaError;
    static NAME: FormulaError;
    static REF: FormulaError;
    static NUM: FormulaError;
    static NA: FormulaError;
    static DIV0: FormulaError;
  }
  class DepParser {
    constructor(config?: {
      onVariable?: (name: string, sheet?: string) => unknown;
    });
    parse(
      formula: string,
      position: { row: number; col: number; sheet: string },
      ignoreError?: boolean,
    ): Ref[];
  }
  export default class FormulaParser {
    static FormulaError: typeof FormulaError;
    static DepParser: typeof DepParser;
    static SSF: {
      format(format: string, value: unknown, options?: unknown): string;
    };
    constructor(config?: {
      functions?: Record<string, (...args: any[]) => any>;
      functionsNeedContext?: Record<string, (...args: any[]) => any>;
      onCell?: (ref: Ref) => unknown;
      onRange?: (ref: Ref) => unknown;
      onVariable?: (
        name: string,
        sheet?: string,
        position?: { row: number; col: number },
      ) => unknown;
    });
    parse(
      formula: string,
      position: { row: number; col: number; sheet: string },
      allowReturnArray?: boolean,
    ): any;
    checkFormulaResult(result: any, allowReturnArray?: boolean): any;
    supportedFunctions(): string[];
    funsNeedContextAndNoDataRetrieve: string[];
    functions: Record<string, (...args: any[]) => any>;
    position: { row: number; col: number; sheet: string };
    retrieveRef(value: unknown): any;
    utils: {
      _applyInfix: (
        left: { val: any; isArray: boolean },
        operator: string,
        right: { val: any; isArray: boolean },
      ) => any;
      _applyPrefix: (prefixes: string[], value: any, isArray: boolean) => any;
      _applyPostfix: (value: any, isArray: boolean, postfix: string) => any;
    };
  }
}
declare module "fast-formula-parser/ssf/ssf.js" {
  const SSF: {
    format(
      format: string,
      value: unknown,
      options?: { date1904?: boolean },
    ): string;
  };
  export default SSF;
}
