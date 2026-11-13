import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationAliases, getCalculationError, getInstantAnswer, matchScore, looksLikeFileQuery } from '../../apps/web/src/shell/spotlight-engine.ts';

test('Spotlight computes exact decimals, percentages and natural arithmetic', () => {
  assert.equal(getInstantAnswer('0.1 + 0.2')?.value, '0.3');
  assert.equal(getInstantAnswer('(7 − 3) × 2')?.value, '8');
  assert.equal(getInstantAnswer('15% of 80')?.value, '12');
  assert.equal(getInstantAnswer('20% off 150')?.value, '120');
  assert.equal(getInstantAnswer('12 plus 5 times 2')?.value, '22');
  assert.equal(getInstantAnswer('= 1e3 / 4 =')?.value, '250');
});

test('Spotlight scientific calculations respect precedence and only allow known functions', () => {
  assert.equal(getInstantAnswer('2^3^2')?.value, '512');
  assert.equal(getInstantAnswer('-2^2')?.value, '-4');
  assert.equal(getInstantAnswer('2^-3')?.value, '0.125');
  assert.equal(getInstantAnswer('(-2)^2')?.value, '4');
  assert.equal(getInstantAnswer('2^-2^2')?.value, '0.0625');
  assert.equal(getInstantAnswer('2^3*4')?.value, '32');
  assert.equal(getInstantAnswer('2*3^2')?.value, '18');
  assert.equal(getInstantAnswer('sqrt(144) + abs(-5)')?.value, '17');
  assert.equal(getInstantAnswer('max(1, 7, 3)')?.value, '7');
  assert.equal(getInstantAnswer('sin(pi/2)')?.value, '1');
  assert.match(getInstantAnswer('sin(pi/2)')!.detail, /radians/);
  assert.equal(Number(getInstantAnswer('e * 2')?.value), Number((Math.E * 2).toPrecision(14)));
  for (const text of ['process.exit()', 'window.alert(1)', 'constructor(1)', 'sqrt(-1)', '10^1000', 'min()', '1 / 10^1000', 'min(1, 10^1000)', 'min(1, 1e308 / 1e-308)', '10^-1000', 'sqrt(1e-999)', '(-1)^0.5']) {
    assert.equal(getInstantAnswer(text), null, text);
  }
});

test('Spotlight distinguishes incomplete math from searches and bounds hostile input', () => {
  assert.match(getCalculationError('1 / 0')!, /divide by zero/i);
  assert.match(getCalculationError('sqrt(16')!, /parenthesis/i);
  assert.equal(getCalculationError('latest news'), null);
  assert.equal(getInstantAnswer('2026'), null);
  assert.equal(getInstantAnswer('calculator'), null);
  assert.equal(getInstantAnswer('1+'.repeat(300)), null);
  assert.equal(getInstantAnswer('sqrt('.repeat(40) + '1' + ')'.repeat(40)), null);
  assert.equal(getInstantAnswer('2^'.repeat(100) + '2'), null);
  assert.equal(getInstantAnswer('1' + ' '.repeat(100000) + 'km to m'), null);
  assert.equal(getInstantAnswer('9'.repeat(100000) + '+1'), null);
  assert.match(getCalculationError('1+'.repeat(100000))!, /too long/i);
  assert.equal(getCalculationError('A long web search query '.repeat(10000)), null);
  assert.equal(getInstantAnswer('1' + ' '.repeat(490) + 'km to m')?.value, '1000 m');
});

test('Spotlight converts compatible units, temperatures, and binary storage', () => {
  assert.equal(getInstantAnswer('5 km to m')?.value, '5000 m');
  assert.equal(getInstantAnswer('10 miles in km')?.value, '16.09344 km');
  assert.equal(getInstantAnswer('1,000 mm to m')?.value, '1 m');
  assert.equal(getInstantAnswer('1 lb to g')?.value, '453.59237 g');
  assert.equal(getInstantAnswer('2 h to min')?.value, '120 min');
  assert.equal(getInstantAnswer('72°F to C')?.value, '22.222222222222 °C');
  assert.equal(getInstantAnswer('0 C to F')?.value, '32 °F');
  assert.equal(getInstantAnswer('273.15 kelvin to C')?.value, '0 °C');
  assert.equal(getInstantAnswer('1 GiB to MiB')?.value, '1024 MiB');
  assert.equal(getInstantAnswer('1 GB to MB')?.value, '1000 MB');
  assert.equal(getInstantAnswer('8 Mb to MB')?.value, '1 MB');
  assert.equal(getInstantAnswer('1 byte to bits')?.value, '8 b');
  assert.equal(getInstantAnswer('1 GiB to Gib')?.value, '8 Gib');
  assert.equal(getInstantAnswer('36 km/h to m/s')?.value, '10 m/s');
  assert.equal(getInstantAnswer('1 gallon to l')?.value, '3.785411784 L');
  for (const text of ['5 kg to km', '100 USD to EUR', '-300 C to F', '1e309 km to m', '1 constructor to C', '1 C to constructor', '1 strange to m', '1234,567 m to km', '1,00 m to km']) assert.equal(getInstantAnswer(text), null, text);
});

test('Spotlight ranks names, aliases, abbreviations, and fuzzy matches predictably', () => {
  assert.ok(matchScore('calc', 'Calculator') > matchScore('calc', 'Notes', 'Make calculations'));
  assert.ok(matchScore('terminal', 'Terminal') > matchScore('terminal', 'Terminal settings'));
  assert.ok(matchScore('safari', 'Lope Browser', '', applicationAliases('lope.browser')) > 0);
  assert.ok(matchScore('te', 'Text Editor') > 0);
  assert.ok(matchScore('clcltr', 'Calculator') > 0);
  assert.ok(matchScore('cafe', 'Café') > 0);
  assert.equal(matchScore('banana', 'Calculator', 'Everyday numbers'), 0);
  assert.deepEqual(applicationAliases('constructor'), []);
});

test('Spotlight tolerates bounded name typos without broadening unrelated queries', () => {
  for (const query of ['calcuulator', 'calcualtor', 'calxulator', 'calclator', 'calxxlator']) {
    const score = matchScore(query, 'Calculator');
    assert.ok(score > 0, query);
    assert.ok(score < matchScore('calc', 'Calculator'), query);
    assert.ok(score < matchScore('calc', 'Calculator', '', ['calc']), query);
  }
  assert.ok(matchScore('calcuulator', 'Calculator') > matchScore('calxxlator', 'Calculator'));
  assert.ok(matchScore('fiels', 'Files') > 0);
  assert.ok(matchScore('browzer', 'Lope Browser') > 0);
  assert.ok(matchScore('text edtor', 'Text Editor') > 0);
  assert.equal(matchScore('faxes', 'Files'), 0);
  assert.equal(matchScore('calxyzlator', 'Calculator'), 0);
  assert.equal(matchScore('calcuulator reviews', 'Calculator'), 0);
  assert.equal(matchScore('calcuulator', 'Notes', 'Calculator'), 0);
  assert.equal(matchScore('calcuulator', 'Notes', '', ['Calculator']), 0);
  assert.equal(matchScore('x'.repeat(100000), 'Calculator'), 0);
});

test('Spotlight reserves workspace paths and file names without treating questions or URLs as files', () => {
  for (const query of ['notes.txt', '/Documents/project plan.md', 'holiday photo.jpg', 'app.tsx']) assert.equal(looksLikeFileQuery(query), true, query);
  for (const query of ['Explain a rainbow', 'hello', 'example.com', 'https://example.com', 'https://example.com/report.pdf', '15% of 80']) assert.equal(looksLikeFileQuery(query), false, query);
});
