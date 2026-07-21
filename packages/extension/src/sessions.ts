import * as vscode from 'vscode';
import * as path from 'path';
import { McpConfigBuilder } from './mcp';
import { findRepoKey, findRepoRoot, listWorktrees } from './git';
import { NotifyServer } from './notifications';
import { writeWorktreeWorkspaceColors } from './workspaceInit';
import { injectWorktreeAssets } from './worktreeAssets';
import { loadGlobalPrefsSync, watchGlobalPrefs, type GlobalPrefs } from './globalPrefs';
import { languagePromptBody } from './language';
import { PHASE_META, PHASE_ORDER, type TaskPhase } from '@code-workbench/mcp-core/phase-prompts';
import {
  EFFORT_FLAGS,
  WORKTREE_COLORS,
  claudeModel,
  sessionIconId,
  worktreeTerminalColor,
  type ClaudeEffort,
  type ClaudeModel,
  type ClaudePermissionMode,
  type SavedSession,
  type SessionKind,
  type SessionProfile,
  type WorktreeColor,
  type WorktreePrefs,
} from './sessionTypes';
import {
  buildBanner,
  claudeConversationExists,
  cryptoRandom,
  readFirstUserMessage,
  shellQuote,
} from './sessionLaunch';

export * from './sessionTypes';
export { SessionItem, SessionsProvider } from './sessionsView';

/** Overrides for a single session, for callers that launch a purpose-built
 *  agent (e.g. the Code Review tool) rather than a blank chat. */
export interface CreateSessionOptions {
  title?: string;
  icon?: string;
  model?: ClaudeModel;
  /** Submitted as the session's first turn. */
  prompt?: string;
  /** `claude --permission-mode` value, e.g. 'plan' to force read-only planning. */
  permissionMode?: ClaudePermissionMode;
  /** Per-session effort override, taking precedence over the worktree pref
   *  (e.g. so a Plan-phase session can force 'max' regardless of the user's
   *  usual setting). */
  effort?: ClaudeEffort;
}

// Legacy workspaceState keys — read only, for one-shot migration into the
// global per-repo store. New code reads/writes via REPOS_KEY in globalState.
const STORE_KEY = 'codeWorkbench.sessions.v2';
const LEGACY_STORE_KEY = 'codeWorkbench.sessions.v1';
const PREFS_KEY = 'codeWorkbench.worktreePrefs.v1';
const ACTIVE_WT_KEY = 'codeWorkbench.activeWorktree';
const BOTTOM_GROUP_KEY = 'codeWorkbench.bottomGroupColumn';

/** globalState key holding repo-scoped state, keyed by git common-dir.
 *  All worktrees of the same repo share one bucket, so switching worktrees
 *  doesn't fragment state across folder-identity workspaceState buckets. */
const REPOS_KEY = 'codeWorkbench.repos.v1';

/** Canonical form of a worktree path for equality checks. Sessions, prefs and
 *  `git worktree list` output can each render the same path slightly
 *  differently (trailing slash, `..` segments, case on case-insensitive
 *  filesystems); normalizing makes counts and lookups consistent. */
export function normalizeWtPath(p: string | undefined | null): string {
  if (!p) return '';
  let s = path.normalize(p).replace(/[\\/]+$/, '');
  if (process.platform === 'darwin' || process.platform === 'win32') s = s.toLowerCase();
  return s;
}

interface RepoState {
  sessions: SavedSession[];
  // Only the fields a user has explicitly set per worktree are stored, so any
  // field left unset keeps inheriting the current global default (see
  // getPrefs). Storing a full WorktreePrefs here would freeze effort/model/yolo
  // at DEFAULT_PREFS the first time *any* pref (e.g. an auto-assigned color)
  // was written, shadowing later changes to the global defaults.
  prefs: Record<string, Partial<WorktreePrefs>>;
  activeWorktree?: string;
}

const EMPTY_REPO_STATE: RepoState = { sessions: [], prefs: {} };

const DEFAULT_PREFS: WorktreePrefs = {
  model: 'default',
  effort: 1,
  yolo: false,
  color: 'default',
};

/** Window (ms) during which a session is considered "actively producing output"
 *  after the most recent terminal write. Slightly longer than the blink period
 *  so a quiet pause doesn't drop the indicator mid-toggle. */
const ACTIVITY_WINDOW_MS = 1500;
/** Blink toggle interval for the active indicator. */
const BLINK_INTERVAL_MS = 500;

