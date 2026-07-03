import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { CodeSearchResult, SearchApi } from '../types';

// ---------------------------------------------------------------------------
// Code-search results page. Rendered in a full editor-tab webview (not the
// sidebar): a query input on top, then every ranked symbol match as a card
// with its code snippet, so results are actually readable — the QuickPick
// this replaces could only show one detail line per result.
// ---------------------------------------------------------------------------

const mono =
  'var(--vscode-editor-font-family, "JetBrains Mono", Menlo, Consolas, monospace)';

/** Split the query into highlightable tokens (identifiers ≥ 3 chars). */
function queryTokens(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-zA-Z0-9_]+/).filter((t) => t.length >= 3))];
}

/** Render text with query tokens wrapped in a highlight span. */
function Highlighted({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  const re = new RegExp(`(${tokens.join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        // Tokens are pure [a-z0-9_] words, so a captured part IS a token.
        tokens.includes(part.toLowerCase()) ? (
          <span
            key={i}
            style={{
              background: 'var(--vscode-editor-findMatchHighlightBackground, rgba(217,119,87,.28))',
              borderRadius: 2,
            }}
          >
            {part}
          </span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

function kindBadge(kind: string): React.ReactNode {
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: mono,
        padding: '1px 6px',
        borderRadius: 8,
        background: 'var(--vscode-badge-background, #4d4d4d)',
        color: 'var(--vscode-badge-foreground, #fff)',
        flexShrink: 0,
      }}
    >
      {kind}
    </span>
  );
}

// ---------------------------------------------------------------------------
// One result card — clickable header (name · kind · file:line) + snippet
// with real line numbers.
// ---------------------------------------------------------------------------

function ResultCard({
  result,
  repoPath,
  tokens,
  onOpen,
}: {
  result: CodeSearchResult;
  repoPath: string | null;
  tokens: string[];
  onOpen: (r: CodeSearchResult) => void;
}) {
  const [hover, setHover] = useState(false);
  const rel =
    repoPath && result.file.startsWith(repoPath)
      ? result.file.slice(repoPath.length).replace(/^[/\\]/, '')
      : result.file;
  const lines = result.snippet.split('\n');
  const gutterWidth = String(result.startLine + lines.length - 1).length;
  const truncated = result.startLine + lines.length - 1 < result.endLine;

  return (
    <div
      onClick={() => onOpen(result)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${hover ? 'var(--vscode-focusBorder)' : 'var(--vscode-widget-border, #3a3a3a)'}`,
        borderRadius: 6,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 120ms ease',
        background: 'var(--vscode-editorWidget-background, transparent)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--vscode-widget-border, #3a3a3a)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          <Highlighted text={result.name} tokens={tokens} />
        </span>
        {kindBadge(result.kind)}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontFamily: mono,
            color: hover
              ? 'var(--vscode-textLink-foreground, #6ab0f3)'
              : 'var(--vscode-descriptionForeground)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {rel}:{result.startLine}
        </span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '8px 10px',
          fontFamily: mono,
          fontSize: 'var(--vscode-editor-font-size, 12px)',
          lineHeight: 1.5,
          overflowX: 'auto',
          background: 'var(--vscode-textCodeBlock-background, rgba(0,0,0,.18))',
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', whiteSpace: 'pre' }}>
            <span
              style={{
                width: `${gutterWidth}ch`,
                marginRight: 12,
                textAlign: 'right',
                flexShrink: 0,
                color: 'var(--vscode-editorLineNumber-foreground, #6a6a6a)',
                userSelect: 'none',
              }}
            >
              {result.startLine + i}
            </span>
            <span>
              <Highlighted text={line} tokens={tokens} />
            </span>
          </div>
        ))}
        {truncated && (
          <div style={{ color: 'var(--vscode-descriptionForeground)', userSelect: 'none' }}>
            <span style={{ width: `${gutterWidth}ch`, marginRight: 12, display: 'inline-block' }} />
            ⋯ {result.endLine - (result.startLine + lines.length - 1)} more line(s)
          </div>
        )}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface Props {
  repoPath: string | null;
  api: SearchApi;
  /** Query pushed by the host (the quick command's input box). Re-runs the
   *  search whenever `externalQueryKey` bumps, even for the same string. */
  externalQuery?: string;
  externalQueryKey?: number;
}

export function SearchPanel({ repoPath, api, externalQuery, externalQueryKey }: Props) {
  const [query, setQuery] = useState(externalQuery ?? '');
  const [results, setResults] = useState<CodeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      const id = ++requestIdRef.current;
      setLoading(true);
      try {
        const found = await api.search(trimmed);
        if (id !== requestIdRef.current) return;
        setResults(found);
        setSearchedQuery(trimmed);
      } catch {
        if (id !== requestIdRef.current) return;
        setResults([]);
        setSearchedQuery(trimmed);
      } finally {
        if (id === requestIdRef.current) setLoading(false);
      }
    },
    [api],
  );

  // Host-pushed query (initial open, or the quick command re-invoked while
  // the panel is already up).
  useEffect(() => {
    if (externalQuery === undefined) return;
    setQuery(externalQuery);
    void runSearch(externalQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalQuery, externalQueryKey]);

  const tokens = useMemo(() => queryTokens(searchedQuery ?? ''), [searchedQuery]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        fontFamily: 'var(--vscode-font-family, sans-serif)',
        color: 'var(--vscode-foreground)',
      }}
    >
      {/* Query bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--vscode-widget-border, #333)',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch(query);
          }}
          placeholder="Search code by fragment or description…"
          spellCheck={false}
          style={{
            flex: 1,
            background: 'var(--vscode-input-background)',
            border: '1px solid var(--vscode-input-border, #555)',
            borderRadius: 4,
            color: 'var(--vscode-input-foreground)',
            fontSize: 13,
            padding: '5px 10px',
            outline: 'none',
          }}
        />
        <button
          onClick={() => void runSearch(query)}
          disabled={loading || !query.trim()}
          style={{
            border: 'none',
            borderRadius: 4,
            padding: '5px 14px',
            fontSize: 12,
            cursor: loading || !query.trim() ? 'default' : 'pointer',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            opacity: loading || !query.trim() ? 0.6 : 1,
          }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
        {searchedQuery !== null && !loading && (
          <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
            {results.length} result(s)
          </span>
        )}
      </div>

      {/* Results */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {loading && (
          <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 12 }}>
            Searching…
          </div>
        )}
        {!loading && searchedQuery !== null && results.length === 0 && (
          <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 12 }}>
            No code matches for “{searchedQuery}”.
          </div>
        )}
        {!loading &&
          results.map((r) => (
            <ResultCard
              key={`${r.file}:${r.startLine}:${r.name}`}
              result={r}
              repoPath={repoPath}
              tokens={tokens}
              onOpen={(res) => void api.openFile(res.file, res.startLine)}
            />
          ))}
      </div>
    </div>
  );
}
