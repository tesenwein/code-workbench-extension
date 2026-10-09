import { useState, useEffect } from 'react';
import { ArchPanel } from '@code-workbench/ui';
import type { ArchApi } from '@code-workbench/ui';
import '@code-workbench/ui/styles.css';
import { createBridge, mountApp } from './bridge';

const bridge = createBridge();

const api: ArchApi = {
  list: () => bridge.call('list'),
  upsert: (card) => bridge.call('upsert', card),
  remove: (slug) => bridge.call('remove', slug),
  openCard: (slug) => bridge.call('openCard', slug),
  openInPage: (slug) => bridge.call('openInPage', slug),
  search: (query) => bridge.call('search', query),
};

interface ArchEvents {
  'repo-root': string | null;
  'arch-changed': null;
  'focus-card': string | null;
  context: { surface?: string } | null;
}

function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [focusSlug, setFocusSlug] = useState<string | null>(null);
  // The same bundle serves the sidebar view and the full-page board; the host
  // posts surface:'page' so the page renders the master/detail detail viewer.
  const [pageMode, setPageMode] = useState(false);

  useEffect(() => {
    bridge.onEvents<ArchEvents>({
      'repo-root': (p) => setRepoPath(p ?? null),
      'arch-changed': () => setReloadKey((k) => k + 1),
      'focus-card': (p) => setFocusSlug(p ?? null),
      context: (p) => setPageMode(p?.surface === 'page'),
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
      pageMode={pageMode}
    />
  );
}

mountApp(<App />);
