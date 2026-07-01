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
export { ArchPanel } from './components/ArchPanel';

export type {
  TaskPriority,
  TaskStatus,
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
} from './types';
