import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRpn, calculateScientific, convertValue, evaluateMathNotes, evaluateProgrammer } from '../../apps/web/src/apps/calculator/modes.ts';

test('scientific calculations preserve exact basic arithmetic and mathematical precedence', () => {
  assert.equal(calculateScientific('0.1+0.2'), '0.3');
  assert.equal(calculateScientific('2^3^2'), '512');
  assert.equal(calculateScientific('-2^2'), '-4');
  assert.equal(calculateScientific('2^-2'), '0.25');
  assert.equal(calculateScientific('sqrt(81) + 3!'), '15');
  assert.equal(calculateScientific('2(3+4)'), '14');
  assert.equal(calculateScientific('log(1000)+ln(e)'), '4');
  assert.equal(calculateScientific('50%*200'), '100');
});

test('scientific angles and domains are explicit and executable input is rejected', () => {
  assert.equal(calculateScientific('sin(30)'), '0.5');
  assert.equal(calculateScientific('sin(pi/2)', 'radians'), '1');
  assert.equal(calculateScientific('sin(180)'), '0');
  assert.equal(calculateScientific('acos(0)'), '90');
  for (const expression of ['tan(90)', 'sqrt(-1)', 'ln(0)', '(-1)!', '171!', '1/0', '2^10000', 'process.exit()', 'constructor(1)', '1;2']) {
    assert.throws(() => calculateScientific(expression), expression);
  }
  assert.throws(() => calculateScientific('('.repeat(33) + '1' + ')'.repeat(33)), /deeply/);
});

test('programmer calculations retain integer precision, precedence and signed 64-bit behavior', () => {
  assert.equal(evaluateProgrammer('9007199254740993 + 2', 10).decimal, '9007199254740995');
  assert.deepEqual(evaluateProgrammer('FF AND 0F', 16), { decimal: '15', binary: '1111', octal: '17', hex: 'F' });
  assert.equal(evaluateProgrammer('1010 XOR 0011', 2).binary, '1001');
  assert.equal(evaluateProgrammer('1 << 8', 10).hex, '100');
  assert.equal(evaluateProgrammer('8 >> 1 + 1', 10).decimal, '2');
  assert.equal(evaluateProgrammer('7/2', 10).decimal, '3');
  assert.equal(evaluateProgrammer('7%2', 10).decimal, '1');
  assert.equal(evaluateProgrammer('NOT 0', 10).hex, 'FFFFFFFFFFFFFFFF');
  assert.equal(evaluateProgrammer('FFFFFFFFFFFFFFFF + 1', 16).decimal, '0');
  assert.equal(evaluateProgrammer('9223372036854775807 + 1', 10).decimal, '-9223372036854775808');
  for (const [expression, radix] of [['2', 2], ['1 << 64', 10], ['1/0', 10], ['18446744073709551616', 10], ['alert(1)', 16]] as const) {
    assert.throws(() => evaluateProgrammer(expression, radix));
  }
});

test('programmer mode accepts leading-zero hexadecimal values without truncating them as binary prefixes', () => {
  for (const value of ['0BAD', '0BEEF', '0B10A', '0BADC0DE']) {
    assert.equal(evaluateProgrammer(value, 16).decimal, BigInt(`0x${value}`).toString());
  }
  assert.equal(evaluateProgrammer('0xBEEF + 0b10 + 0o7', 10).hex, 'BEF8');
  assert.equal(evaluateProgrammer('0b1010', 16).decimal, '10');
  assert.throws(() => evaluateProgrammer('0b102', 10));
});

test('conversions use correct temperature offsets and distinguish decimal from binary data units', () => {
  assert.equal(convertValue('32', 'temperature', 'f', 'c'), '0');
  assert.equal(convertValue('-40', 'temperature', 'c', 'f'), '-40');
  assert.equal(convertValue('273.15', 'temperature', 'k', 'c'), '0');
  assert.equal(convertValue('1', 'length', 'mi', 'm'), '1609.344');
  assert.equal(convertValue('3+2', 'time', 'h', 'min'), '300');
  assert.equal(convertValue('1', 'data', 'MiB', 'B'), '1048576');
  assert.equal(convertValue('1', 'data', 'MB', 'B'), '1000000');
  assert.throws(() => convertValue('1', 'length', 'm', 'kg'), /compatible/);
});

test('RPN keeps operand order, exact decimals and immutable stack state', () => {
  let state = applyRpn([], '10', 'Enter');
  assert.deepEqual(state, { stack: ['10'], input: '' });
  state = applyRpn(state.stack, '4', '-');
  assert.deepEqual(state, { stack: ['6'], input: '' });
  assert.deepEqual(applyRpn(['0.1'], '0.2', '+').stack, ['0.3']);
  assert.deepEqual(applyRpn(['8'], '2', '/').stack, ['4']);
  assert.deepEqual(applyRpn(['30'], '', 'sin').stack, ['0.5']);
  assert.deepEqual(applyRpn(['4'], '', 'Enter').stack, ['4', '4']);
  assert.deepEqual(applyRpn(['2', '3'], '', 'swap').stack, ['3', '2']);
  const original = ['1'];
  assert.throws(() => applyRpn(original, '0', '/'), /zero/);
  assert.deepEqual(original, ['1']);
  assert.throws(() => applyRpn([], '2', '+'), /two numbers/);
});

test('Math Notes evaluates variables and ans while isolating errors by line', () => {
  const lines = evaluateMathNotes('price = 12.5\nquantity = 4\nprice * quantity =\nans / 2\nunknown + 1\n# Shopping\n\nprice + 1');
  assert.deepEqual(lines.map(line => line.result), ['12.5', '4', '50', '25', undefined, undefined, undefined, '13.5']);
  assert.match(lines[4].error!, /Unknown value/);
  assert.equal(lines[5].error, undefined);
  assert.match(evaluateMathNotes('pi = 2')[0].error!, /reserved/);
  assert.match(evaluateMathNotes('constructor(1)')[0].error!, /Unknown value/);
});