export class SessionManager {
  private terminals = new Map<string, vscode.Terminal>();
  private mcp: McpConfigBuilder;
  private notify = new NotifyServer();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  /** Fires on each blink tick. Consumers should refresh ONLY the active
   *  session rows, not the whole tree — otherwise idle rows flicker too. */
  private _onBlink = new vscode.EventEmitter<void>();
  readonly onBlink = this._onBlink.event;
  /** Wall-clock timestamp of the most recent terminal write per session. */
  private lastActivity = new Map<string, number>();
  /** Current phase of the blink toggle. Flipped on each interval tick. */
  private blinkPhase = false;
  private blinkTimer: NodeJS.Timeout | undefined;
  /** Pending title-fallback timers, keyed by session id — see
   *  scheduleTitleFallback. Cleared on dispose so a stale extension-host
   *  shutdown never leaves a dangling setTimeout. */
  private titleFallbackTimers = new Map<string, NodeJS.Timeout>();
  private globalPrefs: GlobalPrefs = loadGlobalPrefsSync();
  private globalPrefsWatcher: vscode.Disposable;
  /** Identity of the current repo (git common-dir). All per-repo state is
   *  bucketed under this key in globalState. Undefined when no repo is open. */
  private repoKey: string | undefined;
  /** Git's canonical path for this window's worktree (from `rev-parse
   *  --show-toplevel`). Set by extension.ts after detectRepoRoot so equality
   *  checks against `git worktree list` output match exactly. */
  private currentWorktreePath: string | undefined;

  /** Resolves once the notify TCP server is listening (port assigned). */
  private notifyReady: Promise<void>;

  constructor(private ctx: vscode.ExtensionContext) {
    this.mcp = new McpConfigBuilder(ctx);
    this.notifyReady = this.notify.start().catch(() => {
      /* notifications unavailable — sessions still work */
    });
    this.notify.onTitle(({ sessionId, title }) => {
      void this.applyRemoteTitle(sessionId, title);
    });
    this.globalPrefsWatcher = watchGlobalPrefs(() => {
      this.globalPrefs = loadGlobalPrefsSync();
      this._onDidChange.fire();
    });
    vscode.window.onDidCloseTerminal((t) => {
      for (const [id, term] of this.terminals) {
        if (term === t) {
          this.terminals.delete(id);
          this.lastActivity.delete(id);
          this._onDidChange.fire();
          break;
        }
      }
    });
    // Best-effort capture of native terminal renames (double-click tab /
    // right-click → Rename). VS Code exposes no rename event, so we poll
    // `Terminal.name` whenever the active terminal or its state changes —
    // those fire on the focus shifts that naturally follow a rename.
    vscode.window.onDidChangeActiveTerminal(() => {
      this.pruneClosedTerminals();
      void this.syncTerminalNames();
      // Re-render so the session row matching the now-focused terminal gains
      // its "selected" highlight (and the previously-selected one drops it).
      this._onDidChange.fire();
    });
    vscode.window.onDidChangeTerminalState(() => {
      this.pruneClosedTerminals();
      void this.syncTerminalNames();
    });
    // Subscribe to raw terminal output to drive the "active" indicator. The
    // event is part of the `terminalDataWriteEvent` proposed API (enabled via
    // package.json `enabledApiProposals`). Guard with `try` so an environment
    // without the proposal still loads — the indicator just stays idle.
    try {
      const w = vscode.window as unknown as {
        onDidWriteTerminalData?: (
          cb: (e: { terminal: vscode.Terminal }) => void,
        ) => vscode.Disposable;
      };
      w.onDidWriteTerminalData?.((e) => this.markActivity(e.terminal));
    } catch {
      /* proposed API unavailable — skip */
    }
  }

  /** Reconcile the session→terminal map against the terminals VS Code still
   *  knows about. Safety net for any close we missed (or a terminal that died
   *  before it was registered) — otherwise a session shows "live" until the
   *  window reloads. */
  private pruneClosedTerminals(): void {
    const live = new Set(vscode.window.terminals);
    let changed = false;
    for (const [id, term] of this.terminals) {
      if (!live.has(term)) {
        this.terminals.delete(id);
        this.lastActivity.delete(id);
        changed = true;
      }
    }
    if (changed) this._onDidChange.fire();
  }

  /** Record a write on a terminal we own and ensure the blink timer is running. */
  private markActivity(term: vscode.Terminal): void {
    let id: string | undefined;
    for (const [sid, t] of this.terminals)
      if (t === term) {
        id = sid;
        break;
      }
    if (!id) return;
    const wasActive = this.isActive(id);
    this.lastActivity.set(id, Date.now());
    if (!this.blinkTimer) {
      this.blinkPhase = true;
      this.blinkTimer = setInterval(() => this.tickBlink(), BLINK_INTERVAL_MS);
    }
    // Structural change (idle → active) requires a full refresh so the row
    // gains its live indicator. Subsequent ticks only need a blink event.
    if (!wasActive) this._onDidChange.fire();
  }

  private tickBlink(): void {
    const now = Date.now();
    let anyActive = false;
    let anyExpired = false;
    for (const [id, ts] of this.lastActivity) {
      if (now - ts > ACTIVITY_WINDOW_MS) {
        this.lastActivity.delete(id);
        anyExpired = true;
      } else {
        anyActive = true;
      }
    }
    this.blinkPhase = !this.blinkPhase;
    // Active rows need to repaint to swap colors; that goes through `onBlink`
    // so consumers can refresh just those rows. A row dropping out of "active"
    // is structural — fire the full-refresh event for that.
    if (anyActive) this._onBlink.fire();
    if (anyExpired) this._onDidChange.fire();
    if (!anyActive && this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = undefined;
      this.blinkPhase = false;
    }
  }

  /** True if the session has produced output within the activity window. */
  isActive(id: string): boolean {
    const ts = this.lastActivity.get(id);
    return ts !== undefined && Date.now() - ts <= ACTIVITY_WINDOW_MS;
  }

