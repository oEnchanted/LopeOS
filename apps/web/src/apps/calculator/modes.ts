import { calculate } from './engine.ts';

export type AngleUnit = 'degrees' | 'radians';
export type ProgrammerRadix = 2 | 8 | 10 | 16;
const MAX_INPUT = 512;

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('The result is outside the supported range.');
  return value;
}
function format(value: number): string {
  return Number(finite(value).toPrecision(15)).toString();
}
function sourceFor(expression: string): string {
  if (expression.length > MAX_INPUT) throw new Error('Expression is too long.');
  return expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
}

/** A small expression parser; names resolve only to the explicit function table. */
export function calculateScientific(expression: string, angle: AngleUnit = 'degrees', variables: Record<string, number | string> = {}): string {
  const source = sourceFor(expression);
  // Keep the basic calculator's exact decimal arithmetic whenever possible.
  if (/^[\d\s.eE+\-*/()%]+$/.test(source)) {
    try { return calculate(source); } catch { /* Constants and scientific syntax use the parser below. */ }
  }
  let at = 0; let depth = 0;
  const skip = () => { while (at < source.length && /\s/.test(source[at])) at++; };
  const take = (token: string) => { skip(); if (source.startsWith(token, at)) { at += token.length; return true; } return false; };
  const radians = (value: number) => angle === 'degrees' ? value * Math.PI / 180 : value;
  const fromRadians = (value: number) => angle === 'degrees' ? value * 180 / Math.PI : value;
  function trig(value: number, kind: 'sin' | 'cos' | 'tan'): number {
    const rad = radians(value);
    const quarter = rad / (Math.PI / 2);
    const exactQuarter = Number.isInteger(quarter);
    const quadrant = ((Math.round(quarter) % 4) + 4) % 4;
    if (kind === 'tan' && exactQuarter && quadrant % 2) throw new Error('Tangent is undefined at this angle.');
    if (exactQuarter) return kind === 'sin' ? [0, 1, 0, -1][quadrant] : kind === 'cos' ? [1, 0, -1, 0][quadrant] : 0;
    return Math[kind](rad);
  }
  const functions: Record<string, (value: number) => number> = {
    sin: value => trig(value, 'sin'), cos: value => trig(value, 'cos'), tan: value => trig(value, 'tan'),
    asin: value => fromRadians(Math.asin(value)), acos: value => fromRadians(Math.acos(value)), atan: value => fromRadians(Math.atan(value)),
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
    exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  };
  function primary(): number {
    skip();
    if (take('(')) { const result = sum(); if (!take(')')) throw new Error('Close the parenthesis.'); return result; }
    const numeric = source.slice(at).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numeric) { at += numeric[0].length; return finite(Number(numeric[0])); }
    const identifier = source.slice(at).match(/^(?:[A-Za-z_][A-Za-z_\d]*|π)/)?.[0];
    if (!identifier) throw new Error('Enter a number or function.');
    at += identifier.length;
    const name = identifier.toLowerCase();
    if (Object.hasOwn(functions, name)) {
      if (!take('(')) throw new Error(`Use ${name}(number).`);
      const argument = sum();
      if (!take(')')) throw new Error('Close the parenthesis.');
      const result = functions[name](argument);
      if (!Number.isFinite(result)) throw new Error(`${name} is not defined for this value.`);
      return result;
    }
    if (name === 'pi' || name === 'π') return Math.PI;
    if (name === 'e') return Math.E;
    if (Object.hasOwn(variables, identifier)) return finite(Number(variables[identifier]));
    throw new Error(`Unknown value: ${identifier}.`);
  }
  function postfix(): number {
    let value = primary();
    while (true) {
      if (take('%')) value /= 100;
      else if (take('!')) {
        if (!Number.isInteger(value) || value < 0 || value > 170) throw new Error('Factorial requires a whole number from 0 to 170.');
        let factorial = 1; for (let n = 2; n <= value; n++) factorial *= n;
        value = factorial;
      } else return finite(value);
    }
  }
  function power(): number {
    const value = postfix();
    return take('^') ? finite(value ** unary()) : value;
  }
  function unary(): number {
    if (++depth > 32) throw new Error('Expression is nested too deeply.');
    const value = take('+') ? unary() : take('-') ? -unary() : power();
    depth--; return value;
  }
  function product(): number {
    let value = unary();
    while (true) {
      if (take('*')) value = finite(value * unary());
      else if (take('/')) { const divisor = unary(); if (divisor === 0) throw new Error('Cannot divide by zero.'); value = finite(value / divisor); }
      else { skip(); if (/[A-Za-z_π(]/.test(source[at] || '')) value = finite(value * unary()); else return value; }
    }
  }
  function sum(): number {
    let value = product();
    while (true) { if (take('+')) value = finite(value + product()); else if (take('-')) value = finite(value - product()); else return value; }
  }
  const result = sum(); skip();
  if (at !== source.length) throw new Error('Check the expression and its operators.');
  return format(result);
}

