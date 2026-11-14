import type { AppManifest } from '../../../../../packages/contracts/src';
import { previewAssociations } from './formats';

/** Preview is the default viewer for images, one window per opened image. */
export const previewManifest: AppManifest = {
  contractVersion: 1, id: 'lope.preview', name: 'Preview', description: 'View, mark up, adjust, and convert images in every common format.', icon: 'preview',
  entry: () => import('./index'), defaultSize: { width: 1040, height: 740 }, minSize: { width: 420, height: 340 },
  fileAssociations: previewAssociations,
  menus: [
    { label: 'File', items: ['preview.new-clipboard', 'preview.open', { separator: true }, 'preview.close-image', 'preview.save', 'preview.duplicate', 'preview.export', 'preview.revert', { separator: true }, 'preview.show-in-files', 'preview.open-in-prism', 'preview.open-in-luma', { separator: true }, 'preview.print'] },
    { label: 'Edit', items: ['preview.undo', 'preview.redo', { separator: true }, 'preview.cut', 'preview.copy', 'preview.paste', 'preview.delete', { separator: true }, 'preview.select-all', 'preview.deselect', 'preview.invert-selection'] },
    { label: 'View', items: ['preview.sidebar', { separator: true }, 'preview.actual-size', 'preview.fit', 'preview.zoom-in', 'preview.zoom-out', 'preview.zoom-selection', { separator: true }, 'preview.checkerboard', 'preview.slideshow', { separator: true }, 'preview.markup', 'preview.inspector'] },
    { label: 'Go', items: ['preview.previous', 'preview.next', { separator: true }, 'preview.first', 'preview.last'] },
    { label: 'Tools', items: ['preview.adjust-color', 'preview.adjust-size', { separator: true }, 'preview.rotate-left', 'preview.rotate-right', 'preview.flip-horizontal', 'preview.flip-vertical', { separator: true }, 'preview.crop', { separator: true }, 'preview.tool-rect', 'preview.tool-ellipse', 'preview.tool-lasso', 'preview.tool-alpha', { separator: true }, 'preview.tool-sketch', 'preview.text', 'preview.shape-rect', 'preview.shape-rounded', 'preview.shape-oval', 'preview.shape-line', 'preview.shape-arrow', 'preview.shape-star', 'preview.shape-bubble', 'preview.shape-highlight'] },
  ],
};
