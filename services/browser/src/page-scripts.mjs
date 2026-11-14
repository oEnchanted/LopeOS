// Scripts LopeOS runs inside remote pages. They run in an isolated world: page scripts share the
// DOM but cannot see these functions or call the binding that reports to the worker.
export const PAGE_WORLD = 'lope-context';
export const PAGE_BINDING = 'lopeContextMenu';

// Headless Chromium draws no context menu, list popup or cursor of its own, so LopeOS draws them.
// Only trusted (user) events are reported, so a page cannot open LopeOS menus by dispatching
// synthetic events. A right-click the page handles itself (custom menus in web apps) is left to the page.
export const PAGE_SCRIPT = `if (window === window.top && !globalThis.__lopePage) {
  globalThis.__lopePage = true;
  const report = value => { try { globalThis.${PAGE_BINDING}(JSON.stringify(value)); } catch {} };
  const editableTypes = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);
  const textField = node => node instanceof HTMLElement && !node.inert && !node.disabled && !node.readOnly && (node.isContentEditable
    || node instanceof HTMLTextAreaElement || (node instanceof HTMLInputElement && editableTypes.has(node.type)));
  document.addEventListener('contextmenu', event => {
    if (!event.isTrusted) return;
    const path = event.composedPath ? event.composedPath() : [event.target];
    setTimeout(() => {
      if (event.defaultPrevented) return;
      const image = path.find(node => node instanceof HTMLImageElement);
      const link = path.find(node => node instanceof HTMLAnchorElement && node.href);
      const field = path.find(node => node instanceof HTMLElement && (node.isContentEditable || node instanceof HTMLTextAreaElement
        || (node instanceof HTMLInputElement && editableTypes.has(node.type))));
      let selection = '';
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        // Never read a password field's value, selected or not.
        if (field.type !== 'password' && typeof field.selectionStart === 'number') selection = field.value.slice(field.selectionStart, field.selectionEnd);
      } else selection = String(getSelection() ?? '');
      report({ type: 'menu', x: event.clientX, y: event.clientY, width: innerWidth, height: innerHeight,
        image: image ? (image.currentSrc || image.src || '') : '', link: link ? link.href : '',
        selection: selection.slice(0, 20000), editable: !!field && !field.disabled && !field.readOnly });
    }, 0);
  }, true);
  // The pointer's cursor, resolved the way Chromium would draw it over this element.
  let cursor = '', pointer = null, cursorFrame = 0;
  const overText = (x, y) => {
    const node = document.caretPositionFromPoint?.(x, y)?.offsetNode;
    if (!(node instanceof Text) || !node.data.trim()) return false;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const rect of range.getClientRects()) if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    return false;
  };
  const resolveCursor = event => {
    const target = event.composedPath().find(node => node instanceof Element);
    if (!target) return 'default';
    const style = getComputedStyle(target), value = style.cursor.split(',').pop().trim();
    if (value && value !== 'auto') return value;
    if (target.closest('a[href],area[href]')) return 'pointer';
    if (textField(target)) return 'text';
    return style.userSelect !== 'none' && overText(event.clientX, event.clientY) ? 'text' : 'default';
  };
  addEventListener('mousemove', event => {
    if (!event.isTrusted) return;
    pointer = event;
    cursorFrame ||= requestAnimationFrame(() => {
      cursorFrame = 0;
      const next = pointer ? resolveCursor(pointer) : 'default';
      if (next !== cursor) { cursor = next; report({ type: 'cursor', cursor }); }
    });
  }, { capture: true, passive: true });
  // Whether typing goes into a text field, so a touch device can show its keyboard.
  let focused = false;
  const focusChanged = () => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    const next = textField(element);
    if (next !== focused) { focused = next; report({ type: 'editable', value: next }); }
  };
  addEventListener('focusin', focusChanged, true);
  addEventListener('focusout', () => setTimeout(focusChanged, 0), true);
  // A list's popup is drawn outside the page, so LopeOS lists the choices instead.
  let list = null;
  globalThis.__lopeChooseOption = index => {
    const select = list; list = null;
    if (!select?.isConnected) return false;
    select.focus({ preventScroll: true });
    if (index < 0 || index === select.selectedIndex || !select.options[index] || select.options[index].disabled) return true;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const openList = (select, event) => {
    if (!(select instanceof HTMLSelectElement) || select.multiple || select.size > 1 || select.disabled) return;
    event.preventDefault();
    select.focus({ preventScroll: true }); list = select;
    const rect = select.getBoundingClientRect();
    report({ type: 'select', x: rect.left, y: rect.top, w: rect.width, h: rect.height, width: innerWidth, height: innerHeight, selected: select.selectedIndex,
      options: [...select.options].slice(0, 1000).map(option => ({ label: option.label || option.text,
        disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
        group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : '' })) });
  };
  addEventListener('mousedown', event => {
    if (event.isTrusted && event.button === 0) openList(event.composedPath().find(node => node instanceof HTMLSelectElement), event);
  }, true);
  addEventListener('keydown', event => {
    const select = event.isTrusted && event.composedPath().find(node => node instanceof HTMLSelectElement);
    if (select && ((event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) || event.key === ' ' || event.key === 'F4')) openList(select, event);
  }, true);
}`;

