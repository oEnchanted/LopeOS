import type { AppManifest } from '../contracts/src';

export const exampleManifest: AppManifest = {
  contractVersion: 1,
  id: 'example.notes', name: 'Example Notes', icon: 'editor',
  description: 'A small example using the LopeOS application SDK.',
  entry: () => import('./src/ExampleApp'),
  defaultSize: { width: 700, height: 520 }, minSize: { width: 340, height: 320 },
  menus: [
    { label: 'File', items: ['example.refresh', 'example.save'] },
    { label: 'Edit', items: ['example.clear'] },
    { label: 'View', items: ['example.compact'] },
  ],
};
