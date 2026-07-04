import * as vscode from 'vscode';
import * as path from 'path';
import { listWorktrees, Worktree } from './git';
import { WorktreeColor, worktreeIconColor } from './sessions';
import { makeNonce, panelHtml, WORKTREE_DOT } from './panelTheme';

/** Plain data carrier passed to worktree commands. The commands only read
 *  `.wt`, so this stays compatible with the old TreeItem-based callers. */
export class WorktreeItem extends vscode.TreeItem {
  constructor(
    public readonly wt: Worktree,
    isActive: boolean,
    color: WorktreeColor,
  ) {
    super(path.basename(wt.path), vscode.TreeItemCollapsibleState.None);
    const ahead = wt.ahead ? ` ↑${wt.ahead}` : '';
    const behind = wt.behind ? ` ↓${wt.behind}` : '';
    const dirty = wt.uncommittedCount ? ` ●${wt.uncommittedCount}` : '';
    this.description = `${isActive ? '★ ' : ''}${wt.branch}${ahead}${behind}${dirty}`;
    this.tooltip = `${wt.path}\nbranch: ${wt.branch}\nHEAD: ${wt.head}\ncolor: ${color}`;
    const themed = worktreeIconColor(color);
    this.iconPath = themed
      ? new vscode.ThemeIcon('git-branch', themed)
      : new vscode.ThemeIcon('git-branch');
  }
}

const WORKTREES_SCRIPT = `
const vscode = acquireVsCodeApi();
const root = document.getElementById('root');
const DOT = ${JSON.stringify(WORKTREE_DOT)};
const SVG = {
  ext:'<path d="M6 3.6h6.4V10"/><path d="M12.4 3.6 6.7 9.3"/><path d="M10.4 9.4v3H3.6v-9h3"/>',
  term:'<path d="M3.6 4 6.6 7l-3 3"/><path d="M8 11h4.4"/>',
  cfg:'<path d="M3 5.6h10"/><path d="M3 10.4h10"/><circle cx="6" cy="5.6" r="1.6"/><circle cx="10" cy="10.4" r="1.6"/>',
  trash:'<path d="M3.2 4.3h9.6"/><path d="M6 4.3V2.6h4v1.7"/><path d="M4.6 4.3 5.4 13h5.2l.8-8.7"/>',
  plus:'<path d="M8 3.4v9.2"/><path d="M3.4 8h9.2"/>',
  pr:'<circle cx="4" cy="4" r="1.8"/><circle cx="4" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><path d="M4 5.8v4.4"/><path d="M12 10.2V7a3 3 0 0 0-3-3H6.6"/><path d="M8.4 2 6.4 4l2 2"/>',
  note:'<path d="M3.4 2.6h9.2v8l-2.8 2.8H3.4z"/><path d="M9.8 13.4V10.6h2.8"/><path d="M5.4 5.6h5.2"/><path d="M5.4 8h3.4"/>'
};
function svg(n){ return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+SVG[n]+'</svg>'; }
function sep(){ var s=document.createElement('span'); s.className='sep'; s.textContent='·'; return s; }
function btn(n,cls,title,fn){
  var b=document.createElement('button');
  b.className='ibtn '+(cls||''); b.title=title; b.innerHTML=svg(n);
  b.addEventListener('click',function(e){ e.stopPropagation(); fn(); });
  return b;
}
function render(st){
  root.textContent='';
  if(st.placeholder){
    var d=document.createElement('div'); d.className='empty fade';
    var t=document.createElement('span'); t.textContent=st.placeholder; d.appendChild(t);
    root.appendChild(d); return;
  }
  (st.items||[]).forEach(function(w){
    var row=document.createElement('div');
    row.className='row'+(w.active?' active':'');
    row.addEventListener('click',function(){ vscode.postMessage({type:'open',path:w.path}); });

    var lead=document.createElement('div'); lead.className='lead';
    var dot=document.createElement('span'); dot.className='dot';
    var dc=DOT[w.color]||DOT.default;
    dot.style.background=dc;
    dot.style.boxShadow='0 0 0 2px var(--bg-0), 0 0 7px '+dc;
    dot.title='color: '+(w.color||'default');
    if(w.isMain){ dot.style.borderRadius='3px'; }
    lead.appendChild(dot); row.appendChild(lead);

    var body=document.createElement('div'); body.className='body';
    var title=document.createElement('div'); title.className='title';
    if(w.active){ var s=document.createElement('span'); s.className='star'; s.textContent='★'; s.style.color=dc; title.appendChild(s); }
    title.appendChild(document.createTextNode(w.name));
    body.appendChild(title);
    var meta=document.createElement('div'); meta.className='meta';
    var br=document.createElement('span'); br.className='br'; br.textContent=w.branch; meta.appendChild(br);
    if(w.ahead||w.behind){
      meta.appendChild(sep());
      var ab=document.createElement('span'); ab.className='ab';
      ab.textContent=(w.ahead?'↑'+w.ahead:'')+(w.ahead&&w.behind?' ':'')+(w.behind?'↓'+w.behind:'');
      ab.title=(w.ahead||0)+' ahead, '+(w.behind||0)+' behind upstream';
      meta.appendChild(ab);
    }
    if(w.dirty){ meta.appendChild(sep()); var dd=document.createElement('span'); dd.className='dirty'; dd.textContent='●'+w.dirty; dd.title=w.dirty+' uncommitted file'+(w.dirty===1?'':'s'); meta.appendChild(dd); }
    if(w.note){ meta.appendChild(sep()); var nn=document.createElement('span'); nn.className='ab'; nn.textContent='✎ note'; nn.title=w.note; meta.appendChild(nn); }
    body.appendChild(meta); row.appendChild(body);

    var acts=document.createElement('div'); acts.className='acts';
    acts.appendChild(btn('ext','clay','Open in new window',function(){ vscode.postMessage({type:'open',path:w.path}); }));
    acts.appendChild(btn('term','clay','New session in this worktree',function(){ vscode.postMessage({type:'spawn',path:w.path}); }));
    acts.appendChild(btn('cfg','','Configure Claude',function(){ vscode.postMessage({type:'configure',path:w.path}); }));
    acts.appendChild(btn('note','',w.note?('Handoff note: '+w.note):'Add handoff note',function(){ vscode.postMessage({type:'note',path:w.path}); }));
    if(!w.isMain){ acts.appendChild(btn('pr','clay','Open pull request',function(){ vscode.postMessage({type:'openPR',path:w.path}); })); }
    if(!w.isMain){ acts.appendChild(btn('trash','danger','Remove worktree',function(){ vscode.postMessage({type:'remove',path:w.path}); })); }
    row.appendChild(acts);
    root.appendChild(row);
  });
  var add=document.createElement('button'); add.className='add';
  add.innerHTML=svg('plus')+'<span>New worktree</span>';
  add.addEventListener('click',function(){ vscode.postMessage({type:'create'}); });
  root.appendChild(add);
}
window.addEventListener('message',function(e){ if(e.data&&e.data.type==='state') render(e.data); });
vscode.postMessage({type:'ready'});
`;

