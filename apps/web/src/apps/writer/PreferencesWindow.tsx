import { useEffect, useRef, useState, type ReactNode, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Accessibility, ArrowLeft, ArrowRight, Check, ChevronDown, FileCheck2, FilePenLine, FolderSearch, Globe2, Grid3X3, LayoutTemplate, LockKeyhole, NotebookPen, Palette, PanelTop, Printer, Save, Search, Shield, SlidersHorizontal, SpellCheck, UserRound, X, Zap } from 'lucide-react';
import type { AppContext } from '../../../../../packages/contracts/src';
import type { WriterPreferences } from './preferences';
import { useAnimatedDismiss } from './motion';
import { useSystemAppearance } from './systemAppearance';
import './preferences.css';

type Category = 'home' | 'general' | 'view' | 'ribbon' | 'edit' | 'spelling' | 'autocorrect' | 'accessibility' | 'languages' | 'save' | 'print' | 'track' | 'user' | 'security' | 'locations' | 'privacy' | 'pride';
type Update = <K extends keyof WriterPreferences>(key: K, value: WriterPreferences[K]) => void;
type Props = { preferences: WriterPreferences; update: Update; autosave: boolean; setAutosave: (value: boolean) => void; context: AppContext; close: () => void };
const groups = [
  { title: 'Authoring and Proofing Tools', items: [
    { id: 'general', title: 'General', icon: SlidersHorizontal, color: 'silver', terms: 'theme appearance dark mode measurement inches centimeters extensions animation sounds gallery' },
    { id: 'view', title: 'View', icon: PanelTop, color: 'silver', terms: 'ruler bookmarks scroll bars formatting paragraph marks window' },
    { id: 'ribbon', title: 'Ribbon & Toolbar', icon: LayoutTemplate, color: 'slate', terms: 'groups collapse classic toolbar' },
    { id: 'edit', title: 'Edit', icon: FilePenLine, color: 'blue', terms: 'pictures wrap paste clipboard editing' },
    { id: 'spelling', title: 'Spelling & Grammar', icon: SpellCheck, color: 'blue', terms: 'dictionary language proofing corrections' },
    { id: 'autocorrect', title: 'AutoCorrect', icon: Zap, color: 'orange', terms: 'replace replacement automatic typing math autoformat autotext' },
    { id: 'accessibility', title: 'Accessibility', icon: Accessibility, color: 'blue', terms: 'motion animation reduce larger controls keytips alt text' },
    { id: 'languages', title: 'East Asian Languages', icon: Globe2, color: 'globe', terms: 'Japanese Chinese Korean English language' },
  ] },
  { title: 'Output and Sharing', items: [
    { id: 'save', title: 'Save', icon: Save, color: 'silver', terms: 'autosave automatic background recovery autorecover interval document format' },
    { id: 'print', title: 'Print', icon: Printer, color: 'silver', terms: 'background reverse order drawings pdf fields markup' },
    { id: 'track', title: 'Track Changes', icon: FileCheck2, color: 'blue', terms: 'review markup insertions deletions revisions balloons' },
  ] },
  { title: 'Personal Settings', items: [
    { id: 'user', title: 'User Information', icon: UserRound, color: 'blue', terms: 'author name initials company address email phone' },
    { id: 'security', title: 'Security', icon: LockKeyhole, color: 'gold', terms: 'macro warning printing tracked changes comments' },
    { id: 'locations', title: 'File Locations', icon: FolderSearch, color: 'folder', terms: 'folder documents path recovery templates startup' },
    { id: 'privacy', title: 'Privacy', icon: Shield, color: 'blue', terms: 'connected experiences telemetry data diagnostics' },
    { id: 'pride', title: 'Show Your Pride', icon: Palette, color: 'rainbow', terms: 'rainbow transgender nonbinary accent' },
  ] },
] as const;
const categories = groups.flatMap(group => [...group.items]);
const titles = Object.fromEntries(categories.map(category => [category.id, category.title])) as Record<Category, string>;
// Index the actual option names as well as category keywords. Keep unavailable
// options discoverable so their pane can explain the capability boundary.
const optionLabels: Record<Exclude<Category, 'home'>, string[]> = {
  general: ['Confirm file format conversion at Open','Include formatted text on Clipboard','Play sounds for events such as opening, saving, or printing','Show file extensions','Turn off Resume Assistant','Show Document Gallery when opening Writer','Update automatic links at Open','Show add-in user interface errors','Always open encrypted files in this app','Enable modern comments','Show measurement in units of','Provide feedback with animation','Office theme','Turn off Dark Mode','Dark Mode has a dark page color','Dark Mode has a white page color','Allow co-authoring on files with macros','Use pen to select and interact with content by default','Open supported Office files from OneDrive or SharePoint in Office apps'],
  view: ['Bookmarks','Comments on rollover','Draft font','Field codes instead of values','Crop Marks','Mail merge prompts','Drawings','Highlight','Object anchors','Text boundaries','Show Non-Printing Characters','All','Hidden text','Paragraph marks','Tab characters','Optional hyphens','Spaces','Horizontal scroll bar','White space between pages in Print Layout View','Horizontal ruler','Vertical ruler','Vertical scroll bar','Wrap to window','Show group titles','Show developer tab'],
  ribbon: ['Classic ribbon','Show group titles','Show Paste Options buttons','Quick Access Toolbar','Save','Undo','Redo'],
  edit: ['Delete selected text when you type','Drag-and-drop text editing','Include paragraph mark when selecting paragraphs','Keep track of formatting','Match font with keyboard','Replace existing text as you type','Overtype mode','Select entire word when selecting text','Use smart cursoring','Insert pictures as','In line with text','Square','Top and bottom','Show Paste Options buttons','Use smart cut and paste','Image Size and Quality','Discard editing data','Do not compress images in file','Enable click and type'],
  spelling: ['Always suggest corrections','Check spelling as you type','Flag repeated words','Frequently confused words','Ignore Internet and file path addresses','Ignore words in UPPERCASE','Ignore words with numbers','Suggest from main dictionary only','Custom Dictionary','Dictionaries','Check grammar as you type','Show readability statistics','Writing style','Grammar & Refinements'],
  autocorrect: ['Automatically correct spelling and formatting as you type','AutoCorrect','Math AutoCorrect','AutoFormat As You Type','AutoText','Show AutoCorrect smart button','Correct TWo INitial CApitals','Capitalize first letter of sentences','Capitalize names of days','Capitalize first letter of table cells','Replace text as you type','Replace','With','Add','Delete'],
  accessibility: ['Enable the option to generate alt text using AI','Show accessibility status for the Accessibility Assistant in the Status Bar','Show accessibility status inline with the document','KeyTips','Activation keystroke','Use Larger Control Surfaces','Show interface animations','Reduce Motion'],
  languages: ['Phonetic Guide','Combined Characters','Vertical Text Layout','Japanese Chinese line-breaking controls','Language-specific proofing tools','Select a language','English'],
  save: ['Turn on AutoSave by default','Always create backup copy','Prompt before saving Normal template','Prompt for document properties','Save data only for forms','Save preview picture of new documents','Allow background saves','Save AutoRecover info','Recovery interval','Save every','Save Writer files as','Word Document','Embed fonts in the file','Embed only the characters used in the document'],
  print: ['Print background colors and images','Reverse print order','Update fields','Update links','Include in Print Version','Document properties','Drawing objects','Field codes','Hidden text','Review display','Print Markup','Final No Markup','Original'],
  track: ['Insertions','Underline','Deletions','Strikethrough','Changed lines','Outside border','Formatting','Color','By author','Default print markup','Moved from Double strikethrough','Moved to Double underline','Inserted cells Light Blue','Deleted cells Pink','Merged cells Light Yellow','Split cells Light Orange','Balloons'],
  user: ['Name','Initials','Company','Address','City','State','Zip','Country Region','Phone','E-Mail','Contact Information'],
  security: ['Disable all macros without notification','Disable all macros with notification','Enable all macros','Trust access to the VBA project object model','Warn before printing a file with tracked changes or comments'],
  locations: ['Documents','Images','User templates','Workgroup templates','AutoRecover files','Tools','Startup','Modify','Reset','Workspace document folder','Save location'],
  privacy: ['Optional Connected Experiences','Turn on optional connected experiences','Diagnostic Data Viewer','View Diagnostic Data','Telemetry'],
  pride: ['Default','Rainbow','Transgender','Nonbinary','Account badge'],
};
const normalizeSearch = (value: string) => value.toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const correctionTabs = ['AutoCorrect','Math AutoCorrect','AutoFormat As You Type','AutoText'];