  /** Current blink phase, exposed so tree items can pick which color to show. */
  getBlinkPhase(): boolean {
    return this.blinkPhase;
  }

  /** Bind the manager to a repo bucket. Call after detecting repoRoot, and
   *  whenever workspace folders change. Triggers a one-shot migration from
   *  legacy workspaceState the first time a repo bucket is touched. */
  async setRepoKey(key: string | undefined): Promise<void> {
    if (this.repoKey === key) return;
    this.repoKey = key;
    if (key) await this.migrateLegacyIntoRepo(key);
    // The notify server picked a fresh random port on this activation, but
    // Claude sessions launched before an extension-host restart still hold the
    // old one — refresh their port files so they can reach us again.
    void this.notifyReady.then(() =>
      this.mcp.refreshNotifyPorts(
        this.list().map((s) => s.id),
        this.notify.port,
      ),
    );
    this._onDidChange.fire();
  }

  // ── Repo-bucket storage ─────────────────────────────────────────────────
  private getReposStore(): Record<string, RepoState> {
    return this.ctx.globalState.get<Record<string, RepoState>>(REPOS_KEY, {});
  }

  private getRepoState(): RepoState {
    if (!this.repoKey) return EMPTY_REPO_STATE;
    return this.getReposStore()[this.repoKey] ?? EMPTY_REPO_STATE;
  }

  // Serializes writes: globalState.get returns the last COMMITTED value, so
  // two overlapping read-mutate-update cycles would both read the same
  // snapshot and the later update() would silently drop the earlier change.
  private repoStateWrites: Promise<void> = Promise.resolve();

  private updateRepoState(mutate: (s: RepoState) => void): Promise<void> {
    const run = this.repoStateWrites.then(async () => {
      if (!this.repoKey) return;
      const all = this.getReposStore();
      const cur: RepoState = {
        sessions: all[this.repoKey]?.sessions ?? [],
        prefs: all[this.repoKey]?.prefs ?? {},
        activeWorktree: all[this.repoKey]?.activeWorktree,
      };
      mutate(cur);
      all[this.repoKey] = cur;
      await this.ctx.globalState.update(REPOS_KEY, all);
    });
    // Keep the chain alive even if a write fails; the caller still sees it.
    this.repoStateWrites = run.catch(() => {});
    return run;
  }

