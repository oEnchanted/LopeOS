/** Print the engine's complete painted pages, keeping its measured line positions. */
export interface WriterPrintOptions { reverseOrder?: boolean; drawings?: boolean; backgrounds?: boolean }
export function createPrintHtml(mount: HTMLElement, expectedPages: number, options: WriterPrintOptions = {}): string {
  const pages = [...mount.querySelectorAll<HTMLElement>('.superdoc-page')];
  if (!pages.length || pages.length !== expectedPages) throw new Error('The print layout is incomplete. Wait for every page to finish rendering.');
  // The renderer inserts run rules through CSSOM; style.outerHTML omits those rules.
  const sheets = [...document.styleSheets, ...document.adoptedStyleSheets];
  const styles = sheets.map(sheet => {
    try { return `<style>${[...sheet.cssRules].map(rule => rule.cssText).join('\n')}</style>`; }
    catch { return (sheet.ownerNode as HTMLElement | null)?.outerHTML || ''; }
  }).join('\n');
  let pageRules = '';
  const ordered = options.reverseOrder ? [...pages].reverse() : pages;
  const html = ordered.map((page, i) => {
    const clone = page.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.ts-chrome,.ts-ime,[data-v2-selection-overlay]').forEach(n => n.remove());
    if (options.drawings === false) clone.querySelectorAll('img,svg').forEach(n => n.remove());
    const width = parseFloat(page.style.width), height = parseFloat(page.style.height);
    if (!width || !height) throw new Error('The page size could not be resolved for printing.');
    pageRules += `@page writer${i}{size:${width}px ${height}px;margin:0}\n`;
    clone.style.page = `writer${i}`;
    clone.style.position = 'relative'; clone.style.left = '0'; clone.style.top = '0';
    clone.style.margin = '0'; clone.style.contentVisibility = 'visible'; clone.removeAttribute('aria-hidden');
    return clone.outerHTML;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Quill document</title>${styles}<style>
${pageRules}
html,body{height:auto!important;overflow:visible!important;margin:0!important;padding:0!important;background:#fff!important}
.writer-app.wr-print-document{height:auto!important;width:auto!important;overflow:visible!important;display:block!important;background:#fff!important}
.wr-print-document .ts-root,.wr-print-document .ts-layout{height:auto!important;display:block!important;transform:none!important;position:static!important;gap:0!important}
.wr-print-document .superdoc-page{box-shadow:none!important;position:relative!important;top:0!important;left:0!important;margin:0!important;break-inside:avoid;break-after:page;content-visibility:visible!important}
.wr-print-document .superdoc-page:last-child{break-after:auto}
.wr-print-document{print-color-adjust:exact;-webkit-print-color-adjust:exact}
${options.backgrounds === false ? '.wr-print-document .superdoc-page{background-color:#fff!important;background-image:none!important}' : ''}
</style></head><body><main class="writer-app wr-print-document"><div class="superdoc"><div class="ts-root"><div class="ts-layout">${html}</div></div></div></main></body></html>`;
}
