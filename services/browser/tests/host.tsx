import { createRoot } from 'react-dom/client';
import Browser from '../../../apps/web/src/apps/browser/Browser';
import '../../../packages/ui/src/styles.css';
createRoot(document.getElementById('browser-test-root')!).render(<Browser/>);
