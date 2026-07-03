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
  openInEditor: (id) => bridge.call('openInEditor', id) as Promise<void>,
};

interface Context {
  activeWorktree: string | null;
  worktrees: string[];
  /** 'page' when hosted as the full editor-tab board (tasksPage.ts). */
  surface?: 'sidebar' | 'page';
}

function App() {
  const [reloadKey, setReloadKey] = useState(0);
  const [ctx, setCtx] = useState<Context>({
    activeWorktree: null,
    worktrees: [],
  });
  // Bumped each time the host asks the page to focus a task, so re-selecting
  // the same id (e.g. reveal) still re-opens its editor.
  const [openTask, setOpenTask] = useState<{ id: string; nonce: number } | null>(null);
  const [newTaskNonce, setNewTaskNonce] = useState(0);

  useEffect(() => {
    bridge.onEvent((name, payload) => {
      if (name === 'tasks-changed') setReloadKey((k) => k + 1);
      else if (name === 'context') setCtx(payload as Context);
      else if (name === 'select-task')
        setOpenTask((prev) => ({ id: String(payload), nonce: (prev?.nonce ?? 0) + 1 }));
      else if (name === 'new-task') setNewTaskNonce((n) => n + 1);
    });
    bridge.ready();
  }, []);

  const isPage = ctx.surface === 'page';

  return (
    <TasksPanel
      api={api}
      activeWorktree={ctx.activeWorktree}
      worktrees={ctx.worktrees}
      reloadKey={reloadKey}
      hideHeaderTitle
      hideHeaderActions
      pageMode={isPage}
      // Sidebar: defer to the main-panel board for editing instead of
      // expanding an inline form in this narrow view.
      onOpenTask={isPage ? undefined : (id) => void bridge.call('openTaskPage', id)}
      openTaskId={openTask?.id}
      openTaskNonce={openTask?.nonce}
      newTaskNonce={newTaskNonce}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
