import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Accessibility, ArrowLeft, ArrowRight, Calculator, ChartColumn, Check, ChevronDown, CircleAlert, FileCheck2, Globe2, Grid3X3, Keyboard, LayoutTemplate, List, LockKeyhole, Palette, PanelTop, Save, Search, Shield, SlidersHorizontal, SpellCheck, X } from 'lucide-react';
import type { AppContext } from '../../../../../packages/contracts/src';
import { usePreferences as useSystemPreferences } from '../../../../../packages/sdk/src/preferences';
import type { Workbook } from '../../../../../packages/spreadsheet-engine/src/model';
import type { SheetPreferences } from './preferences';
import './preferences.css';

type Category = 'home' | 'general' | 'view' | 'ribbon' | 'autocorrect' | 'charts' | 'accessibility' | 'languages' | 'calculation' | 'errors' | 'lists' | 'autocomplete' | 'save' | 'compatibility' | 'security' | 'privacy' | 'pride';
type Update = <K extends keyof SheetPreferences>(key: K, value: SheetPreferences[K]) => void;
export interface PreferencesWindowProps {
  preferences: SheetPreferences; update: Update; context: AppContext; workbook: Workbook;
  onWorkbookChange(patch: Partial<Pick<Workbook, 'calculationMode' | 'dateSystem'>>): void;
  onAction(id: string): void; onClose(): void;
}
const groups = [
  { title: 'Authoring', items: [
    { id: 'general', title: 'General', icon: SlidersHorizontal, color: 'silver', terms: 'default font font size sheets new workbooks zoom gallery appearance theme extensions name units sounds' },
    { id: 'view', title: 'View', icon: PanelTop, color: 'silver', terms: 'formula bar status bar sheet tabs headings gridlines color zero formulas scroll bars notes objects drawings' },
    { id: 'ribbon', title: 'Ribbon & Toolbar', icon: LayoutTemplate, color: 'slate', terms: 'classic collapse group titles customize quick access save undo redo open print calculate' },
    { id: 'autocorrect', title: 'AutoCorrect', icon: SpellCheck, color: 'blue', terms: 'replace text spelling capitals sentences days hyperlinks autoformat typing' },
    { id: 'charts', title: 'Charts', icon: ChartColumn, color: 'green', terms: 'chart default column bar line area scatter pie doughnut legend labels hover tips values' },
    { id: 'accessibility', title: 'Accessibility', icon: Accessibility, color: 'blue', terms: 'larger controls surfaces reduce motion announcements cell coordinates screen reader status alt text' },
    { id: 'languages', title: 'Languages', icon: Globe2, color: 'globe', terms: 'locale numbers dates regional display language english german french spanish japanese chinese' },
  ] },
  { title: 'Formulas and Lists', items: [
    { id: 'calculation', title: 'Calculation', icon: Calculator, color: 'silver', terms: 'automatic manual recalculate date 1900 1904 iteration precision r1c1 threads' },
    { id: 'errors', title: 'Error Checking', icon: CircleAlert, color: 'green', terms: 'background formula errors numbers stored text empty references indicators' },
    { id: 'lists', title: 'Custom Lists', icon: List, color: 'silver', terms: 'fill sort list weekdays months import entries custom' },
    { id: 'autocomplete', title: 'AutoComplete', icon: Keyboard, color: 'blue', terms: 'suggestions typing cell values function names minimum letters enter direction fill handle' },
  ] },
  { title: 'Sharing and Privacy', items: [
    { id: 'save', title: 'Save', icon: Save, color: 'silver', terms: 'autorecover recovery interval seconds minutes background save format xlsx lopebook' },
    { id: 'compatibility', title: 'Compatibility', icon: FileCheck2, color: 'blue', terms: 'excel files native workbook format xlsx csv export conversion warnings legacy' },
    { id: 'security', title: 'Security', icon: LockKeyhole, color: 'gold', terms: 'macros vba xlm external hyperlinks warning password protected encryption' },
    { id: 'privacy', title: 'Privacy', icon: Shield, color: 'blue', terms: 'local data cloud connected experiences diagnostic telemetry recovery storage clear' },
    { id: 'pride', title: 'Show Your Pride', icon: Palette, color: 'rainbow', terms: 'default rainbow transgender nonbinary accent pride' },
  ] },
] as const;
const categories = groups.flatMap(group => [...group.items]);
const titleFor = (id: Category) => id === 'home' ? 'Sheets Preferences' : categories.find(category => category.id === id)?.title ?? 'Sheets Preferences';
const normalizeSearch = (value: string) => value.toLocaleLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const section = (title: string, children: ReactNode) => <section className="sp-pref-section"><h2>{title}</h2>{children}</section>;
const note = (text: string) => <p className="sp-pref-note">{text}</p>;
const unavailable = (label: string, reason: string, checked = false) => <div className="sp-pref-unavailable"><label className="sp-pref-check" title={reason}><input type="checkbox" checked={checked} readOnly disabled aria-description={reason}/><span>{label}</span></label><p>{reason}</p></div>;
const fontNames = ['Aptos', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'monospace'];
const ribbonTabs = ['Home', 'Insert', 'Page Layout', 'Formulas', 'Data', 'Review', 'View', 'Help'];
const quickCommands = [['save', 'Save'], ['undo', 'Undo'], ['redo', 'Redo'], ['open', 'Open'], ['print', 'Print Preview'], ['recalculate', 'Calculate Now']] as const;

