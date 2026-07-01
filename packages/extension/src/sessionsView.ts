import * as vscode from 'vscode';
import * as path from 'path';
import { sessionIconId, type SavedSession } from './sessionTypes';
import { claudeConversationExists } from './sessionLaunch';
import type { SessionManager } from './sessions';
import { makeNonce, panelHtml, WORKTREE_DOT } from './panelTheme';

/** Plain data carrier passed to session commands. The commands only read
 *  `.session`, so this stays compatible with the old TreeItem-based callers. */
export class SessionItem extends vscode.TreeItem {
  constructor(
    public readonly session: SavedSession,
    isOpen: boolean,
    extensionUri: vscode.Uri,
    isActive = false,
  ) {
    super(session.title, vscode.TreeItemCollapsibleState.None);
    void isOpen;
    void extensionUri;
    void isActive;
    this.description = session.kind;
    this.iconPath = new vscode.ThemeIcon(sessionIconId(session));
    this.command = {
      command: 'codeWorkbench.sessions.open',
      title: 'Open Session',
      arguments: [this],
    };
  }
}

const SESSIONS_SCRIPT = `
const vscode = acquireVsCodeApi();
const root = document.getElementById('root');
const DOT = ${JSON.stringify(WORKTREE_DOT)};
const SVG = {
  pencil:'<path d="M10.5 2.6 13.4 5.5 5.6 13.3H2.7v-2.9z"/>',
  icon:'<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.6"/><circle cx="5.9" cy="6.6" r="1.1"/><path d="M3 11.6 6.3 8.2l2.2 2 2.2-2.6 2.6 3"/>',
  x:'<path d="M4.2 4.2 11.8 11.8"/><path d="M11.8 4.2 4.2 11.8"/>',
  branch:'<circle cx="5" cy="4" r="1.7"/><circle cx="5" cy="12" r="1.7"/><circle cx="11" cy="6.5" r="1.7"/><path d="M5 5.7v4.6M5 8.5h3.2a2.6 2.6 0 0 0 2.6-2.6"/>',
  plus:'<path d="M8 3.4v9.2"/><path d="M3.4 8h9.2"/>'
};
function svg(n){ return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+SVG[n]+'</svg>'; }
function sep(){ var s=document.createElement('span'); s.className='sep'; s.textContent='·'; return s; }
function btn(n,cls,title,fn){
  var b=document.createElement('button');
  b.className='ibtn '+(cls||''); b.title=title; b.innerHTML=svg(n);
  b.addEventListener('click',function(e){ e.stopPropagation(); fn(); });
  return b;
}
function groupHead(label,count,active,color){
  var g=document.createElement('div');
  var accent=color&&color!=='default'?DOT[color]:null;
  g.className='grp'+(active?' active':'')+(accent?' wt':'');
  if(accent){
    var gd=document.createElement('span'); gd.className='gdot';
    gd.style.background=accent; gd.style.color=accent;
    g.appendChild(gd);
    g.style.borderBottomColor=accent;
  } else {
    var gi=document.createElement('span'); gi.className='gi'; gi.innerHTML=svg('branch');
    g.appendChild(gi);
  }
  var nm=document.createElement('span'); nm.className='gname'; nm.textContent=label;
  if(accent){ nm.style.color=accent; }
  g.appendChild(nm);
  var ct=document.createElement('span'); ct.className='gcount'; ct.textContent=count; g.appendChild(ct);
  root.appendChild(g);
}
var blinkPhase = false;
function sessionRow(s,accent){
  var row=document.createElement('div');
  row.className='row'+(s.isActive?' active':'')+(s.selected?' selected':'');
  if(accent){ row.style.boxShadow='inset 2px 0 0 '+accent; }
  row.addEventListener('click',function(){ vscode.postMessage({type:'open',id:s.id}); });

  var lead=document.createElement('div'); lead.className='lead';
  var live=document.createElement('span');
  live.className='live'+(s.isOpen?' on':'')+(s.isActive&&blinkPhase?' blink':'');
  if(s.isActive){ live.setAttribute('data-active','1'); }
  live.title=s.isOpen?(s.isActive?'live · active':'live'):'not running';
  lead.appendChild(live); row.appendChild(lead);

  var body=document.createElement('div'); body.className='body';
  var title=document.createElement('div'); title.className='title'; title.textContent=s.title;
  body.appendChild(title);
  var meta=document.createElement('div'); meta.className='meta';
  var k=document.createElement('span'); k.textContent=s.kind; meta.appendChild(k);
  if(s.isOpen){ meta.appendChild(sep()); var lv=document.createElement('span'); lv.className='sess'; lv.textContent='live'; meta.appendChild(lv); }
  body.appendChild(meta); row.appendChild(body);

  var acts=document.createElement('div'); acts.className='acts';
  acts.appendChild(btn('pencil','','Rename session',function(){ vscode.postMessage({type:'rename',id:s.id}); }));
  acts.appendChild(btn('icon','clay','Change tab icon',function(){ vscode.postMessage({type:'setIcon',id:s.id}); }));
  acts.appendChild(btn('x','danger','Close session',function(){ vscode.postMessage({type:'close',id:s.id}); }));
  row.appendChild(acts);
  root.appendChild(row);
}
function addButton(){
  var add=document.createElement('button'); add.className='add';
  add.innerHTML=svg('plus')+'<span>New terminal</span>';
  add.addEventListener('click',function(){ vscode.postMessage({type:'new'}); });
  root.appendChild(add);
}
function render(st){
  root.textContent='';
  if(!st.groups || st.groups.length===0){
    addButton(); return;
  }
  st.groups.forEach(function(grp){
    groupHead(grp.label, grp.items.length, grp.active, grp.color);
    var accent=grp.color&&grp.color!=='default'?DOT[grp.color]:null;
    grp.items.forEach(function(s){ sessionRow(s,accent); });
  });
  addButton();
}
window.addEventListener('message',function(e){
  var d=e.data;
  if(!d) return;
  if(d.type==='state'){ blinkPhase=!!d.blink; render(d); }
  else if(d.type==='blink'){
    blinkPhase=!!d.phase;
    var dots=root.querySelectorAll('.live.on[data-active="1"]');
    for(var i=0;i<dots.length;i++){ dots[i].classList.toggle('blink',blinkPhase); }
  }
});
vscode.postMessage({type:'ready'});
`;

