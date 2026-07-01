import React, { useState } from 'react';

/* ── PaneHeader ──────────────────────────────────────────────────
 * Compact side-panel header — a title, an optional collapse arrow, an
 * optional refresh button, and a right-aligned slot for extra controls.
 * Shared by every Code Workbench panel so they look identical. */

interface PaneHeaderProps {
  title: string;
  /** Suppress the title text — used when the host chrome already shows it
   *  (e.g. a VS Code WebviewView whose view title repeats the pane name). */
  hideTitle?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** When provided, renders a refresh button at the right of the header. */
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshDisabled?: boolean;
  refreshTitle?: string;
  children?: React.ReactNode;
}

export function PaneHeader({
  title,
  hideTitle,
  collapsed,
  onToggleCollapsed,
  onRefresh,
  refreshing,
  refreshDisabled,
  refreshTitle,
  children,
}: PaneHeaderProps) {
  return (
    <div
      className={'cw-pane-header' + (onToggleCollapsed ? ' cw-clickable' : '')}
      onClick={onToggleCollapsed}
    >
      {!hideTitle && <span className="cw-pane-header-title">{title}</span>}
      {onToggleCollapsed && (
        <span className="cw-pane-header-arrow" title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '▴' : '▾'}
        </span>
      )}
      {(children || onRefresh) && <span className="cw-pane-header-spacer" />}
      {children}
      {onRefresh && (
        <button
          className="cw-icon-btn"
          title={refreshing ? 'Refreshing…' : (refreshTitle ?? 'Refresh')}
          disabled={refreshing || refreshDisabled}
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
        >
          <span className={refreshing ? 'cw-spinning' : undefined}>↻</span>
        </button>
      )}
    </div>
  );
}

/* ── Tab ─────────────────────────────────────────────────────────
 * A single tab — a label over a 2px bottom rule that turns clay when
 * active. Used by the scan panes' Active / Acknowledged / Excluded row. */

interface TabProps {
  active: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}

export function Tab({ active, onActivate, children }: TabProps) {
  return (
    <div className={'cw-tab' + (active ? ' cw-tab-active' : '')} onClick={onActivate}>
      {children}
    </div>
  );
}

/* ── AccordionRow ────────────────────────────────────────────────
 * An expandable row — a clickable summary line with a chevron and a
 * collapsible detail panel. Shared by Dead Code and Duplicates. */

interface AccordionRowProps {
  summary: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: () => void;
}

export function AccordionRow({
  summary,
  children,
  open,
  defaultOpen = false,
  onToggle,
}: AccordionRowProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = open !== undefined;
  const expanded = controlled ? open : internalOpen;

  const toggle = () => {
    if (!controlled) setInternalOpen((v) => !v);
    onToggle?.();
  };

  return (
    <div className={'cw-accordion-row' + (expanded ? ' cw-open' : '')}>
      <div className="cw-accordion-summary" onClick={toggle}>
        {summary}
        <span className="cw-accordion-chevron">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && <div className="cw-accordion-detail">{children}</div>}
    </div>
  );
}
