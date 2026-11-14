import type { AppManifest } from '../../../../../packages/contracts/src';
export const imageGeneratorManifest: AppManifest = {
  contractVersion: 1, id: 'lope.image-generator', name: 'Image Generator', description: 'Create images from text with a downloadable AI model that runs on this device.', icon: 'image-generator', singleton: true,
  entry: () => import('./index'), defaultSize: { width: 980, height: 680 }, minSize: { width: 560, height: 440 },
  menus: [
    { label: 'File', items: ['generator.generate', { separator: true }, 'generator.save', 'generator.download'] },
    { label: 'Edit', items: ['generator.random-seed'] },
    { label: 'Model', items: ['generator.install', 'generator.remove'] },
  ],
};
