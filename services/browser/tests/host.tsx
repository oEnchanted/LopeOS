import { createRoot } from 'react-dom/client';
import Browser from '../../../apps/web/src/apps/browser/Browser';
import type { AppContext } from '../../../packages/contracts/src';
import '../../../packages/ui/src/styles.css';

// `?file` renders the app as LopeOS launches it to open a file: a launch path, an
// in-memory LopeDrive and a file dialog that picks a second file.
const drive: Record<string, string> = {
  '/LopeDrive/Documents/report.html': '<!doctype html><title>UI report</title><p id="text">Opened from LopeDrive</p>',
  '/LopeDrive/Documents/second.htm': '<!doctype html><title>Second file</title><p>Chosen with Open File</p>',
};
const read = (path: string) => { if (!(path in drive)) throw new Error('The file is unavailable.'); return new TextEncoder().encode(drive[path]); };
const context = {
  windowId: 'browser-test', launchArgs: { path: '/LopeDrive/Documents/report.html' },
  services: {
    files: {
      stat: async (path: string) => ({ name: path.split('/').at(-1)!, path, type: 'file', size: read(path).length, modified: new Date(0).toISOString() }),
      readBinary: async (path: string) => ({ data: read(path), version: '1' }),
    },
    dialogs: { openFile: async () => '/LopeDrive/Documents/second.htm' },
    commands: { register: () => () => {} },
  },
  lifecycle: { setTitle: () => {}, close: () => {}, onBeforeClose: () => () => {} },
} as unknown as AppContext;

createRoot(document.getElementById('browser-test-root')!).render(new URLSearchParams(location.search).has('file') ? <Browser context={context}/> : <Browser/>);
