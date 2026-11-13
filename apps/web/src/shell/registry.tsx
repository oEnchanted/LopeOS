import type { AppManifest } from '../../../../packages/contracts/src';
import { applicationManifests } from '../apps/manifests';
import { browserApplication } from '../apps/browser/manifest';
import { extensions } from './extensions';
const app = (id: string, name: string, description: string, width: number, height: number, entry: AppManifest['entry'], extras: Partial<AppManifest> = {}): AppManifest => ({ contractVersion: 1, id: `lope.${id}`, name, description, icon: id, entry, defaultSize: { width, height }, minSize: { width: 360, height: 300 }, singleton: true, ...extras });
const adapted = (id: string): AppManifest => { const sourceId = id === 'editor' ? 'text-editor' : id; const manifest = applicationManifests.find(app => app.id === sourceId || app.id === `lope.${id}`)!; return { ...manifest, id: `lope.${id}`, icon: id, ...(id === 'settings' ? { defaultSize: { width: 900, height: 720 } } : {}), singleton: !['editor', 'files'].includes(id) }; };
export const applications: AppManifest[] = [
  app('welcome', 'Welcome', 'Getting started and keyboard shortcuts', 920, 610, () => import('./Welcome')),
  adapted('files'), browserApplication,
  adapted('editor'), adapted('weather'), adapted('calculator'), adapted('settings'),
  ...extensions,
];
export const appById = (id: string) => applications.find(app => app.id === id);
