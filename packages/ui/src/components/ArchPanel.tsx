import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ArchCard, ArchApi } from '../types';
import { decodeEntities } from '../htmlEntities';

// ---------------------------------------------------------------------------
// Data hook — drives the panel off the host-supplied ArchApi. Mirrors the
// Electron app's useArchWiki, but transport-agnostic: the host wires `api` to
// its own IPC / postMessage bridge and pushes a `reloadKey` bump whenever the
// underlying `.code-workbench/.arch` files change.
// ---------------------------------------------------------------------------

function useArchCards(api: ArchApi, repoPath: string | null, reloadKey: number | undefined) {
  const [cards, setCards] = useState<ArchCard[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const id = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await api.list();
      if (id === requestIdRef.current) setCards(result);
    } catch {
      if (id === requestIdRef.current) setCards([]);
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload, repoPath, reloadKey]);

  const upsert = useCallback(
    async (card: Partial<ArchCard> & { name: string }): Promise<ArchCard> => {
      const saved = await api.upsert(card);
      await reload();
      return saved;
    },
    [api, reload],
  );

  const remove = useCallback(
    async (slug: string): Promise<void> => {
      await api.remove(slug);
      await reload();
    },
    [api, reload],
  );

  return { cards, loading, upsert, remove };
}

// ---------------------------------------------------------------------------
// Cards are edited by opening their `<slug>.json` file in the host's normal
// editor (see ArchApi.openCard); the panel only lists and previews them, so
// there is no in-webview card-editor form.
// ---------------------------------------------------------------------------

function btnStyle(variant: 'primary' | 'secondary' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = {
    border: 'none',
    borderRadius: 3,
    padding: '3px 10px',
    fontSize: 12,
    cursor: 'pointer',
  };
  if (variant === 'primary')
    return {
      ...base,
      background: 'var(--vscode-button-background)',
      color: 'var(--vscode-button-foreground)',
    };
  if (variant === 'danger')
    return { ...base, background: 'var(--vscode-errorForeground, #f44)', color: '#fff' };
  return {
    ...base,
    background: 'var(--vscode-button-secondaryBackground)',
    color: 'var(--vscode-button-secondaryForeground)',
  };
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

interface ListViewProps {
  cards: ArchCard[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}

function ListView({ cards, selectedSlug, onSelect }: ListViewProps) {
  const sorted = [...cards].sort((a, b) => a.slug.localeCompare(b.slug));
  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {sorted.map((c) => (
        <div
          key={c.slug}
          onClick={() => onSelect(c.slug)}
          style={{
            padding: '6px 10px',
            cursor: 'pointer',
            background:
              c.slug === selectedSlug
                ? 'var(--vscode-list-activeSelectionBackground)'
                : 'transparent',
            color:
              c.slug === selectedSlug ? 'var(--vscode-list-activeSelectionForeground)' : 'inherit',
            borderBottom: '1px solid var(--vscode-widget-border, transparent)',
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600 }}>{decodeEntities(c.name)}</div>
          <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 11 }}>
            {decodeEntities((c.description || '').split('\n')[0]).slice(0, 80)}
          </div>
        </div>
      ))}
      {cards.length === 0 && (
        <div style={{ padding: 16, color: 'var(--vscode-descriptionForeground)', fontSize: 12 }}>
          No components yet. Click + to add one.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search box
// ---------------------------------------------------------------------------

function SearchBox({
  value,
  onChange,
  resultCount,
  hasQuery,
}: {
  value: string;
  onChange: (v: string) => void;
  resultCount: number;
  hasQuery: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: 120,
        background: 'var(--vscode-input-background)',
        border: `1px solid ${
          focused ? 'var(--vscode-focusBorder)' : 'var(--vscode-input-border, #555)'
        }`,
        borderRadius: 4,
        padding: '0 6px',
        height: 24,
        boxSizing: 'border-box',
        transition: 'border-color 120ms ease',
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        style={{ flexShrink: 0, opacity: 0.6 }}
      >
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
        <line
          x1="10.6"
          y1="10.6"
          x2="14"
          y2="14"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search components…"
        spellCheck={false}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--vscode-input-foreground)',
          fontSize: 12,
        }}
      />
      {hasQuery && (
        <>
          <span
            style={{
              fontSize: 10,
              color: 'var(--vscode-descriptionForeground)',
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
            }}
          >
            {resultCount}
          </span>
          <button
            onClick={() => onChange('')}
            title="Clear search"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              padding: 0,
              border: 'none',
              borderRadius: 3,
              background: 'transparent',
              color: 'var(--vscode-descriptionForeground)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
              <line
                x1="3"
                y1="3"
                x2="13"
                y2="13"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <line
                x1="13"
                y1="3"
                x2="3"
                y2="13"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main pane
// ---------------------------------------------------------------------------

interface Props {
  repoPath: string | null;
  api: ArchApi;
  /** Host bumps this whenever the underlying arch files change on disk. */
  reloadKey?: number;
  /** Suppress the pane-header title when the host chrome already shows it. */
  hideHeaderTitle?: boolean;
  /** Programmatically focus a card by slug (e.g. a deep link from elsewhere). */
  focusSlug?: string | null;
  onFocusSlugHandled?: () => void;
}

export function ArchPanel({
  repoPath,
  api,
  reloadKey,
  hideHeaderTitle,
  focusSlug,
  onFocusSlugHandled,
}: Props) {
  const { cards, loading, upsert } = useArchCards(api, repoPath, reloadKey);
  const [query, setQuery] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  // Selecting a card opens its `<slug>.json` file in the host's normal editor
  // (highlighting it in the list for feedback) — there is no in-webview form.
  const selectCard = useCallback(
    (slug: string) => {
      setSelectedSlug(slug);
      void api.openCard(slug);
    },
    [api],
  );

  useEffect(() => {
    if (focusSlug && cards.length > 0) {
      selectCard(focusSlug);
      onFocusSlugHandled?.();
    }
  }, [focusSlug, cards.length, onFocusSlugHandled, selectCard]);

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      [
        c.name,
        c.slug,
        c.description,
        ...c.files,
        ...c.guidelines,
        ...c.anti_patterns,
        ...c.decisions,
        ...c.dependsOn,
        ...(c.tags ?? []),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [cards, query]);

  // Create a new component card (with defaults), then open its file to edit.
  const addCard = useCallback(async () => {
    const saved = await upsert({ name: 'New Component' });
    setSelectedSlug(saved.slug);
    await api.openCard(saved.slug);
  }, [upsert, api]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 10px',
          borderBottom: '1px solid var(--vscode-widget-border, #333)',
          gap: 6,
        }}
      >
        {!hideHeaderTitle && (
          <span style={{ fontWeight: 600, fontSize: 13, flexShrink: 0 }}>Architecture</span>
        )}
        <SearchBox
          value={query}
          onChange={setQuery}
          resultCount={filteredCards.length}
          hasQuery={query.trim().length > 0}
        />
        <button
          onClick={() => void addCard()}
          title="Add component"
          style={{ ...btnStyle('primary'), padding: '2px 8px' }}
        >
          +
        </button>
      </div>

      {/* Content — component list; clicking a row opens the card file */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <div style={{ padding: 8, fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>
            Loading…
          </div>
        )}
        {!loading && filteredCards.length === 0 && query.trim() ? (
          <div style={{ padding: 16, color: 'var(--vscode-descriptionForeground)', fontSize: 12 }}>
            No components match “{query.trim()}”.
          </div>
        ) : (
          <ListView cards={filteredCards} selectedSlug={selectedSlug} onSelect={selectCard} />
        )}
      </div>
    </div>
  );
}
