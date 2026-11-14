import { AppIcon } from '../../shell/Icons';
import { cloneElement, useEffect, useRef, useState, type ReactElement } from 'react';
import { FileText, X } from 'lucide-react';
import { WriterEngine, assertReceipt, type SelectionCapture, type WriterSnapshot } from '../../../../../packages/document-engine/src';
import type { WriterPreferences } from './preferences';
import { insertPicture, readPictureFile } from './pictures';
import { useAnimatedDismiss } from './motion';

export type DialogKind = 'font' | 'paragraph' | 'table' | 'picture' | 'pictureformat' | 'tableformat' | 'link' | 'comment' | 'style' | 'header' | 'footer' | 'footnote' | 'endnote' | 'symbol' | 'zoom' | 'pagesetup' | 'wordcount' | 'language' | 'mode' | 'account' | 'share' | 'about' | 'help' | 'clipboard' | null;
type Props = { selectedPictureId?: string | null; selectPicture?: (id: string) => void; readOnly?: boolean; preferences?: WriterPreferences; kind: NonNullable<DialogKind>; engine: WriterEngine | null; snapshot: WriterSnapshot; capture: SelectionCapture | null; close: () => void; perform: (action: () => unknown | Promise<unknown>) => Promise<void>; setTab: (tab: string) => void };
const names: Record<NonNullable<DialogKind>, string> = { font: 'Font', paragraph: 'Paragraph', table: 'Insert Table', picture: 'Insert Picture', pictureformat: 'Picture Format', tableformat: 'Table Properties', link: 'Insert Hyperlink', comment: 'New Comment', style: 'Modify Style', header: 'Header', footer: 'Footer', footnote: 'Insert Footnote', endnote: 'Insert Endnote', symbol: 'Symbol', zoom: 'Zoom', pagesetup: 'Page Setup', wordcount: 'Word Count', language: 'Language', mode: 'Document Mode', account: 'Account', share: 'Share', about: 'About LopeOS Quill', help: 'Quill Help', clipboard: 'Clipboard' };

