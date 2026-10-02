/* 스테이지 쪽 다리 — 품은 화면 안의 에이전트와 메시지를 주고받는다 (agent/protocol.ts) */
import type { AgentMsg, HostMsg } from '../agent/protocol';

type Listener = (m: AgentMsg) => void;

/** 요청 번호를 붙여 보내고 같은 번호의 답을 기다린다 */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Ask = <T>(m: DistOmit<Extract<HostMsg, { rid: number }>, 'rid'>, timeout?: number) => Promise<T | null>;

export interface Bridge {
  send(m: HostMsg): void;
  ask: Ask;
  on(fn: Listener): () => void;
  dispose(): void;
}

function make(post: (m: HostMsg) => void, subscribe: (fn: (m: AgentMsg) => void) => () => void): Bridge {
  const listeners = new Set<Listener>();
  const waiting = new Map<number, (v: unknown) => void>();
  let rid = 0;
  const off = subscribe((m) => {
    if (m.type === 'reply') {
      waiting.get(m.rid)?.(m.data);
      waiting.delete(m.rid);
      return;
    }
    listeners.forEach((fn) => fn(m));
  });
  return {
    send: post,
    ask(m, timeout = 15000) {
      const id = ++rid;
      return new Promise((done) => {
        const t = setTimeout(() => {
          waiting.delete(id);
          done(null);
        }, timeout);
        waiting.set(id, (v) => {
          clearTimeout(t);
          done(v as never);
        });
        post({ ...m, rid: id } as HostMsg);
      });
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      off();
      listeners.clear();
      waiting.forEach((w) => w(null));
      waiting.clear();
    },
  };
}

export function iframeBridge(frame: HTMLIFrameElement): Bridge {
  return make(
    (m) => frame.contentWindow?.postMessage({ __terrHost: m }, '*'),
    (fn) => {
      const h = (e: MessageEvent) => {
        const m = (e.data as { __terrAgent?: AgentMsg } | null)?.__terrAgent;
        if (m && e.source === frame.contentWindow) fn(m);
      };
      window.addEventListener('message', h);
      return () => window.removeEventListener('message', h);
    },
  );
}

/** Electron <webview> — preload 가 에이전트와 사이를 잇는다 */
export interface WebviewLike extends HTMLElement {
  send(channel: string, ...args: unknown[]): void;
}

export function webviewBridge(view: WebviewLike): Bridge {
  let ready = false;
  const queue: HostMsg[] = [];
  view.addEventListener('dom-ready', () => {
    ready = true;
    queue.splice(0).forEach((m) => view.send('terr', m));
  });
  return make(
    (m) => {
      try {
        if (ready) view.send('terr', m);
        else queue.push(m);
      } catch {
        queue.push(m);
      }
    },
    (fn) => {
      const h = (e: Event) => {
        const ev = e as Event & { channel: string; args: unknown[] };
        if (ev.channel === 'terr') fn(ev.args[0] as AgentMsg);
      };
      view.addEventListener('ipc-message', h);
      return () => view.removeEventListener('ipc-message', h);
    },
  );
}
