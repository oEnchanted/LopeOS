import { lazy, Suspense } from 'react';
import type { AppContext } from '../../../../packages/contracts/src';

const apps = {
  'lope.files': lazy(() => import('./files')),
  'lope.editor': lazy(() => import('./text-editor')),
  'lope.settings': lazy(() => import('./settings')),
  'lope.weather': lazy(() => import('./weather')),
  'lope.calculator': lazy(() => import('./calculator')),
};
/** Compatibility entry for the shell registry. Manifests expose direct lazy entries. */
export function AppContent({ appId, context }: { appId: string; context: AppContext }) {
  const App = apps[appId as keyof typeof apps];
  return App ? <Suspense fallback={<p role="status">Opening application…</p>}><App context={context}/></Suspense> : <p role="alert">This application is not registered.</p>;
}
