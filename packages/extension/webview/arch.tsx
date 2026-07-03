import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchPanel } from '@code-workbench/ui';
import type { ArchApi } from '@code-workbench/ui';
import '@code-workbench/ui/styles.css';
import { createBridge } from './bridge';

const bridge = createBridge();

const api: ArchApi = {
  list: () => bridge.call('list'),
  upsert: (card) => bridge.call('upsert', card),
  remove: (slug) => bridge.call('remove', slug) as Promise<void>,
  openCard: (slug) => bridge.call('openCard', slug) as Promise<void>,
  search: (query) =>
    bridge.call('search', query) as Promise<Array<{ slug: string; score: number }>>,
};

function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [focusSlug, setFocusSlug] = useState<string | null>(null);

  useEffect(() => {
    bridge.onEvent((name, payload) => {
      if (name === 'repo-root') setRepoPath((payload as string | null) ?? null);
      else if (name === 'arch-changed') setReloadKey((k) => k + 1);
      else if (name === 'focus-card') setFocusSlug((payload as string | null) ?? null);
    });
    bridge.ready();
  }, []);

  return (
    <ArchPanel
      repoPath={repoPath}
      api={api}
      reloadKey={reloadKey}
      hideHeaderTitle
      focusSlug={focusSlug}
      onFocusSlugHandled={() => setFocusSlug(null)}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
