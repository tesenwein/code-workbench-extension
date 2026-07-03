import { ScanPanel } from './ScanPanel';
import { AccordionRow } from './primitives';
import { ScanRowActions } from './ScanRowParts';
import { CodeLines } from './SnippetCard';
import type { DuplicateGroup, DuplicateMember, ScanPaneApi, OpenFileFn } from '../types';

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

/** One clone member's code, with real line numbers — a column in the
 *  side-by-side comparison. Rendered only when the host attached snippets. */
function MemberSnippet({
  member,
  repoPath,
  onOpenFile,
}: {
  member: DuplicateMember;
  repoPath: string | null;
  onOpenFile?: OpenFileFn;
}) {
  const clickable = !!onOpenFile && !!repoPath;
  const open = clickable
    ? () =>
        onOpenFile!(
          `${repoPath}/${member.file}`,
          member.file.split('/').pop() ?? member.file,
          member.startLine,
        )
    : undefined;
  return (
    <div
      className={'dup-snippet-col' + (clickable ? ' dup-snippet-col-link' : '')}
      onClick={open}
      title={clickable ? `Open ${member.file}:${member.startLine}` : undefined}
    >
      <div className="dup-snippet-head">
        <span className="dup-member-kind">{member.kind}</span>
        <span className="dup-snippet-name" title={member.name}>
          {member.name}
        </span>
        <span className="dup-member-file">
          {member.file.split('/').slice(-2).join('/')}:{member.startLine}
        </span>
      </div>
      <CodeLines
        code={member.snippet ?? ''}
        startLine={member.startLine}
        endLine={member.endLine}
      />
    </div>
  );
}

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
      {group.members.some((m) => m.snippet) ? (
        <div className="dup-snippets">
          {group.members.map((m, i) => (
            <MemberSnippet key={i} member={m} repoPath={repoPath} onOpenFile={onOpenFile} />
          ))}
        </div>
      ) : (
        <div className="dup-members">
          {group.members.map((m, i) => {
            const clickable = !!onOpenFile && !!repoPath;
            return (
              <div
                key={i}
                className={'dup-member' + (clickable ? ' dup-member-link' : '')}
                title={clickable ? `Open ${m.file}:${m.startLine}` : m.file + ':' + m.startLine}
                onClick={
                  clickable
                    ? () =>
                        onOpenFile!(`${repoPath}/${m.file}`, m.file.split('/').pop() ?? m.file, m.startLine)
                    : undefined
                }
              >
                <span className="dup-member-kind">{m.kind}</span>
                <span className="dup-member-name">{m.name}</span>
                <span className="dup-member-file">
                  {m.file.split('/').slice(-2).join('/')}:{m.startLine}
                </span>
                <span className="dup-member-lines">{m.lines}L</span>
              </div>
            );
          })}
        </div>
      )}
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
