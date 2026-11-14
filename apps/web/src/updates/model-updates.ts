import { MODEL_IDS } from '../shell/spotlight-ai/core.ts';
import { DENOISE_PACKAGE } from '../../../../packages/photo-engine/src/denoise-manifest.ts';
import { AI_ASSETS, AI_CACHE, AI_MODEL } from '../../../../packages/image-engine/src/ai/catalog.ts';

export interface ModelRelease { id: string; name: string; fingerprint: string }

/** Optional for releases published before model catalogs were included. */
export function parseModelReleases(value: unknown): ModelRelease[] | undefined {
  if (value === undefined) return undefined;
  const invalid = () => new Error('The published model update information is invalid. Try again after the release finishes publishing.');
  if (!Array.isArray(value) || value.length > 32) throw invalid();
  const ids = new Set<string>();
  return value.map(model => {
    if (!model || typeof model !== 'object' || typeof model.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(model.id)
      || ids.has(model.id) || typeof model.name !== 'string' || !model.name.trim() || model.name.length > 100
      || typeof model.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(model.fingerprint)) throw invalid();
    ids.add(model.id);
    return { id: model.id, name: model.name, fingerprint: model.fingerprint };
  });
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Shared by release generation and the running app. These are catalog identities,
 * not a claim about newer upstream weights or the state of installed downloads.
 * Importing the bundled WebLLM catalog never fetches model files or touches caches.
 */
export async function getModelReleases(): Promise<ModelRelease[]> {
  const { prebuiltAppConfig, modelVersion } = await import('@mlc-ai/web-llm');
  const spotlight = MODEL_IDS.map(id => {
    const record = prebuiltAppConfig.model_list.find(model => model.model_id === id);
    if (!record?.model_lib) throw new Error('The Spotlight model catalog is incomplete.');
    return { id, source: record.model, library: record.model_lib, manifest: record.model_manifest ?? null, overrides: record.overrides ?? null };
  });
  return Promise.all([
    fingerprint({ modelVersion, backend: prebuiltAppConfig.cacheBackend ?? 'cache', variants: spotlight })
      .then(value => ({ id: 'spotlight', name: 'Spotlight AI', fingerprint: value })),
    fingerprint({ id: DENOISE_PACKAGE.id, version: DENOISE_PACKAGE.version, runtime: DENOISE_PACKAGE.runtime, files: DENOISE_PACKAGE.files })
      .then(value => ({ id: 'denoise', name: 'Photo denoise', fingerprint: value })),
    fingerprint({ id: AI_MODEL.id, runtime: AI_MODEL.runtime, cache: AI_CACHE, files: AI_ASSETS })
      .then(value => ({ id: 'portrait', name: 'Portrait cutouts', fingerprint: value })),
  ]);
}

/** Read-only comparison with this app's catalog; optional models stay optional. */
export async function checkModelUpdates(target: ModelRelease[] | undefined): Promise<string> {
  if (!target) return 'This release does not publish model update information. Existing downloads are kept.';
  const current = await getModelReleases();
  const updates = target.filter(model => current.find(installed => installed.id === model.id)?.fingerprint !== model.fingerprint);
  const removed = current.filter(model => !target.some(next => next.id === model.id));
  const details: string[] = [];
  if (updates.length) details.push(`Model updates found: ${updates.map(model => model.name).join(', ')}.`);
  if (removed.length) details.push(`No longer listed in this release: ${removed.map(model => model.name).join(', ')}.`);
  if (!details.length) return 'No model catalog changes in this release. Existing downloads are kept.';
  return `${details.join(' ')} Existing downloads are kept; model downloads remain optional.`;
}