  /** One-shot migration: if the repo bucket is empty and legacy workspaceState
   *  has data, transplant it. Runs once per repo across the user's machine. */
  private async migrateLegacyIntoRepo(key: string): Promise<void> {
    const all = this.getReposStore();
    if (all[key]) return;
    const v2 = this.ctx.workspaceState.get<SavedSession[]>(STORE_KEY);
    const legacy = !v2
      ? this.ctx.workspaceState.get<Array<SavedSession & { cwd?: string }>>(LEGACY_STORE_KEY, [])
      : undefined;
    const sessions: SavedSession[] =
      v2 ??
      (legacy ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        worktreePath: s.worktreePath ?? s.cwd ?? '',
        kind: s.kind,
        initCommand: s.initCommand,
        created: s.created,
      }));
    const prefs = this.ctx.workspaceState.get<Record<string, Partial<WorktreePrefs>>>(PREFS_KEY, {});
    const activeWorktree = this.ctx.workspaceState.get<string>(ACTIVE_WT_KEY);
    if (sessions.length === 0 && Object.keys(prefs).length === 0 && !activeWorktree) return;
    all[key] = { sessions, prefs, activeWorktree };
    await this.ctx.globalState.update(REPOS_KEY, all);
  }

  // ── Sessions ────────────────────────────────────────────────────────────
  list(): SavedSession[] {
    return this.getRepoState().sessions;
  }

  listForWorktree(worktreePath: string): SavedSession[] {
    const want = normalizeWtPath(worktreePath);
    return this.list().filter((s) => normalizeWtPath(s.worktreePath) === want);
  }

  isOpen(id: string): boolean {
    return this.terminals.has(id);
  }

  /** Session id whose terminal is the one currently focused/selected in VS
   *  Code, or undefined when no owned terminal is active. Drives the
   *  "selected" highlight in the sessions panel so the list reflects which
   *  chat the user is looking at. */
  getActiveSessionId(): string | undefined {
    const active = vscode.window.activeTerminal;
    if (!active) return undefined;
    for (const [id, term] of this.terminals) if (term === active) return id;
    return undefined;
  }

  async create(
    kind: SessionKind,
    worktreePath: string,
    profile?: SessionProfile,
    opts?: CreateSessionOptions,
  ): Promise<SavedSession> {
    const id = cryptoRandom();
    const session: SavedSession = {
      id,
      title:
        opts?.title ??
        (profile
          ? this.profileTitle(profile, worktreePath)
          : this.defaultTitle(kind, worktreePath)),
      worktreePath,
      kind,
      initCommand: '',
      created: Date.now(),
      ...(profile ? { profile } : {}),
      ...(opts?.icon ? { icon: opts.icon } : {}),
      ...(opts?.model ? { modelOverride: opts.model } : {}),
      ...(opts?.prompt ? { initialPrompt: opts.prompt } : {}),
      ...(opts?.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      ...(opts?.effort != null ? { effortOverride: opts.effort } : {}),
    };
    await this.updateRepoState((st) => {
      st.sessions.push(session);
    });
    await this.open(session);
    this._onDidChange.fire();
    // Titling is normally driven by the agent calling notify_chat_title as
    // its first tool call (see workbenchPrompt.ts). That's best-effort — the
    // model may skip or delay it — so plain chat sessions (no explicit title
    // from the caller, e.g. task-flow/code-review already set a meaningful
    // one) get a code-side fallback derived from the transcript's first user
    // turn if no remote title shows up in time.
    if (!opts?.title && (kind === 'claude' || kind === 'claude-yolo')) {
      this.scheduleTitleFallback(id, session.title);
    }
    return session;
  }

  /** After a grace period, if `sessionId` still has its original default
   *  title (i.e. notify_chat_title never fired and the user hasn't renamed
   *  it), derive one from the first user message in its transcript. */
  private scheduleTitleFallback(sessionId: string, defaultTitle: string): void {
    const existing = this.titleFallbackTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.titleFallbackTimers.delete(sessionId);
      void this.applyTitleFallback(sessionId, defaultTitle);
    }, 25_000);
    this.titleFallbackTimers.set(sessionId, timer);
  }

  private async applyTitleFallback(sessionId: string, defaultTitle: string): Promise<void> {
    const s = this.list().find((x) => x.id === sessionId);
    if (!s || s.title !== defaultTitle || !s.claudeSessionId) return;
    const firstMessage = readFirstUserMessage(s.claudeSessionId);
    if (!firstMessage) return;
    await this.applyRemoteTitle(sessionId, firstMessage);
  }

  /** Ensure a reserved bottom editor group exists for workbench sessions and
   *  return its ViewColumn. Creates a new group below the active one on first
   *  use, locks it so unrelated files don't auto-route there, and remembers
   *  the column across reloads. */
  private async ensureBottomGroupColumn(): Promise<vscode.ViewColumn> {
    const stored = this.ctx.workspaceState.get<number>(BOTTOM_GROUP_KEY);
    let col: vscode.ViewColumn | undefined;
    const existing = vscode.window.tabGroups.all.find((g) => g.viewColumn === stored);
    if (existing) {
      col = existing.viewColumn;
    } else {
      await vscode.commands.executeCommand('workbench.action.newGroupBelow');
      col = vscode.window.tabGroups.activeTabGroup.viewColumn;
      await this.ctx.workspaceState.update(BOTTOM_GROUP_KEY, col);
      try {
        await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
      } catch {
        /* command may not exist on older VS Code — ignore */
      }
    }
    // Focus the bottom group so the new terminal reliably becomes a tab there
    // (rather than splitting whichever group happens to be active).
    const target = vscode.window.tabGroups.all.find((g) => g.viewColumn === col);
    if (target && !target.isActive) {
      const focusCommands = [
        'workbench.action.focusFirstEditorGroup',
        'workbench.action.focusSecondEditorGroup',
        'workbench.action.focusThirdEditorGroup',
        'workbench.action.focusFourthEditorGroup',
        'workbench.action.focusFifthEditorGroup',
        'workbench.action.focusSixthEditorGroup',
        'workbench.action.focusSeventhEditorGroup',
        'workbench.action.focusEighthEditorGroup',
      ];
      const cmd = focusCommands[(col as number) - 1];
      if (cmd) {
        try {
          await vscode.commands.executeCommand(cmd);
        } catch {
          /* ignore */
        }
      }
    }
    return col;
  }

  /**
   * Show a transient "Starting Claude…" progress notification while the TUI
   * boots. VS Code terminals can't be visually overlaid, so we use a
   * notification as the user-visible "not safe to type yet" signal. The
   * window matches the last Ctrl-U clear delay so the indicator drops away
   * around the time the TUI is ready to accept input.
   */
  private showStartupOverlay(term: vscode.Terminal): void {
    const STARTUP_MS = 2500;
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Starting Claude — please wait before typing…',
        cancellable: false,
      },
      () =>
        new Promise<void>((resolve) => {
          const done = () => {
            sub.dispose();
            resolve();
          };
          const sub = vscode.window.onDidCloseTerminal((t) => {
            if (t === term) done();
          });
          setTimeout(done, STARTUP_MS);
        }),
    );
  }

  async open(session: SavedSession): Promise<vscode.Terminal> {
    this.pruneClosedTerminals();
    const existing = this.terminals.get(session.id);
    if (existing) {
      existing.show();
      return existing;
    }
    const cfg = vscode.workspace.getConfiguration('codeWorkbench');
    const placement = cfg.get<string>('sessionPanel', 'panel');
    let location:
      | vscode.TerminalEditorLocationOptions
      | vscode.TerminalSplitLocationOptions
      | vscode.TerminalLocation;
    if (placement === 'panel') {
      location = vscode.TerminalLocation.Panel;
    } else if (placement === 'bottom-group') {
      const col = await this.ensureBottomGroupColumn();
      location = { viewColumn: col, preserveFocus: false };
    } else {
      location = { viewColumn: vscode.ViewColumn.Active, preserveFocus: false };
    }

    const prefs = this.getPrefs(session.worktreePath);
    const color = worktreeTerminalColor(prefs.color);
    const baseOpts: vscode.TerminalOptions = {
      name: session.title,
      cwd: session.worktreePath,
      location,
      isTransient: true,
      iconPath: new vscode.ThemeIcon(sessionIconId(session)),
      ...(color ? { color } : {}),
    };

    // Non-shell terminals run a chat CLI as their "shell". hideFromUser makes
    // the ms-python extension skip its venv auto-activation (it would type
    // `source .../activate` straight into the chat input); creationOptions are
    // checked permanently, and the term.show() below reveals the terminal as
    // normal. VS Code ignores a non-panel `location` on hidden terminals
    // (microsoft/vscode#272656), so only opt out under panel placement.
    const chatOpts = placement === 'panel' ? { hideFromUser: true } : {};
    let term: vscode.Terminal;
    if (session.profile) {
      term = vscode.window.createTerminal({
        ...baseOpts,
        ...chatOpts,
        shellPath: session.profile.command,
        shellArgs: session.profile.args,
        ...(session.profile.env ? { env: session.profile.env } : {}),
      });
    } else if (session.kind === 'shell') {
      term = vscode.window.createTerminal(baseOpts);
    } else {
      const launch = await this.buildLaunch(session);
      term = vscode.window.createTerminal({
        ...baseOpts,
        ...chatOpts,
        shellPath: launch.command,
        shellArgs: launch.args,
      });
      // Register before any await below — if the terminal dies during the
      // save, onDidCloseTerminal must find it in the map or the session
      // would show "live" forever.
      this.terminals.set(session.id, term);
      this.showStartupOverlay(term);
      if (!session.launched || session.claudeSessionId !== launch.claudeSessionId) {
        session.claudeSessionId = launch.claudeSessionId;
        session.launched = true;
        await this.updateRepoState((st) => {
          const s = st.sessions.find((x) => x.id === session.id);
          if (s) {
            s.claudeSessionId = launch.claudeSessionId;
            s.launched = true;
          }
        });
      }
    }

    this.terminals.set(session.id, term);
    term.show();
    this._onDidChange.fire();
    return term;
  }

  /**
   * Apply a title sent over the notify channel (from Claude's notify_chat_title).
   * Updates persisted session state and tries to rename the live terminal tab
   * via VS Code's renameWithArg command. The command operates on the focused
   * terminal, so we briefly focus the target terminal to retitle it, then
   * restore prior focus where reasonable.
   */
  private async applyRemoteTitle(sessionId: string, title: string): Promise<void> {
    const clean = String(title ?? '')
      .trim()
      .slice(0, 80);
    if (!clean) return;
    const s = this.list().find((x) => x.id === sessionId);
    if (!s) return;
    // After an extension-host restart the session→terminal map is empty even
    // though the terminal may still be alive — re-adopt it by its tab name.
    const term = this.terminals.get(sessionId) ?? this.adoptTerminalByName(sessionId, s.title);
    // Don't early-return on a matching saved title alone: a previous rename may
    // have persisted the title but failed to retitle the tab (focus race) — a
    // repeated notify_chat_title must be able to retry the tab rename.
    if (s.title === clean && (!term || term.name === clean)) return;
    if (s.title !== clean) {
      // Mutate the freshly-read committed state by id rather than persisting a
      // captured snapshot — otherwise a concurrent close() could be undone by
      // this write re-committing the session it just removed.
      await this.updateRepoState((st) => {
        const cur = st.sessions.find((x) => x.id === sessionId);
        if (cur) cur.title = clean;
      });
    }
    if (term && term.name !== clean) await this.renameTerminalTab(term, clean);
    this._onDidChange.fire();
  }

  /** Find a live terminal not yet bound to any session whose tab name matches
   *  the session's saved title, and bind it. Best-effort recovery after an
   *  extension-host restart wiped the in-memory map. */
  private adoptTerminalByName(sessionId: string, title: string): vscode.Terminal | undefined {
    const bound = new Set(this.terminals.values());
    const match = vscode.window.terminals.find((t) => !bound.has(t) && t.name === title);
    if (match) {
      this.terminals.set(sessionId, match);
      this._onDidChange.fire();
    }
    return match;
  }

  /**
   * Rename a live terminal tab. VS Code's `renameWithArg` command operates on
   * the focused terminal, so we briefly focus the target to retitle it, then
   * restore prior focus where reasonable.
   */
  private async renameTerminalTab(term: vscode.Terminal, name: string): Promise<void> {
    const prior = vscode.window.activeTerminal;
    const hadEditorFocus = !prior && !!vscode.window.activeTextEditor;
    try {
      // renameWithArg operates on the ACTIVE terminal. show(true) preserves
      // focus and does not reliably switch the active terminal before the
      // command runs, so focus the target for real and wait until VS Code
      // reports it active — otherwise the wrong tab (or none) gets renamed.
      term.show(false);
      for (let i = 0; i < 20 && vscode.window.activeTerminal !== term; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      if (vscode.window.activeTerminal !== term) return;
      await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name });
    } catch {
      /* command may not exist on older VS Code — ignore */
    } finally {
      if (prior && prior !== term) {
        prior.show(false);
      } else if (hadEditorFocus) {
        // We stole focus from the editor to make the rename land — give it back.
        try {
          await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * Best-effort sync of native terminal renames back into saved sessions.
   * VS Code has no rename event; this is called on focus/state changes and
   * picks up any change to `Terminal.name` made through the terminal UI.
   */
  private async syncTerminalNames(): Promise<void> {
    const updates: Array<[string, string]> = [];
    for (const [id, term] of this.terminals) {
      const live = term.name?.trim();
      if (!live) continue;
      const s = this.list().find((x) => x.id === id);
      if (s && s.title !== live) updates.push([id, live]);
    }
    if (updates.length > 0) {
      // Persist by id against fresh committed state so this never resurrects a
      // session removed by a concurrent close().
      await this.updateRepoState((st) => {
        for (const [id, live] of updates) {
          const s = st.sessions.find((x) => x.id === id);
          if (s) s.title = live;
        }
      });
      this._onDidChange.fire();
    }
  }

  /** Persist a codicon override for a session. VS Code has no public setter
   *  for a live `Terminal.iconPath`, so the new icon takes effect the next
   *  time the session terminal is opened. Returns true if there is a live
   *  terminal whose icon won't update until reopen. */
  async setIcon(id: string, iconId: string | undefined): Promise<boolean> {
    const s = this.list().find((x) => x.id === id);
    if (!s) return false;
    const clean = iconId?.trim() || undefined;
    if (s.icon === clean) return false;
    let changed = false;
    await this.updateRepoState((st) => {
      const cur = st.sessions.find((x) => x.id === id);
      if (cur && cur.icon !== clean) {
        cur.icon = clean;
        changed = true;
      }
    });
    if (!changed) return false;
    this._onDidChange.fire();
    return this.terminals.has(id);
  }

  async rename(id: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) return;
    let found = false;
    await this.updateRepoState((st) => {
      const s = st.sessions.find((x) => x.id === id);
      if (s) {
        s.title = clean;
        found = true;
      }
    });
    if (!found) return;
    const term = this.terminals.get(id);
    if (term) await this.renameTerminalTab(term, clean);
    this._onDidChange.fire();
  }

  async close(id: string): Promise<void> {
    const term = this.terminals.get(id);
    term?.dispose();
    this.terminals.delete(id);
    // Remove by id against the fresh committed state — never persist a captured
    // full-list snapshot, or a concurrent title/name write could re-commit the
    // session and leave a dead row in the panel.
    await this.updateRepoState((st) => {
      st.sessions = st.sessions.filter((s) => s.id !== id);
    });
    await this.mcp.delete(id);
    this._onDidChange.fire();
  }

  /** Remove every saved session that has no live terminal ("inactive"). When
   *  `worktreePath` is given, only that worktree's sessions are considered.
   *  Returns the number of sessions removed. */
  async closeInactive(worktreePath?: string): Promise<number> {
    this.pruneClosedTerminals();
    const toRemove = new Set<string>();
    for (const s of this.list()) {
      const scoped =
        !worktreePath || normalizeWtPath(s.worktreePath) === normalizeWtPath(worktreePath);
      if (scoped && !this.isOpen(s.id)) toRemove.add(s.id);
    }
    if (toRemove.size === 0) return 0;
    for (const id of toRemove) await this.mcp.delete(id);
    await this.updateRepoState((st) => {
      st.sessions = st.sessions.filter((s) => !toRemove.has(s.id));
    });
    this._onDidChange.fire();
    return toRemove.size;
  }

  /** Tear down all state tied to a worktree: live terminals, saved sessions,
   *  per-session MCP config files, stored prefs, and the active-worktree pointer
   *  if it referenced this path. Caller decides what to activate next. */
  async cleanupWorktree(worktreePath: string): Promise<void> {
    const want = normalizeWtPath(worktreePath);
    const toRemove = new Set<string>();
    for (const s of this.list()) {
      if (normalizeWtPath(s.worktreePath) === want) {
        const term = this.terminals.get(s.id);
        term?.dispose();
        this.terminals.delete(s.id);
        await this.mcp.delete(s.id);
        toRemove.add(s.id);
      }
    }

    await this.updateRepoState((s) => {
      s.sessions = s.sessions.filter((x) => !toRemove.has(x.id));
      delete s.prefs[worktreePath];
      if (s.activeWorktree === worktreePath) s.activeWorktree = undefined;
    });
    this._onDidChange.fire();
  }

  /** Ensure there is an active worktree, picking the main (or any) remaining
   *  worktree if the current one has been cleared. Returns the new active path,
   *  or undefined if reassignment was unnecessary or no candidates exist. */
  async reassignActiveAfterRemoval(repoRoot: string): Promise<string | undefined> {
    if (this.getActiveWorktree()) return undefined;
    try {
      const remaining = await listWorktrees(repoRoot);
      const main = remaining.find((w) => w.isMain) ?? remaining[0];
      if (!main) return undefined;
      await this.setActiveWorktree(main.path);
      return main.path;
    } catch {
      return undefined;
    }
  }

  // ── Active worktree ─────────────────────────────────────────────────────
  /** The "active" worktree is whichever worktree is open as the workspace
   *  folder in this VS Code window. No stored state — each window is
   *  self-aware. Prefers the git-resolved canonical path so equality checks
   *  against `git worktree list` output succeed even when VS Code's fsPath
   *  differs subtly (symlinks, trailing slash, case folding). */
  getActiveWorktree(): string | undefined {
    return this.currentWorktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Called by extension.ts after `findRepoRoot` resolves the current
   *  workspace folder to git's canonical worktree path. */
  setCurrentWorktreePath(p: string | undefined): void {
    if (this.currentWorktreePath === p) return;
    this.currentWorktreePath = p;
    this._onDidChange.fire();
  }

  /** Compatibility shim: switching the active worktree now means opening that
   *  worktree as the workspace folder of a new window. The current window
   *  keeps its own worktree. */
  async setActiveWorktree(worktreePath: string | undefined): Promise<void> {
    if (!worktreePath) return;
    if (worktreePath === this.getActiveWorktree()) return;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), true);
  }

  // ── Global prefs (defaults + prompts) ───────────────────────────────────
  getGlobalPrefs(): GlobalPrefs {
    return this.globalPrefs;
  }

  setGlobalPrefs(prefs: GlobalPrefs): void {
    this.globalPrefs = prefs;
    this._onDidChange.fire();
  }

  // ── Per-worktree prefs ──────────────────────────────────────────────────
  getPrefs(worktreePath: string): WorktreePrefs {
    const all = this.getRepoState().prefs;
    const defaults: WorktreePrefs = {
      ...DEFAULT_PREFS,
      model: this.globalPrefs.defaults.model,
      effort: this.globalPrefs.defaults.effort,
      yolo: this.globalPrefs.defaults.yolo,
    };
    return { ...defaults, ...(all[worktreePath] ?? {}) };
  }

  /** Map of worktree basename → assigned color. Used by views that group by
   *  the platform-independent worktree key (basename) rather than full path. */
  colorByWorktreeKey(): Record<string, WorktreeColor> {
    const all = this.getRepoState().prefs;
    const out: Record<string, WorktreeColor> = {};
    for (const [p, prefs] of Object.entries(all)) {
      const key =
        p
          .split(/[\\/]+/)
          .filter(Boolean)
          .pop() ?? '';
      if (key && prefs?.color) out[key] = prefs.color;
    }
    return out;
  }

  /** First WorktreeColor (other than 'default') not currently in use, falling back
   *  to round-robin if all are taken. Pure function over the prefs map. */
  pickUnusedColor(): WorktreeColor {
    const all = this.getRepoState().prefs;
    const used = new Set<WorktreeColor>();
    let assignedCount = 0;
    for (const p of Object.values(all)) {
      if (p?.color && p.color !== 'default') {
        used.add(p.color);
        assignedCount += 1;
      }
    }
    const palette = WORKTREE_COLORS.filter((c) => c !== 'default');
    for (const c of palette) if (!used.has(c)) return c;
    return palette[assignedCount % palette.length] ?? 'blue';
  }

  /**
   * Model a task-flow phase runs on for this worktree: the worktree's override
   * beats the global setting, which beats the phase's built-in model. A
   * 'default' entry at either level means "keep falling through".
   */
  resolvePhaseModel(worktreePath: string, phase: TaskPhase): ClaudeModel {
    const worktree = this.getPrefs(worktreePath).phaseModels?.[phase];
    if (worktree && worktree !== 'default') return worktree;
    const global = this.globalPrefs.phaseModels?.[phase];
    if (global && global !== 'default') return global;
    return PHASE_META[phase].model;
  }

  /** Resolved phase→model map for a worktree — what the Phase Board displays. */
  resolvePhaseModels(worktreePath: string): Record<TaskPhase, ClaudeModel> {
    return Object.fromEntries(
      PHASE_ORDER.map((phase) => [phase, this.resolvePhaseModel(worktreePath, phase)]),
    ) as Record<TaskPhase, ClaudeModel>;
  }

  /** Assign a fresh unused color to a worktree if it doesn't already have one. */
  async assignColorIfUnset(worktreePath: string): Promise<void> {
    const cur = this.getPrefs(worktreePath);
    if (cur.color && cur.color !== 'default') return;
    await this.setPrefs(worktreePath, { color: this.pickUnusedColor() });
  }

  async setPrefs(worktreePath: string, patch: Partial<WorktreePrefs>): Promise<void> {
    const prev = this.getRepoState().prefs[worktreePath];
    // Store ONLY explicitly-set fields — do not backfill DEFAULT_PREFS, or an
    // unrelated patch (e.g. assigning a color) would freeze effort/model/yolo
    // and stop them inheriting the global defaults in getPrefs.
    const next: Partial<WorktreePrefs> = { ...(prev ?? {}), ...patch };
    await this.updateRepoState((s) => {
      s.prefs[worktreePath] = next;
    });
    if (patch.color !== undefined && patch.color !== prev?.color) {
      try {
        await writeWorktreeWorkspaceColors(worktreePath, patch.color);
      } catch {
        // best-effort; don't fail the pref update on a fs error
      }
    }
    this._onDidChange.fire();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  private async buildLaunch(
    session: SavedSession,
  ): Promise<{ command: string; args: string[]; claudeSessionId: string }> {
    const { kind, worktreePath, id: sessionId } = session;
    const cfg = vscode.workspace.getConfiguration('codeWorkbench');
    // Global prefs (~/.code-workbench/settings.json) win over VS Code config.
    const claudeCmd = this.globalPrefs.claudeCommand || cfg.get<string>('claudeCommand', 'claude');
    const yoloArgs =
      this.globalPrefs.claudeYoloArgs ||
      cfg.get<string>('claudeYoloArgs', '--dangerously-skip-permissions');
    const prefs = this.getPrefs(worktreePath);
    const args: string[] = [];
    const claudeSessionId = session.claudeSessionId ?? cryptoRandom();
    const resuming =
      !!session.launched &&
      !!session.claudeSessionId &&
      claudeConversationExists(worktreePath, claudeSessionId);
    if (resuming) {
      args.push('--resume', claudeSessionId);
    } else {
      args.push('--session-id', claudeSessionId);
    }
    const model = claudeModel(session.modelOverride ?? prefs.model);
    if (model.flag) args.push('--model', model.flag);
    // Some models (e.g. haiku) don't support extended thinking; skip effort flag.
    if (model.thinking) {
      const effortFlag = EFFORT_FLAGS[session.effortOverride ?? prefs.effort] ?? '';
      if (effortFlag) args.push('--effort', effortFlag);
    }
    if (session.permissionMode) {
      args.push('--permission-mode', session.permissionMode);
    } else if (kind === 'claude-yolo' || prefs.yolo) {
      for (const a of yoloArgs.split(/\s+/).filter(Boolean)) args.push(a);
    }

    const repoPath = (await findRepoRoot(worktreePath)) ?? worktreePath;
    const repoKey = (await findRepoKey(worktreePath)) ?? undefined;
    // Refresh the bundled skills/agents inside this worktree so every session
    // sees copies matching the installed extension version. Never throws.
    await injectWorktreeAssets(worktreePath);
    const languageBody = languagePromptBody(
      this.globalPrefs.language,
      this.globalPrefs.commentLanguage,
    );
    const extraPrompts = [
      ...(languageBody ? [languageBody] : []),
      ...this.globalPrefs.prompts
        .filter((p) => p.enabled)
        .map((p) => p.body.trim())
        .filter(Boolean),
    ];
    const mcp = await this.mcp.write({
      sessionId,
      worktreePath,
      repoPath,
      repoKey,
      notifyPort: this.notify.port,
      extraPrompts,
    });
    if (mcp) {
      args.push('--mcp-config', mcp.configPath);
      if (mcp.promptPath) args.push('--append-system-prompt-file', mcp.promptPath);
    } else {
      // No MCP prompt file — pass user prompts directly.
      for (const body of extraPrompts) args.push('--append-system-prompt', body);
    }

    // Positional prompt: the CLI submits it as the first turn of the new
    // conversation. A resumed session already has it in its transcript.
    if (session.initialPrompt && !resuming) args.push(session.initialPrompt);

    const banner = buildBanner(worktreePath, prefs.color);
    if (banner && process.platform !== 'win32') {
      const script = `printf '%s' ${shellQuote(banner)}; exec ${shellQuote(claudeCmd)}${
        args.length ? ' ' + args.map(shellQuote).join(' ') : ''
      }`;
      return { command: '/bin/sh', args: ['-c', script], claudeSessionId };
    }
    return { command: claudeCmd, args, claudeSessionId };
  }

  dispose(): void {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = undefined;
    }
    for (const timer of this.titleFallbackTimers.values()) clearTimeout(timer);
    this.titleFallbackTimers.clear();
    this.notify.dispose();
    this.globalPrefsWatcher.dispose();
  }

  private defaultTitle(kind: SessionKind, worktreePath: string): string {
    const base = path.basename(worktreePath) || 'workspace';
    const kindLabel = kind === 'claude' ? 'Claude' : kind === 'claude-yolo' ? 'Claude ⚡' : 'Shell';
    const existing = this.listForWorktree(worktreePath).filter((s) => s.kind === kind).length;
    const suffix = existing === 0 ? '' : ` ${existing + 1}`;
    return `${kindLabel}${suffix} · ${base}`;
  }

  private profileTitle(profile: SessionProfile, worktreePath: string): string {
    const base = path.basename(worktreePath) || 'workspace';
    const existing = this.listForWorktree(worktreePath).filter(
      (s) => s.profile?.label === profile.label,
    ).length;
    const suffix = existing === 0 ? '' : ` ${existing + 1}`;
    return `${profile.label}${suffix} · ${base}`;
  }

  /** Reopen every saved session bound to `worktreePath` that has no live
   *  terminal. Used by the restore-on-open setting. Returns the count opened. */
  async restoreSessions(worktreePath: string): Promise<number> {
    let opened = 0;
    for (const s of this.listForWorktree(worktreePath)) {
      if (!this.isOpen(s.id)) {
        await this.open(s);
        opened++;
      }
    }
    return opened;
  }
}
