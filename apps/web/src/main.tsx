import React, { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { FirstRun } from './setup/FirstRun';
import '../../../packages/ui/src/styles.css';
import './shell/shell.css';
import './shell/materials.css';
import './shell/desktop-polish.css';
import './shell/spotlight.css';
import './shell/control-center.css';
import './shell/glass-surfaces.css';

const LAYOUT_KEYS = ['lope.session.layout.v1', 'lope.layout.v1'];
const recoveryStyles = `
.boot-recovery{position:fixed;inset:0;display:grid;place-items:center;padding:16px;background:#dfe9ef;color:#112c3d;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.boot-recovery section{max-width:460px;width:100%;padding:28px;border-radius:18px;background:#fff;border:1px solid #b9cbd6;box-shadow:0 18px 50px #0b2a3d24}
.boot-recovery h1{margin:0 0 8px;font-size:21px;line-height:1.25}
.boot-recovery p{margin:0 0 18px}
.boot-recovery .actions{display:flex;flex-wrap:wrap;gap:10px}
.boot-recovery button{font:inherit;font-weight:600;padding:9px 16px;border-radius:10px;border:1px solid #8aa6b7;background:#f4f8fa;color:inherit;cursor:pointer}
.boot-recovery button.primary{background:#14628a;border-color:#14628a;color:#fff}
.boot-recovery button:focus-visible{outline:3px solid #f0a020;outline-offset:2px}
.boot-recovery details{margin-top:18px;font-size:13px;color:#3d5868}
@media (prefers-color-scheme:dark){.boot-recovery{background:#0d1b24;color:#e8f1f6}.boot-recovery section{background:#16262f;border-color:#2f4a5a}.boot-recovery button{background:#1f3540;border-color:#4b6a7b}.boot-recovery button.primary{background:#5fb6df;border-color:#5fb6df;color:#06202d}.boot-recovery details{color:#a9c0cc}}
`;

/**
 * Last-resort boundary for the boot path. A failed chunk download or a render error
 * caused by damaged saved state must leave a readable recovery screen, never a blank page.
 * It renders without lazy chunks so it works when the desktop bundle cannot load.
 */
class BootBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error : new Error(String(error)) }; }
  componentDidUpdate(_: unknown, previous: { error: Error | null }) { if (this.state.error && !previous.error) document.querySelector<HTMLButtonElement>('.boot-recovery button.primary')?.focus(); }
  componentDidMount() { if (this.state.error) document.querySelector<HTMLButtonElement>('.boot-recovery button.primary')?.focus(); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const network = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch|ChunkLoadError/i.test(error.message);
    const resetLayout = () => { for (const key of LAYOUT_KEYS) { try { localStorage.removeItem(key); } catch { /* Reload still retries. */ } } location.reload(); };
    return <div className="boot-recovery"><style>{recoveryStyles}</style>
      <section role="alert" aria-labelledby="boot-recovery-title">
        <h1 id="boot-recovery-title">LopeOS couldn’t open the desktop</h1>
        <p>{network
          ? 'Part of LopeOS couldn’t be downloaded. Check your connection, then reload. Your files and settings have not been changed.'
          : 'Something in the saved desktop state stopped LopeOS from starting. Reload to try again. If this keeps happening, reset the window layout. That only forgets which windows were open; documents, files, and settings are kept.'}</p>
        <div className="actions">
          <button className="primary" type="button" onClick={() => location.reload()}>Reload LopeOS</button>
          <button type="button" onClick={resetLayout}>Reset window layout and reload</button>
        </div>
        <details><summary>Technical details</summary><code>{error.name}: {error.message.slice(0, 300)}</code></details>
      </section>
    </div>;
  }
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><BootBoundary><FirstRun /></BootBoundary></React.StrictMode>);
