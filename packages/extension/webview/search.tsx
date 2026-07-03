import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SearchPanel } from '@code-workbench/ui';
import type { SearchApi } from '@code-workbench/ui';
import '@code-workbench/ui/styles.css';
import { createBridge } from './bridge';

const bridge = createBridge();

const api: SearchApi = {
  search: (query) => bridge.call('search', query),
  openFile: (file, line) => bridge.call('openFile', file, line) as Promise<void>,
};

function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [queryKey, setQueryKey] = useState(0);

  useEffect(() => {
    bridge.onEvent((name, payload) => {
      if (name === 'repo-root') setRepoPath((payload as string | null) ?? null);
      else if (name === 'run-search') {
        setQuery(String(payload ?? ''));
        setQueryKey((k) => k + 1);
      }
    });
    bridge.ready();
  }, []);

  return (
    <SearchPanel repoPath={repoPath} api={api} externalQuery={query} externalQueryKey={queryKey} />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
