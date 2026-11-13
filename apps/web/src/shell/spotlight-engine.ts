import { calculate } from '../apps/calculator/engine.ts';

export interface InstantAnswer {
  kind: 'calculation' | 'conversion';
  expression: string;
  value: string;
  detail: string;
}

const normalized = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Banded optimal-string-alignment distance, including adjacent transpositions. */
function typoDistance(source: string, target: string, limit: number): number {
  if (Math.abs(source.length - target.length) > limit) return limit + 1;
  let previousPrevious = Array<number>(target.length + 1).fill(Infinity);
  let previous = Array.from({ length: target.length + 1 }, (_, index) => index);
  for (let row = 1; row <= source.length; row++) {
    const current = Array<number>(target.length + 1).fill(Infinity);
    current[0] = row;
    for (let column = Math.max(1, row - limit); column <= Math.min(target.length, row + limit); column++) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (source[row - 1] === target[column - 1] ? 0 : 1),
      );
      if (row > 1 && column > 1 && source[row - 1] === target[column - 2] && source[row - 2] === target[column - 1]) {
        current[column] = Math.min(current[column], previousPrevious[column - 2] + 1);
      }
    }
    previousPrevious = previous;
    previous = current;
  }
  return previous[target.length];
}

/** Scores exact names first, then prefixes, words, and short abbreviations. */
export function matchScore(query: string, label: string, description = '', aliases: readonly string[] = []): number {
  const q = normalized(query);
  if (!q) return 1;
  const name = normalized(label);
  if (name === q) return 120;
  if (name.startsWith(q)) return 105 - Math.min(20, name.length - q.length);
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.some(word => word === q)) return 95;
  if (words.some(word => word.startsWith(q))) return 85;
  if (name.includes(q)) return 75;
  const terms = q.split(/\s+/);
  if (terms.length > 1 && terms.every(term => name.includes(term))) return 70;
  const aliasScore = aliases.reduce((best, alias) => {
    const a = normalized(alias);
    return Math.max(best, a === q ? 100 : a.startsWith(q) ? 80 : a.includes(q) ? 65 : 0);
  }, 0);
  if (aliasScore) return aliasScore;
  if (q.length >= 2 && words.map(word => word[0]).join('').startsWith(q)) return 60;
  if (terms.every(term => normalized(description).includes(term))) return 45;
  // Tolerate small typing mistakes in names, never descriptions or broad query text.
  if (q.length >= 4 && q.length <= 64) {
    let best = 0;
    for (const candidate of new Set([name, ...words])) {
      if (candidate.length < 4 || candidate.length > 64) continue;
      const limit = Math.min(q.length, candidate.length) >= 7 ? 2 : 1;
      const distance = typoDistance(q, candidate, limit);
      if (distance <= limit) best = Math.max(best, 44 - distance * 6);
    }
    if (best) return best;
  }
  // Restrict subsequences to names so broad description matches stay predictable.
  if (q.length >= 3 && !q.includes(' ')) {
    let at = 0;
    let skipped = 0;
    for (const letter of name) { if (letter === q[at]) at++; else if (at > 0 && at < q.length) skipped++; }
    if (at === q.length && skipped <= q.length * 2) return Math.max(10, 35 - skipped);
  }
  return 0;
}

const aliases: Record<string, string[]> = {
  browser: ['web', 'internet', 'safari', 'chrome', 'search'],
  files: ['finder', 'folders', 'documents', 'downloads'],
  terminal: ['console', 'command line', 'shell'],
  editor: ['textedit', 'notepad', 'notes', 'text editor'],
  calculator: ['calc', 'math', 'numbers'],
  settings: ['preferences', 'system settings', 'control panel'],
  writer: ['word', 'documents', 'word processor'],
  'image-editor': ['photoshop', 'image editor', 'photo editor', 'paint'],
  lightroom: ['photos', 'photography', 'raw', 'photo library'],
  weather: ['forecast', 'temperature'],
};
export const applicationAliases = (id: string): string[] => {
  const key = id.replace(/^lope\./, '');
  return Object.hasOwn(aliases, key) ? aliases[key] : [];
};

