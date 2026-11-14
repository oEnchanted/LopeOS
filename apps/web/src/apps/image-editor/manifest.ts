import type { AppManifest } from '../../../../../packages/contracts/src';
export const imageEditorManifest: AppManifest = {
  contractVersion: 1, id: 'lope.image-editor', name: 'Prism', description: 'Edit images with layers, masks, and drawing tools.', icon: 'image-editor',
  entry: () => import('./index'), defaultSize: { width: 1320, height: 840 }, minSize: { width: 740, height: 500 }, singleton: true,
  fileAssociations: ['.lopeimage', '.psd', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', 'image/png', 'image/jpeg', 'image/webp', 'image/vnd.adobe.photoshop'],
  menus: [
    { label: 'File', items: ['image.new', 'image.open', 'image.place', { separator: true }, 'image.save', 'image.save-as', 'image.export', 'image.psd-export', 'image.close'] },
    { label: 'Edit', items: ['image.undo', 'image.redo', { separator: true }, 'image.cut', 'image.copy', 'image.copy-merged', 'image.paste', 'image.paste-in-place', 'image.clear', { separator: true }, 'image.fill', 'image.transform'] },
    { label: 'Image', items: ['image.image-size', 'image.canvas-size', 'image.crop'] },
    { label: 'Layer', items: ['image.new-layer', 'image.duplicate', 'image.group', 'image.mask', 'image.clipping', 'image.embed', 'image.reset-source', 'image.merge', 'image.delete-layer'] },
    { label: 'Type', items: ['image.edit-text'] },
    { label: 'Select', items: ['image.select-all', 'image.deselect', 'image.invert', 'image.feather', 'image.expand', 'image.contract'] },
    { label: 'Filter', items: ['image.local-ai','image.ai-fill','image.ai-expand',{separator:true},'image.filter-gaussian-blur', 'image.filter-sharpen', 'image.filter-unsharp-mask', 'image.filter-invert', 'image.filter-grayscale', { separator: true }, 'image.smart-brightness', 'image.smart-levels', 'image.smart-hue'] },
    { label: 'View', items: ['image.zoom-in', 'image.zoom-out', 'image.fit', 'image.actual', 'image.rulers', 'image.guides'] },
    { label: 'Window', items: ['image.layers', 'image.history', 'image.properties', 'image.color', 'image.adjustments', 'image.channels', 'image.paths', 'image.taskbar', 'image.save-workspace', 'image.restore-workspace', 'image.reset-workspace'] },
    { label: 'Help', items: ['image.about'] },
  ],
};
