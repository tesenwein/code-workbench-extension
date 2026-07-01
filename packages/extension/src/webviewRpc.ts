/* Extension-side half of the webview RPC bridge (see webview/bridge.ts).
 * Wires a webview's incoming messages to a map of async handler functions and
 * answers each with a `rpc-result`. Also exposes `postEvent` for server-push
 * messages (repo-root changes, task-file changes, …). */

import * as vscode from 'vscode';

export interface RpcContext {
  postEvent(name: string, payload: unknown): void;
}

type Handler = (...args: unknown[]) => unknown | Promise<unknown>;

interface IncomingMessage {
  kind?: string;
  id?: number;
  method?: string;
  args?: unknown[];
}

/** Attach RPC handling to a webview. Returns an RpcContext for pushing events. */
export function attachRpc(
  webview: vscode.Webview,
  handlers: Record<string, Handler>,
  onReady: (ctx: RpcContext) => void,
): RpcContext {
  const ctx: RpcContext = {
    postEvent: (name, payload) => void webview.postMessage({ kind: 'event', name, payload }),
  };

  webview.onDidReceiveMessage(async (msg: IncomingMessage) => {
    if (!msg) return;
    if (msg.kind === 'ready') {
      onReady(ctx);
      return;
    }
    if (msg.kind !== 'rpc' || typeof msg.id !== 'number' || !msg.method) return;
    const fn = handlers[msg.method];
    if (!fn) {
      void webview.postMessage({
        kind: 'rpc-result',
        id: msg.id,
        ok: false,
        error: `Unknown RPC method: ${msg.method}`,
      });
      return;
    }
    try {
      const value = await fn(...(msg.args ?? []));
      void webview.postMessage({
        kind: 'rpc-result',
        id: msg.id,
        ok: true,
        value,
      });
    } catch (e) {
      void webview.postMessage({
        kind: 'rpc-result',
        id: msg.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return ctx;
}