function NumberSetting({ value, label, min, max, step = 1, disabled, commit }: { value: number; label: string; min: number; max: number; step?: number; disabled?: boolean; commit(value: number): void }) {
  const [draft, setDraft] = useState(String(value)), [invalid, setInvalid] = useState(false), editing = useRef(false), dirty = useRef(false);
  useEffect(() => { if (!editing.current) { setDraft(String(value)); setInvalid(false); } }, [value]);
  const finish = () => {
    editing.current = false;
    if (!dirty.current) { setDraft(String(value)); return; }
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < min || next > max || step === 1 && !Number.isInteger(next)) { setInvalid(true); return; }
    commit(next); setDraft(String(next)); setInvalid(false); dirty.current = false;
  };
  return <span className="sp-pref-number"><input type="number" aria-label={label} value={draft} min={min} max={max} step={step} disabled={disabled} aria-invalid={invalid || undefined} onFocus={() => { editing.current = true; dirty.current = false; }} onChange={event => { setDraft(event.target.value); dirty.current = true; setInvalid(false); }} onBlur={finish} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); finish(); event.currentTarget.blur(); } }}/>{invalid && <small role="alert">Enter {min}–{max}{step === 1 ? ' as a whole number' : ''}.</small>}</span>;
}

export function PreferencesWindow({ preferences: p, update, workbook, onWorkbookChange, onAction, onClose }: PreferencesWindowProps) {
  const system = useSystemPreferences(), root = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  const [deviceDark, setDeviceDark] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  const [history, setHistory] = useState<Category[]>(['home']), [historyIndex, setHistoryIndex] = useState(0), [query, setQuery] = useState('');
  const [correctionTab, setCorrectionTab] = useState('AutoCorrect'), [from, setFrom] = useState(''), [to, setTo] = useState(''), [selectedReplacement, setSelectedReplacement] = useState<string | null>(null);
  const [selectedList, setSelectedList] = useState(-1), [listDraft, setListDraft] = useState(''), [listError, setListError] = useState(''), [recoveryUnit, setRecoveryUnit] = useState(p.recoveryInterval >= 60 ? 60 : 1), [privacyDetails, setPrivacyDetails] = useState(false);
  const category = history[historyIndex], systemTheme = system.theme === 'system' ? deviceDark ? 'dark' : 'light' : system.theme, theme = p.appearance === 'system' ? systemTheme : p.appearance === 'dark' ? 'dark' : 'light';
  const textScale = Math.max(1, system.textSize / 100), reducedMotion = system.reduceMotion || p.reduceMotion;
  useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'), change = () => setDeviceDark(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement; const surface = root.current, owner = surface?.closest('.sheets-app'); root.current?.focus({ preventScroll: true });
    return () => { const active = document.activeElement; if (active && active !== document.body && !surface?.contains(active)) return; if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); else owner?.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [category, query]);
  const go = (next: Category) => { if (next !== category) { setHistory([...history.slice(0, historyIndex + 1), next]); setHistoryIndex(historyIndex + 1); } setQuery(''); requestAnimationFrame(() => body.current?.focus({ preventScroll: true })); };
  const back = () => { if (historyIndex > 0) { setHistoryIndex(historyIndex - 1); setQuery(''); } }, forward = () => { if (historyIndex < history.length - 1) { setHistoryIndex(historyIndex + 1); setQuery(''); } };
  const check = (key: keyof SheetPreferences, label: string, disabled = false) => <label className="sp-pref-check" data-setting={key}><input type="checkbox" checked={Boolean(p[key])} disabled={disabled} onChange={event => update(key, event.target.checked as never)}/><span>{label}</span></label>;
  const select = <K extends keyof SheetPreferences>(key: K, label: string, values: readonly (readonly [SheetPreferences[K], string])[]) => <label className="sp-pref-select" data-setting={key}><span>{label}</span><span className="sp-pref-select-control"><select aria-label={label} value={String(p[key])} onChange={event => update(key, event.target.value as SheetPreferences[K])}>{values.map(([value, text]) => <option key={String(value)} value={String(value)}>{text}</option>)}</select><ChevronDown size={15}/></span></label>;
  const number = (key: keyof SheetPreferences, label: string, min: number, max: number, step = 1) => <div className="sp-pref-select" data-setting={key}><span>{label}</span><NumberSetting label={label} value={Number(p[key])} min={min} max={max} step={step} commit={value => update(key, value as never)}/></div>;
  const color = (key: keyof SheetPreferences, label: string) => <label className="sp-pref-select sp-pref-color" data-setting={key}><span>{label}</span><input type="color" aria-label={label} value={String(p[key])} onChange={event => update(key, event.target.value as never)}/><code>{String(p[key]).toUpperCase()}</code></label>;
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean), results = categories.filter(item => words.every(word => normalizeSearch(`${item.title} ${item.terms}`).includes(word)));
  function categoryKeys(event: KeyboardEvent<HTMLElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']; if (!keys.includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')], index = buttons.indexOf(document.activeElement as HTMLButtonElement), columns = getComputedStyle(event.currentTarget).gridTemplateColumns.split(' ').length;
    if (index < 0) return; event.preventDefault(); const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + step))]?.focus();
  }
  function addList() {
    const entries = listDraft.split(/[\n,]/).map(value => value.trim()).filter(Boolean);
    if (entries.length < 2 || entries.length > 1000) { setListError('Use 2–1,000 entries, separated by line breaks or commas.'); return; }
    const lists = [...p.customLists]; if (selectedList < 0) { lists.push(entries); setSelectedList(lists.length - 1); } else lists[selectedList] = entries;
    update('customLists', lists); setListDraft(entries.join('\n')); setListError('');
  }
  function closeKey(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); search.current?.focus(); search.current?.select(); return; }
    if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); back(); return; }
    if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); forward(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]') ?? [])].filter(element => element.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); root.current?.focus(); return; }
    const first = focusable[0], last = focusable.at(-1)!;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first.focus(); }
  }
  return <div className="sheets-preferences-backdrop"><section ref={root} className="sheets-preferences glass" role="dialog" aria-modal="true" aria-label="Sheets Preferences" tabIndex={-1} data-theme={theme} data-appearance={theme} data-large-controls={p.largerControls} data-increase-contrast={system.increaseContrast} data-reduce-motion={reducedMotion} style={{ '--sp-pref-scale': textScale } as CSSProperties} onKeyDown={closeKey}>
    <header className="sp-preferences-toolbar glass-inset">
      <div className="sp-pref-history"><button type="button" aria-label="Previous preferences pane" disabled={historyIndex === 0} onClick={back}><ArrowLeft size={18}/></button><button type="button" aria-label="Next preferences pane" disabled={historyIndex === history.length - 1} onClick={forward}><ArrowRight size={18}/></button></div>
      <button type="button" className="sp-pref-show-all" aria-label="Show all preferences" onClick={() => go('home')}><Grid3X3 size={18}/></button>
      <h1>{query ? 'Search Preferences' : titleFor(category)}</h1>
      <label className="sp-pref-search"><Search size={16}/><input ref={search} aria-label="Search preferences" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }}/>{query && <button type="button" aria-label="Clear preferences search" onClick={() => { setQuery(''); search.current?.focus(); }}><X size={14}/></button>}</label>
      <button type="button" className="sp-pref-close" aria-label="Close Preferences" onClick={onClose}><X size={17}/></button>
    </header>
    <div ref={body} className={`sp-preferences-body ${category === 'home' && !query ? 'sp-preferences-home' : ''}`} tabIndex={-1}>
      {query ? <div className="sp-pref-search-results"><h2>{results.length ? `Results for “${query}”` : 'No matching preferences'}</h2>{results.map(item => <button type="button" key={item.id} onClick={() => go(item.id)}><span className={`sp-pref-icon sp-pref-icon-${item.color}`}><item.icon size={26}/></span><span><strong>{item.title}</strong><small>{item.terms.split(' ').slice(0, 9).join(' · ')}</small></span><ArrowRight size={16}/></button>)}{!results.length && note('Try a setting such as gridlines, recovery, font, or calculation.')}</div>
        : category === 'home' ? groups.map(group => <section className="sp-pref-category-section" key={group.title}><h2>{group.title}</h2><div className="sp-pref-category-grid" onKeyDown={categoryKeys}>{group.items.map(item => <button key={item.id} type="button" onClick={() => go(item.id)}><span className={`sp-pref-icon sp-pref-icon-${item.color}`}><item.icon size={28}/></span><span>{item.title}</span></button>)}</div></section>)
          : <div className="sp-pref-pane">
            {category === 'general' && <>
              {section('Settings', <>{check('showStartScreen', 'Show Workbook Gallery when opening Sheets')}{check('showExtensions', 'Show file extensions')}{check('eventSounds', 'Provide feedback with sound')}{select('measurementUnit', 'Measurement units', [['inches', 'Inches'], ['centimeters', 'Centimeters']])}<label className="sp-pref-text"><span>User name</span><input aria-label="User name" value={p.userName} maxLength={100} onChange={event => update('userName', event.target.value)}/></label></>)}
              {section('When Creating New Workbooks', <div className="sp-pref-two-columns">{select('defaultFont', 'Default font', fontNames.map(font => [font, font]))}{number('defaultFontSize', 'Font size', 6, 96)}{number('newSheetCount', 'Sheets in new workbooks', 1, 20)}{number('defaultZoom', 'Default zoom', 25, 200)}{note('These defaults apply to newly created workbooks. Existing cell formatting is preserved.')}</div>)}
              {section('Personalize', <>{select('appearance', 'Appearance', [['system', 'Use system setting'], ['light', 'Light'], ['dark', 'Dark'], ['colorful', 'Colorful']])}{note('Worksheet cells keep their document colors. The surrounding controls follow this appearance.')}</>)}
            </>}
            {category === 'view' && <>
              {section('In the Window', <div className="sp-pref-two-columns">{check('formulaBar', 'Show formula bar')}{check('statusBar', 'Show status bar')}{check('sheetTabs', 'Show sheet tabs')}{check('horizontalScrollBar', 'Show horizontal scroll bar')}{check('verticalScrollBar', 'Show vertical scroll bar')}</div>)}
              {section('In the Worksheet', <>{check('headings', 'Show row and column headings')}{check('gridlines', 'Show gridlines')}{color('gridlineColor', 'Gridline color')}{check('showZeroValues', 'Show zero values')}{check('showFormulas', 'Show formulas instead of results')}{note('View preferences apply in Sheets; they do not change the values in your workbook.')}</>)}
              {section('Notes and Objects', <>{select('notes', 'For cells with notes, show', [['none', 'Neither notes nor indicators'], ['indicators', 'Indicators only'], ['always', 'Notes and indicators']])}{select('objects', 'For objects, show', [['all', 'All'], ['placeholders', 'Placeholders'], ['none', 'Nothing']])}</>)}
            </>}
            {category === 'ribbon' && <>
              {section('Ribbon', <>{check('collapsed', 'Collapse the ribbon')}{check('showGroupTitles', 'Show group titles')}<div className="sp-pref-ribbon-layout"><div><h3>Customize the Ribbon</h3><div className="sp-pref-check-list">{ribbonTabs.map(tab => <label className="sp-pref-check" key={tab}><input type="checkbox" checked={!p.hiddenRibbonTabs.includes(tab)} onChange={event => update('hiddenRibbonTabs', event.target.checked ? p.hiddenRibbonTabs.filter(item => item !== tab) : [...p.hiddenRibbonTabs, tab])}/><span>{tab}</span></label>)}</div></div><div><h3>Quick Access Toolbar</h3><div className="sp-pref-check-list">{quickCommands.map(([id, title]) => <label className="sp-pref-check" key={id}><input type="checkbox" checked={p.quickAccess.includes(id)} onChange={event => update('quickAccess', event.target.checked ? [...p.quickAccess, id] : p.quickAccess.filter(item => item !== id))}/><span>{title}</span></label>)}</div></div></div>{note('Contextual tabs appear when you select a table, chart, or PivotTable. File remains available.')}</>)}
            </>}
            {category === 'autocorrect' && <>
              <div className="sp-pref-intro">{check('autoCorrect', 'Automatically correct text as you type')}</div>
              <div className="sp-pref-segmented" role="tablist" aria-label="AutoCorrect options">{['AutoCorrect', 'AutoFormat As You Type'].map((tab, index) => <button type="button" role="tab" aria-selected={correctionTab === tab} tabIndex={correctionTab === tab ? 0 : -1} key={tab} onClick={() => setCorrectionTab(tab)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setCorrectionTab(index ? 'AutoCorrect' : 'AutoFormat As You Type'); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[index ? 0 : 1]?.focus(); } }}>{tab}</button>)}</div>
              <div className="sp-pref-correction-panel" role="tabpanel" aria-label={correctionTab}>{correctionTab === 'AutoCorrect' ? <>
                {check('correctInitialCapitals', 'Correct TWo INitial CApitals', !p.autoCorrect)}{check('capitalizeSentences', 'Capitalize first letter of sentences', !p.autoCorrect)}{check('capitalizeDays', 'Capitalize names of days', !p.autoCorrect)}
                <h3>Replace text as you type</h3><div className="sp-pref-two-columns"><label className="sp-pref-text"><span>Replace</span><input aria-label="Replace" value={from} maxLength={100} onChange={event => setFrom(event.target.value)}/></label><label className="sp-pref-text"><span>With</span><input aria-label="With" value={to} maxLength={1000} onChange={event => setTo(event.target.value)}/></label></div>
                <div className="sp-pref-replacement-head"><span>Replace</span><span>With</span></div><div className="sp-pref-replacement-list" role="listbox" aria-label="AutoCorrect replacements">{p.replacements.map(rule => <button type="button" key={rule.from} role="option" aria-selected={selectedReplacement === rule.from} onClick={() => { setSelectedReplacement(rule.from); setFrom(rule.from); setTo(rule.to); }}><span>{rule.from}</span><span>{rule.to}</span></button>)}</div>
                <div className="sp-pref-button-row"><button type="button" disabled={!from.trim() || from === to || p.replacements.length >= 200 && !p.replacements.some(rule => rule.from === from)} onClick={() => { update('replacements', [...p.replacements.filter(rule => rule.from !== from), { from, to }]); setSelectedReplacement(from); }}>{p.replacements.some(rule => rule.from === from) ? 'Replace' : 'Add'}</button><button type="button" disabled={!selectedReplacement} onClick={() => { update('replacements', p.replacements.filter(rule => rule.from !== selectedReplacement)); setSelectedReplacement(null); setFrom(''); setTo(''); }}>Delete</button></div>
                {note('Applies to newly entered text. Formulas and existing cells are preserved.')}
              </> : <>{check('autoHyperlinks', 'Internet and network paths with hyperlinks')}{unavailable('Include new rows and columns in a table automatically', 'Table expansion is not yet automatic.')}{unavailable('Fill formulas in tables to create calculated columns', 'Calculated table columns are not available.')}</>}</div>
            </>}
            {category === 'charts' && <>
              {section('Chart Tooltips', <>{check('chartElementTips', 'Show chart element names on hover')}{check('chartValueTips', 'Show data point values on hover')}</>)}
              {section('New Charts', <>{select('chartType', 'Default chart type', [['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['scatter', 'Scatter'], ['pie', 'Pie'], ['doughnut', 'Doughnut']])}{check('chartLegend', 'Show legend by default')}{check('chartLabels', 'Show data labels by default')}{note('Defaults apply to new charts. Double-click an existing chart to edit its own settings.')}</>)}
              {section('Empty and Hidden Cells', <>{note('Empty, text, and error values are shown as gaps in charts. They are not replaced with zero.')}{unavailable('Connect data points with a line across empty cells', 'Gap-connecting options are not available.')}</>)}
            </>}
            {category === 'accessibility' && <>
              {section('Larger Control Surfaces', <>{check('largerControls', 'Use larger control surfaces')}{note('Enlarges ribbon commands and settings controls for easier interaction.')}</>)}
              {section('Accessible Authoring', <>{check('announceCellChanges', 'Announce the selected cell and value')}{check('accessibilityStatus', 'Show accessibility status in the status bar')}{note('The grid exposes cell coordinates, values, and formulas to assistive technology.')}{unavailable('Generate alt text using AI', 'An AI alt-text service is not connected.')}</>)}
              {section('Motion', <>{check('reduceMotion', 'Reduce interface motion')}{note('Your system’s Reduce Motion preference is always respected.')}</>)}
              {section('Keyboard Navigation', <p>Use Tab to move through controls, arrow keys to navigate cells, and Shift with the arrow keys to extend a selection. Press Escape to close this window.</p>)}
            </>}
            {category === 'languages' && <>
              {section('Regional Display', <div className="sp-pref-language"><Globe2 size={48}/><div>{select('locale', 'Number and date display', [['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['de-DE', 'German (Germany)'], ['fr-FR', 'French (France)'], ['es-ES', 'Spanish (Spain)'], ['ja-JP', 'Japanese (Japan)'], ['zh-CN', 'Chinese (Simplified)']])}{note('Changes how numbers are displayed. Formula function names and workbook serialization use invariant English syntax.')}</div></div>)}
              {section('Authoring Languages', <>{note('Cells support Unicode text, including Japanese, Chinese, and Korean.')}{unavailable('Phonetic Guide and language-specific proofing tools', 'Language-specific proofing services are not connected.')}{unavailable('Translate workbook content', 'A translation service is not connected.')}</>)}
            </>}
            {category === 'calculation' && <>
              {section('Calculation', <><div className="sp-pref-workbook-label">For this workbook: <strong>{workbook.name}</strong></div><div className="sp-pref-radios"><label><input type="radio" name="sp-calculation" checked={workbook.calculationMode === 'automatic'} onChange={() => onWorkbookChange({ calculationMode: 'automatic' })}/>Automatic</label><label className="sp-pref-disabled" title="What-if data tables are not implemented."><input type="radio" name="sp-calculation" disabled checked={false} readOnly/>Automatic except for data tables</label><label><input type="radio" name="sp-calculation" checked={workbook.calculationMode === 'manual'} onChange={() => onWorkbookChange({ calculationMode: 'manual' })}/>Manual</label></div>{check('alwaysRecalculateBeforeSave', 'Recalculate workbook before saving')}<div className="sp-pref-button-row"><button type="button" onClick={() => onAction('recalculate')}>Calculate Now</button></div></>)}
              {section('Workbook Options', <><label className="sp-pref-check"><input type="checkbox" checked={workbook.dateSystem === '1904'} onChange={event => onWorkbookChange({ dateSystem: event.target.checked ? '1904' : '1900' })}/><span>Use 1904 date system</span></label>{note('Changing the date system changes how existing date numbers are interpreted.')}{unavailable('R1C1 reference style', 'Formula entry currently uses A1 references.')}{unavailable('Set precision as displayed', 'Calculations retain the stored numeric precision.')}</>)}
              {section('Iteration', <>{unavailable('Enable iterative calculation', 'Circular references are reported as errors; iterative recalculation is not available.')}<div className="sp-pref-two-columns"><label className="sp-pref-select sp-pref-disabled"><span>Maximum iterations</span><input aria-label="Maximum iterations" type="number" value="100" disabled readOnly/></label><label className="sp-pref-select sp-pref-disabled"><span>Maximum change</span><input aria-label="Maximum change" type="number" value="0.001" disabled readOnly/></label></div></>)}
            </>}
            {category === 'errors' && <>
              {section('Error Checking', <>{check('backgroundErrorChecking', 'Enable background error checking')}{color('errorIndicatorColor', 'Indicate errors using this color')}<div className="sp-pref-button-row"><button type="button" onClick={() => onAction('errors')}>Show Errors…</button><button type="button" disabled title="Ignored-error history is not implemented.">Reset Ignored Errors</button></div></>)}
              {section('Error Checking Rules', <>{check('checkFormulaErrors', 'Cells containing formulas that result in an error', !p.backgroundErrorChecking)}{check('checkNumbersAsText', 'Numbers formatted as text or preceded by an apostrophe', !p.backgroundErrorChecking)}{check('checkEmptyReferences', 'Formulas referring to empty cells', !p.backgroundErrorChecking)}{unavailable('Formulas inconsistent with other formulas in the region', 'Region-based formula comparison is not available.')}{unavailable('Formulas omitting cells in a region', 'Automatic range-omission detection is not available.')}{note('Indicators help review a workbook. They do not change formulas or suppress calculation errors.')}</>)}
            </>}
            {category === 'lists' && section('Custom Lists', <>
              <p>Create a sequence to use with the fill handle and custom sorting.</p><div className="sp-pref-list-editor"><div><h3>Custom lists</h3><div className="sp-pref-custom-lists" role="listbox" aria-label="Custom lists"><button type="button" role="option" aria-selected={selectedList < 0} onClick={() => { setSelectedList(-1); setListDraft(''); setListError(''); }}>NEW LIST</button>{p.customLists.map((list, index) => <button key={index} type="button" role="option" aria-selected={selectedList === index} title={list.join(', ')} onClick={() => { setSelectedList(index); setListDraft(list.join('\n')); setListError(''); }}>{list.join(', ')}</button>)}</div></div><label className="sp-pref-text"><span>List entries</span><textarea aria-label="List entries" value={listDraft} onChange={event => setListDraft(event.target.value)} rows={10} placeholder={'First item\nSecond item\nThird item'}/></label></div>
              {listError && <p className="sp-pref-error" role="alert">{listError}</p>}<div className="sp-pref-button-row"><button type="button" disabled={!listDraft.trim()} onClick={addList}>{selectedList < 0 ? 'Add' : 'Replace'}</button><button type="button" disabled={selectedList < 0} onClick={() => { update('customLists', p.customLists.filter((_, index) => index !== selectedList)); setSelectedList(-1); setListDraft(''); }}>Delete</button><button type="button" onClick={() => onAction('custom-list-import')}>Import from Selected Cells…</button></div>{note('Enter one item per line, or separate items with commas. Lists are saved with your Sheets preferences.')}
            </>)}
            {category === 'autocomplete' && <>
              {section('AutoComplete', <>{check('autocomplete', 'Enable AutoComplete for cell values')}{check('autocompleteFunctions', 'Show AutoComplete for function names')}{number('autocompleteMinLetters', 'Show suggestions after typing', 1, 10)}{note('Cell-value suggestions use existing text in the same column. Function suggestions include a signature and support status.')}</>)}
              {section('After Entering Data', <>{check('moveAfterEnter', 'After pressing Enter, move selection')}{select('enterDirection', 'Direction', [['down', 'Down'], ['right', 'Right'], ['up', 'Up'], ['left', 'Left']])}{check('enableFillHandle', 'Enable fill handle and cell drag-and-drop')}</>)}
            </>}
            {category === 'save' && <>
              {section('Save Options', <>{check('recoveryEnabled', 'Save AutoRecover information')}
                <div className="sp-pref-select"><span>Save AutoRecover information every</span><NumberSetting label="Recovery interval" value={p.recoveryInterval / recoveryUnit} min={.5 / recoveryUnit} max={600 / recoveryUnit} step={recoveryUnit === 1 ? .1 : .01} disabled={!p.recoveryEnabled} commit={value => update('recoveryInterval', value * recoveryUnit)}/><span className="sp-pref-select-control"><select aria-label="Recovery interval unit" value={recoveryUnit} onChange={event => setRecoveryUnit(Number(event.target.value))}><option value="1">seconds</option><option value="60">minutes</option></select><ChevronDown size={15}/></span></div>
                {note('AutoRecover keeps a local recovery copy after edits. Use Save to write the workbook to your chosen file.')}{select('defaultFormat', 'Save workbooks as', [['lopebook', 'Sheets Workbook (.lopebook)'], ['xlsx', 'Excel Workbook (.xlsx)']])}{check('alwaysRecalculateBeforeSave', 'Recalculate workbook before saving')}{unavailable('Always create backup copy', 'A separate backup-file service is not configured.')}</>)}
              {section('Recovery', <>{note('Recovery copies belong to this browser profile. They can be opened from File → Recover Workbook.')}<div className="sp-pref-button-row"><button type="button" onClick={() => onAction('recovery')}>Open Recovery Copies…</button></div></>)}
            </>}
            {category === 'compatibility' && <>
              {section('Preferred File Format', <>{select('defaultFormat', 'Save workbooks as', [['lopebook', 'Sheets Workbook (.lopebook)'], ['xlsx', 'Excel Workbook (.xlsx)']])}{note('The Sheets format retains the full native workbook. XLSX supports interchange with Excel; a conversion warning appears when features cannot be preserved.')}</>)}
              {section('Text Export', <>{check('warnBeforeCsvExport', 'Warn before exporting a worksheet as CSV or TSV')}{note('CSV and TSV contain one worksheet’s text values. They do not retain formulas, formatting, charts, or other worksheets.')}</>)}
              {section('Compatibility Report', <><p>Review the formats and features supported by this version of Sheets.</p><button type="button" onClick={() => onAction('compatibility')}>View Feature Support…</button>{unavailable('Use legacy Excel compatibility mode', 'Legacy XLS and XLSB workbooks require separate parsers.')}</>)}
            </>}
            {category === 'security' && <>
              {section('Macro Security', <><div className="sp-pref-radios sp-pref-disabled"><label><input type="radio" name="sp-macros" disabled checked={false} readOnly/>Disable all macros without notification</label><label><input type="radio" name="sp-macros" disabled checked readOnly/>Disable all macros with notification</label><label><input type="radio" name="sp-macros" disabled checked={false} readOnly/>Enable all macros</label></div>{note('Macros do not run in Sheets. Imported workbook code is never executed automatically.')}</>)}
              {section('External Content', <>{check('confirmExternalLinks', 'Warn before opening external hyperlinks')}{unavailable('Automatically update external workbook links', 'External workbook links are not refreshed automatically.')}{unavailable('Trust access to the VBA project object model', 'The VBA runtime is not available.')}</>)}
              {section('Workbook Protection', note('Sheet protection controls editing. It does not encrypt a workbook. Use Review → Protect Sheet to manage the current worksheet.'))}
            </>}
            {category === 'privacy' && <>
              {section('Your Workbooks and Preferences', <><p>Workbook calculations run locally. Files saved to a connected workspace follow that workspace’s storage and sync settings.</p><button type="button" className="sp-pref-link" onClick={() => setPrivacyDetails(value => !value)} aria-expanded={privacyDetails}>Where are my settings stored?</button>{privacyDetails && <p className="sp-pref-explanation">Sheets preferences are stored through LopeOS settings. Recovery copies stay in this browser profile. Clearing browser data removes local recovery copies.</p>}</>)}
              {section('Optional Connected Experiences', <>{unavailable('Turn on optional connected experiences', 'Online proofing, AI assistance, translation, and coauthoring services are not connected.')}{unavailable('Send optional diagnostic data', 'Sheets does not collect optional workbook diagnostic data.')}</>)}
              {section('Local Recovery Storage', <>{note('Clear local recovery copies after saving any workbooks you want to keep. Saved workspace files are unaffected.')}<button type="button" onClick={() => onAction('clear-recovery')}>Clear Recovery Copies…</button></>)}
            </>}
            {category === 'pride' && section('Show Your Pride', <><p>Choose an accent for your Sheets document bar.</p><div className="sp-pref-pride-options">{[['none', 'Default'], ['rainbow', 'Rainbow'], ['trans', 'Transgender'], ['nonbinary', 'Nonbinary']].map(([value, label]) => <label key={value}><span className={`sp-pride-swatch sp-pride-${value}`}/><span><input type="radio" name="sp-pride" checked={p.pride === value} onChange={() => update('pride', value as SheetPreferences['pride'])}/>{label}</span>{p.pride === value && <Check size={16} aria-hidden="true"/>}</label>)}</div>{note('This changes your Sheets accent. It does not change workbook content or exported files.')}</>)}
          </div>}
    </div>
    <footer className="sp-preferences-footer"><span>Changes are saved automatically.</span><button type="button" onClick={onClose}>Done</button></footer>
  </section></div>;
}

export { PreferencesWindow as Preferences };