const section = (title: string, children: ReactNode, className = '') => <section className={`wr-pref-section ${className}`}><h2>{title}</h2>{children}</section>;
const unavailable = (label: string, reason: string, checked = false) => <label className="wr-pref-check wr-pref-unavailable" title={reason}><input type="checkbox" disabled checked={checked} readOnly aria-description={reason}/><span>{label}</span></label>;
const note = (text: string) => <p className="wr-pref-note">{text}</p>;

function RecoveryInterval({ seconds, unit, disabled, commit }: { seconds: number; unit: number; disabled: boolean; commit: (value: number) => void }) {
  const format = (value: number, divisor = unit) => String(Number((value / divisor).toFixed(2)));
  const [draft, setDraft] = useState(() => format(seconds));
  const [conflict, setConflict] = useState<number | null>(null);
  const editing = useRef(false), dirty = useRef(false), focusedValue = useRef(seconds), previousUnit = useRef(unit);
  useEffect(() => {
    if (previousUnit.current !== unit && conflict !== null) setDraft(format(conflict));
    else if (!editing.current && conflict === null) setDraft(format(seconds));
    previousUnit.current = unit;
  }, [seconds,unit,conflict]);
  function finish() {
    editing.current = false;
    if (!dirty.current) { if (conflict === null) setDraft(format(seconds)); return; }
    const next = Number(draft) * unit;
    if (!Number.isFinite(next) || next < .5 || next > 600) { setDraft(format(seconds)); setConflict(null); return; }
    if (seconds !== focusedValue.current) { setConflict(next); return; }
    commit(next); setConflict(null);
  }
  return <><input id="wr-pref-recovery-interval" type="number" aria-label="Recovery interval" value={draft} min={unit === 1 ? .5 : .01} max={600/unit} step="any" disabled={disabled} onFocus={() => { editing.current=true; dirty.current=false; focusedValue.current=seconds; }} onChange={event => {dirty.current=true;setDraft(event.target.value);}} onBlur={finish}/>
    {conflict !== null && <span className="wr-pref-interval-feedback" role="status">The interval changed in another Writer window. Your entry has not been applied.<span><button type="button" onClick={() => {commit(conflict);setDraft(format(conflict));setConflict(null);}}>Use my interval</button><button type="button" onClick={() => {setDraft(format(seconds));setConflict(null);}}>Use latest interval</button></span></span>}
  </>;
}


