import * as vscode from 'vscode';
import type { SessionManager } from './sessions';

/** Shared wiring for the prefs webview panels: renders the html, forwards
 *  webview messages to `onMessage`, re-posts `{type:'state'}` whenever the
 *  SessionManager changes, and tears everything down when the panel closes.
 *  Subclasses call `start()` at the end of their constructor — it can't run in
 *  the base constructor because it calls abstract methods that read the
 *  subclass's own fields. */
export abstract class StatePanelBase<TState> {
  protected disposables: vscode.Disposable[] = [];

  protected constructor(
    protected panel: vscode.WebviewPanel,
    protected mgr: SessionManager,
  ) {}

  protected abstract renderHtml(): string;
  protected abstract state(): TState;
  protected abstract onMessage(msg: { type: string; value?: unknown }): void | Promise<void>;
  /** Called once when the panel is disposed, before disposables are released. */
  protected abstract onDisposed(): void;

  protected start(): void {
    this.panel.webview.html = this.renderHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      undefined,
      this.disposables,
    );
    this.disposables.push(this.mgr.onDidChange(() => this.postState()));
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  protected postState(): void {
    void this.panel.webview.postMessage({ type: 'state', state: this.state() });
  }

  private dispose(): void {
    this.onDisposed();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}
