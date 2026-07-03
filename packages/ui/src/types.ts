/* Shared data shapes for the Code Workbench panel components.
 * Declared here so the @code-workbench/ui package is self-contained and
 * can be bundled by either host (Vite app build / esbuild webview build)
 * without reaching into another package's type-only exports. */

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'open' | 'in-progress' | 'done';

export interface WorkspaceTask {
  id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  /** Worktree path relative to repo root, or null for unassigned tasks. */
  worktree: string | null;
  description: string;
  /** Free-form notes updated by MCP agents (findings, blockers, …). */
  memo: string;
  created: string;
  updated: string;
  parentId?: string | null;
  parallel?: boolean;
  dueDate?: string | null;
  epic?: string | null;
  tags?: string[];
}

/** Fields a caller supplies when creating a task. */
export type NewWorkspaceTask = Omit<WorkspaceTask, 'id' | 'created' | 'updated'>;

export type DeadCodeKind = 'unused-export' | 'unused-local' | 'commented-code';

export interface DeadCodeItem {
  kind: DeadCodeKind;
  file: string;
  name: string;
  startLine: number;
  detail: string;
  /** SHA-1 fingerprint used for ack persistence. */
  fingerprint: string;
}

export interface DuplicateMember {
  file: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  lines: number;
  /** Source of the member (host-widened, capped). When present, the
   *  duplicates page renders the group's members side by side for
   *  comparison; absent in compact/sidebar contexts. */
  snippet?: string;
}

export interface DuplicateGroup {
  cloneType: 'exact' | 'renamed' | 'structural';
  similarity: number;
  count: number;
  members: DuplicateMember[];
  /** SHA-1 fingerprint used for ack persistence. */
  fingerprint: string;
}

export type TypeEscapeKind = 'as-cast' | 'any-type' | 'non-null' | 'ts-ignore';

export interface TypeEscapeItem {
  kind: TypeEscapeKind;
  file: string;
  name: string;
  startLine: number;
  detail: string;
  /** Normalized snippet of the offending node — keeps the fingerprint line-independent. */
  content: string;
  /** SHA-1 fingerprint used for ack persistence. */
  fingerprint: string;
}

/** Any result rendered by a scan pane must carry a stable fingerprint. */
export interface ScanItem {
  fingerprint: string;
}

/** Identifies which scan a pane runs. */
export type ScanFeature = 'dead-code' | 'duplicates' | 'type-escapes';

/** The five project-scoped IO calls every scan pane shares. The host wires
 *  these to its own transport (Electron IPC, or VS Code postMessage). */
export interface ScanPaneApi<T extends ScanItem> {
  /** Run a scan and atomically return its results together with the current
   *  acknowledged fingerprint list so callers never see a stale mismatch. */
  scan: (repoPath: string) => Promise<{ items: T[]; ackedFingerprints: string[] }>;
  listAck: (repoPath: string) => Promise<string[]>;
  listExclude: (repoPath: string) => Promise<string[]>;
  ack: (repoPath: string, fingerprint: string, remove: boolean) => Promise<string[]>;
  excludeDir: (repoPath: string, dir: string, remove: boolean) => Promise<string[]>;
}

/** Task CRUD calls the TasksPanel needs from its host. */
export interface TasksApi {
  list: () => Promise<WorkspaceTask[]>;
  create: (task: NewWorkspaceTask) => Promise<WorkspaceTask>;
  update: (id: string, patch: Partial<WorkspaceTask>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Open the task's backing `.md` file in the host editor. Optional — hosts
   *  that can't surface a file editor (e.g. the Electron app) omit it and the
   *  panel hides the "open in editor" affordance. */
  openInEditor?: (id: string) => Promise<void>;
}

/** Open a file in the host editor. `loc` is an absolute-ish path. */
export type OpenFileFn = (loc: string, name: string, line?: number) => void;

/** A single ranked symbol match from the hybrid code search. Mirrors
 *  mcp-core's CodeSearchResult (scan-types.d.ts) so the ui package stays
 *  self-contained; the host enriches `snippet` with more context lines than
 *  the raw search result carries. */
export interface CodeSearchResult {
  name: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

/** The host IO calls the code-search results panel needs. */
export interface SearchApi {
  search: (query: string) => Promise<CodeSearchResult[]>;
  openFile: (file: string, line: number) => Promise<void>;
}

/** A single architecture-wiki component card, stored as one JSON file under
 *  `.code-workbench/.arch/<slug>.json`. Shared by the arch MCP server, the
 *  Electron app, and the VS Code extension's Architecture panel. */
export interface ArchCard {
  slug: string;
  name: string;
  description: string;
  files: string[];
  guidelines: string[];
  anti_patterns: string[];
  decisions: string[];
  /** Slugs of other cards this component depends on — drives the graph edges. */
  dependsOn: string[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/** The project-scoped arch-wiki IO calls the ArchPanel needs from its host.
 *  The host wires these to its own transport (Electron IPC / VS Code
 *  postMessage) and already knows the active repo, so no repoPath is passed. */
export interface ArchApi {
  list: () => Promise<ArchCard[]>;
  upsert: (card: Partial<ArchCard> & { name: string }) => Promise<ArchCard>;
  remove: (slug: string) => Promise<void>;
  /** Open the card's `<slug>.json` file in the host's normal editor. */
  openCard: (slug: string) => Promise<void>;
}