/** Signed 64-bit arithmetic. Nondecimal output exposes the two's-complement bits. */
export function evaluateProgrammer(expression: string, radix: ProgrammerRadix = 10): { decimal: string; binary: string; octal: string; hex: string } {
  if (![2, 8, 10, 16].includes(radix)) throw new Error('Choose a supported number base.');
  const source = sourceFor(expression).replace(/\bAND\b/gi, '&').replace(/\bOR\b/gi, '|').replace(/\bXOR\b/gi, '^').replace(/\bNOT\b/gi, '~');
  let at = 0; let depth = 0;
  const wrap = (value: bigint) => BigInt.asIntN(64, value);
  const skip = () => { while (at < source.length && /\s/.test(source[at])) at++; };
  const take = (token: string) => { skip(); if (source.startsWith(token, at)) { at += token.length; return true; } return false; };
  function primary(): bigint {
    if (take('(')) { const value = or(); if (!take(')')) throw new Error('Close the parenthesis.'); return value; }
    skip();
    const token = source.slice(at).match(/^(?:0[xX][\dA-Fa-f]+|0[bB][01]+|0[oO][0-7]+|[\dA-Fa-f]+)/)?.[0];
    if (!token) throw new Error('Enter an integer in the selected base.');
    at += token.length;
    let value: bigint;
    if (/^0[xbo]/i.test(token)) value = BigInt(token);
    else {
      const allowed = radix === 2 ? /^[01]+$/ : radix === 8 ? /^[0-7]+$/ : radix === 10 ? /^\d+$/ : /^[\dA-Fa-f]+$/;
      if (!allowed.test(token)) throw new Error(`Use digits valid in base ${radix}.`);
      value = BigInt((radix === 2 ? '0b' : radix === 8 ? '0o' : radix === 16 ? '0x' : '') + token);
    }
    if (value > 0xffffffffffffffffn) throw new Error('Enter a value that fits in 64 bits.');
    return wrap(value);
  }
  function unary(): bigint {
    if (++depth > 32) throw new Error('Expression is nested too deeply.');
    const value = take('+') ? unary() : take('-') ? wrap(-unary()) : take('~') ? wrap(~unary()) : primary();
    depth--; return value;
  }
  function product(): bigint {
    let value = unary();
    while (true) {
      if (take('*')) value = wrap(value * unary());
      else if (take('/')) { const divisor = unary(); if (!divisor) throw new Error('Cannot divide by zero.'); value = wrap(value / divisor); }
      else if (take('%')) { const divisor = unary(); if (!divisor) throw new Error('Cannot divide by zero.'); value = wrap(value % divisor); }
      else return value;
    }
  }
  function sum(): bigint {
    let value = product();
    while (true) { if (take('+')) value = wrap(value + product()); else if (take('-')) value = wrap(value - product()); else return value; }
  }
  function shift(): bigint {
    let value = sum();
    while (true) {
      const left = take('<<'); const right = !left && take('>>');
      if (!left && !right) return value;
      const amount = sum();
      if (amount < 0n || amount > 63n) throw new Error('Shift by a whole number from 0 to 63.');
      value = wrap(left ? value << amount : value >> amount);
    }
  }
  function and(): bigint { let value = shift(); while (take('&')) value = wrap(value & shift()); return value; }
  function xor(): bigint { let value = and(); while (take('^')) value = wrap(value ^ and()); return value; }
  function or(): bigint { let value = xor(); while (take('|')) value = wrap(value | xor()); return value; }
  const value = or(); skip();
  if (at !== source.length) throw new Error('Check the integer expression and its operators.');
  const unsigned = BigInt.asUintN(64, value);
  return { decimal: value.toString(), binary: unsigned.toString(2), octal: unsigned.toString(8), hex: unsigned.toString(16).toUpperCase() };
}

