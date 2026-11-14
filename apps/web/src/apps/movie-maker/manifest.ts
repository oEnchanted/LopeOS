import type { AppManifest } from '../../../../../packages/contracts/src';

export const movieMakerManifest: AppManifest = {
  contractVersion: 1, id: 'lope.movie-maker', name: 'Movie Maker',
  description: 'Turn photos, clips, music, and narration into a movie.', icon: 'movie-maker', singleton: true,
  entry: () => import('./index'), defaultSize: { width: 1180, height: 760 }, minSize: { width: 680, height: 460 },
  fileAssociations: ['.lopemovie', '.lopemoviebundle'],
  menus: [
    { label: 'File', items: ['movie.new', 'movie.open', 'movie.save', 'movie.save-as', 'movie.download-project', 'movie.portable', { separator: true }, 'movie.import', 'movie.export'] },
    { label: 'Edit', items: ['movie.undo', 'movie.redo', { separator: true }, 'movie.split', 'movie.duplicate', 'movie.remove', 'movie.select-all'] },
    { label: 'View', items: ['movie.play', 'movie.fullscreen', 'movie.waveforms'] },
  ],
};