/** Explicit workspace paths and familiar document/code extensions stay in file search. */
export function looksLikeFileQuery(query: string): boolean {
  const text = query.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text)) return false;
  return /^\/(?!\/)[^\s]+/.test(text) || /(?:^|[\s/])[^\s/]+\.(?:txt|md|markdown|docx?|xlsx?|pptx?|pdf|rtf|csv|json|ya?ml|toml|xml|log|html?|css|[cm]?js|jsx|[cm]?ts|tsx|py|sh|png|jpe?g|gif|webp|svg|heic|tiff?|psd|zip|dng|raw|mp[34]|mov|wav)(?:$|\s)/i.test(text);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('This calculation is outside the supported number range.');
  return String(Number(value.toPrecision(14)));
}

const MAX_ANSWER_INPUT = 512;
function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('This calculation is outside the supported number range.');
  return value;
}

function normalizeExpression(query: string): string {
  let text = query.trim().replace(/^=\s*/, '').replace(/\s*=\s*$/, '')
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√\s*\(/g, 'sqrt(')
    .replace(/\bplus\b/gi, '+').replace(/\bminus\b/gi, '-').replace(/\btimes\b/gi, '*').replace(/\bdivided by\b/gi, '/');
  const discount = text.match(/^([\d.]+)\s*%\s+off\s+([\d.]+)$/i);
  if (discount) text = `${discount[2]} * (1 - ${discount[1]}%)`;
  return text.replace(/%\s+of\s+/gi, '% * ');
}

const functions: Record<string, { min: number; max: number; run: (...values: number[]) => number }> = {
  sqrt: { min: 1, max: 1, run: Math.sqrt }, abs: { min: 1, max: 1, run: Math.abs },
  sin: { min: 1, max: 1, run: Math.sin }, cos: { min: 1, max: 1, run: Math.cos }, tan: { min: 1, max: 1, run: Math.tan },
  log: { min: 1, max: 1, run: Math.log10 }, ln: { min: 1, max: 1, run: Math.log },
  round: { min: 1, max: 1, run: Math.round }, floor: { min: 1, max: 1, run: Math.floor }, ceil: { min: 1, max: 1, run: Math.ceil },
  min: { min: 1, max: 20, run: Math.min }, max: { min: 1, max: 20, run: Math.max },
};

/** A bounded recursive-descent parser; never interprets JavaScript or arbitrary names. */
function scientificCalculation(source: string): string {
  let at = 0;
  let depth = 0;
  const skip = () => { while (at < source.length && /\s/.test(source[at])) at++; };
  const take = (token: string) => { skip(); if (source.startsWith(token, at)) { at += token.length; return true; } return false; };
  function primary(): number {
    if (++depth > 32) throw new Error('Expression is nested too deeply.');
    let value: number;
    if (take('(')) { value = sum(); if (!take(')')) throw new Error('Close the parenthesis.'); }
    else {
      skip();
      const number = source.slice(at).match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
      if (number) {
        at += number[0].length;
        value = Number(number[0]);
        if (value === 0 && /[1-9]/.test(number[0].split(/e/i)[0])) throw new Error('This number is too small to represent.');
      }
      else {
        const word = source.slice(at).match(/^[a-z]+/i)?.[0]?.toLowerCase();
        if (!word) throw new Error('Enter a number.');
        at += word.length;
        if (word === 'pi') value = Math.PI;
        else if (word === 'e') value = Math.E;
        else {
          const fn = Object.hasOwn(functions, word) ? functions[word] : undefined;
          if (!fn || !take('(')) throw new Error('Use a supported function followed by parentheses.');
          const args: number[] = [];
          if (!take(')')) {
            do { args.push(sum()); if (args.length > fn.max) throw new Error(`Too many arguments for ${word}.`); } while (take(','));
            if (!take(')')) throw new Error('Close the parenthesis.');
          }
          if (args.length < fn.min) throw new Error(`Enter an argument for ${word}.`);
          value = fn.run(...args);
        }
      }
    }
    while (take('%')) value /= 100;
    depth--;
    if (!Number.isFinite(value)) throw new Error('No finite real-number result.');
    return value;
  }
  function power(): number {
    const value = primary();
    if (take('^')) {
      const result = finite(value ** unary());
      if (value !== 0 && result === 0) throw new Error('This result is too small to represent.');
      return result;
    }
    return value;
  }
  function unary(): number {
    if (++depth > 32) throw new Error('Expression is nested too deeply.');
    const value = take('+') ? unary() : take('-') ? -unary() : power();
    depth--;
    return value;
  }
  function product(): number {
    let value = unary();
    while (true) {
      if (take('*')) value = finite(value * unary());
      else if (take('/')) { const divisor = unary(); if (!divisor) throw new Error('Cannot divide by zero.'); value = finite(value / divisor); }
      else return value;
    }
  }
  function sum(): number {
    let value = product();
    while (true) {
      if (take('+')) value = finite(value + product());
      else if (take('-')) value = finite(value - product());
      else return value;
    }
  }
  const value = sum();
  skip();
  if (at !== source.length) throw new Error('Check the expression and operators.');
  return formatNumber(value);
}

