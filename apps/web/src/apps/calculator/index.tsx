import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownUp, Clipboard, Delete, History, Trash2, X } from 'lucide-react';
import type { AppContext } from '../../../../../packages/contracts/src';
import { Button, Toolbar } from '../../../../../packages/ui/src';
import { useAppCommands, usePreference } from '../hooks';
import { appendCalculatorInput, calculate } from './engine';
import { copyClipboardText } from '../../shell/system';
import { applyRpn, calculateScientific, CONVERSION_CATEGORIES, convertValue, evaluateProgrammer } from './modes';
import { ModeMenu, type CalculatorMode } from './ModeMenu';
import { MathNotes } from './MathNotes';
import '../application.css';
import './calculator.css';

type Radix = 2 | 8 | 10 | 16;
type Calculation = { expression: string; result: string; time: number; mode?: CalculatorMode; radix?: Radix };
const EMPTY_HISTORY: Calculation[] = [];
const DEFAULT_CONVERSION = { category: 'length', from: 'm', to: 'ft' };
const KEYS = ['AC', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='];
const LABELS: Record<string, string> = { AC: 'Clear', '±': 'Change sign', '%': 'Percent', '÷': 'Divide', '×': 'Multiply', '−': 'Subtract', '+': 'Add', '.': 'Decimal point', '=': 'Equals' };
const SCIENTIFIC_KEYS = [
  ['sin', 'sin', 'Sine'], ['cos', 'cos', 'Cosine'], ['tan', 'tan', 'Tangent'], ['(', '(', 'Open parenthesis'], [')', ')', 'Close parenthesis'],
  ['ln', 'ln', 'Natural logarithm'], ['log', 'log', 'Base ten logarithm'], ['sqrt', '√', 'Square root'], ['x²', 'x²', 'Square'], ['^', 'xʸ', 'Power'],
  ['π', 'π', 'Pi'], ['e', 'e', 'Euler’s number'], ['!', 'x!', 'Factorial'], ['1/x', '1/x', 'Reciprocal'], ['abs', '|x|', 'Absolute value'],
];
const BASES = [{ radix: 16, name: 'Hexadecimal', short: 'HEX', key: 'hex' }, { radix: 10, name: 'Decimal', short: 'DEC', key: 'decimal' }, { radix: 8, name: 'Octal', short: 'OCT', key: 'octal' }, { radix: 2, name: 'Binary', short: 'BIN', key: 'binary' }] as const;
const readableExpression = (value: string) => value.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Could not calculate this expression.';

export default function Calculator({ context }: { context: AppContext }) {
  const [expression, setExpression] = useState('0');
  const [previous, setPrevious] = useState('');
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState(false);
  const [mode, setMode] = usePreference<CalculatorMode>(context, 'calculator.mode', 'basic');
  const [angle, setAngle] = usePreference<'degrees' | 'radians'>(context, 'calculator.angle', 'degrees');
  const [radix, setRadix] = usePreference<Radix>(context, 'calculator.radix', 10);
  const [convert, setConvert] = usePreference(context, 'calculator.convert', false);
  const [conversion, setConversion] = usePreference(context, 'calculator.conversion', DEFAULT_CONVERSION);
  const [rpn, setRpn] = usePreference(context, 'calculator.rpn', false);
  const [stack, setStack] = useState<string[]>([]);
  const [history, setHistory] = usePreference(context, 'calculator.history', EMPTY_HISTORY);
  const [historyOpen, setHistoryOpen] = useState(false);
  const expressionInput = useRef<HTMLInputElement>(null);
  const historyClose = useRef<HTMLButtonElement>(null);
  const historyId = useId();
  const category = CONVERSION_CATEGORIES.find(item => item.id === conversion.category) || CONVERSION_CATEGORIES[0];
  const fromUnit = category.units.find(item => item.id === conversion.from) || category.units[0];
  const toUnit = category.units.find(item => item.id === conversion.to) || category.units[1];
  const activeBase = BASES.find(item => item.radix === radix) || BASES[1];
  let baseValues: ReturnType<typeof evaluateProgrammer> | null = null;
  if (mode === 'programmer') { try { baseValues = evaluateProgrammer(expression, radix); } catch { /* An incomplete expression has no preview. */ } }
  let convertedValue = '—';
  if (convert) { try { convertedValue = convertValue(calculateScientific(expression, angle), category.id, fromUnit.id, toUnit.id); } catch { /* Keep incomplete input editable. */ } }

  useEffect(() => {
    if (!historyOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    historyClose.current?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [historyOpen]);

  const clear = () => { setExpression(rpn ? '' : '0'); setPrevious(''); setError(''); setFresh(false); setStack([]); };
  const backspace = () => { setExpression(value => value.slice(0, -1) || (rpn ? '' : '0')); setError(''); setFresh(false); };
  function chooseMode(next: CalculatorMode) {
    setMode(next); setHistoryOpen(false); setExpression('0'); setPrevious(''); setError(''); setFresh(false); setStack([]);
    if (next === 'programmer' || next === 'notes') { setConvert(false); setRpn(false); }
  }
  function evaluate() {
    if (mode === 'programmer') return evaluateProgrammer(expression, radix)[activeBase.key];
    if (mode === 'scientific') return calculateScientific(expression, angle);
    return calculate(expression);
  }
  function remember(source: string, result: string) {
    setHistory([{ expression: source, result, time: Date.now(), mode, radix }, ...history].slice(0, 40));
  }
  async function copy() {
    try {
      const result = convert ? convertedValue : rpn ? expression || stack.at(-1) || '0' : evaluate();
      if (result === '—') throw new Error('Enter a value first.');
      await copyClipboardText(result, 'copy');
      context.services.notify({ title: 'Calculator', message: 'Result copied.', tone: 'success' });
    } catch { context.services.notify({ title: 'Calculator', message: 'The result could not be copied. Select the expression to copy it manually.', tone: 'error' }); }
  }
  function runRpn(key: string) {
    try {
      const next = applyRpn(stack, expression, key, angle);
      if (!['Enter', 'drop', 'swap', 'clear'].includes(key) && next.stack.length) remember([...stack.slice(-2), expression, key].filter(Boolean).join(' '), next.stack.at(-1)!);
      setStack(next.stack); setExpression(next.input); setFresh(false); setError('');
    } catch (cause) { setError(message(cause)); }
  }
  function press(key: string) {
    if (key === 'AC' || key === 'Escape') { clear(); return; }
    if (key === 'Backspace') { backspace(); return; }
    if (rpn && ['=', 'Enter', '+', '−', '×', '÷', '-', '*', '/', '±', '%'].includes(key)) { runRpn(key === '=' ? 'Enter' : key); return; }
    if (key === '=' || key === 'Enter') {
      try { const result = evaluate(); remember(expression, result); setPrevious(expression + ' ='); setExpression(result); setFresh(true); setError(''); }
      catch (cause) { setError(message(cause)); }
      return;
    }
    setError('');
    if (key === '±') { setExpression(value => value.startsWith('-(') && value.endsWith(')') ? value.slice(2, -1) : `-(${value})`); setFresh(false); return; }
    const normalized = key.replace('÷', '/').replace('×', '*').replace('−', '-');
    if (mode === 'programmer') {
      if (/^[0-9A-F]$/i.test(normalized) && parseInt(normalized, 16) >= radix) return;
      if (normalized === '.') return;
      setExpression(value => (fresh && /^[0-9a-f]$/i.test(normalized) || value === '0' && /^[0-9a-f]$/i.test(normalized) ? '' : value) + normalized);
    } else {
      setExpression(value => appendCalculatorInput(fresh && /^[\d.(]$/.test(normalized) ? '' : value, normalized));
    }
    setFresh(false);
  }
  function scientific(key: string) {
    if (rpn) {
      if (key === 'π' || key === 'e') { setExpression(calculateScientific(key)); setError(''); }
      else runRpn(key === '^' ? '^' : key === '!' ? '!' : key);
      return;
    }
    setError('');
    if (key === '(' || key === ')') { press(key); return; }
    if (key === 'π' || key === 'e') setExpression(value => fresh || value === '0' ? key : `${value}${/[\d)πe!]$/.test(value) ? '*' : ''}${key}`);
    else if (key === '^') setExpression(value => `(${value || '0'})^`);
    else if (key === 'x²') setExpression(value => `(${value || '0'})^2`);
    else if (key === '!') setExpression(value => `(${value || '0'})!`);
    else if (key === '1/x') setExpression(value => `1/(${value || '0'})`);
    else setExpression(value => `${key}(${value || '0'})`);
    setFresh(false);
  }
  function chooseBase(next: typeof BASES[number]) {
    try { const values = evaluateProgrammer(expression, radix); setExpression(values[next.key]); setRadix(next.radix); setPrevious(''); setFresh(true); setError(''); }
    catch (cause) { setError(message(cause)); }
  }
  const commands = [
    { id: 'calculator.clear' as const, label: 'Clear', shortcut: 'Escape', execute: clear },
    { id: 'calculator.backspace' as const, label: 'Backspace', shortcut: 'Backspace', enabled: expression !== '0' && mode !== 'notes', execute: backspace },
    { id: 'calculator.copy' as const, label: 'Copy Result', shortcut: 'Mod+C', enabled: !error && mode !== 'notes', execute: copy },
    { id: 'calculator.history' as const, label: 'Show History', checked: historyOpen, execute: () => setHistoryOpen(!historyOpen) },
    { id: 'calculator.clear-history' as const, label: 'Clear History', enabled: history.length > 0, execute: () => setHistory([]) },
  ];
  useAppCommands(context, commands);

  return <div className={`lope-app calculator-view calculator-${mode}${convert ? ' is-converting' : ''}${rpn ? ' is-rpn' : ''}`} data-testid="calculator-app" tabIndex={0} aria-label="Calculator" onKeyDown={event => {
    const target = event.target as HTMLElement;
    if (historyOpen) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setHistoryOpen(false); } return; }
    if (target === expressionInput.current) {
      if (((event.metaKey || event.ctrlKey) && ['w', 'k'].includes(event.key.toLowerCase())) || (event.altKey && event.key === 'F10')) return;
      event.stopPropagation();
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); press(event.key); }
      if (rpn && ['+', '-', '*', '/'].includes(event.key)) { event.preventDefault(); press(event.key); }
      return;
    }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || mode === 'notes') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Enter' && target.tagName === 'BUTTON') return;
    if (/^[\d+\-*/().%=]$/.test(event.key) || (mode === 'programmer' && /^[a-f]$/i.test(event.key)) || ['Enter', 'Backspace', 'Escape', 'Delete'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); press(event.key === 'Delete' ? 'AC' : event.key); }
  }}>
    <Toolbar>
      <ModeMenu mode={mode} onMode={chooseMode} convert={convert} onConvert={() => { setConvert(!convert); setRpn(false); setExpression('0'); setError(''); setPrevious(''); }} rpn={rpn} onRpn={() => { setRpn(!rpn); setConvert(false); setExpression(rpn ? '0' : ''); setStack([]); setError(''); setPrevious(''); }}/>
      <div className="control-group">
        {mode !== 'notes' && <Button aria-label="Copy result" title="Copy result" disabled={Boolean(error)} onClick={() => { void copy(); }}><Clipboard size={16} strokeWidth={1.7}/></Button>}
        <Button aria-label="Show calculation history" title="Calculation history" aria-expanded={historyOpen} aria-controls={historyId} onClick={() => setHistoryOpen(!historyOpen)}><History size={17} strokeWidth={1.7}/></Button>
      </div>
    </Toolbar>
    {mode === 'notes' ? <div className="calculator-body" inert={historyOpen}><MathNotes context={context}/></div> : <div className="calculator-body" inert={historyOpen}>
      {rpn && <section className="calculator-stack" aria-label="RPN stack"><div className="calculator-stack-heading"><span>Stack</span><div><button type="button" onClick={() => runRpn('swap')} disabled={stack.length < 2}>Swap</button><button type="button" onClick={() => runRpn('drop')} disabled={!stack.length}>Drop</button></div></div>{stack.length ? <ol>{stack.slice(-3).map((value, index) => <li key={index}><span>{Math.max(0, stack.length - 3) + index + 1}</span><output>{value}</output></li>)}</ol> : <p>Enter a number, then press enter.</p>}</section>}
      {convert ? <div className="calculator-converter">
        <select aria-label="Conversion category" value={category.id} onChange={event => { const next = CONVERSION_CATEGORIES.find(item => item.id === event.target.value)!; setConversion({ category: next.id, from: next.units[0].id, to: next.units[1].id }); }}>{CONVERSION_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        <div className="calculator-conversion-value"><input ref={expressionInput} aria-label="Value to convert" inputMode="decimal" autoComplete="off" value={expression} onChange={event => { if (event.target.value.length <= 512 && /^[\d\s.eE+\-*/()%×÷−]*$/.test(event.target.value)) { setExpression(event.target.value); setFresh(false); setError(''); } }}/><select aria-label="From unit" value={fromUnit.id} onChange={event => setConversion({ category: category.id, from: event.target.value, to: toUnit.id })}>{category.units.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
        <div className="calculator-conversion-divider"><span/><button type="button" aria-label="Swap conversion units" onClick={() => setConversion({ category: category.id, from: toUnit.id, to: fromUnit.id })}><ArrowDownUp size={16}/></button></div>
        <div className="calculator-conversion-value"><output aria-label="Converted value" aria-live="polite">{convertedValue}</output><select aria-label="To unit" value={toUnit.id} onChange={event => setConversion({ category: category.id, from: fromUnit.id, to: event.target.value })}>{category.units.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
        <div className="calculator-feedback" role="status" aria-live="polite">{error}</div>
      </div> : <div className={`calculator-display${error ? ' has-error' : ''}`}>
        <span className="calculator-previous" title={readableExpression(previous)}>{readableExpression(previous) || '\u00a0'}</span>
        <input ref={expressionInput} aria-label="Expression" aria-invalid={Boolean(error)} inputMode={mode === 'programmer' || mode === 'scientific' ? 'text' : 'decimal'} autoComplete="off" spellCheck={false} value={expression} placeholder={rpn ? stack.at(-1) || '0' : undefined} style={{ '--display-size': `${Math.max(27, Math.min(64, 480 / Math.max(expression.length, 1)))}px` } as CSSProperties} onChange={event => {
          const pattern = mode === 'programmer' ? /^[\da-z\s+\-*/()%<>&|^~]*$/i : mode === 'scientific' ? /^[\da-z\s.π+\-*/()%×÷−^!,]*$/i : /^[\d\s.eE+\-*/()%×÷−]*$/;
          if (event.target.value.length <= 512 && pattern.test(event.target.value)) { setExpression(event.target.value); setFresh(false); setError(''); }
        }}/>
        <div className="calculator-display-actions"><div className="calculator-feedback" role="status" aria-live="polite">{error || <span className="calculator-sr-only">{fresh ? `Result: ${expression}` : rpn && stack.length ? `Stack result: ${stack.at(-1)}` : ''}</span>}</div><Button aria-label="Backspace" title="Delete last digit" onClick={backspace}><Delete size={19} strokeWidth={1.6}/></Button></div>
      </div>}
      {mode === 'scientific' && !convert && <section className="calculator-scientific-functions" aria-label="Scientific functions"><div className="calculator-function-heading"><span>Angle</span><div role="group" aria-label="Angle unit"><button type="button" aria-label="Degrees" aria-pressed={angle === 'degrees'} onClick={() => setAngle('degrees')}>Deg</button><button type="button" aria-label="Radians" aria-pressed={angle === 'radians'} onClick={() => setAngle('radians')}>Rad</button></div></div><div className="calculator-function-grid">{SCIENTIFIC_KEYS.map(([key, label, name]) => <button key={key} type="button" aria-label={name} disabled={rpn && (key === '(' || key === ')')} onClick={() => scientific(key)}>{label}</button>)}</div></section>}
      {mode === 'programmer' && <section className="calculator-programmer-tools" aria-label="Programmer tools"><div className="calculator-bases">{BASES.map(base => <button type="button" key={base.radix} aria-label={base.name} aria-pressed={radix === base.radix} onClick={() => chooseBase(base)}><span>{base.short}</span><output title={baseValues?.[base.key]}>{baseValues?.[base.key] || '—'}</output></button>)}</div><div className="calculator-bitwise-keys">{['A', 'B', 'C', 'D', 'E', 'F'].map(key => <button key={key} type="button" aria-label={`Hex digit ${key}`} disabled={radix !== 16} onClick={() => press(key)}>{key}</button>)}{['AND', 'OR', 'XOR', 'NOT', '<<', '>>'].map(key => <button key={key} type="button" aria-label={key === '<<' ? 'Shift left' : key === '>>' ? 'Shift right' : key} onClick={() => { setExpression(value => key === 'NOT' ? `NOT (${value})` : value + ` ${key} `); setFresh(false); setError(''); }}>{key}</button>)}</div></section>}
      <div className="calculator-pad">{KEYS.map(key => <button type="button" key={key} aria-label={rpn && key === '=' ? 'Push to stack' : mode === 'programmer' && key === '%' ? 'Remainder' : LABELS[key] || key} disabled={mode === 'programmer' && (key === '.' || /^\d$/.test(key) && Number(key) >= radix)} className={`${['÷', '×', '−', '+', '='].includes(key) ? 'operator' : ''} ${['AC', '±', '%'].includes(key) ? 'utility' : ''} ${key === '0' ? 'zero' : ''} ${key === '=' ? 'equals' : ''}`} onClick={() => press(key)}>{rpn && key === '=' ? <span className="calculator-enter-label">enter</span> : key}</button>)}</div>
    </div>}
    {historyOpen && <section id={historyId} className="calculator-history" aria-label="Calculation history"><div className="history-heading"><h2>History</h2><div className="control-group"><Button aria-label="Clear calculation history" title="Clear history" disabled={!history.length} onClick={() => setHistory([])}><Trash2 size={16} strokeWidth={1.7}/></Button><button ref={historyClose} className="ui-button" type="button" aria-label="Close history" title="Close history" onClick={() => setHistoryOpen(false)}><X size={17} strokeWidth={1.7}/></button></div></div>{!history.length ? <div className="calculator-history-empty"><History size={32} strokeWidth={1.2}/><h3>No calculations yet</h3><p>Your results will appear here.</p></div> : <ol>{history.map((item, index) => <li key={`${item.time}-${index}`}><button type="button" aria-label={`Use result ${item.result}`} onClick={() => { setMode(item.mode || 'basic'); setRadix(item.radix || 10); setConvert(false); setRpn(false); setExpression(item.result); setPrevious(item.expression + ' ='); setError(''); setFresh(true); setHistoryOpen(false); }}><span>{readableExpression(item.expression)} =</span><strong>{item.result}</strong></button></li>)}</ol>}</section>}
  </div>;
}
