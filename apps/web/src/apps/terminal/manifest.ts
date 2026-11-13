import type { AppManifest } from '../../../../../packages/contracts/src';
export const terminalApplication: AppManifest = {
  contractVersion: 1, id: 'terminal', name: 'Terminal', description: 'Run commands in a Linux shell.', icon: 'terminal',
  entry: () => import('./Terminal'), defaultSize: { width: 860, height: 540 }, minSize: { width: 400, height: 300 }, singleton: true,
  menus: [
    { label: 'File', items: ['terminal.new-tab', 'terminal.close-tab'] },
    { label: 'Edit', items: ['terminal.copy', 'terminal.paste', { separator: true }, 'terminal.find'] },
    { label: 'View', items: ['terminal.clear'] },
  ],
};
