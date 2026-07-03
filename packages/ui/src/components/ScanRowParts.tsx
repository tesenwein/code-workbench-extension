// Shared building blocks for scan-result rows (Dead Code + Duplicates).
// The two panels render different bodies, but their file links and action
// buttons are identical — these components hold that common ground.

import { AccordionRow } from './primitives';
import type { OpenFileFn } from '../types';

interface FileLinkProps {
  file: string;
  line: number;
  repoPath: string | null;
  onOpenFile?: OpenFileFn;
  /** Base CSS class; `${baseClass}-link` is added when the link is clickable. */
  baseClass: string;
}

// A `dir/file:line` label that opens the file when a repo + handler are present.
export function FileLink({ file, line, repoPath, onOpenFile, baseClass }: FileLinkProps) {
  const clickable = !!onOpenFile && !!repoPath;
  return (
    <span
      className={`${baseClass}${clickable ? ` ${baseClass}-link` : ''}`}
      title={`${file}:${line}`}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              onOpenFile!(`${repoPath}/${file}`, file.split('/').pop() ?? file, line);
            }
          : undefined
      }
    >
      {file.split('/').slice(-2).join('/')}:{line}
    </span>
  );
}

interface ScanRowActionsProps {
  acknowledged: boolean;
  fingerprint: string;
  /** Title for the "+ task" button; omit to hide it. */
  taskTitle?: string;
  onAck: (fp: string) => void;
  onUnack: (fp: string) => void;
  onCreateTask?: (title: string) => void;
}

// Any item an accordion scan-row can render: a kinded, fingerprinted finding
// with a file location and an optional content snippet.
export interface ScanRowItem {
  kind: string;
  file: string;
  name: string;
  startLine: number;
  detail: string;
  fingerprint: string;
  content?: string;
}

interface ScanItemRowProps<T extends ScanRowItem> {
  item: T;
  acknowledged: boolean;
  repoPath: string | null;
  kindLabel: Record<string, string>;
  kindClass: Record<string, string>;
  onAck: (fp: string) => void;
  onUnack: (fp: string) => void;
  onCreateTask?: (title: string) => void;
  onOpenFile?: OpenFileFn;
}

// The accordion row shared by the Dead Code and Type Safety panes: a kind badge
// + clickable name summary, expanding to file link, detail, optional snippet and
// the action buttons. `kindLabel`/`kindClass` map each pane's kinds to display.
export function ScanItemRow<T extends ScanRowItem>({
  item,
  acknowledged,
  repoPath,
  kindLabel,
  kindClass,
  onAck,
  onUnack,
  onCreateTask,
  onOpenFile,
}: ScanItemRowProps<T>) {
  const clickable = !!onOpenFile && !!repoPath;
  return (
    <AccordionRow
      summary={
        <>
          <span className={`dc-kind-badge ${kindClass[item.kind]}`}>{kindLabel[item.kind]}</span>
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
        {item.content && <div className="dc-item-snippet">{item.content}</div>}
        <div className="dc-item-actions">
          <ScanRowActions
            acknowledged={acknowledged}
            fingerprint={item.fingerprint}
            taskTitle={`Fix ${kindLabel[item.kind].toLowerCase()}: ${item.name}`}
            onAck={onAck}
            onUnack={onUnack}
            onCreateTask={onCreateTask}
          />
        </div>
      </div>
    </AccordionRow>
  );
}

// The "+ task / acknowledge / unacknowledge" button group shared by both panes.
export function ScanRowActions({
  acknowledged,
  fingerprint,
  taskTitle,
  onAck,
  onUnack,
  onCreateTask,
}: ScanRowActionsProps) {
  return (
    <>
      {!acknowledged && onCreateTask && taskTitle && (
        <button
          className="cw-rowaction"
          onClick={(e) => {
            e.stopPropagation();
            onCreateTask(taskTitle);
          }}
        >
          + task
        </button>
      )}
      {!acknowledged ? (
        <button
          className="cw-rowaction cw-rowaction-clay"
          onClick={(e) => {
            e.stopPropagation();
            onAck(fingerprint);
          }}
        >
          acknowledge
        </button>
      ) : (
        <button
          className="cw-rowaction"
          onClick={(e) => {
            e.stopPropagation();
            onUnack(fingerprint);
          }}
        >
          unacknowledge
        </button>
      )}
    </>
  );
}
