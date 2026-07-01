// Shared building blocks for scan-result rows (Dead Code + Duplicates).
// The two panels render different bodies, but their file links and action
// buttons are identical — these components hold that common ground.

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
