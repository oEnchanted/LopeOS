import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FilePlus2, FileText, FolderOpen, Printer, Save } from 'lucide-react';
import { WriterEngine } from '../../../../../packages/document-engine/src';
import type { AppContext } from '../../../../../packages/contracts/src';
import { createPrintHtml } from './print';
import type { RecentDocument } from './index';
import { AccountStatus } from '../../accounts/AccountPanel';
import { useAnimatedDismiss } from './motion';
import { playWriterSound, type WriterPreferences } from './preferences';

type Props = { preferences: WriterPreferences; section: string; setSection: (s: string) => void; close: () => void; source: { title: string; path: string | null; preserveOriginal: boolean }; context: AppContext; run: (id: string) => void; openPath: (path: string) => void; printSource: Uint8Array | null; engine: WriterEngine | null; error: string; perform: (action: () => unknown | Promise<unknown>) => Promise<void> };
export function Backstage({ section, setSection, close: onClose, source, context, run, openPath, printSource, engine, error, perform, preferences }: Props) {
  const root = useRef<HTMLElement>(null);
  const { close, closing } = useAnimatedDismiss(onClose, root);
  useEffect(() => { root.current?.querySelector<HTMLButtonElement>('.wr-back')?.focus(); }, []);
  const recents = context.services.settings.get<RecentDocument[]>('writer.recent', []);
  return <section ref={root} className={`writer-backstage ${closing ? 'wr-is-closing' : ''}`} aria-label="File Backstage" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')].filter(n => n.offsetParent !== null);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && index <= 0) { e.preventDefault(); items.at(-1)?.focus(); }
    else if (!e.shiftKey && index === items.length - 1) { e.preventDefault(); items[0]?.focus(); }
  }}><nav><button className="wr-back" aria-label="Back to document" onClick={close}><ArrowLeft size={24}/></button>{['Home','New','Open','Info','Save','Save As','Print','Export','Account','Options'].map(item => <button key={item} className={section === item ? 'selected' : ''} onClick={() => { if (item === 'Save') { close(); run('save'); } else if (item === 'Print') run('print'); else if (item === 'Options') run('preferences'); else setSection(item); }}>{item}</button>)}</nav><div className="wr-backstage-content" key={section}>
    <h1>{section}</h1>
    {(section === 'Home' || section === 'New') && <><h2>New</h2><div className="wr-template-list"><button onClick={() => run('new')}><span className="wr-template-page"/><strong>Blank document</strong></button></div></>}
    {(section === 'Home' || section === 'Open') && <><div className="wr-backstage-heading"><h2>Recent</h2><button onClick={() => run('open')}><FolderOpen size={16}/>Browse workspace</button></div>{recents.length ? <div className="wr-recents">{recents.map(file => <button key={file.path} onClick={() => openPath(file.path)}><FileText size={27}/><span><strong>{file.name}</strong><small>{file.path}</small></span><small>{new Date(file.opened).toLocaleDateString('en-US')}</small></button>)}</div> : <p>No recent documents yet.</p>}</>}
    {section === 'Save As' && <><div className="wr-save-location"><FolderOpen size={38}/><div><h2>LopeOS workspace</h2><p>Choose a location and filename in your workspace.</p><button className="wr-primary" onClick={() => { close(); run('save-as'); }}><Save size={16}/>Browse</button></div></div>{source.preserveOriginal && <p>Save a copy to preserve unsupported features in the original package.</p>}</>}
    {section === 'Info' && <><h2>{source.title}</h2><p>{source.path || 'This document has not been saved to the workspace.'}</p><dl><dt>File format</dt><dd>Word document (.docx)</dd><dt>Document engine</dt><dd>SuperDoc 2.30.0</dd><dt>Compatibility</dt><dd>{source.preserveOriginal ? 'Save a copy required' : 'Editable DOCX'}</dd></dl><button onClick={() => run('about')}>About Writer</button></>}
    {section === 'Export' && <><h2>Create a document copy</h2><p>Download a Word document or print a PDF copy.</p><div className="wr-export-options"><button onClick={() => run('export')}><FileText size={32}/><span><strong>Export Word Document</strong><small>DOCX, with comments and revisions preserved</small></span></button><button onClick={() => run('print')}><Printer size={32}/><span><strong>Create PDF / Print</strong><small>Preview pages before printing</small></span></button></div></>}
    {section === 'Print' && <PrintPreview preferences={preferences} bytes={printSource} engine={engine} perform={perform} sourceError={error}/>}
    {section === 'Account' && <><h2>LopeOS Account</h2><p>Your saved documents, Writer preferences, and recovery drafts sync with your account. Each account includes 1 GB of free cloud storage.</p><AccountStatus/><button onClick={() => { close(); context.services.launch('lope.settings', { page: 'account' }); }}>Manage LopeOS account</button></>}
    {section === 'Options' && <button onClick={() => run('preferences')}>Open Preferences…</button>}
  </div></section>;
}

