import vm from 'node:vm';

export interface ReleaseAsset { url: string; size: number; sha256: string }
export interface ReleaseManifest { format: 1; version: string; build: string; releasedAt: string; totalBytes: number; assets: ReleaseAsset[] }
type Validator = (release: ReleaseManifest) => unknown;

/** Load validateRelease() from the update worker script exactly as clients run it. */
function loadValidator(workerSource: string): Validator {
  const context: Record<string, unknown> = { self: { location: { origin: 'https://lopeos.invalid' }, addEventListener() {} }, URL };
  vm.createContext(context);
  vm.runInContext(workerSource, context, { filename: 'lope-sw.js' });
  if (typeof context.validateRelease !== 'function') throw new Error('The update worker no longer defines validateRelease().');
  return context.validateRelease as Validator;
}

function accepts(validate: Validator, release: ReleaseManifest, assets: ReleaseAsset[]): boolean {
  try { validate({ ...release, assets, totalBytes: assets.reduce((sum, asset) => sum + asset.size, 0) }); return true; }
  catch { return false; }
}

/**
 * Fail the build when the update worker would refuse the release. Clients keep
 * their installed worker until every LopeOS tab closes, so new public files must
 * fit the existing allowlist (index.html, assets/, wallpapers/, photos/, or a
 * root icon/manifest file). Loosening the worker does not help those clients.
 */
export function assertWorkerAccepts(release: ReleaseManifest, workerSource: string): void {
  const validate = loadValidator(workerSource);
  try { validate(release); return; }
  catch (error) {
    const reason = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
    const index = release.assets.find(asset => asset.url === '/index.html');
    const rejected = index ? release.assets.filter(asset => asset !== index && !accepts(validate, release, [index, asset])).map(asset => asset.url) : [];
    const detail = rejected.length ? ` Unsupported files: ${rejected.slice(0, 20).join(', ')}${rejected.length > 20 ? ', …' : ''}. Import them from app code so Vite emits them under /assets, or move them under an allowed folder.` : '';
    throw new Error(`Installed LopeOS update workers would reject this release (${reason}).${detail}`);
  }
}