type ConversionUnit = { id: string; label: string; factor: number };
const unit = (id: string, label: string, factor: number): ConversionUnit => ({ id, label, factor });
export const CONVERSION_CATEGORIES = [
  { id: 'length', label: 'Length', units: [unit('m', 'Meters', 1), unit('km', 'Kilometers', 1000), unit('cm', 'Centimeters', .01), unit('mm', 'Millimeters', .001), unit('in', 'Inches', .0254), unit('ft', 'Feet', .3048), unit('yd', 'Yards', .9144), unit('mi', 'Miles', 1609.344)] },
  { id: 'mass', label: 'Weight', units: [unit('kg', 'Kilograms', 1), unit('g', 'Grams', .001), unit('mg', 'Milligrams', .000001), unit('lb', 'Pounds', .45359237), unit('oz', 'Ounces', .028349523125)] },
  { id: 'temperature', label: 'Temperature', units: [unit('c', 'Celsius', 1), unit('f', 'Fahrenheit', 1), unit('k', 'Kelvin', 1)] },
  { id: 'speed', label: 'Speed', units: [unit('mps', 'Meters per second', 1), unit('kph', 'Kilometers per hour', 1 / 3.6), unit('mph', 'Miles per hour', .44704), unit('kn', 'Knots', 1852 / 3600)] },
  { id: 'area', label: 'Area', units: [unit('m2', 'Square meters', 1), unit('km2', 'Square kilometers', 1e6), unit('ft2', 'Square feet', .09290304), unit('ha', 'Hectares', 10000), unit('ac', 'Acres', 4046.8564224)] },
  { id: 'volume', label: 'Volume', units: [unit('l', 'Liters', 1), unit('ml', 'Milliliters', .001), unit('m3', 'Cubic meters', 1000), unit('gal', 'US gallons', 3.785411784), unit('cup', 'US cups', .2365882365), unit('floz', 'US fluid ounces', .0295735295625)] },
  { id: 'time', label: 'Time', units: [unit('s', 'Seconds', 1), unit('min', 'Minutes', 60), unit('h', 'Hours', 3600), unit('d', 'Days', 86400), unit('wk', 'Weeks', 604800)] },
  { id: 'data', label: 'Data', units: [unit('b', 'Bits', .125), unit('B', 'Bytes', 1), unit('kB', 'Kilobytes', 1000), unit('MB', 'Megabytes', 1e6), unit('GB', 'Gigabytes', 1e9), unit('KiB', 'Kibibytes', 1024), unit('MiB', 'Mebibytes', 1048576), unit('GiB', 'Gibibytes', 1073741824)] },
];

export function convertValue(value: string, category: string, from: string, to: string): string {
  const definition = CONVERSION_CATEGORIES.find(item => item.id === category);
  const source = definition?.units.find(item => item.id === from);
  const target = definition?.units.find(item => item.id === to);
  if (!source || !target) throw new Error('Choose compatible conversion units.');
  const amount = Number(calculate(value));
  if (category === 'temperature') {
    const celsius = from === 'f' ? (amount - 32) * 5 / 9 : from === 'k' ? amount - 273.15 : amount;
    return format(to === 'f' ? celsius * 9 / 5 + 32 : to === 'k' ? celsius + 273.15 : celsius);
  }
  return format(amount * source.factor / target.factor);
}

export function applyRpn(stack: string[], input: string, key: string, angle: AngleUnit = 'degrees'): { stack: string[]; input: string } {
  if (key === 'clear' || key === 'AC') return { stack: [], input: '' };
  const next = [...stack];
  if (input.trim()) next.push(calculateScientific(input, angle));
  if (next.length > 100) throw new Error('The stack is full. Clear or drop an entry.');
  if (key === 'Enter' || key === '=' || key === 'enter') {
    if (!input.trim()) { if (!next.length) throw new Error('Enter a number first.'); next.push(next.at(-1)!); }
    if (next.length > 100) throw new Error('The stack is full. Clear or drop an entry.');
    return { stack: next, input: '' };
  }
  const normalized = key.replace('×', '*').replace('÷', '/').replace('−', '-');
  const binary = ['+', '-', '*', '/', '^'].includes(normalized);
  if (next.length < (binary || key === 'swap' ? 2 : 1)) throw new Error(binary || key === 'swap' ? 'Enter two numbers on the stack.' : 'Enter a number first.');
  if (key === 'drop') next.pop();
  else if (key === 'swap') [next[next.length - 2], next[next.length - 1]] = [next[next.length - 1], next[next.length - 2]];
  else if (binary) {
    const right = next.pop()!; const left = next.pop()!;
    next.push(calculateScientific(`(${left})${normalized}(${right})`, angle));
  } else {
    const top = next.pop()!;
    const expression = key === '%' ? `(${top})%` : ['±', '+/-', 'negate'].includes(key) ? `-(${top})`
      : ['x²', 'square'].includes(key) ? `(${top})^2` : ['1/x', 'reciprocal'].includes(key) ? `1/(${top})`
      : key === '!' ? `(${top})!` : `${key}(${top})`;
    next.push(calculateScientific(expression, angle));
  }
  return { stack: next, input: '' };
}

export function evaluateMathNotes(source: string, angle: AngleUnit = 'degrees'): { line: string; result?: string; error?: string }[] {
  const variables: Record<string, string> = Object.create(null);
  return source.split('\n').map(line => {
    const text = line.trim();
    if (!text || text.startsWith('#') || text.startsWith('//')) return { line };
    try {
      const assignment = text.match(/^([A-Za-z_][A-Za-z_\d]*)\s*=(?!=)\s*(.+)$/);
      const expression = assignment ? assignment[2] : text.replace(/=\s*$/, '');
      if (assignment && ['pi', 'e', 'ans'].includes(assignment[1].toLowerCase())) throw new Error('This name is reserved.');
      const result = calculateScientific(expression, angle, variables);
      if (assignment) variables[assignment[1]] = result;
      variables.ans = result;
      return { line, result };
    } catch (cause) { return { line, error: cause instanceof Error ? cause.message : 'Check this expression.' }; }
  });
}
