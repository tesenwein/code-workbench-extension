/* Minimal request/response bridge over the VS Code webview message channel.
 * The React panels call `rpc.call('method', ...args)` and await a Promise; the
 * extension-side provider answers with a matching `rpc-result` message.
 * The provider can also push `event` messages (e.g. a repo-root change or a
 * task-file change) which the panel subscribes to via `rpc.onEvent`. */

import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** Per-entry event map: event name → payload type. */
export type EventHandlers<E> = { [K in keyof E]?: (payload: E[K]) => void };

export interface Bridge {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  onEvent(handler: (name: string, payload: unknown) => void): void;
  /** Subscribe with one handler per event name; `E` maps each name to the
   *  payload type the host posts for it (see the `postEvent` call sites). */
  onEvents<E extends object>(handlers: EventHandlers<E>): void;
  /** Tell the provider the webview has mounted and wants its initial state. */
  ready(): void;
}

export function createBridge(): Bridge {
  const vscode = acquireVsCodeApi();
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  const eventHandlers: Array<(name: string, payload: unknown) => void> = [];

  window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as
      | {
          kind: 'rpc-result';
          id: number;
          ok: boolean;
          value?: unknown;
          error?: string;
        }
      | { kind: 'event'; name: string; payload: unknown }
      | undefined;
    if (!msg) return;
    if (msg.kind === 'rpc-result') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error ?? 'RPC failed'));
    } else if (msg.kind === 'event') {
      for (const h of eventHandlers) h(msg.name, msg.payload);
    }
  });

  return {
    call<T>(method: string, ...args: unknown[]): Promise<T> {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        vscode.postMessage({ kind: 'rpc', id, method, args });
      });
    },
    onEvent(handler) {
      eventHandlers.push(handler);
    },
    onEvents<E extends object>(handlers: EventHandlers<E>) {
      eventHandlers.push((name, payload) => {
        if (!Object.hasOwn(handlers, name)) return;
        // The wire payload is untyped; `E` is the entry's declared contract.
        const handler = handlers[name as keyof E] as ((p: unknown) => void) | undefined;
        handler?.(payload);
      });
    },
    ready() {
      vscode.postMessage({ kind: 'ready' });
    },
  };
}

/** Render `element` into the page's `#root` container. */
export function mountApp(element: ReactElement): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('Webview entry is missing its #root element');
  createRoot(root).render(element);
}
