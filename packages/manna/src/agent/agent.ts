/* 에이전트 — 품은 화면 문서 안에서, 페이지 스크립트보다 먼저 돈다.
 * 하는 일: 시계 멈추기(일시정지), 앵커 요소 찾기와 위치 보고, 피커(요소·영역 잡기), 클릭 경로 기록과 재생, 단축키 전달.
 * 폴더 화면(srcdoc)과 URL 화면(webview) 모두 이 코드 하나를 쓴다. 단독 IIFE 로 빌드된다 (vite.agent.config.ts).
 *
 * 화면 안의 같은 출처 iframe(패키지 안 하위 페이지 등)도 엔트리 문서처럼 다룬다 — 피커는 iframe 안으로 내려가고,
 * 지문에는 거쳐 간 iframe 들을 적어(fp.frames) 다시 찾을 때 같은 길로 내려간다. 좌표는 늘 엔트리 뷰포트 기준.
 * 하위 문서의 shim 이 뜨자마자 hookChild 로 알려 오면 그 창에도 시계 · 마우스 잠금 · 클릭 기록 · 단축키 · 조작 표시를 건다.
 */
import type { Fingerprint, Region } from '@core';
import { fingerprint, resolve, styleProps, trailOf } from '@core';
import { pathLog, quickReveal, recordClick, replay, resetPath } from './path';
import type { AgentMsg, AnchorIn, HostMsg, Picked, RectTuple } from './protocol';

declare global {
  interface Window {
    __terrAgent?: boolean;
    __manna?: Record<string, unknown>;
  }
}

type Win = Window & typeof globalThis;