export function Preferences({ preferences: p, update, autosave, setAutosave, context, close: onClose }: Props) {
  const system = useSystemAppearance();
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const { close, closing } = useAnimatedDismiss(onClose, root);
  const [history, setHistory] = useState<Category[]>(['home']);
  const [index, setIndex] = useState(0);
  const category = history[index];
  const [query, setQuery] = useState('');
  const [correctionTab, setCorrectionTab] = useState('AutoCorrect');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [fileLocation, setFileLocation] = useState('Documents');
  const [editingLocation, setEditingLocation] = useState(false);
  const [folder, setFolder] = useState(p.documentsFolder);
  const [locationError, setLocationError] = useState('');
  const [recoveryUnit, setRecoveryUnit] = useState(p.recoveryDelay >= 60 ? 60 : 1);
  const [privacyDetails, setPrivacyDetails] = useState(false);
  const ruleTypeahead = useRef({ text: '', time: 0 });
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    const surface = root.current;
    const owner = surface?.closest('.writer-app');
    const editor = owner?.querySelector<HTMLElement>('[role="textbox"][aria-label="Document content"]');
    root.current?.focus({preventScroll:true});
    return () => { const active=document.activeElement; if(active && active !== document.body && !surface?.contains(active)) return; const previous=previousFocus.current; if (previous?.isConnected && owner?.contains(previous) && previous.matches('input,textarea') && !previous.closest('.writer-workspace')) previous.focus({preventScroll:true}); else editor?.focus({preventScroll:true}); };
  }, []);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [category, query]);
  function go(next: Category) {
    const navigationFocus = document.activeElement;
    if (next !== category) { setHistory(previous => [...previous.slice(0,index+1),next]); setIndex(index+1); }
    setQuery('');
    requestAnimationFrame(() => {
      if (document.activeElement === navigationFocus || document.activeElement === document.body) body.current?.focus({ preventScroll: true });
    });
  }
  function back() { if (index > 0) { setIndex(index-1); setQuery(''); } }
  function forward() { if (index < history.length-1) { setIndex(index+1); setQuery(''); } }
  const check = (key: keyof WriterPreferences, label: string, extra?: ReactNode) => <div className="wr-pref-field" data-setting={key}><label className="wr-pref-check"><input type="checkbox" checked={Boolean(p[key])} onChange={e => (() => { update(key,e.target.checked as never); if (key === 'verticalRuler' && e.target.checked) update('ruler',true); })()}/><span>{label}</span></label>{extra}</div>;
  const select = <K extends keyof WriterPreferences>(key: K, label: string, options: Array<[WriterPreferences[K],string]>) => <label className="wr-pref-select" data-setting={key}><span>{label}</span><span className="wr-pref-select-control"><select aria-label={label} value={String(p[key])} onChange={e => update(key,e.target.value as WriterPreferences[K])}>{options.map(([value,label]) => <option key={String(value)} value={String(value)}>{label}</option>)}</select><ChevronDown size={16}/></span></label>;
  const text = (key: keyof WriterPreferences, label: string, multiline = false) => <label className="wr-pref-text" data-setting={key}><span>{label}</span>{multiline ? <textarea aria-label={label} value={String(p[key])} onChange={e => update(key,e.target.value as never)} rows={3}/> : <input aria-label={label} value={String(p[key])} maxLength={key === 'userInitials' ? 5 : 300} onChange={e => update(key,e.target.value as never)}/>}</label>;
  const allMarks = p.formattingMarks;
  const queryTerms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const filtered = categories.filter(item => {
    const content = normalizeSearch([item.title,item.terms,...optionLabels[item.id]].join(' '));
    return queryTerms.every(term => content.includes(term));
  });
  function correctionTabKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? correctionTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + correctionTabs.length) % correctionTabs.length;
    setCorrectionTab(correctionTabs[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  function chooseRule(index: number, focus = false) {
    const rule = p.replacements[index]; if (!rule) return;
    setSelectedRule(rule.from); setFrom(rule.from); setTo(rule.to);
    if (focus) {
      const option = root.current?.querySelectorAll<HTMLButtonElement>('[role="listbox"] [role="option"]')[index];
      option?.focus(); option?.scrollIntoView({ block: 'nearest' });
    }
  }
  function correctionRuleKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!p.replacements.length) return;
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % options.length;
    if (event.key === 'ArrowUp') next = current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length;
    if (next < 0 && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now(), previous = ruleTypeahead.current;
      const text = (now - previous.time < 750 ? previous.text : '') + event.key.toLowerCase();
      ruleTypeahead.current = { text, time: now };
      next = p.replacements.findIndex(rule => rule.from.toLowerCase().startsWith(text));
    }
    if (next >= 0) { event.preventDefault(); chooseRule(next,true); }
  }
  const activeRule = p.replacements.some(rule => rule.from === selectedRule) ? selectedRule : p.replacements[0]?.from;

  const toolbar = <header className="wr-preferences-toolbar">
    <div className="wr-pref-history"><button aria-label="Previous preferences pane" disabled={index === 0} onClick={back}><ArrowLeft/></button><button aria-label="Next preferences pane" disabled={index === history.length-1} onClick={forward}><ArrowRight/></button></div>
    <button className="wr-pref-show-all" aria-label="Show all preferences" onClick={() => go('home')}><Grid3X3/></button>
    <h1>{category === 'home' ? 'Writer Preferences' : titles[category]}</h1>
    <label className="wr-pref-search"><Search size={22}/><input ref={search} aria-label="Search preferences" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); } }}/>{query && <button aria-label="Clear preferences search" onClick={() => { setQuery(''); search.current?.focus(); }}><X size={16}/></button>}</label>
    <button className="wr-pref-close" aria-label="Close Preferences" onClick={close}><X size={16}/></button>
  </header>;
  return <div className={`writer-preferences-backdrop ${closing ? 'wr-is-closing' : ''}`}><section ref={root} className="writer-preferences" data-appearance={system.theme} data-increase-contrast={system.increaseContrast} data-large-text={system.textScale > 1} style={{ '--wr-pref-text-scale': system.textScale } as CSSProperties} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Writer Preferences" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if ((e.metaKey || e.ctrlKey) && e.key === '[') { e.preventDefault(); back(); }
    if ((e.metaKey || e.ctrlKey) && e.key === ']') { e.preventDefault(); forward(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); search.current?.focus(); }
    if (e.key === 'Tab') {
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node => node.offsetParent !== null && node.tabIndex >= 0);
      const active = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && active <= 0) { e.preventDefault(); items.at(-1)?.focus(); }
      else if (!e.shiftKey && active === items.length-1) { e.preventDefault(); items[0]?.focus(); }
    }
  }}>{toolbar}<div ref={body} className={`wr-preferences-content ${category === 'home' && !query ? 'wr-preferences-home' : ''}`} tabIndex={-1}>
    <div key={query ? 'search' : category} className="wr-pref-pane" data-category={category}>
      {query ? <section className="wr-pref-search-results"><h2>Search Results</h2>{filtered.length ? filtered.map(item => <button key={item.id} aria-label={`Open ${item.title} preferences`} onClick={() => go(item.id)}><item.icon size={30}/><span><strong>{item.title}</strong><small>{item.terms.split(' ').slice(0,6).join(' · ')}</small></span><ArrowRight size={18}/></button>) : <p>No preferences match “{query}”.</p>}</section> : category === 'home' ? groups.map(group => <section className="wr-pref-category-section" key={group.title}><h2>{group.title}</h2><div className="wr-pref-category-grid">{group.items.map(item => <button key={item.id} onClick={() => go(item.id)}><span className={`wr-pref-icon wr-pref-icon-${item.color}`}><item.icon strokeWidth={1.35}/></span><span>{item.title}</span></button>)}</div></section>) : <>
      {category === 'general' && <>
        {section('Settings', <><div className="wr-pref-columns"><div>{unavailable('Confirm file format conversion at Open','Unsupported formats always require conversion before opening.')}{unavailable('Include formatted text on Clipboard','Native keyboard shortcuts preserve rich text; ribbon clipboard commands transfer text.',true)}{check('eventSounds','Play sounds for events such as opening, saving, or printing')}{check('showExtensions','Show file extensions')}{unavailable('Turn off Resume Assistant','Resume Assistant is not connected.')}</div><div>{check('showGallery','Show Document Gallery when opening Writer')}{unavailable('Update automatic links at Open','External links are preserved without downloading external content.')}{unavailable('Show add-in user interface errors','An add-in service is not connected.')}{unavailable('Always open encrypted files in this app','Encrypted documents must be decrypted before opening.')}{check('modernComments','Enable modern comments')}</div></div>{select('measurementUnit','Show measurement in units of:',[['in','Inches'],['cm','Centimeters']])}{check('animations','Provide feedback with animation')}</>)}
        {section('Personalize', <>{select('theme','Office theme:',[['aluminum','Aluminum'],['white','White'],['colorful','Colorful'],['dark','Dark']])}<div className="wr-pref-radios">{[['off','Turn off Dark Mode'],['dark','Dark Mode has a dark page color'],['white','Dark Mode has a white page color']].map(([value,label]) => <label key={value}><input type="radio" name="wr-dark-page" checked={value === (p.theme === 'dark' ? p.darkPage ? 'dark' : 'white' : 'off')} onChange={() => { update('theme',value === 'off' ? 'white' : 'dark'); update('darkPage',value === 'dark'); }}/>{label}</label>)}</div>{note('Preferences follows the LopeOS system theme. The Office theme controls the document editor.')}</>)}
        {section('Co-authoring Options', <>{unavailable('Allow co-authoring on files with macros','Live co-authoring and macro execution are not connected.')}{note('Documents stay in your LopeOS workspace. Cloud collaboration is not connected.')}</>)}
        {section('Pen', unavailable('Use pen to select and interact with content by default','Pen input follows your device settings.'))}
        {section('Link Handling', unavailable('Open supported Office files from OneDrive or SharePoint in Office apps','OneDrive and SharePoint are not connected.'))}
      </>}
      {category === 'view' && <>
        {section('Show in Document', <div className="wr-pref-columns"><div>{check('bookmarks','Bookmarks')}{unavailable('Comments on rollover','Open Comments to read and reply to document threads.',true)}{unavailable('Draft font','Writer uses paginated Print Layout.')}{unavailable('Field codes instead of values','Field-code display is not available.')}{unavailable('Crop Marks','Crop marks are not available.')}{unavailable('Mail merge prompts','Mail merge is not connected.')}</div><div>{unavailable('Drawings','Drawing objects are displayed by the document renderer.',true)}{unavailable('Highlight','Document highlights are preserved and displayed.',true)}{unavailable('Object anchors','Object anchor indicators are not available.')}{unavailable('Text boundaries','Text-boundary indicators are not available.')}</div></div>)}
        {section('Show Non-Printing Characters', <>{check('formattingMarks','All')}<div className="wr-pref-character-options">{unavailable('Hidden text','Hidden-text display is not available.')}{unavailable('Paragraph marks','Use All to show paragraph marks together with spaces and tabs.',allMarks)}{unavailable('Tab characters','Use All to show tab characters.',allMarks)}{unavailable('Optional hyphens','Individual formatting-mark filters are not available.')}{unavailable('Spaces','Use All to show spaces.',allMarks)}</div></>)}
        {section('Show Window Elements', <div className="wr-pref-columns"><div>{check('horizontalScrollbar','Horizontal scroll bar')}{unavailable('White space between pages in Print Layout View','Page boundaries remain visible in Print Layout.',true)}{check('ruler','Horizontal ruler')}</div><div>{check('verticalRuler','Vertical ruler')}{check('verticalScrollbar','Vertical scroll bar')}{unavailable('Wrap to window','Use Fit Page Width on the status bar to fit the document.')}</div></div>)}
        {section('Ribbon', <>{check('groupTitles','Show group titles')}{unavailable('Show developer tab','Developer and VBA tools are not available.')}</>)}
      </>}
      {category === 'ribbon' && <>
        {section('Ribbon', <>{note('Classic ribbon')}{check('groupTitles','Show group titles')}{check('showPasteOptions','Show Paste Options buttons')}{note('Use the chevron at the bottom-right of the ribbon, or Ctrl/⌘ F1, to collapse or expand commands.')}</>)}
        {section('Quick Access Toolbar', <div className="wr-pref-toolbar-preview"><Save/><span>Save</span><span>Undo</span><span>Redo</span></div>)}
      </>}
      {category === 'edit' && <>
        {section('Editing Options', <>{unavailable('Delete selected text when you type','Selection replacement is handled by the document editor.',true)}{unavailable('Drag-and-drop text editing','Drag-and-drop behavior is controlled by the document editor.')}{unavailable('Include paragraph mark when selecting paragraphs','Paragraph selection follows the document editor’s native behavior.',true)}{unavailable('Keep track of formatting','Formatting is always preserved in the document.',true)}{unavailable('Match font with keyboard','Font selection is available on Home.')}{unavailable('Replace existing text as you type (Overtype mode)','Overtype mode is not available.')}{unavailable('Select entire word when selecting text','Word selection is provided by the document editor.',true)}{unavailable('Use smart cursoring','Caret movement is handled by the document editor.',true)}{select('defaultPictureWrap','Insert pictures as:',[['inline','In line with text'],['square','Square'],['topAndBottom','Top and bottom']])}</>)}
        {section('Cut and Paste Options', <>{check('showPasteOptions','Show Paste Options buttons')}{unavailable('Use smart cut and paste','Native keyboard clipboard behavior is provided by the document editor.')}</>)}
        {section('Image Size and Quality', <>{unavailable('Discard editing data','Original image data is retained.')}{unavailable('Do not compress images in file','Writer retains the supplied image bytes.',true)}</>)}
        {section('Click and Type', unavailable('Enable click and type','Clicking places the caret in existing content; free-position paragraph creation is not available.'))}
      </>}
      {category === 'spelling' && <>
        {section('Spelling', <><div className="wr-pref-columns"><div>{['Always suggest corrections','Check spelling as you type','Flag repeated words','Frequently confused words','Ignore Internet and file path addresses'].map(label => <div key={label}>{unavailable(label,'A spelling service is not connected.')}</div>)}</div><div>{['Ignore words in UPPERCASE','Ignore words with numbers','Suggest from main dictionary only'].map(label => <div key={label}>{unavailable(label,'A spelling service is not connected.')}</div>)}</div></div><div className="wr-pref-button-row"><button disabled>Custom Dictionary</button><button disabled>Dictionaries…</button></div>{note('Spelling suggestions and dictionaries require a connected proofing service. AutoCorrect replacements are available separately.')}</>)}
        {section('Grammar', <>{unavailable('Check grammar as you type','A grammar service is not connected.')}{unavailable('Show readability statistics','A grammar service is not connected.')}<div className="wr-pref-button-row"><span>Writing style:</span><button disabled>Grammar & Refinements</button><button disabled>Settings…</button></div></>)}
      </>}
      {category === 'autocorrect' && <>
        <div className="wr-pref-autocorrect-enable">{check('autoCorrect','Automatically correct spelling and formatting as you type')}</div>
        <div className="wr-pref-segmented" role="tablist" aria-label="AutoCorrect sections">{correctionTabs.map((tab,index) => <button key={tab} id={`wr-autocorrect-tab-${index}`} role="tab" aria-selected={correctionTab === tab} aria-controls="wr-autocorrect-panel" tabIndex={correctionTab === tab ? 0 : -1} onKeyDown={event => correctionTabKey(event,index)} onClick={() => setCorrectionTab(tab)}>{tab}</button>)}</div>
        <div id="wr-autocorrect-panel" className="wr-pref-autocorrect-panel" role="tabpanel" aria-labelledby={`wr-autocorrect-tab-${correctionTabs.indexOf(correctionTab)}`} tabIndex={0}>{correctionTab === 'AutoCorrect' ? <>
          {unavailable('Show AutoCorrect smart button','Use Undo to reverse a replacement.')}
          <div className="wr-pref-indent">{unavailable('Correct TWo INitial CApitals','Capitalization rules are not available.')}{unavailable('Capitalize first letter of sentences','Capitalization rules are not available.')}{unavailable('Capitalize names of days','Capitalization rules are not available.')}{unavailable('Capitalize first letter of table cells','Capitalization rules are not available.')}</div>
          {check('autoCorrect','Replace text as you type')}
          <div className="wr-pref-replacements"><label className="wr-pref-text"><span>Replace:</span><input aria-label="AutoCorrect replace" maxLength={64} value={from} onChange={e => setFrom(e.target.value)}/></label><label className="wr-pref-text"><span>With:</span><input aria-label="AutoCorrect with" maxLength={256} value={to} onChange={e => setTo(e.target.value)}/></label>
            <div className="wr-pref-rule-table" role="listbox" aria-label="AutoCorrect replacements" onKeyDown={correctionRuleKey}>{p.replacements.map((rule,index) => <button key={rule.from} role="option" aria-selected={selectedRule === rule.from} tabIndex={activeRule === rule.from ? 0 : -1} onClick={() => chooseRule(index)}><span>{rule.from}</span><span>{rule.to}</span></button>)}</div>
            <div className="wr-pref-button-row"><button disabled={!from.trim() || from === to || (p.replacements.length >= 200 && !p.replacements.some(rule => rule.from === from))} onClick={() => { if (p.replacements.length >= 200 && !p.replacements.some(rule => rule.from === from)) return; update('replacements',[...p.replacements.filter(rule => rule.from !== from),{ from, to }]); setSelectedRule(from); }}>{p.replacements.some(rule => rule.from === from) ? 'Replace' : 'Add'}</button><button disabled={!selectedRule} onClick={() => { update('replacements',p.replacements.filter(rule => rule.from !== selectedRule)); setSelectedRule(null); setFrom(''); setTo(''); }}>Delete</button></div>
          </div>{p.replacements.length >= 200 && <p className="wr-pref-note" role="status">The 200-replacement limit has been reached. Delete a replacement before adding another; existing replacements can still be edited.</p>}{note('Replacements apply after a space or tab in newly typed text. They do not change pasted text or existing document content. Undo remains available.')}
        </> : <>{section(correctionTab, <>{note(correctionTab === 'AutoText' ? 'Reusable AutoText blocks are not available.' : correctionTab === 'Math AutoCorrect' ? 'Math AutoCorrect is not available. Add a plain-text symbol replacement on the AutoCorrect tab.' : 'Automatic lists and formatting use the document editor’s native typing behavior.')}</>)}</>}</div>
      </>}
      {category === 'accessibility' && <>
        {section('Alt Text', <>{unavailable('Enable the option to generate alt text using AI','An AI alt-text service is not connected.')}{note('Add alt text when inserting a picture.')}</>)}
        {section('Accessible Authoring', <>{unavailable('Show accessibility status for the Accessibility Assistant in the Status Bar','An Accessibility Assistant is not connected.')}{unavailable('Show accessibility status inline with the document','An Accessibility Assistant is not connected.')}</>)}
        {section('KeyTips', <>{note('Use F6 to move between application regions. Use arrow keys in ribbon menus, and Alt+Q to search commands.')}<div className="wr-pref-button-row"><span>Activation keystroke:</span><button disabled>Disabled</button></div></>)}
        {section('Larger Control Surfaces', <>{note('Enlarge application controls for easier interaction with assistive devices.')}{check('largerControls','Use Larger Control Surfaces')}</>)}
        {section('Motion', <>{check('animations','Show interface animations')}{note('Your system’s Reduce Motion preference is always respected.')}</>)}
      </>}
      {category === 'languages' && section('East Asian Languages', <div className="wr-pref-language"><Globe2 size={80}/><div><p>Writer supports Unicode text, including Japanese, Chinese, and Korean. Document fonts and language metadata are preserved when opening and saving DOCX files.</p><ul><li>Phonetic Guide</li><li>Combined Characters</li><li>Vertical Text Layout</li><li>Japanese/Chinese line-breaking controls</li><li>Language-specific proofing tools</li></ul>{note('These additional authoring and proofing tools are not available.')}<label className="wr-pref-select"><span>Select a language:</span><span className="wr-pref-select-control"><select disabled defaultValue="en"><option value="en">English (Default)</option></select><ChevronDown size={16}/></span></label></div></div>)}
      {category === 'save' && <>
        {section('Save Options', <><label className="wr-pref-check"><input type="checkbox" checked={autosave} onChange={e => setAutosave(e.target.checked)}/><span>Turn on AutoSave by default</span></label><p className="wr-pref-explanation">Automatically save named documents to your LopeOS workspace after edits. Unsaved documents can use a local recovery copy.</p>{unavailable('Always create backup copy','A separate backup-file service is not connected.')}{unavailable('Prompt before saving Normal template','Writer does not change the Normal template.')}{unavailable('Prompt for document properties','Document properties are retained without a save prompt.')}{unavailable('Save data only for forms (current document only)','Form-data export is not available.')}{unavailable('Save preview picture of new documents','Document preview thumbnails are not available.')}{unavailable('Allow background saves','Workspace saves run in the background.',true)}{check('recoveryEnabled','Save AutoRecover info')}
          <div className="wr-pref-select wr-pref-recovery-interval"><label htmlFor="wr-pref-recovery-interval">Save every:</label><RecoveryInterval seconds={p.recoveryDelay} unit={recoveryUnit} disabled={!p.recoveryEnabled} commit={value => update('recoveryDelay',value)}/><span className="wr-pref-select-control"><select aria-label="Recovery interval unit" value={recoveryUnit} onChange={e => setRecoveryUnit(Number(e.target.value))}><option value="1">seconds</option><option value="60">minutes</option></select><ChevronDown size={16}/></span></div>
          <div className="wr-pref-button-row"><span>Save Writer files as:</span><button disabled>Word Document (.docx)</button></div></>)}
        {section('Font Embedding', <>{unavailable('Embed fonts in the file','Licensed font embedding is not available.')}{unavailable('Embed only the characters used in the document','Licensed font embedding is not available.')}</>)}
      </>}
      {category === 'print' && <>
        {section('Print Options', <>{check('printBackgrounds','Print background colors and images')}{check('reversePrint','Reverse print order')}{check('updateFields','Update fields')}{unavailable('Update links','External linked content is not downloaded when printing.')}</>)}
        {section('Include in Print Version', <>{unavailable('Document properties','Printing a separate document-properties page is not available.')}{check('printDrawings','Drawing objects')}{unavailable('Field codes','Fields print their current values.')}{unavailable('Hidden text','Hidden-text printing is not available.')}{select('printReview','Review display:',[['review','Print Markup'],['final','Final — No Markup'],['original','Original']])}</>)}
      </>}
      {category === 'track' && <>
        {section('Markup', <><div className="wr-pref-markup-grid">{[['Insertions:','Underline','insert'],['Deletions:','Strikethrough','delete'],['Changed lines:','Outside border','line'],['Formatting:','(none)','format']].map(([label,value,kind]) => <div className="wr-pref-markup-row" key={label}><span>{label}</span><button disabled>{value}<ChevronDown size={16}/></button><span>Color:</span><button disabled><i className="wr-pref-author-colors"/>By author<ChevronDown size={16}/></button><div className={`wr-pref-markup-preview ${kind}`}>Sample text</div></div>)}</div>{select('printReview','Default print markup:',[['review','Print Markup'],['final','Final — No Markup'],['original','Original']])}{note('Review display and Accept/Reject are on the Review ribbon. Custom revision colors and line styles are not available.')}</>)}
        {section('Moves', <>{unavailable('Moved from: Double strikethrough','Custom move markup is not available.')}{unavailable('Moved to: Double underline','Custom move markup is not available.')}</>)}
        {section('Table Cell Highlighting', <div className="wr-pref-highlight-examples">{[['Inserted cells','Light Blue','#dff3fb'],['Deleted cells','Pink','#fbe7f3'],['Merged cells','Light Yellow','#fff4d8'],['Split cells','Light Orange','#fbe2d0']].map(([label,color,hex]) => <label key={label}><span>{label}:</span><button disabled><i style={{background:hex}}/>{color}</button></label>)}</div>)}
        {section('Balloons', note('Comments use the resizable Comments pane. Drag its edge to change the width.'))}
      </>}
      {category === 'user' && <>
        {section('User Information', <><div className="wr-pref-user-name">{text('userName','Name:')}{text('userInitials','Initials:')}</div>{note('Used for new comments and tracked changes. Existing author information is preserved.')}</>)}
        {section('Contact Information', <>{text('company','Company:')}{text('address','Address:',true)}<div className="wr-pref-contact-row">{text('city','City:')}{text('region','State:')}{text('postalCode','Zip:')}</div>{text('country','Country/Region:')}<div className="wr-pref-columns">{text('phone','Phone:')}{text('userEmail','E-Mail:')}</div></>)}
      </>}
      {category === 'security' && <>
        {section('Macro Security', <div className="wr-pref-radios">{['Disable all macros without notification','Disable all macros with notification','Enable all macros'].map((label,index) => <label key={label} className="wr-pref-unavailable" title="Writer does not execute macros."><input type="radio" disabled readOnly checked={index === 1}/>{label}</label>)}{note('Macros never run in Writer. Documents containing macros use the compatibility copy or read-only workflow.')}</div>)}
        {section('Developer Macro Settings', unavailable('Trust access to the VBA project object model','VBA is not available.'))}
        {section('Document-specific Settings', check('warnReviewPrint','Warn before printing a file with tracked changes or comments'))}
      </>}
      {category === 'locations' && section('File Locations', <>
        <div className="wr-pref-locations"><table><thead><tr><th>File Types</th><th>Locations</th></tr></thead><tbody>{[['Documents',p.documentsFolder],['Images','Choose a file when inserting a picture'],['User templates','Not configured'],['Workgroup templates','Not configured'],['AutoRecover files','Local browser recovery storage'],['Tools','Not configured'],['Startup','Not configured']].map(([name,path]) => <tr key={name} aria-selected={fileLocation === name} tabIndex={0} onClick={() => {setFileLocation(name);setEditingLocation(false);}} onKeyDown={e => {if(e.key === 'Enter' || e.key === ' '){e.preventDefault();setFileLocation(name);setEditingLocation(false);}}}><td>{name}</td><td title={path}>{path}</td></tr>)}</tbody></table></div>
        <div className="wr-pref-button-row"><button disabled={fileLocation !== 'Documents'} onClick={() => {setFolder(p.documentsFolder);setEditingLocation(true);setLocationError('');}}>Modify…</button><button disabled={fileLocation !== 'Documents'} onClick={() => update('documentsFolder','/')}>Reset</button></div>
        {editingLocation && <div className="wr-pref-location-edit"><label className="wr-pref-text"><span>Workspace document folder:</span><input aria-label="Workspace document folder" value={folder} onChange={e => setFolder(e.target.value)}/></label><button onClick={async () => {const path=folder.trim().replace(/\/$/,'') || '/';if(!path.startsWith('/') || path.split('/').includes('..')){setLocationError('Use an absolute workspace folder path.');return;}try {const entry=await context.services.files.stat(path);if(entry.type !== 'directory')throw new Error('Choose a workspace folder.');update('documentsFolder',path);setEditingLocation(false);}catch(cause){setLocationError(cause instanceof Error ? cause.message : 'The workspace folder could not be opened.');}}}>Save location</button>{locationError && <p role="alert">{locationError}</p>}</div>}
        {note('Documents supplies the suggested workspace path for Save As. AutoRecover copies are stored in this browser profile.')}
      </>)}
      {category === 'privacy' && <>
        <section className="wr-pref-section"><p>Writer preferences apply to this LopeOS workspace. Your documents and personal settings are saved in LopeOS and sync with your cloud account while signed in.</p><button className="wr-pref-link" onClick={() => setPrivacyDetails(!privacyDetails)}>Learn more about where your settings apply…</button>{privacyDetails && <p className="wr-pref-explanation">Author details are attached to new comments and revisions. Recovery copies are stored in this browser profile. Clearing browser data removes local copies. Check that LopeDrive has finished syncing before clearing data.</p>}<h2>Optional Connected Experiences</h2><p>Cloud collaboration, AI assistance, proofing, online pictures, and account sharing are not connected.</p>{unavailable('Turn on optional connected experiences','No connected-experience provider is configured.')}{note('Document-engine telemetry is disabled. Preference changes do not enable an external connection.')}</section>
        {section('Diagnostic Data Viewer', <button disabled>View Diagnostic Data</button>)}
      </>}
      {category === 'pride' && section('Show Your Pride', <><p>Choose an accent for your Writer account badge.</p><div className="wr-pref-pride-options">{[['none','Default'],['rainbow','Rainbow'],['trans','Transgender'],['nonbinary','Nonbinary']].map(([value,label]) => <label key={value}><i className={`wr-pride-swatch wr-pride-${value}`}/><input type="radio" name="wr-pride" checked={p.pride === value} onChange={() => update('pride',value as WriterPreferences['pride'])}/>{label}</label>)}</div></>)}
      </>}
    </div>
  </div></section></div>;
}
