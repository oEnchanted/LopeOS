import type { AppManifest } from '../../../../../packages/contracts/src';

export const writerManifest: AppManifest = {
  contractVersion: 1, id: 'lope.writer', name: 'Writer', icon: 'editor',
  description: 'Create, edit, and review Word documents.',
  entry: () => import('./index'), singleton: false,
  defaultSize: { width: 1366, height: 840 }, minSize: { width: 640, height: 420 },
  fileAssociations: ['.docx', '.dotx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  menus: [
    { label: 'Writer', items: ['writer.about', { separator: true }, 'writer.preferences'] },
    { label: 'File', items: ['writer.new', 'writer.open', 'writer.save', 'writer.save-as', { separator: true }, 'writer.export', 'writer.print', 'writer.preferences', 'writer.about'] },
    { label: 'Edit', items: ['writer.undo', 'writer.redo', { separator: true }, 'writer.cut', 'writer.copy', 'writer.paste', 'writer.find', 'writer.replace'] },
    { label: 'Format', items: ['writer.bold', 'writer.italic', 'writer.underline', 'writer.font', 'writer.paragraph'] },
    { label: 'Insert', items: ['writer.table', 'writer.picture', 'writer.link', 'writer.comment', 'writer.toc'] },
    { label: 'Review', items: ['writer.track', 'writer.accept', 'writer.reject', 'writer.comments'] },
    { label: 'View', items: ['writer.navigation', 'writer.ruler', 'writer.marks', 'writer.collapse'] },
  ],
};
