import type { AppManifest, MenuDefinition } from '../../../../packages/contracts/src';

const fileMenus: MenuDefinition[] = [
  { label: 'File', items: ['files.new-window', { separator: true }, 'files.open', 'files.open-with', 'files.new-folder', 'files.upload', 'files.download', { separator: true }, 'files.info'] },
  { label: 'Edit', items: ['files.cut', 'files.copy', 'files.paste', 'files.duplicate', { separator: true }, 'files.rename', 'files.move', 'files.delete', 'files.put-back', 'files.delete-permanently', 'files.empty-trash', { separator: true }, 'files.select-all', 'files.find'] },
  { label: 'View', items: ['files.home', 'files.documents', 'files.downloads', 'files.trash', 'files.parent', 'files.go', { separator: true }, 'files.list', 'files.grid', 'files.hidden', 'files.refresh'] },
];
export const filesManifest: AppManifest = {
  contractVersion: 1, id: 'lope.files', name: 'Files', description: 'Browse and manage files.', icon: 'files',
  entry: () => import('./files'), defaultSize: { width: 900, height: 590 }, minSize: { width: 360, height: 340 },
  fileAssociations: ['inode/directory'], menus: fileMenus,
};
export const editorManifest: AppManifest = {
  contractVersion: 1, id: 'lope.editor', name: 'Text Editor', description: 'Edit plain text files.', icon: 'editor',
  entry: () => import('./text-editor'), defaultSize: { width: 780, height: 610 }, minSize: { width: 340, height: 320 },
  fileAssociations: ['.txt', '.md', '.markdown', '.json', '.csv', '.js', '.ts', '.tsx', '.jsx', '.css', '.py', '.sh', '.yaml', '.yml', '.toml', '.xml', '.log', 'text/plain'],
  menus: [
    { label: 'File', items: ['editor.new', 'editor.open', { separator: true }, 'editor.save', 'editor.save-as'] },
    { label: 'Edit', items: ['editor.undo', 'editor.redo', { separator: true }, 'editor.find', 'editor.replace'] },
    { label: 'View', items: ['editor.wrap'] },
  ],
};
export const settingsManifest: AppManifest = {
  contractVersion: 1, id: 'lope.settings', name: 'Settings', description: 'System preferences and accounts.', icon: 'settings', singleton: true,
  entry: () => import('./settings'), defaultSize: { width: 820, height: 630 }, minSize: { width: 360, height: 350 },
  menus: [{ label: 'View', items: ['settings.appearance', 'settings.wallpaper', 'settings.dock', 'settings.accessibility', 'settings.weather', 'settings.applications'] }],
};
export const weatherManifest: AppManifest = {
  contractVersion: 1, id: 'lope.weather', name: 'Weather', description: 'Current conditions and forecasts.', icon: 'weather', singleton: true,
  entry: () => import('./weather'), defaultSize: { width: 780, height: 740 }, minSize: { width: 340, height: 400 },
  menus: [{ label: 'Edit', items: ['weather.location'] }, { label: 'View', items: ['weather.refresh', 'weather.celsius', 'weather.fahrenheit'] }],
};
export const calculatorManifest: AppManifest = {
  contractVersion: 1, id: 'lope.calculator', name: 'Calculator', description: 'Calculations, conversions, and math notes.', icon: 'calculator', singleton: true,
  entry: () => import('./calculator'), defaultSize: { width: 365, height: 550 }, minSize: { width: 300, height: 420 },
  menus: [{ label: 'Edit', items: ['calculator.clear', 'calculator.backspace', 'calculator.copy'] }, { label: 'View', items: ['calculator.history', 'calculator.clear-history'] }],
};
export const applicationManifests = [filesManifest, editorManifest, settingsManifest, weatherManifest, calculatorManifest];