function looksLikeCalculation(source: string): boolean {
  if (!source) return false;
  if (/^[\d\s.eE+*/^()%−-]+$/.test(source)) return /[+*/^()%−-]/.test(source);
  return /^(?:[\d\s.+*/^()%,-]|pi\b|e\b|sqrt\b|abs\b|sin\b|cos\b|tan\b|log\b|ln\b|round\b|floor\b|ceil\b|min\b|max\b)+$/i.test(source)
    && /\b(?:pi|e|sqrt|abs|sin|cos|tan|log|ln|round|floor|ceil|min|max)\b/i.test(source);
}

function answerCalculation(query: string): InstantAnswer | null {
  if (query.length > MAX_ANSWER_INPUT) throw new Error('Expression is too long.');
  const expression = normalizeExpression(query);
  if (!looksLikeCalculation(expression)) return null;
  if (expression.length > MAX_ANSWER_INPUT) throw new Error('Expression is too long.');
  const scientific = /\^|[a-z]/i.test(expression.replace(/(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+/g, ''));
  const value = scientific ? scientificCalculation(expression) : calculate(expression);
  return { kind: 'calculation', expression: query.trim(), value, detail: /\b(sin|cos|tan)\b/i.test(expression) ? 'Calculation · angles in radians' : 'Calculation' };
}

type Unit = { dimension: string; factor: number; symbol: string };
const units = new Map<string, Unit>();
function unit(dimension: string, factor: number, symbol: string, names: string[]) {
  for (const name of names) units.set(name, { dimension, factor, symbol });
}
unit('length', 1, 'm', ['m', 'meter', 'meters', 'metre', 'metres']);
unit('length', 1000, 'km', ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres']);
unit('length', .01, 'cm', ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres']);
unit('length', .001, 'mm', ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']);
unit('length', .0254, 'in', ['in', 'inch', 'inches']);
unit('length', .3048, 'ft', ['ft', 'foot', 'feet']);
unit('length', .9144, 'yd', ['yd', 'yard', 'yards']);
unit('length', 1609.344, 'mi', ['mi', 'mile', 'miles']);
unit('mass', 1, 'kg', ['kg', 'kilogram', 'kilograms']);
unit('mass', .001, 'g', ['g', 'gram', 'grams']);
unit('mass', .000001, 'mg', ['mg', 'milligram', 'milligrams']);
unit('mass', .45359237, 'lb', ['lb', 'lbs', 'pound', 'pounds']);
unit('mass', .028349523125, 'oz', ['oz', 'ounce', 'ounces']);
unit('volume', 1, 'L', ['l', 'liter', 'liters', 'litre', 'litres']);
unit('volume', .001, 'mL', ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']);
unit('volume', 3.785411784, 'US gal', ['gal', 'gallon', 'gallons', 'us gal']);
unit('volume', .2365882365, 'US cups', ['cup', 'cups', 'us cups']);
unit('volume', .01478676478125, 'US tbsp', ['tbsp', 'tablespoon', 'tablespoons']);
unit('volume', .00492892159375, 'US tsp', ['tsp', 'teaspoon', 'teaspoons']);
unit('time', .001, 'ms', ['ms', 'millisecond', 'milliseconds']);
unit('time', 1, 's', ['s', 'sec', 'second', 'seconds']);
unit('time', 60, 'min', ['min', 'minute', 'minutes']);
unit('time', 3600, 'h', ['h', 'hr', 'hour', 'hours']);
unit('time', 86400, 'days', ['d', 'day', 'days']);
unit('time', 604800, 'weeks', ['w', 'week', 'weeks']);
unit('speed', 1, 'm/s', ['m/s']);
unit('speed', 1 / 3.6, 'km/h', ['km/h', 'kph', 'kmh']);
unit('speed', .44704, 'mph', ['mph']);
for (let power = 0; power <= 4; power++) {
  const prefix = ['', 'kilo', 'mega', 'giga', 'tera'][power];
  const symbol = ['', 'K', 'M', 'G', 'T'][power];
  unit('data', 1000 ** power, `${symbol}B`, [`${prefix}byte`, `${prefix}bytes`]);
  unit('data', 1000 ** power / 8, `${symbol}b`, [`${prefix}bit`, `${prefix}bits`]);
}

function lookupUnit(raw: string): Unit | undefined {
  // Preserve the conventional b/B distinction: 8 Mb is 1 MB.
  const data = raw.match(/^([kmgt]?)(i?)([bB])$/i);
  if (data && (!data[2] || data[1])) {
    const power = ['', 'k', 'm', 'g', 't'].indexOf(data[1].toLowerCase());
    const base = data[2] ? 1024 : 1000;
    const bits = data[3] === 'b';
    return { dimension: 'data', factor: base ** power / (bits ? 8 : 1), symbol: `${data[1].toUpperCase()}${data[2] ? 'i' : ''}${bits ? 'b' : 'B'}` };
  }
  return units.get(raw.toLowerCase());
}

function conversion(query: string): InstantAnswer | null {
  const match = query.trim().match(/^([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-z°/]+(?: [a-z°/]+)*)\s+(?:to|in|into|=)\s+([a-z°/]+(?: [a-z°/]+)*)$/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const fromName = match[2].trim().toLowerCase();
  const toName = match[3].trim().toLowerCase();
  const temperatures: Record<string, string> = { c: 'C', '°c': 'C', celsius: 'C', f: 'F', '°f': 'F', fahrenheit: 'F', k: 'K', kelvin: 'K' };
  const temperature = (name: string) => Object.hasOwn(temperatures, name) ? temperatures[name] : undefined;
  const fromTemp = temperature(fromName);
  const toTemp = temperature(toName);
  let result: number;
  let symbol: string;
  if (fromTemp && toTemp) {
    const celsius = fromTemp === 'F' ? (value - 32) * 5 / 9 : fromTemp === 'K' ? value - 273.15 : value;
    if (celsius < -273.15 - 1e-10) return null;
    result = toTemp === 'F' ? celsius * 9 / 5 + 32 : toTemp === 'K' ? celsius + 273.15 : celsius;
    symbol = toTemp === 'K' ? 'K' : `°${toTemp}`;
  } else {
    const from = lookupUnit(match[2].trim());
    const to = lookupUnit(match[3].trim());
    if (!from || !to || from.dimension !== to.dimension) return null;
    result = value * from.factor / to.factor;
    symbol = to.symbol;
  }
  if (!Number.isFinite(result)) return null;
  return { kind: 'conversion', expression: query.trim(), value: `${formatNumber(result)} ${symbol}`, detail: 'Unit conversion' };
}

export function getInstantAnswer(query: string): InstantAnswer | null {
  if (query.length > MAX_ANSWER_INPUT) return null;
  try { return conversion(query) || answerCalculation(query); } catch { return null; }
}

export function getCalculationError(query: string): string | null {
  if (query.length > MAX_ANSWER_INPUT) {
    return looksLikeCalculation(normalizeExpression(query.slice(0, MAX_ANSWER_INPUT))) ? 'Expression is too long.' : null;
  }
  try { answerCalculation(query); return null; }
  catch (error) { return error instanceof Error ? error.message : 'Check the calculation.'; }
}
