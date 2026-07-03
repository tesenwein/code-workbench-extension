import { ScanPanel } from './ScanPanel';
import { ScanRowActions } from './ScanRowParts';
import { SnippetCard } from './SnippetCard';
import type { DeadCodeItem, DeadCodeKind, ScanPaneApi, OpenFileFn } from '../types';

interface Props {
  repoPath: string | null;
  api: ScanPaneApi<DeadCodeItem>;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onCreateTask?: (title: string) => void;
  onOpenFile?: OpenFileFn;
  results?: DeadCodeItem[];
  onResultsChange?: (next: DeadCodeItem[]) => void;
  resizable?: boolean;
  /** Suppress the pane-header title when the host chrome already shows it. */
  hideHeaderTitle?: boolean;
  /** Suppress the pane-header refresh button when the host provides its own. */
  hideHeaderRefresh?: boolean;
  /** Bump to trigger a scan from the host (e.g. a view/title command). */
  scanSignal?: number;
}

const KIND_LABEL: Record<DeadCodeKind, string> = {
  'unused-export': 'Export',
  'unused-local': 'Local',
  'commented-code': 'Comment',
};

const KIND_CLASS: Record<DeadCodeKind, string> = {
  'unused-export': 'dc-kind-export',
  'unused-local': 'dc-kind-local',
  'commented-code': 'dc-kind-comment',
};

export function DeadCodePanel({
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
    <ScanPanel<DeadCodeItem>
      title="Dead Code"
      hideHeaderTitle={hideHeaderTitle}
      hideHeaderRefresh={hideHeaderRefresh}
      scanSignal={scanSignal}
      repoPath={repoPath}
      feature="dead-code"
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      scanLabel="Scan for dead code"
      scanHint="Click ↻ to scan for dead code."
      excludePlaceholder="Directory name (e.g. dist)"
      api={api}
      results={results}
      onResultsChange={onResultsChange}
      resizable={resizable}
      renderRow={({ item, acknowledged, onAck, onUnack }) => (
        <SnippetCard
          name={item.name}
          kind={
            <span className={`dc-kind-badge ${KIND_CLASS[item.kind]}`}>{KIND_LABEL[item.kind]}</span>
          }
          file={item.file}
          startLine={item.startLine}
          repoPath={repoPath}
          snippet={item.snippet}
          onOpenFile={onOpenFile}
          detail={<span className="cw-snip-desc">{item.detail}</span>}
          actions={
            <ScanRowActions
              acknowledged={acknowledged}
              fingerprint={item.fingerprint}
              taskTitle={`Fix ${KIND_LABEL[item.kind].toLowerCase()}: ${item.name}`}
              onAck={onAck}
              onUnack={onUnack}
              onCreateTask={onCreateTask}
            />
          }
        />
      )}
    />
  );
}
