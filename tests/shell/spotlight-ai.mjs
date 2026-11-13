/** Spotlight chat UI acceptance using a deterministic Worker boundary. No model or host
 * clipboard data is read. Live model execution is verified separately by the runtime smoke. */
import { chromium, expect } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installContractRuntime } from '../integration/contract-runtime-fixture.ts';
import { installSpotlightAiFixture } from './fixtures/spotlight-ai.mjs';

const origin = process.env.LOPE_QA_URL || 'http://127.0.0.1:5173';
const artifacts = new URL('./screenshots/', import.meta.url);
const checks = [], errors = [], externalRequests = [], networkBodies = [];
const browser = await chromium.launch({ headless: true });

async function setup(page, options = {}) {
  const filesystem = await installContractRuntime(page);
  await page.addInitScript(({ searchFiles }) => localStorage.setItem('lope.preferences.user.desktop-test-user.v2', JSON.stringify({ version: 2, preferences: { searchHistoryDays: 7, searchFiles } })), { searchFiles: options.searchFiles ?? false });
  await installSpotlightAiFixture(page, options);
  await page.route(/https:\/\/(?:huggingface\.co|cdn-lfs.*|raw\.githubusercontent\.com|cdn\.jsdelivr\.net)\//, route => {
    externalRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  page.on('request', request => { if (request.postData()) networkBodies.push(request.postData()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.welcome-main h1')).toBeVisible();
  return filesystem;
}
const searchDialog = page => page.getByRole('dialog', { name: 'Find applications', exact: true });
const searchInput = page => page.getByRole('textbox', { name: 'Search LopeOS', exact: true });
const button = (page, name) => searchDialog(page).getByRole('button', { name, exact: true });
async function openMain(page) {
  if (!await searchDialog(page).isVisible()) await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+0');
  await expect(searchInput(page)).toBeFocused();
  return searchInput(page);
}
const state = (page, expression) => page.evaluate(expression);
async function modelOptions(page) {
  if (!await button(page, 'Unload model').isVisible()) await button(page, 'Model options').click();
}

try {
  await mkdir(artifacts, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await setup(page);
  expect(await state(page, () => window.__spotlightAI.workers)).toBe(0);
  await openMain(page);
  const input = searchInput(page);
  await expect(input).toBeFocused();
  await expect(button(page, 'Download model')).toBeEnabled();
  expect(await state(page, () => window.__spotlightAI.workers)).toBe(0);
  expect(externalRequests).toEqual([]);
  checks.push('Opening the main Spotlight input checks capability without loading a model or creating a worker');
  await page.screenshot({ path: fileURLToPath(new URL('spotlight-ai-start.png', artifacts)), animations: 'disabled' });

  await page.evaluate(() => { window.__spotlightAI.loadMode = 'hold'; });
  await button(page, 'Download model').click();
  await expect(button(page, 'Cancel download')).toBeVisible();
  await expect.poll(() => state(page, () => window.__spotlightAI.workers)).toBe(1);
  await button(page, 'Cancel download').click();
  await expect(button(page, 'Download model')).toBeEnabled();
  await expect.poll(() => state(page, () => window.__spotlightAI.terminations)).toBe(1);
  checks.push('Explicit model load shows progress and cancellation terminates its worker');

  await page.evaluate(() => { window.__spotlightAI.loadMode = 'error'; });
  await button(page, 'Download model').click();
  await expect(searchDialog(page)).toContainText(/download|load|network/i);
  await expect(button(page, 'Download model')).toBeEnabled();
  await page.evaluate(() => { window.__spotlightAI.loadMode = 'success'; });
  await button(page, 'Download model').click();
  await modelOptions(page);
  await expect(button(page, 'Unload model')).toBeEnabled();
  await expect(button(page, 'Send message')).toBeDisabled();
  checks.push('A failed load can be retried and an empty message cannot be sent');

  await input.fill('0.1 + 0.2');
  await expect(searchDialog(page).locator('.spotlight-answer')).toContainText('0.3');
  await input.press('Enter');
  expect(await state(page, () => window.__spotlightAI.clipboardWrites.at(-1))).toBe('0.3');
  expect(await state(page, () => window.__spotlightAI.incoming.filter(message => message.type === 'generate').length)).toBe(0);
  checks.push('Math in the main input uses the exact calculator instead of the LLM');

  await input.fill('hello.txt');
  await button(page, 'Enable file search').click();
  // Submit before the debounced scan completes: filename priority must survive the race.
  await input.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Document content', exact: true })).toHaveValue('Hello from the shared workspace.\n');
  expect(await state(page, () => window.__spotlightAI.incoming.filter(message => message.type === 'generate').length)).toBe(0);
  await openMain(page);
  checks.push('Filename queries enable workspace search and open files without invoking the model');

  const oversizedUnicode = '界'.repeat(1000);
  await input.fill(oversizedUnicode);
  await input.press('Enter');
  await expect(searchDialog(page)).toContainText(/too long|shorten/i);
  await expect(input).toHaveValue(oversizedUnicode);
  expect(await state(page, () => window.__spotlightAI.incoming.filter(message => message.type === 'generate').length)).toBe(0);
  checks.push('Oversized Unicode prompts stay editable when the model context limit rejects them');

  const prompt = 'Only-in-memory prompt 76b8: suggest a short project name.';
  await input.fill(prompt);
  await input.press('Enter');
  await expect(button(page, 'Stop response')).toBeVisible();
  const conversation = searchDialog(page).getByRole('region', { name: 'Spotlight conversation', exact: true });
  await expect(conversation).toContainText(prompt);
  await expect(conversation).toContainText('A small local answer.');
  await expect(button(page, 'Stop response')).toHaveCount(0);
  expect(await state(page, () => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes('Only-in-memory prompt 76b8')))).toBe(false);
  expect(networkBodies.some(body => body.includes('Only-in-memory prompt 76b8'))).toBe(false);
  expect(externalRequests).toEqual([]);
  checks.push('Enter streams a response while keeping prompts out of persistent storage and network requests');

  await input.fill('Can you make it shorter?');
  await button(page, 'Send message').click();
  await expect(conversation).toContainText('Can you make it shorter?');
  await expect(button(page, 'Stop response')).toHaveCount(0);
  const requests = await state(page, () => window.__spotlightAI.incoming);
  // Runtime receives structured conversation turns; fixtures never inject page globals into product code.
  const followup = requests.filter(message => message.type === 'generate').at(-1);
  expect(followup.messages.filter(message => message.role === 'user').map(message => message.content)).toEqual([prompt, 'Can you make it shorter?']);
  expect(followup.messages.find(message => message.role === 'assistant')?.content).toBe('A small local answer.');
  checks.push('Follow-up messages include the current conversation context');
  await page.screenshot({ path: fileURLToPath(new URL('spotlight-ai-conversation.png', artifacts)), animations: 'disabled' });

  await page.evaluate(() => { window.__spotlightAI.generationMode = 'hold'; });
  await input.fill('Start a long explanation.');
  await input.press('Enter');
  await expect(button(page, 'Stop response')).toBeVisible();
  const stopRequests = await state(page, () => window.__spotlightAI.incoming.filter(message => message.type === 'stop').length);
  await input.fill('2 + 2');
  await expect(searchDialog(page).locator('.spotlight-answer')).toContainText('4');
  await page.keyboard.press('Control+1');
  await input.fill('calculator');
  await expect(searchDialog(page).getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Control+0');
  await input.fill('');
  await expect(button(page, 'Stop response')).toBeVisible();
  expect(await state(page, () => window.__spotlightAI.incoming.filter(message => message.type === 'stop').length)).toBe(stopRequests);
  checks.push('Switching to math and application search keeps an active reply running');
  await button(page, 'Stop response').click();
  await expect(button(page, 'Stop response')).toHaveCount(0);
  await expect(input).toBeFocused();
  checks.push('Stop response interrupts generation and returns keyboard focus to the input');

  await button(page, 'New chat').click();
  await expect(conversation).toHaveCount(0);
  await expect(input).toBeFocused();
  checks.push('New chat clears conversation text without persisting it');

  await page.evaluate(() => { window.__spotlightAI.generationMode = 'error'; });
  await input.fill('Trigger a recoverable model error.');
  await expect(button(page, 'Send message')).toBeEnabled();
  await input.press('Enter');
  await expect(button(page, 'Stop response')).toHaveCount(0);
  await expect(searchDialog(page)).toContainText(/failed|error|could not|unavailable/i);
  await page.evaluate(() => { window.__spotlightAI.generationMode = 'success'; });
  if (await button(page, 'Download model').isVisible()) await button(page, 'Download model').click();
  await button(page, 'Retry response').click();
  await expect(conversation).toContainText('A small local answer.');
  await expect(button(page, 'Stop response')).toHaveCount(0);
  expect(await state(page, () => window.__spotlightAI.incoming.filter(message => message.type === 'generate').at(-1).messages.at(-1).content)).toBe('Trigger a recoverable model error.');
  checks.push('Generation failures are visible and Retry response resends the same prompt successfully');

  await input.fill('https://example.com/docs');
  await input.press('Enter');
  await expect(conversation).toContainText('https://example.com/docs');
  await expect(button(page, 'Stop response')).toHaveCount(0);
  expect(await state(page, () => window.__spotlightAI.incoming.filter(message => message.type === 'generate').at(-1).messages.at(-1).content)).toBe('https://example.com/docs');
  await expect(page.locator('[data-app-id="lope.browser"]')).toHaveCount(0);
  checks.push('Website-like text goes to the local model and does not navigate or search the web');

  await page.evaluate(() => { window.__spotlightAI.generationMode = 'hold'; });
  await input.fill('Pause when I close Spotlight.');
  await input.press('Enter');
  await expect(button(page, 'Stop response')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(searchDialog(page)).toBeHidden();
  await openMain(page);
  await expect(button(page, 'Stop response')).toHaveCount(0);
  checks.push('Closing Spotlight stops generation before reopening the conversation');

  await modelOptions(page);
  await button(page, 'Unload model').click();
  await expect(button(page, 'Download model')).toBeEnabled();
  await expect.poll(() => state(page, () => window.__spotlightAI.terminations)).toBeGreaterThan(1);
  checks.push('Unload model releases its worker and GPU resources');

  await page.evaluate(() => { window.__spotlightAI.generationMode = 'success'; });
  await button(page, 'Download model').click();
  await expect(button(page, 'Remove download')).toBeEnabled();
  await button(page, 'Remove download').click();
  await expect(button(page, 'Download model')).toBeEnabled();
  expect(await state(page, () => window.__spotlightAI.incoming.some(message => message.type === 'remove'))).toBe(true);
  checks.push('Remove download requests cache deletion and returns to the opt-in state');

  await page.setViewportSize({ width: 390, height: 700 });
  await expect(searchDialog(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const bounds = await searchDialog(page).boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
  await button(page, 'Download model').scrollIntoViewIfNeeded();
  const downloadBounds = await button(page, 'Download model').boundingBox();
  expect(downloadBounds.y + downloadBounds.height).toBeLessThanOrEqual(700);
  await button(page, 'Download model').click();
  await expect(button(page, 'Unload model')).toBeEnabled();
  const footer = searchDialog(page).locator('.spotlight-footer');
  await footer.scrollIntoViewIfNeeded();
  const footerBounds = await footer.boundingBox();
  expect(footerBounds.y + footerBounds.height).toBeLessThanOrEqual(700);
  await page.screenshot({ path: fileURLToPath(new URL('spotlight-ai-mobile.png', artifacts)), animations: 'disabled' });
  checks.push('The integrated Spotlight fits a narrow viewport and scrolls to model controls and keyboard help');

  const unsupported = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await setup(unsupported, { supported: false });
  await openMain(unsupported);
  await expect(searchDialog(unsupported)).toContainText(/WebGPU|supported browser|unavailable/i);
  expect(await state(unsupported, () => window.__spotlightAI.workers)).toBe(0);
  await unsupported.keyboard.press('Control+0');
  await searchInput(unsupported).fill('15% of 80');
  await expect(searchDialog(unsupported).locator('.spotlight-answer')).toContainText('12');
  checks.push('Unsupported browsers receive an explanation while normal Spotlight calculations still work');
  await unsupported.close();

  const slow = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const filesystem = await setup(slow, { searchFiles: true });
  await openMain(slow);
  await button(slow, 'Download model').click();
  await searchInput(slow).fill('Where is Paris');
  await expect(button(slow, 'Send message')).toBeEnabled();
  let releaseLookup;
  const lookupGate = new Promise(resolve => { releaseLookup = resolve; });
  let heldLookups = 0;
  const holdLookup = async route => { heldLookups++; await lookupGate; await route.fallback(); };
  await slow.route('**/api/fs/list**', holdLookup);
  await searchInput(slow).fill('Where is Berlin');
  await searchInput(slow).press('Enter');
  await expect.poll(() => heldLookups).toBeGreaterThan(0);
  await expect(searchDialog(slow).getByRole('region', { name: 'Spotlight conversation', exact: true })).toContainText('Where is Berlin');
  await expect(button(slow, 'Stop response')).toHaveCount(0);
  releaseLookup();
  await slow.unroute('**/api/fs/list**', holdLookup);
  checks.push('An unavailable workspace lookup reaches its deadline and allows ordinary text to reach the model');

  filesystem.externalWrite('/Documents/hello-other.txt', 'The selected second file.');
  let releaseFolder;
  const folderGate = new Promise(resolve => { releaseFolder = resolve; });
  const holdFolder = async route => {
    if (new URL(route.request().url()).searchParams.get('path') === '/Downloads') await folderGate;
    await route.fallback();
  };
  await slow.route('**/api/fs/list**', holdFolder);
  await searchInput(slow).fill('hello');
  const selectedFile = searchDialog(slow).getByRole('option', { name: /hello-other\.txt/ });
  await expect(selectedFile).toBeVisible();
  const matchingFiles = searchDialog(slow).getByRole('option');
  const names = await matchingFiles.allTextContents();
  const selectedIndex = names.findIndex(name => name.includes('hello-other.txt'));
  expect(selectedIndex).toBeGreaterThan(0);
  for (let index = 0; index < selectedIndex; index++) await searchInput(slow).press('ArrowDown');
  await expect(selectedFile).toHaveAttribute('aria-selected', 'true');
  await searchInput(slow).press('Enter');
  await expect(slow.getByRole('textbox', { name: 'Document content', exact: true })).toHaveValue('The selected second file.');
  expect(await state(slow, () => window.__spotlightAI.incoming.filter(message => message.type === 'generate').at(-1).messages.at(-1).content)).toBe('Where is Berlin');
  releaseFolder();
  await slow.unroute('**/api/fs/list**', holdFolder);
  checks.push('Enter opens the selected matching file while other workspace folders are still pending');
  await slow.close();

  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  await rm(new URL('spotlight-ai-failure.png', artifacts), { force: true });
  await writeFile(new URL('spotlight-ai-verification.json', artifacts), JSON.stringify({ checks, errors, externalRequests }, null, 2) + '\n');
  console.log(JSON.stringify({ checks, errors, externalRequests }, null, 2));
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages()).at(-1);
  if (page) await page.screenshot({ path: fileURLToPath(new URL('spotlight-ai-failure.png', artifacts)), animations: 'disabled' }).catch(() => {});
  await writeFile(new URL('spotlight-ai-verification.json', artifacts), JSON.stringify({ checks, errors, externalRequests, failure: error.message }, null, 2) + '\n');
  throw error;
} finally { await browser.close(); }
