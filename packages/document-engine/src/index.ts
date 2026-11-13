import { SuperDoc, type BorrowedSuperDocUI } from 'superdoc';
import type { OperationId, OperationInput, OperationOutput, SelectionCapture as EngineSelectionCapture, SelectionTarget, SuperDocUIState } from 'superdoc/ui';
import 'superdoc/style.layered.css';
import { createDocument, DOCX_MIME, documentWordCount } from './package';
export * from './package';
export type { SuperDocUIState } from 'superdoc/ui';
export type SelectionCapture = EngineSelectionCapture & { writerRevision?: number };
export type ParagraphTarget = Extract<OperationInput<'format.paragraph.applyBatch'>['targets'][number], { kind: 'block' }>;
export interface EnginePreferences {
  ruler: boolean; formattingMarks: boolean; bookmarks: boolean; measurementUnit: 'in' | 'cm';
  user: { name: string; email: string }; autoCorrect: boolean; replacements: Array<{ from: string; to: string }>;
}

export interface WriterSnapshot {
  ready: boolean; page: number; pages: number; words: number; revision: number; reviewDisplay: 'review' | 'final' | 'original';
  missingFonts: string[]; state: SuperDocUIState | null;
}
export const emptySnapshot: WriterSnapshot = { ready: false, page: 1, pages: 1, words: 0, revision: 0, reviewDisplay: 'review', missingFonts: [], state: null };

export function assertReceipt(result: unknown): void {
  if (result === false || result == null) throw new Error('This command is unavailable for the current selection.');
  if (typeof result === 'object' && 'success' in result && result.success === false) {
    const failure = 'failure' in result ? result.failure as { message?: string; code?: string } : null;
    throw new Error(failure?.message || failure?.code || 'The document operation could not be completed.');
  }
  if (typeof result === 'object' && 'ok' in result && result.ok === false) throw new Error('reason' in result ? String(result.reason) : 'The document operation is unavailable.');
}

