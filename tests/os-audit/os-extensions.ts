/**
 * OS AUDIT ONLY. Replaces shell/extensions.ts in the audit build so the shell can
 * be verified while sibling applications are mid-edit. It registers a disposable
 * hostile fixture app; nothing here ships in the production registry.
 */
import type { AppManifest } from '../../packages/contracts/src';
export const extensions: AppManifest[] = [{
  contractVersion: 1, id: 'audit.hostile', name: 'Audit Fixture', icon: 'editor',
  description: 'Disposable OS audit fixture that attempts unauthorized operations.',
  entry: () => import('./HostileFixture'),
  defaultSize: { width: 520, height: 420 }, minSize: { width: 320, height: 260 },
  menus: [{ label: 'Fixture', items: ['fixture.ping'] }],
}];
