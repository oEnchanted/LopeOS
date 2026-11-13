/** Exact rational arithmetic for decimal input. No executable source is evaluated. */
type Rational = { n: bigint; d: bigint };
const MAX_INPUT = 512;
function gcd(a: bigint, b: bigint): bigint { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a || 1n; }
function rational(n: bigint, d = 1n): Rational {
  if (!d) throw new Error('Cannot divide by zero.');
  if (d < 0n) { n = -n; d = -d; }
  const common = gcd(n, d); return { n: n / common, d: d / common };
}
function decimal(raw: string): Rational {
  const [mantissa, exponent = '0'] = raw.toLowerCase().split('e');
  const exp = Number(exponent);
  if (!Number.isInteger(exp) || Math.abs(exp) > 100) throw new Error('Number is too large.');
  const [whole, fraction = ''] = mantissa.split('.');
  const power = fraction.length - exp;
  const n = BigInt((whole || '0') + fraction);
  return power >= 0 ? rational(n, 10n ** BigInt(power)) : rational(n * 10n ** BigInt(-power));
}
function format({ n, d }: Rational): string {
  if (!n) return '0';
  const negative = n < 0n; if (negative) n = -n;
  let exponent = n.toString().length - d.toString().length;
  const scaleCompare = exponent >= 0 ? d * 10n ** BigInt(exponent) : d;
  if ((exponent >= 0 ? n : n * 10n ** BigInt(-exponent)) < scaleCompare) exponent--;
  const places = 14 - exponent;
  const numerator = places >= 0 ? n * 10n ** BigInt(places) : n;
  const denominator = places >= 0 ? d : d * 10n ** BigInt(-places);
  let rounded = (numerator / denominator + ((numerator % denominator) * 2n >= denominator ? 1n : 0n)).toString();
  let text: string;
  if (exponent > 14 || exponent < -8) {
    if (rounded.length > 15) { exponent++; rounded = rounded.slice(0, 15); }
    text = rounded[0] + (rounded.slice(1).replace(/0+$/, '') ? '.' + rounded.slice(1).replace(/0+$/, '') : '') + 'e' + (exponent >= 0 ? '+' : '') + exponent;
  } else if (places <= 0) text = rounded + '0'.repeat(-places);
  else {
    rounded = rounded.padStart(places + 1, '0');
    text = (rounded.slice(0, -places) + '.' + rounded.slice(-places)).replace(/\.?0+$/, '');
  }
  return (negative ? '-' : '') + text;
}

export function calculate(expression: string): string {
  if (expression.length > MAX_INPUT) throw new Error('Expression is too long.');
  const source = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  let at = 0; let depth = 0;
  const skip = () => { while (/\s/.test(source[at] || '') && at < source.length) at++; };
  const take = (token: string) => { skip(); if (source[at] === token) { at++; return true; } return false; };
  function primary(): Rational {
    if (++depth > 32) throw new Error('Expression is nested too deeply.');
    let result: Rational;
    if (take('+')) result = primary();
    else if (take('-')) { const v = primary(); result = rational(-v.n, v.d); }
    else if (take('(')) { result = sum(); if (!take(')')) throw new Error('Close the parenthesis.'); }
    else {
      skip(); const match = source.slice(at).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!match) throw new Error('Enter a number.');
      at += match[0].length; result = decimal(match[0]);
    }
    while (take('%')) result = rational(result.n, result.d * 100n);
    depth--; return result;
  }
  function product(): Rational {
    let a = primary();
    while (true) {
      if (take('*')) { const b = primary(); a = rational(a.n * b.n, a.d * b.d); }
      else if (take('/')) { const b = primary(); a = rational(a.n * b.d, a.d * b.n); }
      else return a;
    }
  }
  function sum(): Rational {
    let a = product();
    while (true) {
      if (take('+')) { const b = product(); a = rational(a.n * b.d + b.n * a.d, a.d * b.d); }
      else if (take('-')) { const b = product(); a = rational(a.n * b.d - b.n * a.d, a.d * b.d); }
      else return a;
    }
  }
  const result = sum(); skip();
  if (at !== source.length) throw new Error('Use numbers, parentheses, +, −, ×, ÷, and %.');
  return format(result);
}

export function appendCalculatorInput(input: string, key: string): string {
  if (input.length >= MAX_INPUT) return input;
  if (key === '.') {
    const lastNumber = input.match(/(?:\d*\.?\d*(?:e[+-]?\d+)?)$/i)?.[0] || '';
    if (lastNumber.includes('.') || /e/i.test(lastNumber)) return input;
    return input + (lastNumber ? '.' : '0.');
  }
  if (/^\d$/.test(key) && input === '0') return key;
  if (/^[\d+\-*/().%]$/.test(key)) return input + key;
  return input;
}
