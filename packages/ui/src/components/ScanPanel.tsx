import React, { useState, useCallback, useRef, useEffect } from 'react';
import { PaneHeader, Tab } from './primitives';
import type { ScanItem, ScanFeature, ScanPaneApi } from '../types';

type ScanTab = 'active' | 'acknowledged' | 'excluded';

interface ScanPanelProps<T extends ScanItem> {
  title: string;
  /** Suppress the pane-header title when the host chrome already shows it. */
  hideHeaderTitle?: boolean;
  /** Suppress the pane-header refresh button when the host chrome provides
   *  its own scan action (e.g. a VS Code view/title command). */
  hideHeaderRefresh?: boolean;
  /** Bump this to trigger a scan from the host (e.g. a view/title command).
   *  The initial value is ignored — only changes after mount run a scan. */
  scanSignal?: number;
  repoPath: string | null;
  /** Which scan this pane runs. */
  feature: ScanFeature;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Tooltip for the scan button. */
  scanLabel: string;
  /** Hint shown before the first scan has run. */
  scanHint: string;
  /** Placeholder text for the exclude-directory input. */
  excludePlaceholder: string;
  api: ScanPaneApi<T>;
  /** Renders one result row. */
  renderRow: (args: {
    item: T;
    acknowledged: boolean;
    onAck: (fingerprint: string) => void;
    onUnack: (fingerprint: string) => void;
  }) => React.ReactNode;
  /** Controlled results — when provided, the host owns scan-result storage
   *  (e.g. the app keeps them per-worktree). Omit for internal state. */
  results?: T[];
  onResultsChange?: (next: T[]) => void;
  /** Render a drag-to-resize handle + fixed-height body (Electron app). The
   *  VS Code WebviewView is sized by the editor, so it leaves this off. */
  resizable?: boolean;
}

const DEFAULT_HEIGHT = 180;
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 560;

/**
 * Generic scan-result pane: a collapsible pane with Active / Acknowledged /
 * Excluded tabs and a scan / acknowledge / exclude workflow. Shared by
 * DeadCodePanel and DuplicatesPanel — they differ only in the IO calls
 * (`api`) and how a single result row is rendered (`renderRow`).
 */
