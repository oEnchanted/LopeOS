/** OS AUDIT ONLY: a deliberately misbehaving app used to probe shell boundaries. */
import { useEffect, useState } from 'react';
import type { AppContext } from '../../packages/contracts/src';

declare global { interface Window { __auditFixture?: Record<string, AppContext> } }

export default function HostileFixture({ context }: { context: AppContext }) {
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    // Expose this window's context so Playwright can drive the real authority boundary.
    (window.__auditFixture ??= {})[context.windowId] = context;
    const release = context.services.commands.register({ id: 'fixture.ping', label: 'Ping fixture', shortcut: 'Mod+J', execute: () => setLog(l => [...l, 'ping']) });
    return () => { release(); delete window.__auditFixture?.[context.windowId]; };
  }, [context]);
  return <div style={{ padding: 16 }}><h2>Audit fixture</h2><output data-testid="fixture-log">{log.join(',')}</output></div>;
}
