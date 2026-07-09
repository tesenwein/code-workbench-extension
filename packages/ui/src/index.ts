/* @code-workbench/ui — shared React panel components for the Code
 * Workbench Electron app and VS Code extension. Import the matching
 * `@code-workbench/ui/styles.css` once per host for the component CSS. */

export { PaneHeader, Tab, AccordionRow } from './components/primitives';
export { FileLink, ScanRowActions } from './components/ScanRowParts';
export { ScanPanel } from './components/ScanPanel';
export { DeadCodePanel } from './components/DeadCodePanel';
export { TypeEscapePanel } from './components/TypeEscapePanel';
export { DuplicatesPanel } from './components/DuplicatesPanel';
export { TasksPanel } from './components/TasksPanel';
export { PhaseBoard } from './components/PhaseBoard';
export { ArchPanel } from './components/ArchPanel';
export { SearchPanel } from './components/SearchPanel';

export type {
  TaskPriority,
  TaskStatus,
  TaskPhase,
  PhaseModelMap,
  WorkspaceTask,
  NewWorkspaceTask,
  DeadCodeKind,
  DeadCodeItem,
  TypeEscapeKind,
  TypeEscapeItem,
  DuplicateMember,
  DuplicateGroup,
  ScanItem,
  ScanFeature,
  ScanPaneApi,
  TasksApi,
  OpenFileFn,
  ArchCard,
  ArchApi,
  CodeSearchResult,
  SearchApi,
} from './types';
