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

  // A repo switch must not leave the previous project's cards visible while
  // the new list loads (a reloadKey bump keeps them to avoid flicker).
  useEffect(() => {
    setCards([]);
  }, [repoPath]);

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
  /** Keep the given order (semantic ranking) instead of sorting by slug. */
  preserveOrder?: boolean;
}

function ListView({ cards, selectedSlug, onSelect, preserveOrder }: ListViewProps) {
  const sorted = preserveOrder ? cards : [...cards].sort((a, b) => a.slug.localeCompare(b.slug));
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
  semantic,
}: {
  value: string;
  onChange: (v: string) => void;
  resultCount: number;
  hasQuery: boolean;
  /** Show a badge when results are ranked by embedding similarity. */
  semantic?: boolean;
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
          {semantic && (
            <span
              title="Ranked by semantic (embedding) similarity"
              style={{
                fontSize: 9,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                padding: '1px 5px',
                borderRadius: 3,
                background: 'var(--vscode-badge-background)',
                color: 'var(--vscode-badge-foreground)',
                flexShrink: 0,
              }}
            >
              semantic
            </span>
          )}
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
  // Semantic ranking (host embeddings) — best-first slug order for the current
  // query, or null while the substring filter is the source of truth (no
  // api.search, empty query, a ranking still in flight, or search returned []
  // because the model is unavailable / no card cleared the relevance floor).
  const [semanticOrder, setSemanticOrder] = useState<string[] | null>(null);

  // A repo switch invalidates the selection — it points at a card of the
  // previous project and could open the wrong file via focus-card.
  useEffect(() => {
    setSelectedSlug(null);
  }, [repoPath]);

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

  // Debounced semantic search: ask the host to embed-rank cards for the query.
  // Runs only when the host wired api.search; an empty result (model absent or
  // nothing relevant) clears semanticOrder so the substring filter below takes
  // over.
  const search = api.search;
  useEffect(() => {
    const q = query.trim();
    // Drop the previous query's ranking immediately — substring order is the
    // honest interim state while the new ranking is in flight.
    setSemanticOrder(null);
    if (!search || !q) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const hits = await search(q);
        if (cancelled) return;
        setSemanticOrder(hits.length ? hits.map((h) => h.slug) : null);
      } catch {
        if (!cancelled) setSemanticOrder(null);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, query, reloadKey]);

  const substringMatches = useMemo(() => {
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

  // When semantic ranking is live, order cards by it (the host already drops
  // cards below its relevance floor, so an off-topic query can rank nothing
  // and the empty state stays reachable) — but always fold in substring
  // matches so a literal term never disappears. Otherwise fall back to
  // substring filtering.
  const semanticActive = semanticOrder !== null && query.trim().length > 0;
  const filteredCards = useMemo(() => {
    if (!semanticActive || !semanticOrder) return substringMatches;
    const bySlug = new Map(cards.map((c) => [c.slug, c]));
    const seen = new Set<string>();
    const ranked: ArchCard[] = [];
    for (const slug of semanticOrder) {
      const card = bySlug.get(slug);
      if (card && !seen.has(slug)) {
        seen.add(slug);
        ranked.push(card);
      }
    }
    for (const c of substringMatches) {
      if (!seen.has(c.slug)) {
        seen.add(c.slug);
        ranked.push(c);
      }
    }
    return ranked;
  }, [semanticActive, semanticOrder, substringMatches, cards]);

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
          semantic={semanticActive}
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
          <ListView
            cards={filteredCards}
            selectedSlug={selectedSlug}
            onSelect={selectCard}
            preserveOrder={semanticActive}
          />
        )}
      </div>
    </div>
  );
}
