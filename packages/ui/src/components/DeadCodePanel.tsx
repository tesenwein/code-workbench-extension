import { ScanPanel } from './ScanPanel';
import { AccordionRow } from './primitives';
import { FileLink, ScanRowActions } from './ScanRowParts';
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

function ItemRow({
  item,
  acknowledged,
  repoPath,
  onAck,
  onUnack,
  onCreateTask,
  onOpenFile,
}: {
  item: DeadCodeItem;
  acknowledged: boolean;
  repoPath: string | null;
  onAck: (fp: string) => void;
  onUnack: (fp: string) => void;
  onCreateTask?: (title: string) => void;
  onOpenFile?: OpenFileFn;
}) {
  const clickable = !!onOpenFile && !!repoPath;
  return (
    <AccordionRow
      summary={
        <>
          <span className={`dc-kind-badge ${KIND_CLASS[item.kind]}`}>{KIND_LABEL[item.kind]}</span>
          <span
            className={`dc-item-name${clickable ? ' dc-item-name-link' : ''}`}
            title={clickable ? `Open ${item.file}:${item.startLine}` : undefined}
            onClick={
              clickable
                ? (e) => {
                    e.stopPropagation();
                    onOpenFile!(
                      `${repoPath}/${item.file}`,
                      item.file.split('/').pop() ?? item.file,
                      item.startLine,
                    );
                  }
                : undefined
            }
          >
            {item.name}
          </span>
        </>
      }
    >
      <div className="dc-item-detail">
        <div className="dc-item-location">
          <FileLink
            file={item.file}
            line={item.startLine}
            repoPath={repoPath}
            onOpenFile={onOpenFile}
            baseClass="dc-item-file"
          />
        </div>
        <div className="dc-item-desc">{item.detail}</div>
        <div className="dc-item-actions">
          <ScanRowActions
            acknowledged={acknowledged}
            fingerprint={item.fingerprint}
            taskTitle={`Fix ${KIND_LABEL[item.kind].toLowerCase()}: ${item.name}`}
            onAck={onAck}
            onUnack={onUnack}
            onCreateTask={onCreateTask}
          />
        </div>
      </div>
    </AccordionRow>
  );
}

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
        <ItemRow
          item={item}
          acknowledged={acknowledged}
          repoPath={repoPath}
          onAck={onAck}
          onUnack={onUnack}
          onCreateTask={onCreateTask}
          onOpenFile={onOpenFile}
        />
      )}
    />
  );
}