export function ScanPanel<T extends ScanItem>({
  title,
  hideHeaderTitle,
  hideHeaderRefresh,
  scanSignal,
  repoPath,
  feature,
  collapsed,
  onToggleCollapsed,
  scanLabel,
  scanHint,
  excludePlaceholder,
  api,
  renderRow,
  results,
  onResultsChange,
  resizable = false,
}: ScanPanelProps<T>) {
  void feature;
  const [tab, setTab] = useState<ScanTab>('active');

  const [internalItems, setInternalItems] = useState<T[]>([]);
  const controlled = results !== undefined;
  const items = controlled ? results : internalItems;
  const setItems = useCallback(
    (next: T[]) => {
      if (controlled) onResultsChange?.(next);
      else setInternalItems(next);
    },
    [controlled, onResultsChange],
  );

  const [ackedFingerprints, setAckedFingerprints] = useState<string[]>([]);
  const [excludeDirs, setExcludeDirs] = useState<string[]>([]);
  const [newDir, setNewDir] = useState('');
  const [scanning, setScanning] = useState(false);
  // True once a scan has completed for the current project. Lets the panel
  // distinguish "never scanned" (show the hint) from "scanned, found nothing"
  // (show a clean confirmation) — without it an empty scan looks like a no-op.
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bodyHeight, setBodyHeight] = useState(DEFAULT_HEIGHT);
  const resizerStartY = useRef<number | null>(null);
  const resizerStartH = useRef<number>(DEFAULT_HEIGHT);

  // Load the persisted ack + exclude lists when the project changes.
  useEffect(() => {
    setError(null);
    setScanned(false);
    if (!repoPath) {
      setAckedFingerprints([]);
      setExcludeDirs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [acked, excluded] = await Promise.all([
          api.listAck(repoPath),
          api.listExclude(repoPath),
        ]);
        if (!cancelled) {
          setAckedFingerprints(acked);
          setExcludeDirs(excluded);
        }
      } catch {
        // non-fatal — lists stay empty until a successful scan
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPath, api]);

  const handleScan = useCallback(async () => {
    if (!repoPath) return;
    setScanning(true);
    setError(null);
    try {
      const [{ items: scanned, ackedFingerprints: acked }, excluded] = await Promise.all([
        api.scan(repoPath),
        api.listExclude(repoPath),
      ]);
      setItems(scanned);
      setAckedFingerprints(acked);
      setExcludeDirs(excluded);
      setScanned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [repoPath, api, setItems]);

  // Host-driven scans (e.g. a VS Code view/title command). A ref keeps the
  // effect keyed on scanSignal only, so a repoPath change won't trigger one.
  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;
  const scanSignalSeen = useRef(false);
  useEffect(() => {
    if (!scanSignalSeen.current) {
      scanSignalSeen.current = true;
      return;
    }
    void handleScanRef.current();
  }, [scanSignal]);

  const handleAddExclude = useCallback(async () => {
    const name = newDir.trim();
    if (!repoPath || !name) return;
    try {
      const updated = await api.excludeDir(repoPath, name, false);
      setExcludeDirs(updated);
      setNewDir('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [repoPath, newDir, api]);

  const handleRemoveExclude = useCallback(
    async (dir: string) => {
      if (!repoPath) return;
      try {
        const updated = await api.excludeDir(repoPath, dir, true);
        setExcludeDirs(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [repoPath, api],
  );

  const handleAck = useCallback(
    async (fingerprint: string) => {
      if (!repoPath) return;
      try {
        setAckedFingerprints(await api.ack(repoPath, fingerprint, false));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [repoPath, api],
  );

  const handleUnack = useCallback(
    async (fingerprint: string) => {
      if (!repoPath) return;
      try {
        setAckedFingerprints(await api.ack(repoPath, fingerprint, true));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [repoPath, api],
  );

  const handleResizerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizerStartY.current = e.clientY;
      resizerStartH.current = bodyHeight;
      document.body.style.cursor = 'row-resize';
      const onMove = (ev: MouseEvent) => {
        if (resizerStartY.current === null) return;
        const delta = resizerStartY.current - ev.clientY;
        setBodyHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, resizerStartH.current + delta)));
      };
      const onUp = () => {
        resizerStartY.current = null;
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [bodyHeight],
  );

  const ackedSet = new Set(ackedFingerprints);
  const activeItems = items.filter((i) => !ackedSet.has(i.fingerprint));
  const ackedItems = items.filter((i) => ackedSet.has(i.fingerprint));
  const displayItems = tab === 'acknowledged' ? ackedItems : activeItems;
  const hasResults = items.length > 0;

  return (
    <div className="cw-pane">
      {resizable && !collapsed && (
        <div
          className="cw-pane-resizer"
          title="Drag to resize"
          onMouseDown={handleResizerMouseDown}
        />
      )}
      {/* The VS Code panels hide this header — the editor's own view chrome
          already shows the title + a scan action — so rendering it there
          would leave an empty bar. Scan status moves into the tabs row. */}
      {!hideHeaderTitle && (
        <PaneHeader
          title={title}
          hideTitle={hideHeaderTitle}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onRefresh={hideHeaderRefresh ? undefined : () => void handleScan()}
          refreshing={scanning}
          refreshDisabled={!repoPath}
          refreshTitle={scanLabel}
        >
          <span className="cw-pane-header-meta">
            {scanning
              ? 'scanning…'
              : (hasResults || scanned) && !collapsed
                ? activeItems.length > 0
                  ? `${activeItems.length} found`
                  : 'clean'
                : ''}
          </span>
        </PaneHeader>
      )}

      {!collapsed && (
        <div className="cw-scan-body" style={resizable ? { height: bodyHeight } : { flex: 1 }}>
          {scanning && <div className="cw-scan-progress" />}
          {error && <div className="cw-error">{error}</div>}

          {!repoPath && <div className="cw-empty">No project open.</div>}

          {repoPath && (
            <div className="cw-tabs">
              <Tab active={tab === 'active'} onActivate={() => setTab('active')}>
                Active
                {activeItems.length > 0 && (
                  <span className="cw-tab-count">{activeItems.length}</span>
                )}
              </Tab>
              <Tab active={tab === 'acknowledged'} onActivate={() => setTab('acknowledged')}>
                Acknowledged
                {ackedItems.length > 0 && <span className="cw-tab-count">{ackedItems.length}</span>}
              </Tab>
              <Tab active={tab === 'excluded'} onActivate={() => setTab('excluded')}>
                Excluded
                {excludeDirs.length > 0 && (
                  <span className="cw-tab-count">{excludeDirs.length}</span>
                )}
              </Tab>
              {/* With the pane header hidden, the tabs row carries scan
                  status — a count, "clean", or a live "scanning…". */}
              {hideHeaderTitle && (
                <>
                  <span className="cw-tabs-spacer" />
                  {(scanning || hasResults || scanned) && (
                    <span className="cw-tabs-meta">
                      {scanning
                        ? 'scanning…'
                        : activeItems.length > 0
                          ? `${activeItems.length} found`
                          : 'clean'}
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {repoPath && tab === 'excluded' && (
            <div>
              <div className="cw-scan-exclude-input-row">
                <input
                  className="cw-scan-exclude-input"
                  type="text"
                  placeholder={excludePlaceholder}
                  value={newDir}
                  onChange={(e) => setNewDir(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAddExclude();
                  }}
                />
                <button
                  className="cw-action-btn cw-action-clay"
                  disabled={!newDir.trim()}
                  onClick={() => void handleAddExclude()}
                >
                  exclude
                </button>
              </div>
              <div className="cw-scan-exclude-hint">
                Directories matching these names are skipped on the next scan.
              </div>
              {excludeDirs.length === 0 ? (
                <div className="cw-empty">No excluded directories.</div>
              ) : (
                excludeDirs.map((d) => (
                  <div key={d} className="cw-scan-exclude-row">
                    <span className="cw-scan-exclude-name">{d}</span>
                    <button className="cw-action-btn" onClick={() => void handleRemoveExclude(d)}>
                      remove
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {repoPath && tab !== 'excluded' && (
            <>
              {scanning && !hasResults && <div className="cw-empty">Scanning…</div>}

              {!hasResults && !scanning && (
                <div className="cw-empty">{scanned ? 'No results found — all clean.' : scanHint}</div>
              )}

              {displayItems.length === 0 && hasResults && (
                <div className="cw-empty">
                  {tab === 'active' ? 'All results acknowledged.' : 'Nothing acknowledged yet.'}
                </div>
              )}

              {displayItems.map((item) => (
                <React.Fragment key={item.fingerprint}>
                  {renderRow({
                    item,
                    acknowledged: tab === 'acknowledged',
                    onAck: handleAck,
                    onUnack: handleUnack,
                  })}
                </React.Fragment>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