export function WriterDialog({ selectedPictureId, selectPicture, readOnly = false, preferences, kind, engine, snapshot, capture, close: onClose, perform, setTab: setRibbonTab }: Props) {
  const [font, setFont] = useState(String(snapshot.state?.toolbar.commands['font-family']?.value || 'Aptos'));
  const [size, setSize] = useState(Number(snapshot.state?.toolbar.commands['font-size']?.value || 11));
  const [bold, setBold] = useState(Boolean(snapshot.state?.toolbar.commands.bold?.active));
  const [italic, setItalic] = useState(Boolean(snapshot.state?.toolbar.commands.italic?.active));
  const [underline, setUnderline] = useState(Boolean(snapshot.state?.toolbar.commands.underline?.active));
  const [strike, setStrike] = useState(Boolean(snapshot.state?.toolbar.commands.strikethrough?.active));
  const [color, setColor] = useState(String(snapshot.state?.toolbar.commands['text-color']?.value || '#000000'));
  const [align, setAlign] = useState('left');
  const [before, setBefore] = useState(0);
  const [after, setAfter] = useState(8);
  const [line, setLine] = useState(1.15);
  const [indent, setIndent] = useState(0);
  const [rightIndent, setRightIndent] = useState(0);
  const [keepNext, setKeepNext] = useState(false);
  const [widow, setWidow] = useState(true);
  const [pageBreak, setPageBreak] = useState(false);
  const [shading, setShading] = useState('');
  const [border, setBorder] = useState(false);
  const [tabStop, setTabStop] = useState(0);
  const [repeatHeader, setRepeatHeader] = useState(false);
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [text, setText] = useState('');
  const [href, setHref] = useState('https://');
  const [style, setStyle] = useState(snapshot.state?.styles.activeParagraphStyleId || 'Heading1');
  const [zoom, setZoom] = useState(snapshot.state?.zoom.value || 100);
  const [file, setFile] = useState<File | null>(null);
  const [width, setWidth] = useState(kind === 'tableformat' ? 120 : 320);
  const [height, setHeight] = useState(200);
  const [wrap, setWrap] = useState(kind === 'mode' ? snapshot.state?.documentMode || 'editing' : 'inline');
  const [pictures, setPictures] = useState<Awaited<ReturnType<WriterEngine['api']['images']['list']>>['items']>([]);
  const [pictureId, setPictureId] = useState('');
  const [lockAnchor, setLockAnchor] = useState(false);
  const [crop, setCrop] = useState({ left:0,right:0,top:0,bottom:0 });
  const [tab, setTab] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const [loading, setLoading] = useState(['font','paragraph','pictureformat','tableformat'].includes(kind));
  const [paragraphCount, setParagraphCount] = useState(1);
  const changed = useRef(new Set<string>());
  const pictureRequest = useRef(0);
  const root = useRef<HTMLElement>(null);
  const { close, closing } = useAnimatedDismiss(onClose, root);
  useEffect(() => {
    if (kind !== 'picture' || !file) return;
    let active = true;
    void readPictureFile(file).then(size => { if (!active) return; if (!changed.current.has('Width (px):')) setWidth(size.width); if (!changed.current.has('Height (px):')) setHeight(size.height); }).catch(cause => { if (active) setFailure(cause instanceof Error ? cause.message : 'The picture could not be opened.'); });
    return () => { active = false; };
  }, [file,kind]);
  const measurement = preferences?.measurementUnit === 'cm' ? 2.54 : 1;
  const unit = preferences?.measurementUnit === 'cm' ? 'cm' : 'inches';
  const leftLabel = `Left (${unit}):`, rightLabel = `Right (${unit}):`, tabLabel = `Tab stop (${unit}):`;
  const latest = useRef({ pending, loading, close, apply });
  latest.current = { pending, loading, close, apply };
  const title = names[kind];
  useEffect(() => {
    if (!loading) root.current?.querySelector<HTMLElement>('.writer-dialog-body input, .writer-dialog-body select, .writer-dialog-body textarea')?.focus();
  }, [loading]);
  useEffect(() => {
    const el = root.current!;
    const items = () => [...el.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(n => n.offsetParent !== null && !n.closest('[inert]'));
    el.querySelector<HTMLElement>('.writer-dialog-body input, .writer-dialog-body select, .writer-dialog-body textarea')?.focus();
    if (!el.contains(document.activeElement)) items()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!latest.current.pending) latest.current.close(); }
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !['file','checkbox','radio'].includes(e.target.type)) {
        e.preventDefault(); if (!latest.current.pending && !latest.current.loading) void latest.current.apply();
      }
      if (e.key === 'Tab') {
        const list = items(), i = list.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); list.at(-1)?.focus(); }
        else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0]?.focus(); }
      }
    };
    el.addEventListener('keydown', trap);
    return () => { el.removeEventListener('keydown', trap); const active = document.activeElement; if (!active || active === document.body || el.contains(active)) engine?.focus(); };
  }, [kind]);
  useEffect(() => {
    if (!engine?.snapshot.ready) return;
    let active = true;
    void (async () => {
      if (kind === 'font') {
        const result = await engine.invoke('format.readSelection', { selection: 'current', keys: ['fontFamily','fontSize','bold','italic','underline','strike','color'] });
        if (!active) return;
        const { properties: p } = result;
        if (p.fontFamily?.state === 'uniform' && typeof p.fontFamily.value === 'string') setFont(p.fontFamily.value);
        if (p.fontSize?.state === 'uniform' && typeof p.fontSize.value === 'number') setSize(p.fontSize.value);
        if (p.bold?.state === 'uniform') setBold(Boolean(p.bold.value));
        if (p.italic?.state === 'uniform') setItalic(Boolean(p.italic.value));
        if (p.underline?.state === 'uniform') setUnderline(Boolean(p.underline.value));
        if (p.strike?.state === 'uniform') setStrike(Boolean(p.strike.value));
        if (p.color?.state === 'uniform' && typeof p.color.value === 'string' && /^#?[\da-f]{6}$/i.test(p.color.value)) setColor('#' + p.color.value.replace('#',''));
      } else if (kind === 'paragraph') {
        const targets = await engine.selectedParagraphs(capture);
        if (!active) return;
        setParagraphCount(targets.length);
        if (!targets[0]) return;
        const { node } = await engine.api.getNode(targets[0]);
        if (!active) return;
        const paragraph = node.kind === 'paragraph' ? node.paragraph : node.kind === 'heading' ? node.heading : null;
        const p = paragraph ? { ...paragraph.resolved, ...paragraph.props } : null;
        if (p) {
          setAlign(p.alignment || 'left'); setBefore(p.spacing?.before || 0); setAfter(p.spacing?.after || 0);
          if (p.spacing?.lineRule === 'auto' || p.spacing?.lineRule === 'multiple') setLine(p.spacing.line || 1.15);
          setIndent((p.indent?.left || 0) / 72); setRightIndent((p.indent?.right || 0) / 72); setKeepNext(Boolean(p.keepWithNext)); setWidow(p.widowControl !== false); setPageBreak(Boolean(p.pageBreakBefore));
        }
      } else if (kind === 'pictureformat') {
        const result = await engine.api.images.list({});
        if (!active) return;
        setPictures(result.items);
        const image = result.items.find(image => image.sdImageId === selectedPictureId) || result.items.at(-1);
        if (image) loadPicture(await engine.api.images.get({ imageId: image.sdImageId }));
      } else if (kind === 'tableformat') {
        const context = await engine.ui!.tables.getContextAsync();
        if (!context.tableNodeId) return;
        const { node } = await engine.api.getNode({ kind: 'block', nodeType: 'table', nodeId: context.tableNodeId });
        if (!active || node.kind !== 'table') return;
        setWidth(node.table.columns?.[context.columnIndex || 0]?.width || 120);
        setRepeatHeader(Boolean(node.table.rows[0]?.props?.repeatHeader));
      }
    })().catch(cause => { if (active) setFailure(cause instanceof Error ? cause.message : 'Current settings could not be read.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, engine]);
  function loadPicture(image: typeof pictures[number]) {
    setPictureId(image.sdImageId); setWidth(image.properties.size?.width || 320); setHeight(image.properties.size?.height || 200);
    setText(image.properties.description || image.properties.alt || '');
    const flags = image.properties as typeof image.properties & { inline?: boolean };
    setWrap(flags.placement === 'floating' || flags.inline === false ? image.properties.wrap?.type === 'TopAndBottom' ? 'topAndBottom' : image.properties.wrap?.type === 'None' ? 'none' : 'square' : 'inline');
    setCrop({left:image.properties.crop?.left||0,right:image.properties.crop?.right||0,top:image.properties.crop?.top||0,bottom:image.properties.crop?.bottom||0}); setLockAnchor(false); changed.current.clear();
  }
  async function choosePicture(id: string) {
    if (!engine) return;
    const request = ++pictureRequest.current; setLoading(true); setFailure('');
    try { const image = await engine.api.images.get({ imageId:id }); if (request === pictureRequest.current) loadPicture(image); }
    catch (cause) { if (request === pictureRequest.current) setFailure(cause instanceof Error ? cause.message : 'The picture could not be opened.'); }
    finally { if (request === pictureRequest.current) setLoading(false); }
  }
  const change = (key: string, action: () => void) => { changed.current.add(key); action(); };
  const has = (key: string) => changed.current.has(key);
  const readonly = ['wordcount','language','account','share','about','help','clipboard'].includes(kind);
  const editingDisabled = !readonly && !['zoom','mode'].includes(kind) && snapshot.state?.documentMode === 'viewing';
  const label = (name: string, control: ReactElement<{ id?: string }>) => {
    const id = `wr-${kind}-${name.replace(/[^a-z]/gi,'').toLowerCase()}`;
    return <label className="wr-form-label" htmlFor={id}><span>{name}</span>{cloneElement(control, { id })}</label>;
  };
  const number = (name: string, value: number, set: (n: number) => void, min = 0, max = 1000, step = 1) => label(name, <input type="number" aria-label={name} value={value} required min={min} max={max} step={step} onChange={e => change(name, () => set(Number(e.target.value)))}/>);
  async function apply() {
    if (!engine || pending || loading) return;
    const invalid = root.current?.querySelector<HTMLInputElement>('input:invalid');
    if (invalid) { invalid.reportValidity(); return; }
    latest.current.pending = true; setPending(true); setFailure('');
    try {
      // These operations use explicit captured targets. Restoring UI selection
      // here can race the native paragraph transaction's revision check.
      if (capture && !['comment','style','pictureformat','font','paragraph'].includes(kind)) engine.restore(capture);
      root.current?.focus({ preventScroll: true });
      const target = capture?.selectionTarget || engine.ui?.selection.current()?.selectionTarget;
      if (kind === 'font') {
        if (!target) throw new Error('Select text before applying font formatting.');
        const inline = { ...(has('font') && { fontFamily: font }), ...(has('Size:') && { fontSize: size }), ...(has('bold') && { bold }), ...(has('italic') && { italic }), ...(has('underline') && { underline }), ...(has('strike') && { strike }), ...(has('color') && { color }) };
        if (Object.keys(inline).length) await engine.invoke('format.apply', { target, inline });
      } else if (kind === 'paragraph') {
        const targets = await engine.selectedParagraphs(capture);
        if (!targets.length) throw new Error('Place the caret in a paragraph first.');
        const operations: Parameters<WriterEngine['api']['format']['paragraph']['applyBatch']>[0]['operations'] = [];
        if (has('align')) operations.push({ operationId: 'format.paragraph.setAlignment', input: { alignment: align as 'left' | 'right' | 'center' | 'justify' } });
        if (has('Before (pt):') || has('After (pt):') || has('Line spacing:')) operations.push({ operationId: 'format.paragraph.setSpacing', input: { ...(has('Before (pt):') && { before: before * 20 }), ...(has('After (pt):') && { after: after * 20 }), ...(has('Line spacing:') && { line: line * 240, lineRule: 'auto' }) } });
        if (has(leftLabel) || has(rightLabel)) operations.push({ operationId: 'format.paragraph.setIndentation', input: { ...(has(leftLabel) && {left: indent * 1440}), ...(has(rightLabel) && {right: rightIndent * 1440}) } });
        if (has('keepNext') || has('widow')) operations.push({ operationId: 'format.paragraph.setKeepOptions', input: { ...(has('keepNext') && { keepNext }), ...(has('widow') && { widowControl: widow }) } });
        if (has('pageBreak')) operations.push({ operationId: 'format.paragraph.setFlowOptions', input: { pageBreakBefore: pageBreak } });
        if (has(tabLabel)) operations.push({ operationId: 'format.paragraph.setTabStop', input: { position: tabStop * 1440, alignment: 'left' } });
        if (shading) operations.push({ operationId: 'format.paragraph.setShading', input: { fill: shading.replace('#','') } });
        if (border) operations.push({ operationId: 'format.paragraph.setBorder', input: { side: 'bottom', style: 'single', color: '000000', size: 8 } });
        // A single indentation edit needs one native setter, rather than a
        // batch plan that can conflict with formatting-mark view hydration.
        if (targets.length===1&&operations.length===1&&operations[0].operationId==='format.paragraph.setIndentation') await engine.invoke('format.paragraph.setIndentation',{target:targets[0],...operations[0].input});
        else if (operations.length) await engine.invoke('format.paragraph.applyBatch', { targets, operations });
      } else if (kind === 'style') {
        const patch = { ...(has('Size:') && { fontSize: size * 2 }), ...(has('bold') && { bold }), ...(has('italic') && { italic }), ...(has('strike') && { strike }), ...(has('font') && { fontFamily: { ascii: font, hAnsi: font } }), ...(has('color') && { color: { val: color.replace('#','') } }), ...(has('underline') && { underline: { val: underline ? 'single' : 'none' } }) };
        if (Object.keys(patch).length) await engine.invoke('styles.apply', { target: { scope: 'style', styleId: style, channel: 'run' }, patch });
      } else if (kind === 'table') {
        await engine.command('table-insert', { rows: Math.min(100, Math.max(1, rows)), columns: Math.min(20, Math.max(1, columns)) }); setRibbonTab('Table Layout');
      } else if (kind === 'picture') {
        if (!file) throw new Error('Choose an image first.');
        const id = await insertPicture(engine,file,{ alt:text || file.name,width:has('Width (px):') ? width : undefined,height:has('Height (px):') ? height : undefined,wrap:preferences?.defaultPictureWrap });
        selectPicture?.(id);
        setRibbonTab('Picture Format');
      } else if (kind === 'pictureformat') {
        const images = await engine.api.images.list({});
        const summary = images.items.find(image => image.sdImageId === pictureId);
        const image = summary && await engine.api.images.get({ imageId: summary.sdImageId });
        if (!image) throw new Error('Insert a picture first.');
        const imageId = image.sdImageId;
        if (has('wrap')) {
          if (wrap === 'inline') assertReceipt(await engine.api.images.convertToInline({ imageId }));
          else { if(image.properties.placement!=='floating')assertReceipt(await engine.api.images.convertToFloating({ imageId })); assertReceipt(await engine.api.images.setWrapType({ imageId, type: wrap === 'square' ? 'Square' : wrap === 'none' ? 'None' : 'TopAndBottom' })); }
        }
        if (has('lockAnchor') && wrap !== 'inline') assertReceipt(await engine.api.images.setAnchorOptions({ imageId, options: { lockAnchor } }));
        if (has('pictureAlt')) assertReceipt(await engine.api.images.setAltText({ imageId,description:text }));
        // The engine requires both dimensions. Preserve the untouched dimension from the fresh image read.
        if (has('Width (px):') || has('Height (px):')) assertReceipt(await engine.api.images.setSize({ imageId, size: { width: has('Width (px):') ? width : image.properties.size?.width || width, height: has('Height (px):') ? height : image.properties.size?.height || height } }));
        const sides = ['left','right','top','bottom'] as const;
        if (sides.some(side=>has(`Crop ${side} (%)`))) {
          const next = Object.fromEntries(sides.map(side=>[side,has(`Crop ${side} (%)`)?crop[side]:image.properties.crop?.[side]||0])) as typeof crop;
          if(next.left+next.right>=100||next.top+next.bottom>=100)throw new Error('Keep some of the picture visible between opposite crop edges.');
          assertReceipt(await engine.api.images.crop({ imageId,crop:next }));
        }
      } else if (kind === 'link') {
        const url = new URL(href);
        if (!['https:','http:','mailto:'].includes(url.protocol)) throw new Error('Use an https, http, or mailto link.');
        await engine.command('link', { href, ...(text || !capture ? { text: text || href } : {}) });
      } else if (kind === 'comment') {
        if (!capture) throw new Error('Select text before adding a comment.');
        if (!text.trim()) throw new Error('Enter a comment.');
        await engine.addComment(capture, text.trim());
      } else if (kind === 'footnote' || kind === 'endnote') {
        if (target) await engine.ui?.selection.applyAndWait({ ...target, start: target.end, end: target.end });
        await engine.invoke('footnotes.insert', { type: kind, content: text });
      } else if (kind === 'header' || kind === 'footer') {
        const sections = await engine.api.sections.list({});
        const section = sections.items[0]?.address;
        if (!section) throw new Error('No section is available.');
        const slot = { kind: 'headerFooterSlot' as const, section, headerFooterKind: kind, variant: 'default' as const };
        const existing = await engine.api.headerFooters.resolve({ target: slot });
        let refId: string;
        if (existing.status !== 'none') refId = existing.refId;
        else {
          const part = await engine.api.headerFooters.parts.create({ kind }); assertReceipt(part);
          if (!part.success) return;
          refId = part.refId;
          assertReceipt(await engine.api.headerFooters.refs.set({ target: slot, refId }));
        }
        await engine.invoke('create.paragraph', { text, in: { kind: 'story', storyType: 'headerFooterPart', refId } });
      } else if (kind === 'symbol') {
        await engine.insertTextAtSelection(text || '©', target || undefined);
      } else if (kind === 'zoom') engine.setZoom(zoom);
      else if (kind === 'pagesetup') await engine.pageSetup('margins', indent || 1);
      else if (kind === 'mode') engine.setMode((readOnly ? 'viewing' : wrap === 'inline' ? 'editing' : wrap) as 'editing' | 'suggesting' | 'viewing');
      else if (kind === 'tableformat') {
        const table = await engine.ui!.tables.getContextAsync();
        if (!table.inTable || !table.tableNodeId) throw new Error('Place the caret in a table cell first.');
        if (has('Column width (pt):')) await engine.invoke('tables.setColumnWidth', { nodeId: table.tableNodeId, columnIndex: table.columnIndex || 0, widthPt: width });
        if (has('repeatHeader')) await engine.invoke('tables.setRowOptions', { nodeId: table.tableNodeId, rowIndex: 0, repeatHeader });
        if (shading) await engine.invoke('tables.setShading', { nodeId: table.cellNodeId || table.tableNodeId, color: shading.replace('#','') });
        if (border) await engine.invoke('tables.applyBorderPreset', { nodeId: table.tableNodeId, preset: 'all' });
      }
      close();
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'This change could not be applied.'); }
    finally { setPending(false); }
  }
  const fontControls = <><div className="wr-form-grid">{label('Font:', <select aria-label="Dialog font" value={font} onChange={e => change('font', () => setFont(e.target.value))}>{['Aptos','Calibri','Arial','Times New Roman','Cambria','Georgia','Verdana','Courier New'].map(f => <option key={f}>{f}</option>)}</select>)}{number('Size:', size, setSize, 1, 1638)}</div>{label('Font color:', <input type="color" aria-label="Dialog font color" value={color} onChange={e => change('color', () => setColor(e.target.value))}/>)}<fieldset><legend>Effects</legend><div className="wr-check-grid">{[['Bold',bold,setBold,'bold'],['Italic',italic,setItalic,'italic'],['Underline',underline,setUnderline,'underline'],['Strikethrough',strike,setStrike,'strike']].map(([name,value,set,key]) => <label key={String(name)}><input type="checkbox" checked={Boolean(value)} onChange={e => change(String(key), () => (set as (b: boolean) => void)(e.target.checked))}/>{String(name)}</label>)}</div></fieldset><fieldset><legend>Preview</legend><div className="wr-font-preview" style={{ fontFamily: `${font}, Arial, sans-serif`, fontSize: Math.min(40,size), fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal', color, textDecoration: [underline && 'underline', strike && 'line-through'].filter(Boolean).join(' ') || 'none' }}>AaBbCcYyZz</div></fieldset></>;
  return <div className={`writer-modal-backdrop ${closing ? 'wr-is-closing' : ''}`}><section ref={root} className={`writer-dialog wr-dialog-${kind}`} role="dialog" tabIndex={-1} aria-modal="true" aria-label={title}><header><h2>{title}</h2><button aria-label={`Close ${title}`} disabled={pending || closing} onClick={close}><X size={16}/></button></header><div className="writer-dialog-body" inert={pending || loading || closing} aria-busy={loading || pending}>
    {kind === 'font' && <><div className="wr-dialog-tabs"><button className="selected">Font</button><button disabled title="Advanced typography is not implemented">Advanced</button></div>{fontControls}</>}
    {kind === 'paragraph' && <>{paragraphCount > 1 && <p className="wr-selection-note">{paragraphCount} selected paragraphs. Only settings you change will be applied.</p>}<div className="wr-dialog-tabs">{['Indents and Spacing','Line and Page Breaks'].map(t => <button key={t} className={(tab || 'Indents and Spacing') === t ? 'selected' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>{tab !== 'Line and Page Breaks' ? <><fieldset><legend>General</legend>{label('Alignment:', <select value={align} onChange={e => change('align', () => setAlign(e.target.value))}>{['left','center','right','justify'].map(v => <option key={v}>{v}</option>)}</select>)}</fieldset><fieldset><legend>Indentation</legend>{number(leftLabel, Number((indent*measurement).toFixed(3)), value => setIndent(value/measurement), 0, 8*measurement, .01)}{number(rightLabel, Number((rightIndent*measurement).toFixed(3)), value => setRightIndent(value/measurement), 0, 8*measurement, .01)}{number(tabLabel, Number((tabStop*measurement).toFixed(3)), value => setTabStop(value/measurement), 0, 8*measurement, .01)}</fieldset><fieldset><legend>Spacing</legend><div className="wr-form-grid">{number('Before (pt):', before, setBefore, 0, 1584)}{number('After (pt):', after, setAfter, 0, 1584)}{number('Line spacing:', line, setLine, .5, 10, .05)}</div></fieldset></> : <fieldset><legend>Pagination</legend><div className="wr-stack-checks"><label><input type="checkbox" checked={widow} onChange={e => change('widow', () => setWidow(e.target.checked))}/>Widow/Orphan control</label><label><input type="checkbox" checked={keepNext} onChange={e => change('keepNext', () => setKeepNext(e.target.checked))}/>Keep with next</label><label><input type="checkbox" checked={pageBreak} onChange={e => change('pageBreak', () => setPageBreak(e.target.checked))}/>Page break before</label></div></fieldset>}<fieldset><legend>Preview</legend><div className="wr-paragraph-preview"><i/><i/><i/><i/></div></fieldset></>}
    {kind === 'style' && <>{label('Style:', <select value={style} onChange={e => setStyle(e.target.value)}>{[['Normal','Normal'],['NoSpacing','No Spacing'],['Heading1','Heading 1'],['Heading2','Heading 2'],['Title','Title']].map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select>)}<p>Changes apply to all paragraphs using this style.</p>{fontControls}</>}
    {kind === 'table' && <><fieldset><legend>Table size</legend>{number('Number of columns:', columns, setColumns, 1, 20)}{number('Number of rows:', rows, setRows, 1, 100)}</fieldset><fieldset><legend>AutoFit behavior</legend><label><input type="radio" checked readOnly/>Fixed column width: Auto</label></fieldset></>}
    {(kind === 'picture' || kind === 'pictureformat') && <>{kind === 'picture' ? <>{label('Image file:', <input type="file" aria-label="Picture file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => setFile(e.target.files?.[0] || null)}/>)}{label('Alt text:', <input value={text} onChange={e => setText(e.target.value)}/>)}</> : <>{label('Picture:', <select aria-label="Picture to format" value={pictureId} onChange={e => void choosePicture(e.target.value)}>{pictures.map((picture,index) => <option key={picture.sdImageId} value={picture.sdImageId}>{index+1}. {picture.properties.name || picture.properties.description || 'Picture'}</option>)}</select>)}{label('Alt text:',<input aria-label="Picture alt text" value={text} onChange={event=>change('pictureAlt',()=>setText(event.target.value))}/>)}{label('Text wrapping:', <select aria-label="Text wrapping" value={wrap} onChange={e => change('wrap', () => setWrap(e.target.value))}><option value="inline">In Line with Text</option><option value="square">Square</option><option value="topAndBottom">Top and Bottom</option><option value="none">No text wrapping</option></select>)}<fieldset><legend>Crop</legend><div className="wr-form-grid">{(['left','right','top','bottom'] as const).map(side=>label(`Crop ${side} (%)`,<input type="number" aria-label={`Crop ${side} (%)`} value={crop[side]} min={0} max={99.999} step="any" onChange={event=>change(`Crop ${side} (%)`,()=>setCrop(previous=>({...previous,[side]:Number(event.target.value)})))}/>))}</div></fieldset><label><input type="checkbox" checked={lockAnchor} onChange={e => change('lockAnchor', () => setLockAnchor(e.target.checked))}/>Lock floating picture anchor</label></>}<div className="wr-form-grid">{number('Width (px):', width, setWidth, 1, 2000)}{number('Height (px):', height, setHeight, 1, 2000)}</div></>}
    {kind === 'tableformat' && <><p>Column width applies to the column containing the current cell.</p>{number('Column width (pt):', width, setWidth, 12, 600)}<label><input type="checkbox" checked={repeatHeader} onChange={e => change('repeatHeader', () => setRepeatHeader(e.target.checked))}/> Repeat first row as header</label></>}
    {kind === 'link' && <>{label('Text to display:', <input value={text} onChange={e => setText(e.target.value)} placeholder={capture?.quotedText || 'Link text'}/>)}{label('Address:', <input aria-label="Link address" value={href} onChange={e => setHref(e.target.value)}/>)}</>}
    {['comment','header','footer','footnote','endnote'].includes(kind) && <>{kind === 'comment' && <blockquote>{capture?.quotedText || 'Select document text before adding a comment.'}</blockquote>}{kind === 'header' || kind === 'footer' ? <p>Add a {kind} to the first section. Text is appended to existing {kind} content.</p> : null}<textarea aria-label={`${title} text`} autoFocus rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={kind === 'comment' ? 'Mention or comment…' : 'Enter text…'}/></>}
    {kind === 'symbol' && <><div className="wr-symbol-grid">{['©','®','™','€','£','¥','±','×','÷','∞','α','β','Ω','π','→','—','§','¶','✓','…'].map(s => <button key={s} className={s === text ? 'selected' : ''} onClick={() => setText(s)}>{s}</button>)}</div>{label('Selected symbol:', <input value={text || '©'} onChange={e => setText(e.target.value)}/>)}</>}
    {kind === 'zoom' && <>{number('Percent:', zoom, setZoom, 25, 200, 5)}<div className="wr-zoom-presets">{[50,75,100,125,150,200].map(v => <button key={v} onClick={() => setZoom(v)}>{v}%</button>)}</div></>}
    {kind === 'pagesetup' && <>{number(`All margins (${unit}):`, Number(((indent || 1)*measurement).toFixed(3)), value => setIndent(value/measurement), .25*measurement, 3*measurement, .01)}<p>Applies to every section. Size, orientation, and columns are on the Layout ribbon.</p></>}
    {kind === 'wordcount' && <dl className="wr-statistics"><dt>Pages</dt><dd>{snapshot.pages}</dd><dt>Words</dt><dd>{snapshot.words}</dd><dt>Selected text</dt><dd>{snapshot.state?.selection.quotedText.length || 0} characters</dd></dl>}
    {kind === 'language' && <><p>Proofing language: English (United States)</p><p>A spelling and grammar service is not connected. Document language metadata is preserved on DOCX export.</p></>}
    {kind === 'mode' && <>{label('Mode:', <select value={wrap === 'inline' ? 'editing' : wrap} onChange={e => change('wrap', () => setWrap(e.target.value))}><option value="editing" disabled={readOnly}>Editing</option><option value="suggesting" disabled={readOnly}>Reviewing — Track Changes</option><option value="viewing">Viewing</option></select>)}</>}
    {kind === 'account' && <><p><strong>LopeOS Account</strong></p><p>Sign in through Settings → LopeOS Account for 1 GB of free storage. Your saved documents, preferences, and recovery drafts sync automatically. Open LopeDrive in Files to see sync progress.</p></>}{kind === 'share' && <><p><strong>Share a document copy</strong></p><p>Download a DOCX copy from File → Export to share it. Account sync keeps your own devices up to date; live collaboration is not connected.</p></>}
    {kind === 'about' && <><div className="wr-about"><AppIcon name="writer" size={40}/><div><h3>LopeOS Quill</h3><p>Version 0.1.0 • Document engine: SuperDoc 2.30.0</p></div></div><p>SuperDoc’s UI is AGPL-3.0; its DOCX Engine has a separate proprietary license.</p></>}
    {kind === 'help' && <><p>Use the Home ribbon for formatting, Insert for tables and pictures, and Review for comments and tracked changes.</p><dl className="wr-statistics"><dt>Save</dt><dd>Ctrl / ⌘ S</dd><dt>Find</dt><dd>Ctrl / ⌘ F</dd><dt>Link</dt><dd>Ctrl / ⌘ K</dd><dt>Collapse ribbon</dt><dd>Ctrl / ⌘ F1</dd><dt>Ribbon focus</dt><dd>F6</dd></dl><p>Commands that require a connected service are unavailable. Hover a disabled command for its availability reason.</p></>}
    {kind === 'clipboard' && <p>Use Ctrl/⌘ C, X, and V inside the document for rich clipboard content. Ribbon clipboard controls use text and require browser clipboard permission.</p>}
    {['paragraph','tableformat'].includes(kind) && <fieldset><legend>Borders and Shading</legend>{label('Shading:', <select value={shading} onChange={e => setShading(e.target.value)}><option value="">Keep existing</option><option value="#FFFFFF">White</option><option value="#D9E2F3">Light blue</option><option value="#FFF2CC">Light yellow</option><option value="#E2EFDA">Light green</option></select>)}<label><input type="checkbox" checked={border} onChange={e => setBorder(e.target.checked)}/> {kind === 'paragraph' ? 'Apply bottom border' : 'Apply all borders'}</label></fieldset>}
    {failure && <p className="wr-dialog-error" role="alert">{failure}</p>}
  </div><footer className="writer-dialog-actions">{readonly ? <button className="primary" onClick={close}>Close</button> : <><button disabled={pending || closing} onClick={close}>Cancel</button><button className="primary" disabled={pending || loading || closing || !snapshot.ready || editingDisabled} onClick={() => void apply()}>{pending ? 'Applying…' : loading ? 'Loading…' : kind === 'comment' ? 'Post comment' : ['table','picture','link','symbol','footnote','endnote'].includes(kind) ? 'Insert' : 'OK'}</button></>}</footer></section></div>;
}