/**
 * Find in page. Highlights every match with the CSS Custom Highlight API and makes one active,
 * without changing the page's selection or focus. Whitespace runs match a single space, matching
 * is case-insensitive, and matches never span block boundaries. Stateless: the worker passes the
 * previous active match, so it works in any instance of the isolated world.
 * @param {string} text  @param {'start'|'next'|'previous'|'clear'} step  @param {number} previous 1-based
 */
function lopeFind(text, step, previous) {
  const ALL = 'lope-find', ACTIVE = 'lope-find-active';
  const ours = sheet => [...sheet.cssRules].some(rule => rule.selectorText?.includes(ALL));
  const clear = () => {
    CSS.highlights.delete(ALL); CSS.highlights.delete(ACTIVE);
    if (document.adoptedStyleSheets.some(ours)) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => !ours(sheet));
    return { active: 0, total: 0 };
  };
  const needle = String(text).replace(/\s+/g, ' ');
  if (step === 'clear' || !needle.trim()) return clear();
  const skipped = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION']);
  const visible = new Map(), inline = new Map();
  const shown = element => {
    if (!visible.has(element)) visible.set(element, !skipped.has(element.tagName)
      && (!element.checkVisibility || element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })));
    return visible.get(element);
  };
  const block = element => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      if (!inline.has(node)) inline.set(node, getComputedStyle(node).display.startsWith('inline'));
      if (!inline.get(node)) return node;
    }
    return document.body;
  };
  const space = code => code === 32 || code === 9 || code === 10 || code === 12 || code === 13 || code === 160;
  // Build the page text with collapsed whitespace, remembering where each character came from.
  const entries = []; let content = '', lastBlock = null, node;
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  while ((node = walker.nextNode()) && content.length < 2000000) {
    const parent = node.parentElement;
    if (!parent || !node.data || !shown(parent)) continue;
    const owner = block(parent);
    if (owner !== lastBlock && content) content += '\n';
    lastBlock = owner;
    const data = node.data, offsets = []; let piece = '';
    for (let index = 0; index < data.length; index++) {
      if (space(data.charCodeAt(index))) {
        if (piece.endsWith(' ') || (!piece && (content.endsWith(' ') || content.endsWith('\n') || !content))) continue;
        piece += ' ';
      } else piece += data[index];
      offsets.push(index);
    }
    if (!piece) continue;
    offsets.push(data.length);
    entries.push({ node, start: content.length, offsets }); content += piece;
  }
  const locate = position => {
    let low = 0, high = entries.length - 1;
    while (low < high) { const middle = (low + high + 1) >> 1; if (entries[middle].start <= position) low = middle; else high = middle - 1; }
    return entries[low];
  };
  const ranges = [];
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  for (const match of content.matchAll(pattern)) {
    if (ranges.length >= 1000) break;
    const first = locate(match.index), last = locate(match.index + match[0].length - 1);
    if (!first || !last) continue;
    const range = new Range();
    range.setStart(first.node, first.offsets[match.index - first.start]);
    range.setEnd(last.node, last.offsets[match.index + match[0].length - 1 - last.start] + 1);
    ranges.push(range);
  }
  if (!ranges.length) { clear(); return { active: 0, total: 0 }; }
  let index;
  if (step === 'next' && previous > 0) index = previous % ranges.length;
  else if (step === 'previous' && previous > 0) index = (previous - 2 + ranges.length) % ranges.length;
  else { index = ranges.findIndex(range => range.getBoundingClientRect().bottom >= 0); if (index < 0) index = 0; }
  if (!document.adoptedStyleSheets.some(ours)) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`::highlight(${ALL}){background-color:#ffe36e;color:#111}::highlight(${ACTIVE}){background-color:#ff9a3d;color:#111}`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  const active = new Highlight(ranges[index]); active.priority = 1;
  CSS.highlights.set(ALL, new Highlight(...ranges)); CSS.highlights.set(ACTIVE, active);
  const range = ranges[index], outside = rect => rect.top < 0 || rect.bottom > innerHeight || rect.left < 0 || rect.right > innerWidth;
  if (outside(range.getBoundingClientRect())) {
    range.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = range.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > innerHeight) scrollBy({ top: rect.top - innerHeight / 2, behavior: 'instant' });
  }
  return { active: index + 1, total: ranges.length };
}
export const findExpression = (text, step, previous = 0) =>
  `(${lopeFind})(${JSON.stringify(text)}, ${JSON.stringify(step)}, ${Number(previous) || 0})`;
