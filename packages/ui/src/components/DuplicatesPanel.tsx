import { ScanPanel } from './ScanPanel';
import { AccordionRow } from './primitives';
import { FileLink, ScanRowActions } from './ScanRowParts';
import type { DuplicateGroup, ScanPaneApi, OpenFileFn } from '../types';

interface Props {
  repoPath: string | null;
  api: ScanPaneApi<DuplicateGroup>;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onCreateTask?: (title: string) => void;
  onOpenFile?: OpenFileFn;
  results?: DuplicateGroup[];
  onResultsChange?: (next: DuplicateGroup[]) => void;
  resizable?: boolean;
  /** Suppress the pane-header title when the host chrome already shows it. */
  hideHeaderTitle?: boolean;
  /** Suppress the pane-header refresh button when the host provides its own. */
  hideHeaderRefresh?: boolean;
  /** Bump to trigger a scan from the host (e.g. a view/title command). */
  scanSignal?: number;
}

const CLONE_LABEL: Record<DuplicateGroup['cloneType'], string> = {
  exact: 'Exact',
  renamed: 'Renamed',
  structural: 'Structural',
};

function GroupRow({
  group,
  acknowledged,
  repoPath,
  onAck,
  onUnack,
  onCreateTask,
  onOpenFile,
}: {
  group: DuplicateGroup;
  acknowledged: boolean;
  repoPath: string | null;
  onAck: (fp: string) => void;
  onUnack: (fp: string) => void;
  onCreateTask?: (title: string) => void;
  onOpenFile?: OpenFileFn;
}) {
  return (
    <AccordionRow
      summary={
        <>
          <span className={`dup-clone-badge dup-clone-${group.cloneType}`}>
            {CLONE_LABEL[group.cloneType]}
          </span>
          <span className="dup-group-title">
            {group.members[0]?.name ?? '—'}
            {group.count > 1 && <span className="dup-count"> ×{group.count}</span>}
          </span>
          <span className="dup-sim">{Math.round(group.similarity * 100)}%</span>
        </>
      }
    >
      <div className="dup-members">
        {group.members.map((m, i) => (
          <div key={i} className="dup-member">
            <span className="dup-member-kind">{m.kind}</span>
            <span className="dup-member-name" title={m.file + ':' + m.startLine}>
              {m.name}
            </span>
            <FileLink
              file={m.file}
              line={m.startLine}
              repoPath={repoPath}
              onOpenFile={onOpenFile}
              baseClass="dup-member-file"
            />
            <span className="dup-member-lines">{m.lines}L</span>
          </div>
        ))}
      </div>
      <div className="dup-group-actions">
        <ScanRowActions
          acknowledged={acknowledged}
          fingerprint={group.fingerprint}
          taskTitle={`Refactor ${CLONE_LABEL[group.cloneType]} duplicate: ${
            group.members[0]?.name ?? 'unknown'
          }`}
          onAck={onAck}
          onUnack={onUnack}
          onCreateTask={onCreateTask}
        />
      </div>
    </AccordionRow>
  );
}

export function DuplicatesPanel({
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
    <ScanPanel<DuplicateGroup>
      title="Duplicates"
      hideHeaderTitle={hideHeaderTitle}
      hideHeaderRefresh={hideHeaderRefresh}
      scanSignal={scanSignal}
      repoPath={repoPath}
      feature="duplicates"
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      scanLabel="Scan for duplicate code"
      scanHint="Click ↻ to scan for duplicate code."
      excludePlaceholder="Directory name (e.g. release)"
      api={api}
      results={results}
      onResultsChange={onResultsChange}
      resizable={resizable}
      renderRow={({ item, acknowledged, onAck, onUnack }) => (
        <GroupRow
          group={item}
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
