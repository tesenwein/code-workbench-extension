// Shared "snippet show" building blocks — a line-numbered code block and a
// fully-clickable card that wraps it. Used by the Dead Code and Duplicates
// result views so that, like the code-search results, clicking anywhere on a
// finding opens the file at its line (no hunting for a tiny link).

import type { ReactNode } from 'react';
import type { OpenFileFn } from '../types';

interface CodeLinesProps {
  code: string;
  startLine: number;
  /** Real end line of the symbol; when it exceeds the shown lines, a
   *  "N more line(s)" hint is appended. Omit to suppress the hint. */
  endLine?: number;
}

/** A line-numbered code snippet in the shared style. */
export function CodeLines({ code, startLine, endLine }: CodeLinesProps) {
  const lines = code.split('\n');
  const shownEnd = startLine + lines.length - 1;
  return (
    <pre className="cw-snip-code">
      {lines.map((line, i) => (
        <div key={i}>
          <span className="cw-snip-ln">{startLine + i}</span>
          {line}
        </div>
      ))}
      {endLine != null && shownEnd < endLine && (
        <div className="cw-snip-more">
          <span className="cw-snip-ln" />⋯ {endLine - shownEnd} more line(s)
        </div>
      )}
    </pre>
  );
}

interface SnippetCardProps {
  name: string;
  /** Leading badge (kind). Rendered before the name. */
  kind?: ReactNode;
  /** Repo-relative file path. */
  file: string;
  startLine: number;
  endLine?: number;
  repoPath: string | null;
  snippet?: string;
  onOpenFile?: OpenFileFn;
  /** Line shown under the header, before the snippet (e.g. a description). */
  detail?: ReactNode;
  /** Right-aligned header badge (e.g. similarity %). */
  meta?: ReactNode;
  /** Footer buttons; their clicks are isolated so they don't open the file. */
  actions?: ReactNode;
}

/** A clickable code card: a header (kind · name · file:line) over a
 *  line-numbered snippet. Clicking anywhere opens the file at its line. */
export function SnippetCard({
  name,
  kind,
  file,
  startLine,
  endLine,
  repoPath,
  snippet,
  onOpenFile,
  detail,
  meta,
  actions,
}: SnippetCardProps) {
  const clickable = !!onOpenFile && !!repoPath;
  const open = clickable
    ? () => onOpenFile!(`${repoPath}/${file}`, file.split('/').pop() ?? file, startLine)
    : undefined;
  return (
    <div
      className={'cw-snip' + (clickable ? ' cw-snip-click' : '')}
      onClick={open}
      title={clickable ? `Open ${file}:${startLine}` : undefined}
    >
      <div className="cw-snip-head">
        {kind}
        <span className="cw-snip-name" title={name}>
          {name}
        </span>
        {meta}
        <span className="cw-snip-path">
          {file.split('/').slice(-2).join('/')}:{startLine}
        </span>
      </div>
      {detail != null && <div className="cw-snip-detail">{detail}</div>}
      {snippet && <CodeLines code={snippet} startLine={startLine} endLine={endLine} />}
      {actions && (
        <div className="cw-snip-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}
