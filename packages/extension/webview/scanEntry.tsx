import { useState, useEffect } from 'react';
import type { ComponentType } from 'react';
import type { ScanPaneApi, ScanItem, OpenFileFn } from '@code-workbench/ui';
import '@code-workbench/ui/styles.css';
import { createBridge, mountApp } from './bridge';

interface ScanEvents {
  'repo-root': string | null;
  scan: null;
}

interface ScanPanelProps<T extends ScanItem> {
  repoPath: string | null;
  api: ScanPaneApi<T>;
  hideHeaderTitle: boolean;
  hideHeaderRefresh: boolean;
  scanSignal: number;
  onCreateTask: (title: string) => void;
  onOpenFile: OpenFileFn;
}

/** Mount a scan page: wires the shared scan RPC set (scan/ack/exclude/…) and the
 *  `repo-root` / `scan` events to `Panel`. The three scan entries differ only in
 *  which panel they render. */
export function createScanApp<T extends ScanItem>(Panel: ComponentType<ScanPanelProps<T>>): void {
  const bridge = createBridge();

  const api: ScanPaneApi<T> = {
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
      bridge.onEvents<ScanEvents>({
        'repo-root': (p) => setRepoPath(p ?? null),
        scan: () => setScanSignal((n) => n + 1),
      });
      bridge.ready();
    }, []);

    return (
      <Panel
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

  mountApp(<App />);
}
