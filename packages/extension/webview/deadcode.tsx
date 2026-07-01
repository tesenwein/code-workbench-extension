import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DeadCodePanel } from '@code-workbench/ui';
import type { ScanPaneApi, DeadCodeItem } from '@code-workbench/ui';
import '@code-workbench/ui/styles.css';
import { createBridge } from './bridge';

const bridge = createBridge();

const api: ScanPaneApi<DeadCodeItem> = {
  scan: (p) => bridge.call('scan', p),
  listAck: (p) => bridge.call('listAck', p),
  listExclude: (p) => bridge.call('listExclude', p),
  ack: (p, fp, remove) => bridge.call('ack', p, fp, remove),
  excludeDir: (p, dir, remove) => bridge.call('excludeDir', p, dir, remove),
};

function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [scanSignal, setScanSignal] = useState(0);

  useEffect(() => {
    bridge.onEvent((name, payload) => {
      if (name === 'repo-root') setRepoPath((payload as string | null) ?? null);
      else if (name === 'scan') setScanSignal((n) => n + 1);
    });
    bridge.ready();
  }, []);

  return (
    <DeadCodePanel
      repoPath={repoPath}
      api={api}
      hideHeaderTitle
      hideHeaderRefresh
      scanSignal={scanSignal}
      onCreateTask={(title) => void bridge.call('createTask', title)}
      onOpenFile={(loc, _name, line) => void bridge.call('openFile', loc, line)}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
