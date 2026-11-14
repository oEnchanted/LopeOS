import type { AppManifest, MenuDefinition } from '../../../../../packages/contracts/src';
export const browserMenus: MenuDefinition[] = [
  { label: 'File', items: ['browser.new-tab', 'browser.private', 'browser.open-file', 'browser.duplicate', 'browser.close-tab', { separator: true }, 'browser.print'] },
  { label: 'Edit', items: ['browser.copy-address', 'browser.paste', 'browser.find'] },
  { label: 'View', items: ['browser.reload', 'browser.stop', 'browser.home', { separator: true }, 'browser.zoom-in', 'browser.zoom-out', 'browser.zoom-reset', { separator: true }, 'browser.devtools'] },
  { label: 'History', items: ['browser.back', 'browser.forward', 'browser.reopen', { separator: true }, 'browser.history', 'browser.clear-data'] },
  { label: 'Bookmarks', items: ['browser.bookmark', 'browser.bookmarks'] },
  { label: 'Window', items: ['browser.downloads', 'browser.next-tab', 'browser.previous-tab'] },
  { label: 'Help', items: ['browser.about', 'browser.open-host'] },
];
export const browserApplication: AppManifest = {
  contractVersion: 1, id: 'lope.browser', name: 'Lope Browser', description: 'Browse websites and manage bookmarks.', icon: 'browser',
  entry: () => import('./Browser'), defaultSize: { width: 1100, height: 740 }, minSize: { width: 420, height: 360 },
  // Listed before the Text Editor in the registry, so HTML files open here by default.
  singleton: true, protocols: ['http:', 'https:'], fileAssociations: ['.html', '.htm', '.xhtml', 'text/html', 'application/xhtml+xml'], menus: browserMenus,
};