export class WorktreesProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'codeWorkbench.worktrees';
  /** Coalesce bursts of refresh() calls (file saves, session ticks, focus) into
   *  a single git scan. listWorktrees() spawns ~3 git processes per worktree, so
   *  an un-throttled refresh on every onDidSaveTextDocument is a process storm. */
  private static readonly REFRESH_DEBOUNCE_MS = 300;
  private view?: vscode.WebviewView;
  private cache: Worktree[] = [];
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private getRepoRoot: () => string | undefined,
    private getActiveWorktree: () => string | undefined,
    private getColor: (worktreePath: string) => WorktreeColor,
    private getNote: (worktreePath: string) => string | undefined = () => undefined,
  ) {}

  refresh(): void {
    // Schedule once and ignore further calls until it fires: guarantees at most
    // one git scan per debounce window even under a continuous save stream.
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.post();
    }, WorktreesProvider.REFRESH_DEBOUNCE_MS);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = panelHtml(view.webview.cspSource, makeNonce(), WORKTREES_SCRIPT);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    // The panel skips git scans while hidden; catch up the moment it reappears.
    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });
  }

  private async loadState(): Promise<Record<string, unknown>> {
    const root = this.getRepoRoot();
    if (!root)
      return {
        placeholder: 'Not a git repository — open a repo to use Code Workbench.',
      };
    try {
      const trees = await listWorktrees(root);
      this.cache = trees;
      const active = this.getActiveWorktree();
      return {
        items: trees.map((wt) => ({
          path: wt.path,
          name: path.basename(wt.path),
          branch: wt.branch,
          dirty: wt.uncommittedCount ?? 0,
          ahead: wt.ahead ?? 0,
          behind: wt.behind ?? 0,
          active: wt.path === active,
          isMain: wt.isMain,
          color: this.getColor(wt.path),
          note: this.getNote(wt.path) || undefined,
        })),
      };
    } catch {
      return { items: [] };
    }
  }

  private lastJson = '';

  private async post(): Promise<void> {
    // No view, or hidden: skip the git scan entirely. onDidChangeVisibility
    // re-triggers a refresh when the panel comes back, so nothing is missed.
    if (!this.view || !this.view.visible) return;
    const state = await this.loadState();
    const json = JSON.stringify(state);
    if (json === this.lastJson) return;
    this.lastJson = json;
    void this.view.webview.postMessage({ type: 'state', ...state });
  }

  private onMessage(m: { type?: string; path?: string }): void {
    if (m?.type === 'ready') {
      this.lastJson = '';
      void this.post();
      return;
    }
    if (m?.type === 'init') {
      void vscode.commands.executeCommand('codeWorkbench.init');
      return;
    }
    if (m?.type === 'create') {
      void vscode.commands.executeCommand('codeWorkbench.worktrees.add');
      return;
    }
    const wt = this.cache.find((w) => w.path === m?.path);
    if (!wt) return;
    const cmd = (
      {
        open: 'codeWorkbench.worktrees.open',
        spawn: 'codeWorkbench.worktrees.spawnHere',
        configure: 'codeWorkbench.worktrees.configure',
        openPR: 'codeWorkbench.worktrees.openPR',
        remove: 'codeWorkbench.worktrees.remove',
        note: 'codeWorkbench.worktrees.editNote',
      } as Record<string, string>
    )[m?.type ?? ''];
    if (cmd) void vscode.commands.executeCommand(cmd, { wt });
  }
}
