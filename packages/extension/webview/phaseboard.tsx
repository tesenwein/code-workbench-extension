import { useState, useEffect } from 'react';
import { PhaseBoard } from '@code-workbench/ui';
import type { PhaseModelMap, TasksApi } from '@code-workbench/ui';
import '@code-workbench/ui/styles.css';
import { createBridge, mountApp } from './bridge';

const bridge = createBridge();

const api: TasksApi = {
  list: () => bridge.call('list'),
  create: (task) => bridge.call('create', task),
  update: (id, patch) => bridge.call('update', id, patch),
  remove: (id) => bridge.call('remove', id),
  openInEditor: (id) => bridge.call('openInEditor', id),
  startPhase: (id, phase) => bridge.call('startPhase', id, phase),
  confirmBulkStart: (phase, startableIds, inProgressIds) =>
    bridge.call('confirmBulkStart', phase, startableIds, inProgressIds),
};

interface PhaseBoardEvents {
  'tasks-changed': null;
  'phase-models': PhaseModelMap;
}

function App() {
  const [reloadKey, setReloadKey] = useState(0);
  const [phaseModels, setPhaseModels] = useState<PhaseModelMap | undefined>(undefined);

  useEffect(() => {
    bridge.onEvents<PhaseBoardEvents>({
      'tasks-changed': () => setReloadKey((k) => k + 1),
      'phase-models': setPhaseModels,
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

mountApp(<App />);
