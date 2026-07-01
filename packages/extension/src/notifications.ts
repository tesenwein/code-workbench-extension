import * as net from 'net';
import * as vscode from 'vscode';

export type NotifyKind = 'done' | 'needs_input' | 'info';

export interface NotifyMessage {
  type: 'notification';
  kind: NotifyKind;
  title: string;
  message?: string;
  ts?: number;
}

export interface SetTitleMessage {
  type: 'set_title';
  sessionId: string;
  title: string;
}

type IncomingMessage = NotifyMessage | SetTitleMessage;

const DEFAULT_BODY_BY_KIND: Record<NotifyKind, string> = {
  done: 'Task finished',
  needs_input: 'Needs your input',
  info: 'Update',
};

export class NotifyServer {
  private server: net.Server | null = null;
  private _port = 0;
  private _onTitle = new vscode.EventEmitter<{
    sessionId: string;
    title: string;
  }>();
  readonly onTitle = this._onTitle.event;

  get port(): number {
    return this._port;
  }

  async start(): Promise<void> {
    if (this.server) return;
    await new Promise<void>((resolve, reject) => {
      const srv = net.createServer((sock) => this.handleConnection(sock));
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') this._port = addr.port;
        this.server = srv;
        resolve();
      });
    });
  }

  dispose(): void {
    try {
      this.server?.close();
    } catch {
      /* ignore */
    }
    this.server = null;
    this._port = 0;
    this._onTitle.dispose();
  }

  private handleConnection(sock: net.Socket): void {
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as IncomingMessage;
          this.dispatch(msg);
        } catch {
          /* malformed — ignore */
        }
      }
    });
    sock.on('error', () => {
      /* ignore */
    });
  }

  private dispatch(msg: IncomingMessage): void {
    if (msg.type === 'set_title') {
      this._onTitle.fire({
        sessionId: msg.sessionId,
        title: String(msg.title ?? ''),
      });
      return;
    }
    if (msg.type !== 'notification') return;
    const title = String(msg.title ?? '').trim();
    const message = String(msg.message ?? '').trim();
    const parts = [title, message].filter(Boolean);
    // Fall back to a kind-appropriate default so we never show a bare "Claude:".
    const body =
      parts.length > 0
        ? parts.join(' — ')
        : DEFAULT_BODY_BY_KIND[msg.kind] ?? 'Notification';
    if (msg.kind === 'needs_input') {
      void vscode.window.showWarningMessage(`Claude: ${body}`);
    } else {
      void vscode.window.showInformationMessage(`Claude: ${body}`);
    }
  }
}