export class SessionsProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'codeWorkbench.sessions';
  private view?: vscode.WebviewView;
  private cache: SavedSession[] = [];

  constructor(
    private mgr: SessionManager,
    private extensionUri: vscode.Uri,
  ) {
    void this.extensionUri;
    mgr.onDidChange(() => this.post());
    mgr.onBlink(() => {
      void this.view?.webview.postMessage({
        type: 'blink',
        phase: this.mgr.getBlinkPhase(),
      });
    });
  }

  refresh(): void {
    void this.post();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = panelHtml(view.webview.cspSource, makeNonce(), SESSIONS_SCRIPT);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
  }

  private loadState(): Record<string, unknown> {
    const active = this.mgr.getActiveWorktree();
    const selectedId = this.mgr.getActiveSessionId();
    this.cache = this.mgr.list().filter((s) => !isOrphanedClaudeSession(s, this.mgr.isOpen(s.id)));

    const groups = new Map<string, SavedSession[]>();
    for (const s of this.cache) {
      const bucket = groups.get(s.worktreePath);
      if (bucket) bucket.push(s);
      else groups.set(s.worktreePath, [s]);
    }

    const keys = [...groups.keys()].sort((a, b) => {
      if (a === active) return -1;
      if (b === active) return 1;
      return path.basename(a).localeCompare(path.basename(b));
    });

    const groupArr = keys.map((k) => ({
      label: path.basename(k),
      active: k === active,
      color: this.mgr.getPrefs(k).color,
      items: groups
        .get(k)!
        .slice()
        .sort((a, b) => b.created - a.created)
        .map((s) => ({
          id: s.id,
          title: s.title,
          kind: s.kind,
          isOpen: this.mgr.isOpen(s.id),
          isActive: this.mgr.isActive(s.id),
          selected: s.id === selectedId,
        })),
    }));
    return { groups: groupArr, blink: this.mgr.getBlinkPhase() };
  }

  private lastJson = '';

  private post(): void {
    if (!this.view) return;
    const state = this.loadState();
    const json = JSON.stringify(state);
    if (json === this.lastJson) return;
    this.lastJson = json;
    void this.view.webview.postMessage({ type: 'state', ...state });
  }

  private onMessage(m: { type?: string; id?: string }): void {
    if (m?.type === 'ready') {
      this.lastJson = '';
      this.post();
      return;
    }
    if (m?.type === 'new') {
      void vscode.commands.executeCommand('codeWorkbench.sessions.new');
      return;
    }
    const session = this.cache.find((s) => s.id === m?.id);
    if (!session) return;
    const cmd = (
      {
        open: 'codeWorkbench.sessions.open',
        rename: 'codeWorkbench.sessions.rename',
        setIcon: 'codeWorkbench.sessions.setIcon',
        close: 'codeWorkbench.sessions.close',
      } as Record<string, string>
    )[m?.type ?? ''];
    if (cmd) void vscode.commands.executeCommand(cmd, { session });
  }
}

/** A saved Claude session is "orphaned" once it has been launched but its
 *  on-disk transcript at ~/.claude/projects/<cwd>/<id>.jsonl has been deleted.
 *  Such sessions can never be resumed — hide them from the tree. Live sessions
 *  and not-yet-launched sessions are always shown; shell sessions never have a
 *  Claude transcript and are always shown. */
function isOrphanedClaudeSession(s: SavedSession, isOpen: boolean): boolean {
  if (isOpen) return false;
  if (s.kind === 'shell') return false;
  if (!s.launched || !s.claudeSessionId) return false;
  return !claudeConversationExists(s.worktreePath, s.claudeSessionId);
}