(function main() {
  if (window.__terrAgent) return;
  window.__terrAgent = true;

  const ROOT = document;
  const inFrame = window.parent !== window;
  const send = (m: AgentMsg) => {
    if (inFrame) window.parent.postMessage({ __terrAgent: m }, '*');
    else window.postMessage({ __terrAgent: m }, '*');
  };
  const nativeNow = performance.now.bind(performance);
  // 일시정지와 상관없이 도는 원래 rAF (시계를 걸기 전에 잡아 둔다)
  const nativeRaf = window.requestAnimationFrame.bind(window);

  /* ── 화면 안 iframe ─────────────────────────────────────────────────── */
  /** 그 문서를 품은 iframe — 엔트리 문서 밖으로는 나가지 않는다 */
  const frameOf = (doc: Document): Element | null => {
    if (doc === ROOT) return null;
    try {
      return doc.defaultView?.frameElement ?? null;
    } catch {
      return null;
    }
  };
  /** iframe 안 문서 — 다른 출처면 null */
  const innerDoc = (el: Element): Document | null => {
    if (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME') return null;
    try {
      return (el as HTMLIFrameElement).contentDocument;
    } catch {
      return null;
    }
  };
  /** 엔트리부터 그 문서까지 거치는 iframe 들 */
  const framesOf = (doc: Document): Element[] => {
    const out: Element[] = [];
    for (let d = doc, f = frameOf(d); f; d = f.ownerDocument, f = frameOf(d)) out.unshift(f);
    return out;
  };
  /** iframe 내용이 시작하는 자리 (그 iframe 이 있는 문서 좌표) */
  const contentOrigin = (f: Element) => {
    const r = f.getBoundingClientRect();
    const cs = (f.ownerDocument.defaultView ?? window).getComputedStyle(f);
    return { x: r.left + f.clientLeft + (parseFloat(cs.paddingLeft) || 0), y: r.top + f.clientTop + (parseFloat(cs.paddingTop) || 0) };
  };
  /** 그 문서 좌표에 더하면 엔트리 좌표 */
  const offsetOf = (doc: Document) => {
    let x = 0;
    let y = 0;
    for (const f of framesOf(doc)) {
      const o = contentOrigin(f);
      x += o.x;
      y += o.y;
    }
    return { x, y };
  };
  /** 요소 박스 — 엔트리 뷰포트 좌표 */
  const rectIn = (el: Element): DOMRect => {
    const r = el.getBoundingClientRect();
    if (el.ownerDocument === ROOT) return r;
    const o = offsetOf(el.ownerDocument);
    return new DOMRect(r.left + o.x, r.top + o.y, r.width, r.height);
  };
  const fpOf = (el: Element): Fingerprint => {
    const fp = fingerprint(el);
    const fr = framesOf(el.ownerDocument);
    return fr.length ? { ...fp, frames: fr.map((f) => fingerprint(f)) } : fp;
  };
  /** 지문으로 요소 찾기 — 적힌 iframe 들을 따라 내려간다 */
  const find = (fp: Fingerprint): Element | null => {
    let doc: Document | null = ROOT;
    for (const f of fp.frames ?? []) {
      const el: Element | undefined = resolve(doc, f)?.el;
      doc = el ? innerDoc(el) : null;
      if (!doc) return null;
    }
    return resolve(doc, fp)?.el ?? null;
  };
  /** 그 자리의 가장 안쪽 요소 — 같은 출처 iframe 이면 그 안으로 내려간다 */
  const deepAt = (x: number, y: number): Element | null => {
    let el = ROOT.elementFromPoint(x, y);
    let lx = x;
    let ly = y;
    while (el) {
      const inner = innerDoc(el);
      if (!inner) break;
      const o = contentOrigin(el);
      const sub = inner.elementFromPoint(lx - o.x, ly - o.y);
      if (!sub) break;
      lx -= o.x;
      ly -= o.y;
      el = sub;
    }
    return el;
  };
  /** 한 칸 위 — 하위 문서의 body 위는 그 문서를 품은 iframe */
  const up = (el: Element): Element | null => {
    const p = el.parentElement;
    if (p && p.tagName !== 'HTML') return p;
    return el.ownerDocument === ROOT ? p : frameOf(el.ownerDocument);
  };
  /** 요소가 든 문서들 — 엔트리부터 */
  const docsOf = (el: Element): Document[] => [ROOT, ...framesOf(el.ownerDocument).map((f) => innerDoc(f)!).filter(Boolean)];

  /* ── 시계 — 일시정지 (rAF 보류, performance.now·Date.now 정지, CSS 애니메이션 정지). 창(문서)마다 ── */
  interface Clock {
    pause(): void;
    resume(): void;
  }
  const installClock = (win: Win): Clock => {
    const perf = win.performance;
    const now = perf.now.bind(perf);
    const dateNow = win.Date.now;
    const raf = win.requestAnimationFrame.bind(win);
    const caf = win.cancelAnimationFrame.bind(win);
    let on = false;
    let pausedAt = 0;
    let offset = 0;
    let seq = 0;
    const pending: Record<number, number> = {};
    let held: [number, FrameRequestCallback][] = [];
    let frozen: Animation[] = [];
    perf.now = () => (on ? pausedAt : now()) - offset;
    win.Date.now = () => dateNow() - offset - (on ? now() - pausedAt : 0);
    const schedule = (id: number, cb: FrameRequestCallback) => {
      pending[id] = raf((ts) => {
        delete pending[id];
        if (on) held.push([id, cb]);
        else cb(ts - offset);
      });
    };
    win.requestAnimationFrame = (cb) => {
      const id = ++seq;
      if (on) held.push([id, cb]);
      else schedule(id, cb);
      return id;
    };
    win.cancelAnimationFrame = (id) => {
      if (pending[id] != null) {
        caf(pending[id]);
        delete pending[id];
      }
      held = held.filter((h) => h[0] !== id);
    };
    return {
      pause() {
        if (on) return;
        on = true;
        pausedAt = now();
        frozen = (win.document.getAnimations?.() ?? []).filter((a) => a.playState === 'running');
        frozen.forEach((a) => a.pause());
      },
      resume() {
        if (!on) return;
        offset += now() - pausedAt;
        on = false;
        const h = held;
        held = [];
        h.forEach(([id, cb]) => schedule(id, cb));
        frozen.forEach((a) => {
          try {
            a.play();
          } catch {
            /* 이미 끝난 애니메이션 */
          }
        });
        frozen = [];
      },
    };
  };

  /* ── 마우스 잠금 (Pointer Lock) — 품은 화면은 마우스를 잠그지 못한다.
   * 게임 엔진(Unity 등)이 커서를 잠그면 커서가 숨고 모든 클릭이 화면으로만 가서 탭 · 고르기 · Comment 를 쓸 수 없다.
   * Esc 로 풀면 곧바로 다시 잠그려다 브라우저가 거절하고, 화면이 그 오류를 창으로 띄운다.
   * 그래서 잠금 요청은 조용히 받아 넘긴다 (오류도 내지 않는다). 커서는 늘 테라리움 것 */
  const blockPointerLock = (win: Win) => {
    const proto = win.Element?.prototype;
    if (proto?.requestPointerLock) {
      proto.requestPointerLock = function () {
        return Promise.resolve();
      } as typeof proto.requestPointerLock;
    }
  };

  /** 이 화면의 창들 — 엔트리와, 알려 온(또는 찾아낸) 같은 출처 하위 창 */
  const wins = new Map<Document, { win: Win; clock: Clock }>();
  let paused = false;
  const live = () => {
    for (const [doc, w] of wins) {
      let alive = false;
      try {
        alive = w.win.document === doc;
      } catch {
        /* 닫힌 창 */
      }
      if (!alive) wins.delete(doc);
    }
    return wins;
  };
  const releaseLock = () => {
    for (const doc of live().keys()) if (doc.pointerLockElement) doc.exitPointerLock?.();
  };
  const pause = () => {
    if (paused) return;
    releaseLock();
    paused = true;
    for (const w of live().values()) w.clock.pause();
  };
  const resume = () => {
    if (!paused) return;
    paused = false;
    for (const w of live().values()) w.clock.resume();
  };

  wins.set(ROOT, { win: window as Win, clock: installClock(window as Win) });
  blockPointerLock(window as Win);

  /* ── 앵커 위치 — 매 프레임 계산해 바뀌었을 때만 보고 ─────────────────── */
  let anchors: AnchorIn[] = [];
  const cache = new Map<string, { el: Element | null; tried: number }>();
  const tones = new Map<string, number>();
  let lastSent = '';
  let lastTone = 0;
  let lastScan = 0;

  const visOpts = { opacityProperty: true, visibilityProperty: true };
  const checkVis = (el: Element) => {
    const cv = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
    return cv ? cv.call(el, visOpts) : true;
  };
  /** 보이는가 — 엔트리 뷰포트 안이고, 하위 문서면 품은 iframe 들도 보이고 그 안쪽에 있어야 */
  const shown = (el: Element, r: DOMRect) => {
    if (r.width <= 0 && r.height <= 0) return false;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
    if (!checkVis(el)) return false;
    for (const f of framesOf(el.ownerDocument)) {
      const fr = rectIn(f);
      if (r.right < fr.left || r.bottom < fr.top || r.left > fr.right || r.top > fr.bottom) return false;
      if (!checkVis(f)) return false;
    }
    return true;
  };
  const target = (el: Element, region?: Region) => {
    const r = rectIn(el);
    return region ? new DOMRect(r.left + region.x * r.width, r.top + region.y * r.height, region.w * r.width, region.h * r.height) : r;
  };

  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const parseRgb = (c: string) => {
    const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)/.exec(c);
    if (!m) return null;
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a];
  };
  /** 마커 자리 배경 밝기 0~1 — 캔버스는 픽셀을, 그 밖은 불투명한 배경색을 본다. iframe 이면 그 안쪽부터 */
  const backgroundAt = (x: number, y: number) => {
    const layers: [Document, number, number][] = [];
    let doc: Document = ROOT;
    let lx = x;
    let ly = y;
    for (;;) {
      layers.unshift([doc, lx, ly]);
      const el = doc.elementFromPoint(lx, ly);
      const inner = el && innerDoc(el);
      if (!el || !inner) break;
      const o = contentOrigin(el);
      lx -= o.x;
      ly -= o.y;
      doc = inner;
    }
    for (const [d, px, py] of layers) {
      for (const el of d.elementsFromPoint(px, py)) {
        if (innerDoc(el)) continue;
        if (el.tagName === 'CANVAS') {
          try {
            const cv = el as HTMLCanvasElement;
            const r = cv.getBoundingClientRect();
            const ctx = probe.getContext('2d', { willReadFrequently: true })!;
            ctx.clearRect(0, 0, 1, 1);
            ctx.drawImage(cv, ((px - r.left) / r.width) * cv.width, ((py - r.top) / r.height) * cv.height, 1, 1, 0, 0, 1, 1);
            const p = ctx.getImageData(0, 0, 1, 1).data;
            if (p[3] > 128) return lum(p[0], p[1], p[2]);
          } catch {
            /* 오염된 캔버스 */
          }
          continue;
        }
        const c = parseRgb((d.defaultView ?? window).getComputedStyle(el).backgroundColor);
        if (c && c[3] > 0.5) return lum(c[0], c[1], c[2]);
      }
    }
    return 1;
  };

  const tick = (t: number) => {
    nativeRaf(tick);
    // 알려 오지 않은 같은 출처 iframe 도 찾아 건다 (화면이 직접 만든 about:blank · srcdoc 등)
    if (t - lastScan > 500) {
      lastScan = t;
      for (const doc of [...live().keys()]) {
        for (const f of Array.from(doc.querySelectorAll('iframe, frame'))) {
          const inner = innerDoc(f);
          if (inner && !wins.has(inner) && inner.defaultView) hookChild(inner.defaultView as Win);
        }
      }
    }
    if (!document.body || !anchors.length) {
      if (lastSent !== '{}' && document.body) {
        lastSent = '{}';
        send({ type: 'frame', rects: {} });
      }
      return;
    }
    const sampleTone = t - lastTone > 500;
    if (sampleTone) lastTone = t;
    const rects: Record<string, RectTuple> = {};
    for (const a of anchors) {
      let c = cache.get(a.id);
      if (!c || (c.el && !c.el.isConnected) || (!c.el && t - c.tried > 600)) {
        c = { el: find(a.fp), tried: t };
        cache.set(a.id, c);
      }
      if (!c.el) continue;
      const r = target(c.el, a.region);
      const vis = shown(c.el, r);
      if (vis && sampleTone) tones.set(a.id, backgroundAt(Math.max(0, r.left), Math.max(0, r.top)) > 0.55 ? 0 : 1);
      rects[a.id] = [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width), Math.round(r.height), vis ? 1 : 0, tones.get(a.id) ?? 0];
    }
    const s = JSON.stringify(rects);
    if (s !== lastSent) {
      lastSent = s;
      send({ type: 'frame', rects });
    }
  };
  nativeRaf(tick);

  /* ── 피커 ─────────────────────────────────────────────────────────── */
  let picking = false;
  let stack: Element[] = [];

  const labelOf = (el: Element) => {
    const fp = fingerprint(el);
    return fp.id ? `${fp.tag}#${fp.id}` : fp.classes[0] ? `${fp.tag}.${fp.classes[0]}` : fp.tag;
  };
  const rectOf = (el: Element, region?: Region): [number, number, number, number] => {
    const r = target(el, region);
    return [r.left, r.top, r.width, r.height];
  };
  /** 대상의 HTML 조각 — 작으면 그대로, 크면 여는 태그 + 글자 일부 + 닫는 태그 */
  const snippetOf = (el: Element): string => {
    const full = el.outerHTML;
    if (full.length <= 700) return full;
    const open = full.slice(0, full.indexOf('>') + 1).slice(0, 400);
    const txt = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return `${open} … (자식 ${el.children.length}개${txt ? `, 글자: ${txt}` : ''}) … </${el.tagName.toLowerCase()}>`;
  };
  const pickedOf = (el: Element, region?: Region): Picked => ({
    html: snippetOf(el),
    fp: fpOf(el),
    ...(region ? { region } : {}),
    rect: rectOf(el, region),
    label: labelOf(el),
    trail: docsOf(el).flatMap((d) => trailOf(d)),
    props: styleProps(el),
    path: pathLog.map((p) => ({ ...p })),
  });
  const at = (x: number, y: number) => {
    const el = deepAt(x, y);
    if (!el) return document.body;
    return el === el.ownerDocument.documentElement ? (el.ownerDocument.body ?? el) : el;
  };
  /** 드래그 박스를 모두 품는 가장 깊은 요소 */
  const containerFor = (rect: DOMRect) => {
    let el: Element | null = deepAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
    while (el && el !== document.body) {
      const r = rectIn(el);
      if (r.left <= rect.left + 1 && r.top <= rect.top + 1 && r.right >= rect.right - 1 && r.bottom >= rect.bottom - 1) break;
      el = up(el);
    }
    return el ?? document.body;
  };

  const reply = (rid: number, data: unknown) => send({ type: 'reply', rid, data });

  /* ── 메시지 처리 ───────────────────────────────────────────────────── */
  const handle = async (m: HostMsg) => {
    switch (m.type) {
      case 'anchors':
        anchors = m.list;
        for (const id of [...cache.keys()]) if (!anchors.some((a) => a.id === id)) cache.delete(id);
        for (const a of anchors) cache.delete(a.id); // 지문이 바뀌었을 수 있다
        lastSent = '';
        return;
      case 'picking':
        picking = m.on;
        if (m.on) releaseLock();
        if (!m.on) stack = [];
        return;
      case 'trace':
        tracing = m.on;
        return;
      case 'pause':
        return pause();
      case 'resume':
        return resume();
      case 'hover': {
        const el = at(m.x, m.y);
        stack = [el];
        return reply(m.rid, { rect: rectOf(el), label: labelOf(el) });
      }
      case 'pick': {
        const top = stack[stack.length - 1];
        const el = top && top.isConnected ? top : at(m.x, m.y);
        stack = [el];
        return reply(m.rid, pickedOf(el));
      }
      case 'pickRect': {
        const rect = new DOMRect(m.x, m.y, m.w, m.h);
        const el = containerFor(rect);
        const r = rectIn(el);
        const region = r.width && r.height ? { x: (rect.left - r.left) / r.width, y: (rect.top - r.top) / r.height, w: rect.width / r.width, h: rect.height / r.height } : undefined;
        stack = [];
        return reply(m.rid, pickedOf(el, region));
      }
      case 'pickUp': {
        const top = stack[stack.length - 1];
        const parent = top ? up(top) : null;
        if (parent && parent.tagName !== 'HTML') stack.push(parent);
        const el = stack[stack.length - 1];
        return reply(m.rid, el ? pickedOf(el) : null);
      }
      case 'pickDown': {
        if (stack.length > 1) stack.pop();
        const el = stack[stack.length - 1];
        return reply(m.rid, el ? pickedOf(el) : null);
      }
      case 'reveal': {
        const visible = () => {
          const el = find(m.fp);
          return !!el && shown(el, target(el, m.region));
        };
        if (visible()) return reply(m.rid, { ok: true });
        resume();
        if (m.quick) {
          await quickReveal(find, m.steps);
          await new Promise((r) => setTimeout(r, 300));
          return reply(m.rid, { ok: visible() });
        }
        const done = await replay(find, m.steps, () => true);
        resetPath(m.steps);
        return reply(m.rid, { ok: done && visible() });
      }
      case 'setPath':
        return resetPath(m.steps);
    }
  };

  window.addEventListener('message', (e) => {
    const m = (e.data as { __terrHost?: HostMsg } | null)?.__terrHost;
    if (!m) return;
    if (inFrame && e.source !== window.parent) return;
    handle(m);
  });

  /* ── 창마다 거는 것 — 조작 표시 · 클릭 경로 · 단축키 ─────────────────── */
  let tracing = false;
  let lastMove = 0;
  const KEY_NAME: Record<string, string> = { ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' };
  const typing = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  };
  const listen = (win: Win, doc: Document) => {
    // 화면 녹화 중 포인터 · 키 — 좌표는 엔트리 기준으로
    const point = (ev: 'move' | 'down' | 'up') => (e: PointerEvent) => {
      if (!tracing) return;
      // 움직임은 자주 오므로 솎는다 (멈춤 시계와 상관없이 원래 시계로)
      const t = nativeNow();
      if (ev === 'move' && t - lastMove < 30) return;
      lastMove = t;
      const o = offsetOf(doc);
      send({ type: 'input', ev, x: e.clientX + o.x, y: e.clientY + o.y });
    };
    win.addEventListener('pointermove', point('move'), true);
    win.addEventListener('pointerdown', point('down'), true);
    win.addEventListener('pointerup', point('up'), true);
    win.addEventListener('keydown', (e) => {
      if (!tracing || /^(Control|Shift|Alt|Meta|CapsLock|Process|Unidentified)$/.test(e.key)) return;
      const t = e.target as Element | null;
      const secret = !!t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'password';
      const text = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (text) return send({ type: 'input', ev: 'key', x: 0, y: 0, key: secret ? '•' : e.key, text: true });
      if (e.repeat && e.key !== 'Backspace') return;
      const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
      const name = KEY_NAME[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
      send({ type: 'input', ev: 'key', x: 0, y: 0, key: [...mods, name].join('+') });
    }, true);

    // 클릭 경로 — 하위 문서 안의 클릭도 같은 경로에 (지문에 거쳐 간 iframe 이 적힌다)
    doc.addEventListener('click', (e) => !picking && recordClick(e, fpOf), true);

    // 단축키 — 하위 문서에 포커스가 있어도 Ctrl(피커) · Esc · 되돌리기가 테라리움에 닿는다
    const onKey = (phase: 'down' | 'up') => (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!(e.key === 'Control' || e.key === 'Meta' || e.key === 'Escape' || e.key === 'Delete' || mod)) return;
      const ty = typing(e);
      if (e.key === 'Delete' && (ty || phase === 'up')) return;
      if (phase === 'down' && mod && !ty && /^[szy]$/i.test(e.key)) e.preventDefault();
      send({ type: 'key', phase, key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey, alt: e.altKey, repeat: e.repeat, typing: ty });
    };
    win.addEventListener('keydown', onKey('down'), true);
    win.addEventListener('keyup', onKey('up'), true);
    if (doc === ROOT) {
      win.addEventListener('blur', () => send({ type: 'key', phase: 'up', key: 'Control', ctrl: false, shift: false, meta: false, alt: false, repeat: false, typing: false }));
    }
  };

  /** 하위 창 걸기 — 하위 문서의 shim 이 맨 먼저 부른다(화면 스크립트보다 앞). 그 아래 창도 이어 걸 수 있게 넘겨준다 */
  function hookChild(win: Win): void {
    let doc: Document;
    try {
      doc = win.document;
    } catch {
      return; // 다른 출처
    }
    if (!doc || doc === ROOT || wins.has(doc)) return;
    const clock = installClock(win);
    wins.set(doc, { win, clock });
    if (paused) clock.pause();
    blockPointerLock(win);
    listen(win, doc);
    try {
      win.__manna = Object.assign(win.__manna ?? {}, { hookChild });
    } catch {
      /* 무시 */
    }
  }

  listen(window as Win, ROOT);
  window.__manna = Object.assign(window.__manna ?? {}, { pause, resume, isPaused: () => paused, hookChild });

  /* 페이지를 다시 불러오지 않고 주소만 바뀌는 사이트(SPA) — 지금 주소를 알려 마커를 그 주소의 것만 붙이게 한다 */
  let lastUrl = location.href;
  const navCheck = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    send({ type: 'nav', url: lastUrl });
  };
  for (const k of ['pushState', 'replaceState'] as const) {
    const orig = history[k].bind(history);
    history[k] = ((...a: Parameters<History['pushState']>) => {
      orig(...a);
      setTimeout(navCheck, 0);
    }) as History['pushState'];
  }
  window.addEventListener('popstate', navCheck);
  window.addEventListener('hashchange', navCheck);

  const ready = () => send({ type: 'ready', url: location.href, title: document.title });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
