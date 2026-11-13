import { useMemo } from 'react';
import { NotebookPen } from 'lucide-react';
import type { AppContext } from '../../../../../packages/contracts/src';
import { usePreference } from '../hooks';
import { evaluateMathNotes } from './modes';

export function MathNotes({ context }: { context: AppContext }) {
  const [source, setSource] = usePreference(context, 'calculator.mathNotes', '');
  const lines = useMemo(() => evaluateMathNotes(source), [source]);
  return <section className="calculator-notes" aria-label="Math Notes">
    <header><NotebookPen size={22} strokeWidth={1.4}/><div><h2>Math Notes</h2><span>Saved on this device</span></div></header>
    <p className="calculator-notes-help">Write a calculation on each line. Name a value to use it later, like <code>price = 24</code>.</p>
    <textarea aria-label="Math notes" placeholder={'price = 24\nquantity = 3\nprice * quantity'} value={source} spellCheck={false} autoComplete="off" onChange={event => { if (event.target.value.length <= 20000) setSource(event.target.value); }}/>
    <section className="calculator-note-results" aria-label="Math note results" aria-live="polite">
      <h3>Results</h3>
      {source.trim() ? lines.map((line, index) => line.line.trim() && <div className={`calculator-note-result${line.error ? ' has-error' : ''}`} key={index}><span className="calculator-note-number">{index + 1}</span><span className="calculator-note-expression">{line.line}</span><strong>{line.error || line.result || '—'}</strong></div>) : <p>Results appear as you write.</p>}
    </section>
  </section>;
}
