import React from 'react';
import { createRoot } from 'react-dom/client';
import { FirstRun } from './setup/FirstRun';
import '../../../packages/ui/src/styles.css';
import './shell/shell.css';
import './shell/materials.css';
import './shell/desktop-polish.css';
import './shell/spotlight.css';
import './shell/control-center.css';
import './shell/glass-surfaces.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><FirstRun /></React.StrictMode>);
