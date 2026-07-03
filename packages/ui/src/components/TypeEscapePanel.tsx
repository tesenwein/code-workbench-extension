import { ScanPanel } from './ScanPanel';
import { ScanItemRow } from './ScanRowParts';
import type { TypeEscapeItem, TypeEscapeKind, ScanPaneApi, OpenFileFn } from '../types';

interface Props {
  repoPath: string | null;
  api: ScanPaneApi<TypeEscapeItem>;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onCreateTask?: (title: string) => void;
  onOpenFile?: OpenFileFn;
  results?: TypeEscapeItem[];
  onResultsChange?: (next: TypeEscapeItem[]) => void;
  resizable?: boolean;
  /** Suppress the pane-header title when the host chrome already shows it. */
  hideHeaderTitle?: boolean;
  /** Suppress the pane-header refresh button when the host provides its own. */
  hideHeaderRefresh?: boolean;
  /** Bump to trigger a scan from the host (e.g. a view/title command). */
  scanSignal?: number;
}

const KIND_LABEL: Record<TypeEscapeKind, string> = {
  'as-cast': 'Cast',
  'any-type': 'Any',
  'non-null': 'Non-null',
  'ts-ignore': 'Ignore',
};

const KIND_CLASS: Record<TypeEscapeKind, string> = {
  'as-cast': 'dc-kind-export',
  'any-type': 'dc-kind-comment',
  'non-null': 'dc-kind-local',
  'ts-ignore': 'dc-kind-comment',
};

export function TypeEscapePanel({
  repoPath,
  api,
  collapsed,
  onToggleCollapsed,
  onCreateTask,
  onOpenFile,
  results,
  onResultsChange,
  resizable,
  hideHeaderTitle,
  hideHeaderRefresh,
  scanSignal,
}: Props) {
  return (
    <ScanPanel<TypeEscapeItem>
      title="Type Safety"
      hideHeaderTitle={hideHeaderTitle}
      hideHeaderRefresh={hideHeaderRefresh}
      scanSignal={scanSignal}
      repoPath={repoPath}
      feature="type-escapes"
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      scanLabel="Scan for type escapes"
      scanHint="Click ↻ to scan for type-safety escape hatches."
      excludePlaceholder="Directory name (e.g. dist)"
      api={api}
      results={results}
      onResultsChange={onResultsChange}
      resizable={resizable}
      renderRow={({ item, acknowledged, onAck, onUnack }) => (
        <ScanItemRow
          item={item}
          acknowledged={acknowledged}
          repoPath={repoPath}
          kindLabel={KIND_LABEL}
          kindClass={KIND_CLASS}
          onAck={onAck}
          onUnack={onUnack}
          onCreateTask={onCreateTask}
          onOpenFile={onOpenFile}
        />
      )}
    />
  );
}
