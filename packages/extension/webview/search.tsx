import { useState, useEffect } from 'react';
import { SearchPanel } from '@code-workbench/ui';
import type { SearchApi } from '@code-workbench/ui';
import '@code-workbench/ui/styles.css';
import { createBridge, mountApp } from './bridge';

const bridge = createBridge();

const api: SearchApi = {
  search: (query) => bridge.call('search', query),
  openFile: (file, line) => bridge.call('openFile', file, line),
};

interface SearchEvents {
  'repo-root': string | null;
  'run-search': string | null;
}

function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [queryKey, setQueryKey] = useState(0);

  useEffect(() => {
    bridge.onEvents<SearchEvents>({
      'repo-root': (p) => setRepoPath(p ?? null),
      'run-search': (p) => {
        setQuery(String(p ?? ''));
        setQueryKey((k) => k + 1);
      },
    });
    bridge.ready();
  }, []);

  return (
    <SearchPanel repoPath={repoPath} api={api} externalQuery={query} externalQueryKey={queryKey} />
  );
}

mountApp(<App />);
