import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PhaseBoard } from '@code-workbench/ui';
import type { PhaseModelMap, TasksApi } from '@code-workbench/ui';
import '@code-workbench/ui/styles.css';
import { createBridge } from './bridge';

const bridge = createBridge();

const api: TasksApi = {
  list: () => bridge.call('list'),
  create: (task) => bridge.call('create', task),
  update: (id, patch) => bridge.call('update', id, patch) as Promise<void>,
  remove: (id) => bridge.call('remove', id) as Promise<void>,
  openInEditor: (id) => bridge.call('openInEditor', id) as Promise<void>,
  startPhase: (id, phase) => bridge.call('startPhase', id, phase) as Promise<void>,
};

function App() {
  const [reloadKey, setReloadKey] = useState(0);
  const [phaseModels, setPhaseModels] = useState<PhaseModelMap | undefined>(undefined);

  useEffect(() => {
    bridge.onEvent((name, payload) => {
      if (name === 'tasks-changed') setReloadKey((k) => k + 1);
      else if (name === 'phase-models') setPhaseModels(payload as PhaseModelMap);
    });
    bridge.ready();
  }, []);

  return (
    <PhaseBoard
      api={api}
      reloadKey={reloadKey}
      phaseModels={phaseModels}
      onOpenTask={(id) => void bridge.call('openTaskPage', id)}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
