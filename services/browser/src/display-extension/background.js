// Lope Browser display helper. The worker drives it over Chromium's private DevTools
// pipe. It declares no content scripts, web-accessible resources or external
// connections, so websites can neither detect nor message it.
const DOCUMENT = 'offscreen.html';
let creating;

async function ensureDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen.createDocument({
    url: DOCUMENT, reasons: ['USER_MEDIA', 'CLIPBOARD'],
    justification: 'Encodes the selected tab for the LopeOS window that shows it.',
  }).finally(() => { creating = undefined; });
  await creating;
}

globalThis.lopeDisplay = {
  async ready() { await ensureDocument(); return chrome.runtime.id; },
  /** A single-use capture grant for the tab behind a DevTools target. */
  async streamId(targetId) {
    const target = (await chrome.debugger.getTargets()).find(item => item.id === targetId);
    if (target?.tabId === undefined) throw new Error('This tab cannot be shown.');
    await ensureDocument();
    return chrome.tabCapture.getMediaStreamId({ targetTabId: target.tabId });
  },
};

// The offscreen document wakes this worker if Chromium stopped it while idle.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message === 'lope-display-wake') reply(true);
});