/** Public v2 API only. OOXML, selection transactions, and layout remain engine-owned. */
export class WriterEngine {
  private superdoc: SuperDoc | null = null;
  private element: HTMLElement | null = null;
  private releases: Array<() => void> = [];
  private frame = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private loaded = false;
  private readOnly = false;
  private rulerVisible = false;
  private activePreferences: EnginePreferences | null = null;
  private correctionTimer: ReturnType<typeof setTimeout> | undefined;
  private typingSequence = 0;
  private typed = false;
  private composing = false;
  private transactionCarets = new Map<string, { undo: SelectionTarget; redo: SelectionTarget }>();
  private historyGesture: number | null = null;
  private historyCaretWork: Promise<unknown> = Promise.resolve();
  snapshot: WriterSnapshot = { ...emptySnapshot };
  constructor(private changed: (snapshot: WriterSnapshot) => void, private failed: (error: unknown) => void, private preferences?: EnginePreferences) {}
  get ui(): BorrowedSuperDocUI | null { return this.superdoc?.ui ?? null; }
  get api() {
    const api = this.superdoc?.getDocumentApi();
    if (!api || !this.loaded) throw new Error('Wait for the document to finish opening.');
    return api;
  }
  mount(element: HTMLElement, bytes = createDocument(), readOnly = false, print = false): Promise<void> {
    this.readOnly = readOnly;
    this.element = element;
    const input = (event: Event) => {
      const e = event as InputEvent;
      this.typingSequence++; this.typed = e.inputType === 'insertText' && !e.isComposing && !this.composing;
      clearTimeout(this.correctionTimer);
    };
    // The paginated editor commits ordinary keyboard input itself; it does not
    // dispatch beforeinput for every key. Observe the gesture without intercepting it.
    const keyboard = (event: KeyboardEvent) => {
      this.typingSequence++;
      this.typed = !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing && !this.composing && [...event.key].length === 1;
      this.historyGesture = (event.metaKey || event.ctrlKey) && ['z','y'].includes(event.key.toLowerCase()) ? this.typingSequence : null;
      clearTimeout(this.correctionTimer);
    };
    const pointer = () => { this.typingSequence++; this.typed = false; this.historyGesture = null; clearTimeout(this.correctionTimer); };
    const compositionStart = () => { this.composing = true; this.typed = false; };
    const compositionEnd = () => { this.composing = false; this.typed = false; };
    element.addEventListener('beforeinput', input, true);
    element.addEventListener('keydown', keyboard, true);
    element.addEventListener('pointerdown', pointer, true);
    element.addEventListener('compositionstart', compositionStart, true);
    element.addEventListener('compositionend', compositionEnd, true);
    this.releases.push(() => { element.removeEventListener('beforeinput', input, true); element.removeEventListener('keydown', keyboard, true); element.removeEventListener('pointerdown', pointer, true); element.removeEventListener('compositionstart', compositionStart, true); element.removeEventListener('compositionend', compositionEnd, true); });
    const scroller = element.closest('.writer-workspace') || element;
    const scrolled = () => this.publish();
    scroller.addEventListener('scroll', scrolled, { passive: true });
    this.releases.push(() => scroller.removeEventListener('scroll', scrolled));
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } else this.failed(error); };
      this.superdoc = new SuperDoc({
        selector: element,
        document: new File([new Uint8Array(bytes)], 'Document.docx', { type: DOCX_MIME }),
        user: this.preferences?.user || { name: 'LopeOS User', email: 'local@lopeos.invalid' },
        documentMode: readOnly ? 'viewing' : 'editing',
        telemetry: { enabled: false },
        ui: { toolbar: false, comments: false, search: false, ruler: !print, contextMenu: !print, loading: false },
        layoutEngineOptions: { virtualization: { enabled: !print, window: 5, overscan: 1 } },
        zoom: { initial: 100 },
        onPaginationUpdate: ({ totalPages }) => { this.snapshot.pages = totalPages; this.publish(); },
        onFontsChanged: ({ missingFonts }) => { this.snapshot.missingFonts = missingFonts || []; this.publish(); },
        onReady: async () => {
          if (this.disposed) return;
          const ui = this.ui!;
          if (!print) this.superdoc?.toggleRuler();
          element.querySelector('[role="textbox"]')?.setAttribute('aria-label', 'Document content');
          this.loaded = true;
          this.releases.push(ui.select(s => s).subscribe(() => this.publish()));
          this.releases.push(ui.comments.observe(() => this.publish()), ui.trackChanges.observe(() => this.publish()), ui.styles.observe(() => this.publish()));
          this.releases.push(ui.document.onChange(change => {
            this.snapshot.revision++; this.scheduleCount(); this.publish();
            if ((change.cause === 'undo' || change.cause === 'redo') && change.txId && this.historyGesture === this.typingSequence) {
              const caret = this.transactionCarets.get(change.txId)?.[change.cause];
              if (caret) this.historyCaretWork = ui.selection.applyAndWait(caret).then(async result => { if (result.ok) await this.revealSelection(caret); }).catch(() => {});
            }
            if (change.cause === 'user' && this.typed && !this.readOnly && this.preferences?.autoCorrect) {
              clearTimeout(this.correctionTimer); this.correctionTimer = setTimeout(() => void this.correctTypedWord(), 40);
            }
          }));
          this.scheduleCount(); this.publish();
          if (!print && !readOnly) await Promise.resolve(this.api.blocks.list({ limit: 1 })).then(async ({ blocks }) => {
            const block = blocks[0];
            if (block && ['paragraph','heading','listItem'].includes(block.nodeType)) {
              const point = { kind: 'text' as const, blockId: block.nodeId, offset: 0 };
              await ui.selection.applyAndWait({ kind: 'selection', start: point, end: point });
              element.querySelector<HTMLElement>('[role="textbox"]')?.focus({ preventScroll: true });
              scroller.scrollTop = 0;
            }
          }).catch(() => {});
          this.snapshot.ready = true;
          if (this.preferences) await this.applyPreferences(this.preferences);
          this.publish();
          settled = true; resolve();
        },
        onContentError: ({ error }) => fail(error),
        onException: ({ error }) => fail(error),
      });
    });
  }
  private publish() {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.disposed) return;
      this.snapshot = { ...this.snapshot, page: this.currentPage(), state: this.ui?.state ?? null };
      this.changed(this.snapshot);
    });
  }
  private scheduleCount() {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try { this.snapshot.words = documentWordCount(await this.api.getText({})); this.publish(); } catch { /* count is retried after the next committed edit */ }
    }, 180);
  }
  async command(id: string, value?: unknown) {
    if (!this.ui || !this.snapshot.ready) throw new Error('The document is still opening.');
    const history = id === 'undo' || id === 'redo';
    if (history) { await this.historyCaretWork; this.historyGesture = this.typingSequence; }
    assertReceipt(await this.ui.commands.executeAsync(id, value));
    if (history) await this.historyCaretWork;
    if (id === 'ruler') this.rulerVisible = !this.rulerVisible;
  }
  async applyPreferences(preferences: EnginePreferences) {
    this.preferences = preferences;
    if (!this.superdoc || !this.loaded) return;
    const previous = this.activePreferences;
    if (this.rulerVisible !== preferences.ruler) { this.superdoc.toggleRuler(); this.rulerVisible = preferences.ruler; }
    if (!previous || previous.formattingMarks !== preferences.formattingMarks) this.superdoc.setShowFormattingMarks(preferences.formattingMarks);
    if (!previous || previous.bookmarks !== preferences.bookmarks) this.superdoc.setShowBookmarks(preferences.bookmarks);
    if (!previous || previous.measurementUnit !== preferences.measurementUnit) this.superdoc.setMeasurementUnit(preferences.measurementUnit);
    if (previous && (previous.user.name !== preferences.user.name || previous.user.email !== preferences.user.email)) await this.superdoc.setUser(preferences.user);
    this.activePreferences = preferences;
    this.publish();
  }
  private async correctTypedWord() {
    if (this.disposed || this.composing || !this.typed || !this.preferences?.autoCorrect || !this.element?.contains(document.activeElement)) return;
    const sequence = this.typingSequence;
    try {
      const selection = await this.api.selection.current();
      const target = selection.selectionTarget;
      if (!selection.empty || !target || target.start.kind !== 'text' || target.end.kind !== 'text' || target.start.blockId !== target.end.blockId || target.start.offset !== target.end.offset) return;
      const point = target.start;
      const context = await this.api.ranges.resolve({ start: { kind: 'point', point: { ...point, offset: Math.max(0, point.offset - 120) } }, end: { kind: 'point', point }, in: target.story });
      const value = context.preview.text, delimiter = value.at(-1);
      if (!delimiter || !/[ \t\u00a0]/u.test(delimiter)) return;
      const rule = this.preferences.replacements.find(rule => rule.from !== rule.to && value.endsWith(rule.from + delimiter) && (value.length === rule.from.length + 1 || /\s/u.test(value[value.length - rule.from.length - 2])));
      if (!rule || this.disposed || sequence !== this.typingSequence || this.composing) return;
      // Include the typed delimiter so the native undo/redo transaction records
      // the caret after the space, rather than inside the corrected word.
      const start = { ...point, offset: point.offset - rule.from.length - 1 }, end = point;
      const receipt = await this.api.replace({ target: { kind: 'selection', start, end, story: target.story }, text: rule.to + delimiter }, { expectedRevision: context.evaluatedRevision, changeMode: this.ui?.state.documentMode === 'suggesting' ? 'tracked' : 'direct' });
      assertReceipt(receipt);
      const caret = { ...point, offset: point.offset + rule.to.length - rule.from.length };
      this.rememberTransactionCarets(receipt.txId, { kind: 'selection', start: point, end: point, story: target.story }, { kind: 'selection', start: caret, end: caret, story: target.story });
      if (!this.disposed && sequence === this.typingSequence && this.element?.contains(document.activeElement)) {
        await this.ui?.selection.applyAndWait({ kind: 'selection', start: caret, end: caret, story: target.story });
      }
    } catch { /* A stale range is skipped; typing and IME composition always take precedence. */ }
  }
  private rememberTransactionCarets(txId: string | undefined, undo: SelectionTarget, redo: SelectionTarget) {
    if (!txId) return;
    this.transactionCarets.set(txId, { undo, redo });
    if (this.transactionCarets.size > 50) this.transactionCarets.delete(this.transactionCarets.keys().next().value!);
  }
  private async revealSelection(selection: SelectionTarget) {
    const point = selection.end;
    if (point.kind !== 'text') return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = await this.ui?.viewport.scrollIntoView({ target: { kind: 'text', blockId: point.blockId, range: { start: point.offset, end: point.offset }, story: selection.story }, block: 'nearest', behavior: 'instant' });
      if (result?.success || this.disposed) return;
      // A host may deliberately hide its own scrollbars. Use acknowledged
      // public geometry to scroll our viewport when native navigation has no
      // scrollable ancestor; document positions and pagination remain native.
      const caret = this.ui?.viewport.getRect({ target: selection }).rect;
      const viewport = this.element?.closest<HTMLElement>('.writer-workspace') || this.element;
      if (caret && viewport) {
        const visible = viewport.getBoundingClientRect();
        if (caret.top < visible.top + 16) viewport.scrollTop += caret.top - visible.top - 16;
        else if (caret.bottom > visible.bottom - 16) viewport.scrollTop += caret.bottom - visible.bottom + 16;
        if (caret.left < visible.left + 16) viewport.scrollLeft += caret.left - visible.left - 16;
        else if (caret.right > visible.right - 16) viewport.scrollLeft += caret.right - visible.right + 16;
        return;
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }
  private async placeInsertedCaret(receipt: OperationOutput<'insert'>, previous: SelectionTarget, blankPage = false, value?: string) {
    const inserted = blankPage ? receipt.effects?.insertedText?.[0]?.selectionTarget : receipt.effects?.insertedText?.at(-1)?.selectionTarget;
    const tracked = receipt.effects?.resultText, segment = tracked?.segments.at(-1);
    const trackedEnd = segment ? { kind: 'text' as const, blockId: segment.blockId, offset: segment.range.end } : null;
    // v2.30 omits created-content effects for tracked text replacement. Its
    // resolved semantic insertion point still identifies where the literal
    // UTF-16 text was inserted; plain-text newlines stay inside that paragraph.
    const resolved = receipt.resolution?.selectionTarget || previous;
    const replacedEnd = value !== undefined && resolved.start.kind === 'text' ? { ...resolved.start, offset: resolved.start.offset + value.length } : null;
    if (inserted || trackedEnd || replacedEnd) {
      // Blank Page leaves the caret on its new page, between the two breaks.
      const point = blankPage && inserted?.start.kind === 'text' ? { ...inserted.start, offset: inserted.start.offset + 1 } : inserted?.end || trackedEnd || replacedEnd!;
      const caret: SelectionTarget = { kind: 'selection', start: point, end: point, story: inserted?.story || tracked?.story || resolved.story, coordinateSpace: tracked?.coordinateSpace || resolved.coordinateSpace };
      this.rememberTransactionCarets(receipt.txId, previous, caret);
      assertReceipt(await this.ui?.selection.applyAndWait(caret));
      await this.revealSelection(caret);
    }
    this.focus();
  }
  async insertTextAtSelection(value: string, target?: SelectionTarget): Promise<void> {
    if (this.ui?.state.documentMode === 'viewing') throw new Error('Switch to Editing or Reviewing mode to insert text.');
    const selection = target || (await this.api.selection.current()).selectionTarget;
    if (!selection) throw new Error('Place the cursor in the document before inserting text.');
    const receipt = await this.api.insert({ target: selection, value });
    assertReceipt(receipt);
    await this.placeInsertedCaret(receipt, selection, false, value);
  }
  async updateExistingFields() {
    const tables = await this.api.toc.list({});
    for (const table of tables.items) assertReceipt(await this.api.toc.update({ target: table.address, mode: 'all' }));
  }
  async invoke<Id extends OperationId>(id: Id, input: OperationInput<Id>): Promise<OperationOutput<Id>> {
    // v2.30's browser facade omits invoke at runtime despite its declaration.
    // Resolve only the documented public operation path, keeping its owning object.
    const keys = id.split('.');
    let owner: unknown = this.api;
    for (const key of keys.slice(0, -1)) owner = (owner as Record<string, unknown>)?.[key];
    const method = (owner as Record<string, unknown>)?.[keys.at(-1)!];
    if (typeof method !== 'function') throw new Error(`The installed document engine does not expose ${id}.`);
    const result = await method.call(owner, input);
    assertReceipt(result);
    return result as OperationOutput<Id>;
  }
  capture(): SelectionCapture | null {
    const capture = this.ui?.selection.capture();
    return capture ? { ...capture, writerRevision: this.snapshot.revision } : null;
  }
  async captureFresh(): Promise<SelectionCapture | null> {
    const revision = this.snapshot.revision;
    const info = await this.api.selection.current();
    if (info.empty || !info.target || !info.selectionTarget) return null;
    const range = await this.api.ranges.resolve({ start: { kind: 'point', point: info.selectionTarget.start }, end: { kind: 'point', point: info.selectionTarget.end }, in: info.selectionTarget.story });
    if (revision !== this.snapshot.revision) throw new Error('The document changed. Select the passage again.');
    return { ...this.ui!.selection.getSnapshot(), empty: false, target: info.target, selectionTarget: info.selectionTarget, quotedText: range.preview.text, capturedAt: Date.now(), writerRevision: revision };
  }
  async addComment(capture: SelectionCapture, text: string) {
    if (capture.writerRevision !== this.snapshot.revision) throw new Error('The document changed. Select the passage again before posting your comment.');
    // Use a fresh public capture token: v2.30's cached UI capture may precede source hydration.
    // Match the frozen semantic endpoints and keep the opaque token intact.
    const fresh = await this.api.selection.current();
    const endpoints = (s: typeof fresh.selectionTarget) => s ? JSON.stringify([s.start, s.end, s.story]) : '';
    if (fresh.empty || !fresh.target || endpoints(fresh.selectionTarget) !== endpoints(capture.selectionTarget)) throw new Error('The selected passage changed. Select it again before posting your comment.');
    assertReceipt(await this.api.comments.create({ target: fresh.target, text }));
  }
  restore(capture: SelectionCapture | null) {
    if (capture && this.ui) {
      const result = this.ui.selection.restore(capture);
      if (!result.success) throw new Error('The selection changed. Select the text again before applying this command.');
    }
  }
  async selectedParagraphs(capture: SelectionCapture | null): Promise<ParagraphTarget[]> {
    const target = capture?.selectionTarget || (await this.api.selection.current()).selectionTarget;
    if (!target) return [];
    const range = await this.api.ranges.resolve({
      start: { kind: 'point', point: target.start }, end: { kind: 'point', point: target.end }, in: target.story,
    });
    const blocks = range.preview.blocks.filter(b => ['paragraph', 'heading', 'listItem'].includes(b.nodeType));
    // A collapsed range can have no preview text, but still has paragraph context.
    if (!blocks.length && target.start.kind === 'text') {
      const { address } = await this.api.getNodeById({ nodeId: target.start.blockId });
      if (address.kind === 'block' && ['paragraph', 'heading', 'listItem'].includes(address.nodeType)) return [address as ParagraphTarget];
    }
    return blocks.map(b => ({ kind: 'block', nodeType: b.nodeType as ParagraphTarget['nodeType'], nodeId: b.nodeId }));
  }
  async export(): Promise<Uint8Array> {
    if (!this.superdoc || !this.snapshot.ready) throw new Error('The document is still opening.');
    const blob = await this.superdoc.export({ exportType: ['docx'], triggerDownload: false });
    if (!(blob instanceof Blob)) throw new Error('The document engine did not return a DOCX file.');
    return new Uint8Array(await blob.arrayBuffer());
  }
  focus() { this.element?.querySelector<HTMLElement>('[role="textbox"]')?.focus({ preventScroll: true }); }
  goToPage(page: number) { this.element?.querySelector(`[data-page-number="${page}"]`)?.scrollIntoView({ block: 'start' }); }
  private currentPage() {
    if (!this.element) return 1;
    const viewport = (this.element.closest('.writer-workspace') || this.element).getBoundingClientRect();
    let best = 0, page = 1;
    for (const element of this.element.querySelectorAll<HTMLElement>('.superdoc-page')) {
      const rect = element.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top));
      if (overlap > best) { best = overlap; page = Number(element.dataset.pageNumber) || 1; }
    }
    return page;
  }
  async navigateToText(blockId: string) {
    const target = { kind: 'text' as const, blockId, range: { start: 0, end: 0 } };
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = await this.ui?.viewport.scrollIntoView({ target });
      if (result?.success) return;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    throw new Error('This passage could not be brought into view. Try again after the page finishes loading.');
  }
  async selectAll() {
    const { blocks } = await this.api.blocks.list({ limit: 20000, includeText: true });
    const first = blocks[0], last = blocks.at(-1);
    if (!first || !last || first.nodeType === 'tableRow' || first.nodeType === 'tableCell' || last.nodeType === 'tableRow' || last.nodeType === 'tableCell') return;
    const result = await this.ui?.selection.applyAndWait({ kind: 'selection',
      start: { kind: 'nodeEdge', node: { kind: 'block', nodeType: first.nodeType, nodeId: first.nodeId }, edge: 'before' },
      end: { kind: 'nodeEdge', node: { kind: 'block', nodeType: last.nodeType, nodeId: last.nodeId }, edge: 'after' },
    });
    assertReceipt(result); this.focus();
  }
  async updateTOC() {
    const tables = await this.api.toc.list({});
    if (!tables.items.length) return this.command('table-of-contents-insert');
    for (const table of tables.items) assertReceipt(await this.api.toc.update({ target: table.address, mode: 'all' }));
  }
  async insertPageBreak() { await this.insertPageBreaks(1); }
  async insertBlankPage() { await this.insertPageBreaks(2); }
  private async insertPageBreaks(count: 1 | 2) {
    if (this.ui?.state.documentMode !== 'editing') throw new Error('Switch to Editing mode to insert page breaks. The installed engine cannot track page-break insertion.');
    const { selectionTarget: target } = await this.api.selection.current();
    if (!target) throw new Error('Place the cursor in the document before inserting a page break.');
    // Public native OOXML insertion preserves the surrounding runs and inserts
    // a real break at the caret in one history transaction. A second break leaves
    // a complete blank page between the surrounding text.
    const receipt = await this.api.insert({ type: 'ooxml', target,
      value: `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${'<w:br w:type="page"/>'.repeat(count)}</w:r>`,
      namespaces: { w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' },
    });
    assertReceipt(receipt);
    await this.placeInsertedCaret(receipt, target, count === 2);
  }
  async pageMargins(preset: 'normal' | 'narrow' | 'moderate' | 'wide') {
    const vertical = preset === 'narrow' ? .5 : 1;
    const horizontal = { normal: 1, narrow: .5, moderate: .75, wide: 2 }[preset];
    const sections = await this.api.sections.list({});
    for (const section of sections.items) assertReceipt(await this.api.sections.setPageMargins({ target: section.address, top: vertical, bottom: vertical, left: horizontal, right: horizontal }));
  }
  async pageSetup(kind: 'margins' | 'orientation' | 'size' | 'columns', value: number | string) {
    if (kind === 'margins' && (!Number.isFinite(Number(value)) || Number(value) < .25 || Number(value) > 3)) throw new Error('Use page margins between 0.25 and 3 inches.');
    const sections = await this.api.sections.list({});
    // Apply to the complete document. Section-specific controls are an explicitly tracked gap.
    for (const section of sections.items) {
      const target = section.address;
      const currentWidth = section.pageSetup?.width || 8.5, currentHeight = section.pageSetup?.height || 11;
      const shortSide = Math.min(currentWidth, currentHeight), longSide = Math.max(currentWidth, currentHeight);
      if (kind === 'margins') assertReceipt(await this.api.sections.setPageMargins({ target, top: Number(value), bottom: Number(value), left: Number(value), right: Number(value) }));
      if (kind === 'orientation') assertReceipt(await this.api.sections.setPageSetup({ target, orientation: value as 'portrait' | 'landscape', width: value === 'landscape' ? longSide : shortSide, height: value === 'landscape' ? shortSide : longSide }));
      if (kind === 'size') {
        const width = value === 'A4' ? 8.2677 : 8.5, height = value === 'A4' ? 11.6929 : 11;
        const landscape = section.pageSetup?.orientation === 'landscape' || currentWidth > currentHeight;
        assertReceipt(await this.api.sections.setPageSetup({ target, width: landscape ? height : width, height: landscape ? width : height }));
      }
      if (kind === 'columns') assertReceipt(await this.api.sections.setColumns({ target, count: Number(value), gap: .5, equalWidth: true }));
    }
  }
  setZoom(value: number) { this.superdoc?.setZoom(value); }
  fitWidth() { this.superdoc?.setZoomMode('fit-width'); }
  async fitPage() {
    if (!this.element || !this.superdoc || !this.snapshot.ready) throw new Error('The document is still opening.');
    const number = this.currentPage();
    const page = this.element.querySelector<HTMLElement>(`.superdoc-page[data-page-number="${number}"]`);
    if (!page) throw new Error('Wait for this page to finish loading.');
    const viewport = this.element.closest<HTMLElement>('.writer-workspace') || this.element;
    const rect = page.getBoundingClientRect(), padding = getComputedStyle(viewport);
    const width = viewport.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight) - 32;
    const height = viewport.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom) - 32;
    const zoom = this.ui?.state.zoom.value || 100;
    const fitted = zoom * Math.min(width / rect.width, height / rect.height);
    this.setZoom(Math.max(25, Math.min(200, Math.floor(fitted))));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    this.element?.querySelector<HTMLElement>(`.superdoc-page[data-page-number="${number}"]`)?.scrollIntoView({ block: 'center', inline: 'center' });
  }
  setReviewDisplay(value: 'review' | 'final' | 'original') {
    this.superdoc?.setTrackedChangesPreferences({ mode: value });
    this.snapshot.reviewDisplay = value; this.publish();
  }
  setMode(value: 'editing' | 'suggesting' | 'viewing') { if (!this.readOnly || value === 'viewing') this.superdoc?.setDocumentMode(value); }
  destroy() {
    this.disposed = true; this.loaded = false; cancelAnimationFrame(this.frame); clearTimeout(this.timer); clearTimeout(this.correctionTimer);
    this.releases.forEach(fn => fn()); this.releases = [];
    this.transactionCarets.clear();
    this.superdoc?.destroy(); this.superdoc = null;
  }
}
