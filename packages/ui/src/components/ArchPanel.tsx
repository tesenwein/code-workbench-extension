import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ArchCard, ArchApi, OpenFileFn } from '../types';
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
// Card editor
// ---------------------------------------------------------------------------

interface EditorProps {
  card: Partial<ArchCard> & { name: string };
  onSave: (card: Partial<ArchCard> & { name: string }) => Promise<unknown>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function tagsValue(arr: string[] | undefined): string {
  return (arr ?? []).join(', ');
}

function parseTags(val: string): string[] {
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function CardEditor({ card, onSave, onDelete, onClose }: EditorProps) {
  const [name, setName] = useState(card.name ?? '');
  const [description, setDescription] = useState(card.description ?? '');
  const [files, setFiles] = useState(tagsValue(card.files));
  const [guidelines, setGuidelines] = useState(tagsValue(card.guidelines));
  const [antiPatterns, setAntiPatterns] = useState(tagsValue(card.anti_patterns));
  const [decisions, setDecisions] = useState(tagsValue(card.decisions));
  const [dependsOn, setDependsOn] = useState(tagsValue(card.dependsOn));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await onSave({
        ...card,
        name,
        description,
        files: parseTags(files),
        guidelines: parseTags(guidelines),
        anti_patterns: parseTags(antiPatterns),
        decisions: parseTags(decisions),
        dependsOn: parseTags(dependsOn),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }, [
    card,
    name,
    description,
    files,
    guidelines,
    antiPatterns,
    decisions,
    dependsOn,
    onSave,
    onClose,
  ]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        overflow: 'auto',
        flex: 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
          {card.slug ? `Edit: ${card.slug}` : 'New Component'}
        </span>
        <button onClick={onClose} style={btnStyle('secondary')}>
          Cancel
        </button>
        {onDelete && !confirmDelete && (
          <button onClick={() => setConfirmDelete(true)} style={btnStyle('danger')}>
            Delete
          </button>
        )}
        {onDelete && confirmDelete && (
          <>
            <span style={{ fontSize: 11, color: 'var(--vscode-errorForeground)' }}>Confirm?</span>
            <button
              onClick={async () => {
                await onDelete();
                onClose();
              }}
              style={btnStyle('danger')}
            >
              Yes, Delete
            </button>
            <button onClick={() => setConfirmDelete(false)} style={btnStyle('secondary')}>
              No
            </button>
          </>
        )}
        <button onClick={save} disabled={saving || !name.trim()} style={btnStyle('primary')}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>
      <Field label="Key Files (comma-separated)">
        <input
          value={files}
          onChange={(e) => setFiles(e.target.value)}
          style={inputStyle}
          placeholder="src/foo.ts, src/bar.ts"
        />
      </Field>
      <Field label="Guidelines (comma-separated)">
        <input
          value={guidelines}
          onChange={(e) => setGuidelines(e.target.value)}
          style={inputStyle}
        />
      </Field>
      <Field label="Anti-patterns (comma-separated)">
        <input
          value={antiPatterns}
          onChange={(e) => setAntiPatterns(e.target.value)}
          style={inputStyle}
        />
      </Field>
      <Field label="Decisions (comma-separated)">
        <input
          value={decisions}
          onChange={(e) => setDecisions(e.target.value)}
          style={inputStyle}
        />
      </Field>
      <Field label="Depends On (slugs, comma-separated)">
        <input
          value={dependsOn}
          onChange={(e) => setDependsOn(e.target.value)}
          style={inputStyle}
          placeholder="mcp-core, task-system"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>{label}</span>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-input-border, #555)',
  borderRadius: 3,
  padding: '4px 6px',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
};

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
  /** Open a file in the host editor — wires the card's Key Files to the editor. */
  onOpenFile?: OpenFileFn;
  /** Programmatically focus a card by slug (e.g. a deep link from elsewhere). */
  focusSlug?: string | null;
  onFocusSlugHandled?: () => void;
}

export function ArchPanel({
  repoPath,
  api,
  reloadKey,
  hideHeaderTitle,
  onOpenFile,
  focusSlug,
  onFocusSlugHandled,
}: Props) {
  const { cards, loading, upsert, remove } = useArchCards(api, repoPath, reloadKey);
  const [query, setQuery] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  useEffect(() => {
    if (focusSlug && cards.length > 0) {
      setSelectedSlug(focusSlug);
      onFocusSlugHandled?.();
    }
  }, [focusSlug, cards.length, onFocusSlugHandled]);

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
  const [editing, setEditing] = useState<(Partial<ArchCard> & { name: string }) | null>(null);

  const selectedCard = selectedSlug ? cards.find((c) => c.slug === selectedSlug) : null;

  const DETAIL_MIN = 180;
  const DETAIL_MAX = 600;
  const [detailWidth, setDetailWidth] = useState(260);
  const resizeStartX = useRef<number | null>(null);
  const resizeStartW = useRef(260);
  const handleResizerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeStartX.current = e.clientX;
      resizeStartW.current = detailWidth;
      document.body.style.cursor = 'col-resize';
      const onMove = (ev: MouseEvent) => {
        if (resizeStartX.current === null) return;
        const delta = resizeStartX.current - ev.clientX;
        setDetailWidth(Math.max(DETAIL_MIN, Math.min(DETAIL_MAX, resizeStartW.current + delta)));
      };
      const onUp = () => {
        resizeStartX.current = null;
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [detailWidth],
  );

  const openEdit = useCallback((card?: ArchCard) => {
    setEditing(card ? { ...card } : { name: '' });
  }, []);

  const closeEdit = useCallback(() => setEditing(null), []);

  if (editing) {
    return (
      <CardEditor
        card={editing}
        onSave={upsert}
        onDelete={
          editing.slug
            ? ((_slug) => async () => {
                await remove(_slug);
              })(editing.slug)
            : undefined
        }
        onClose={closeEdit}
      />
    );
  }

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
        <button onClick={() => openEdit()} style={{ ...btnStyle('primary'), padding: '2px 8px' }}>
          +
        </button>
      </div>

      {/* Content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: component list */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loading && (
            <div style={{ padding: 8, fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>
              Loading…
            </div>
          )}
          {!loading && filteredCards.length === 0 && query.trim() ? (
            <div
              style={{ padding: 16, color: 'var(--vscode-descriptionForeground)', fontSize: 12 }}
            >
              No components match “{query.trim()}”.
            </div>
          ) : (
            <ListView cards={filteredCards} selectedSlug={selectedSlug} onSelect={setSelectedSlug} />
          )}
        </div>

        {/* Resizer */}
        {selectedCard && (
          <div
            onMouseDown={handleResizerMouseDown}
            title="Drag to resize"
            style={{
              flex: '0 0 6px',
              cursor: 'col-resize',
              background: 'var(--vscode-widget-border, #333)',
            }}
          />
        )}

        {/* Right: card detail + edit button */}
        {selectedCard && (
          <div
            style={{
              flex: `0 0 ${detailWidth}px`,
              overflow: 'auto',
              padding: 10,
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, flex: 1 }}>{decodeEntities(selectedCard.name)}</span>
              <button onClick={() => openEdit(selectedCard)} style={btnStyle('secondary')}>
                Edit
              </button>
            </div>
            <p style={{ color: 'var(--vscode-descriptionForeground)', margin: '0 0 8px' }}>
              {decodeEntities(selectedCard.description)}
            </p>
            {selectedCard.files.length > 0 && (
              <Section
                title="Files"
                items={selectedCard.files}
                onOpenFile={onOpenFile}
                repoPath={repoPath}
              />
            )}
            {selectedCard.guidelines.length > 0 && (
              <Section title="Guidelines" items={selectedCard.guidelines} />
            )}
            {selectedCard.anti_patterns.length > 0 && (
              <Section title="Anti-patterns" items={selectedCard.anti_patterns} />
            )}
            {selectedCard.decisions.length > 0 && (
              <Section title="Decisions" items={selectedCard.decisions} />
            )}
            {selectedCard.dependsOn.length > 0 && (
              <Section title="Depends On" items={selectedCard.dependsOn} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  onOpenFile,
  repoPath,
}: {
  title: string;
  items: string[];
  /** When provided alongside repoPath, list items open in the host editor. */
  onOpenFile?: OpenFileFn;
  repoPath?: string | null;
}) {
  const clickable = title === 'Files' && !!onOpenFile && !!repoPath;
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{ fontWeight: 600, color: 'var(--vscode-descriptionForeground)', marginBottom: 3 }}
      >
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {items.map((item, i) => (
          <li key={i} style={{ marginBottom: 2 }}>
            {clickable ? (
              <span
                onClick={() => onOpenFile!(`${repoPath}/${item}`, item.split('/').pop() ?? item)}
                title={`Open ${item}`}
                style={{
                  cursor: 'pointer',
                  color: 'var(--vscode-textLink-foreground)',
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
              >
                {item}
              </span>
            ) : (
              decodeEntities(item)
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
