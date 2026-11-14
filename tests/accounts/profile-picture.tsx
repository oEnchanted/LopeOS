import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccountPanel } from '../../apps/web/src/accounts/AccountPanel';
import { cloudAccount } from '../../apps/web/src/accounts/service';
import '../../packages/ui/src/styles.css';

createRoot(document.getElementById('root')!).render(<main className="settings-app-v2" data-testid="profile-picture-harness" style={{ margin: '24px auto', padding: 24, width: 'min(100%, 620px)', background: 'var(--surface)', color: 'var(--text)' }}><AccountPanel/></main>);
void cloudAccount.initialize();
