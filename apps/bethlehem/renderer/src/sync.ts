/* 여러 창 — 탭을 별도 창으로 빼기 · 복제 보기
 *
 * 본 창(main)만 작업 폴더에 쓴다. 본 창에서 띄운 창(mirror)은 시작할 때 본 창에서 문서를 받아 오고,
 * 어느 창에서 고치든 고친 문서를 BroadcastChannel 로 다른 창에 보낸다(같은 출처라 창끼리 바로 통한다).
 * 받은 창은 제자리에서 바꾼다. 본 창은 받은 고침을 자동 저장한다.
 */
import { effect } from '@preact/signals';
import type { EncodedBlob, MannaDoc } from '@core';
import type { Host } from '@manna/host';
import {
  applyRemoteDoc, blobs, detachedTabs, doc, loadDocument, openTabs, rev, saveState, screenId, selectScreen, tabPolicy, windowMode,
} from '@manna/store';

type Msg =
  | { t: 'hello'; from: string }
  | { t: 'state'; to: string; doc: MannaDoc; blobs: [string, EncodedBlob][] }
  | { t: 'doc'; from: string; doc: MannaDoc; blobs: [string, EncodedBlob][] }
  | { t: 'opened'; from: string; screen: string; detach: boolean }
  | { t: 'bye'; from: string; screen: string; detach: boolean }
  | { t: 'save'; from: string; saveAs: boolean };

const me = Math.random().toString(36).slice(2);
const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('terrarium-windows') : null;
const post = (m: Msg) => ch?.postMessage(m);

let applying = false;
/** 본 창: 띄운 창이 하나라도 생겼는가 — 없으면 보낼 일도 없다 */
let peers = false;
const sent = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** 이 창에서 고친 것을 다른 창으로 — 고침이 잦으면(타이핑) 잠깐 모아서 */
function broadcastSoon(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const fresh = [...blobs].filter(([sha]) => !sent.has(sha));
    for (const [sha] of fresh) sent.add(sha);
    post({ t: 'doc', from: me, doc: JSON.parse(JSON.stringify(doc.peek())), blobs: fresh });
  }, 150);
}

function applyIncoming(d: MannaDoc, entries: [string, EncodedBlob][]): void {
  if (doc.peek().id !== d.id) {
    // 본 창이 다른 문서를 열었다 — 띄운 창은 할 일이 끝났다
    if (windowMode.peek() === 'mirror') window.close();
    return;
  }
  for (const [sha] of entries) sent.add(sha);
  applying = true;
  try {
    applyRemoteDoc(d, entries, windowMode.peek() === 'main');
  } finally {
    applying = false;
  }
}

/** 뺀 탭을 본 창 탭 줄로 되돌린다 */
function giveBack(screen: string): void {
  if (!detachedTabs.peek().has(screen)) return;
  const next = new Set(detachedTabs.peek());
  next.delete(screen);
  detachedTabs.value = next;
}

/** 본 창 — 띄운 창이 문서를 달라고 하면 주고, 고침을 받아 들이고, 빼낸 탭을 잠시 줄에서 뺀다 */
export function startMainSync(save: (saveAs: boolean) => void): void {
  if (!ch) return;
  window.bethlehem.onScreenWindowClosed((o) => o.detach && giveBack(o.screen));
  ch.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data;
    if (m.t === 'hello') {
      peers = true;
      for (const sha of blobs.keys()) sent.add(sha);
      post({ t: 'state', to: m.from, doc: JSON.parse(JSON.stringify(doc.peek())), blobs: [...blobs] });
    }
    else if (m.t === 'doc' && m.from !== me) applyIncoming(m.doc, m.blobs);
    else if (m.t === 'opened' && m.detach) {
      detachedTabs.value = new Set([...detachedTabs.peek(), m.screen]);
      // 지금 보던 탭을 뺐으면 옆 탭으로
      if (screenId.peek() === m.screen) {
        const rest = openTabs.peek().filter((id) => !detachedTabs.peek().has(id));
        if (rest[0]) selectScreen(rest[0]);
      }
    } else if (m.t === 'bye' && m.detach) giveBack(m.screen);
    else if (m.t === 'save') save(m.saveAs);
  };
  let docId = doc.peek().id;
  effect(() => {
    rev.value;
    if (doc.peek().id !== docId) {
      docId = doc.peek().id;
      detachedTabs.value = new Set();
    }
    if (peers && !applying) broadcastSoon();
  });
}

/** 띄운 창 — 본 창에서 문서를 받아 그 화면만 보인다. 저장은 본 창이 한다 */
export function startMirror(screen: string, detach: boolean): Promise<void> {
  windowMode.value = 'mirror';
  tabPolicy.author = false;
  tabPolicy.persist = false;
  return new Promise((resolve) => {
    if (!ch) return resolve();
    ch.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.t === 'state' && m.to === me) {
        applying = true;
        try {
          loadDocument(m.doc, new Map(m.blobs), null);
        } finally {
          applying = false;
        }
        for (const [sha] of m.blobs) sent.add(sha);
        openTabs.value = [screen];
        selectScreen(screen);
        saveState.value = { kind: 'saved', message: '본 창이 저장합니다' };
        post({ t: 'opened', from: me, screen, detach });
        effect(() => {
          rev.value;
          if (!applying) broadcastSoon();
        });
        resolve();
      } else if (m.t === 'doc' && m.from !== me) applyIncoming(m.doc, m.blobs);
    };
    window.addEventListener('beforeunload', () => post({ t: 'bye', from: me, screen, detach }));
    post({ t: 'hello', from: me });
  });
}

/** 띄운 창의 저장 — 본 창에 맡긴다. 자동 저장은 고침을 본 창에 보내는 것으로 끝 */
export function mirrorHost(base: Host): Host {
  return {
    ...base,
    async autosave() {
      saveState.value = { kind: 'saved', at: Date.now(), message: '본 창이 저장합니다' };
    },
    async save(saveAs) {
      post({ t: 'save', from: me, saveAs });
      return true;
    },
  };
}