function PrintPreview({ bytes, engine, perform, sourceError, preferences }: { bytes: Uint8Array | null; engine: WriterEngine | null; perform: Props['perform']; sourceError: string; preferences: WriterPreferences }) {
  const mount = useRef<HTMLDivElement>(null);
  const previewEngine = useRef<WriterEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState(1);
  const [printError, setPrintError] = useState('');
  const [review, setReview] = useState<'review'|'final'|'original'>(preferences.printReview);
  useEffect(() => {
    setReady(false); setPrintError('');
    if (!bytes) return;
    let active = true;
    const fail = (error: unknown) => { if (active) { setReady(false); setPrintError(error instanceof Error ? error.message : 'Print preview could not be prepared.'); } };
    const instance = new WriterEngine(s => { if (active) setPages(s.pages); }, fail);
    previewEngine.current = instance;
    void instance.mount(mount.current!, bytes, true, true).then(() => { if (active) { instance.setReviewDisplay(review); instance.setZoom(55); setReady(true); } }).catch(fail);
    return () => { active = false; instance.destroy(); previewEngine.current = null; };
  }, [bytes]);
  async function print() {
    if (!previewEngine.current || !mount.current) return;
    const html = createPrintHtml(mount.current, pages, { reverseOrder: preferences.reversePrint, drawings: preferences.printDrawings, backgrounds: preferences.printBackgrounds });
    const frame = document.createElement('iframe');
    frame.title = 'Print document'; frame.className = 'wr-print-frame'; document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open(); doc.write(html); doc.close();
    await doc.fonts.ready;
    await new Promise(resolve => setTimeout(resolve, 150));
    frame.contentWindow!.addEventListener('afterprint', () => frame.remove(), { once: true });
    playWriterSound(preferences.eventSounds);
    frame.contentWindow!.focus(); frame.contentWindow!.print();
    // Some browsers omit afterprint. Keep the document alive while the print UI is open.
    setTimeout(() => frame.remove(), 300000);
    previewEngine.current?.setZoom(55);
  }
  return <div className="wr-print-preview"><div className="wr-print-settings"><button className="wr-print-button" disabled={!ready} onClick={() => void perform(print)}><Printer size={32}/><span>Print</span></button><h2>Printer</h2><p>Browser print dialog</p><p className="wr-print-note">Choose “Save as PDF” in the print dialog to save a PDF copy.</p><h2>Settings</h2><p>Print All Pages</p><p>Document page size and orientation</p><select aria-label="Print review display" value={review} onChange={e => { const value = e.target.value as typeof review; setReview(value); previewEngine.current?.setReviewDisplay(value); }}><option value="review">Print Markup</option><option value="final">Final — No Markup</option><option value="original">Original</option></select><p>{ready ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : 'Preparing preview…'}</p></div><div className="wr-print-preview-stage"><div className="wr-print-preview-canvas" ref={mount}/>{!ready && !printError && !sourceError && <div className="wr-print-loading" role="status">Preparing print preview…</div>}{(printError || sourceError) && <p className="wr-dialog-error" role="alert">{printError || sourceError}</p>}</div></div>;
}
