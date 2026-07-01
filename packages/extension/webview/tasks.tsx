import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { TasksPanel } from '@code-workbench/ui';
import type { TasksApi } from '@code-workbench/ui';
import '@code-workbench/ui/styles.css';
import { createBridge } from './bridge';

const bridge = createBridge();

const api: TasksApi = {
  list: () => bridge.call('list'),
  create: (task) => bridge.call('create', task),
  update: (id, patch) => bridge.call('update', id, patch) as Promise<void>,
  remove: (id) => bridge.call('remove', id) as Promise<void>,
};

interface Context {
  activeWorktree: string | null;
  worktrees: string[];
}

function App() {
  const [reloadKey, setReloadKey] = useState(0);
  const [ctx, setCtx] = useState<Context>({
    activeWorktree: null,
    worktrees: [],
  });

  useEffect(() => {
    bridge.onEvent((name, payload) => {
      if (name === 'tasks-changed') setReloadKey((k) => k + 1);
      else if (name === 'context') setCtx(payload as Context);
    });
    bridge.ready();
  }, []);

  return (
    <TasksPanel
      api={api}
      activeWorktree={ctx.activeWorktree}
      worktrees={ctx.worktrees}
      reloadKey={reloadKey}
      hideHeaderTitle
      hideHeaderActions
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
