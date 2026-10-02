/* 에이전트 — 품은 화면 문서 안에서, 페이지 스크립트보다 먼저 돈다.
 * 하는 일: 시계 멈추기(일시정지), 앵커 요소 찾기와 위치 보고, 피커(요소·영역 잡기), 클릭 경로 기록과 재생, 단축키 전달.
 * 폴더 화면(srcdoc)과 URL 화면(webview) 모두 이 코드 하나를 쓴다. 단독 IIFE 로 빌드된다 (vite.agent.config.ts).
 */
import type { Region } from '@core';
import { fingerprint, resolve, styleProps, trailOf } from '@core';
import { pathLog, quickReveal, recordClick, replay, resetPath } from './path';
import type { AgentMsg, AnchorIn, HostMsg, Picked, RectTuple } from './protocol';

declare global {
  interface Window {
    __terrAgent?: boolean;
    __manna?: Record<string, unknown>;
  }
}

(function main() {
  if (window.__terrAgent) return;
  window.__terrAgent = true;

  const inFrame = window.parent !== window;
  const send = (m: AgentMsg) => {
    if (inFrame) window.parent.postMessage({ __terrAgent: m }, '*');
    else window.postMessage({ __terrAgent: m }, '*');
  };

  /* ── 시계 — 일시정지 (rAF 보류, performance.now·Date.now 정지, CSS 애니메이션 정지) ── */
  const perf = window.performance;
  const nativeNow = perf.now.bind(perf);
  const nativeDateNow = Date.now;
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCaf = window.cancelAnimationFrame.bind(window);
  let paused = false;
  let pausedAt = 0;
  let offset = 0;
  let seq = 0;
  const pending: Record<number, number> = {};
  let held: [number, FrameRequestCallback][] = [];
  let frozen: Animation[] = [];

  perf.now = () => (paused ? pausedAt : nativeNow()) - offset;
  Date.now = () => nativeDateNow() - offset - (paused ? nativeNow() - pausedAt : 0);
  const schedule = (id: number, cb: FrameRequestCallback) => {
    pending[id] = nativeRaf((ts) => {
      delete pending[id];
      if (paused) held.push([id, cb]);
      else cb(ts - offset);
    });
  };
  window.requestAnimationFrame = (cb) => {
    const id = ++seq;
    if (paused) held.push([id, cb]);
    else schedule(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (pending[id] != null) {
      nativeCaf(pending[id]);
      delete pending[id];
    }
    held = held.filter((h) => h[0] !== id);
  };
  const pause = () => {
    if (paused) return;
    paused = true;
    pausedAt = nativeNow();
    frozen = (document.getAnimations?.() ?? []).filter((a) => a.playState === 'running');
    frozen.forEach((a) => a.pause());
  };
  const resume = () => {
    if (!paused) return;
    offset += nativeNow() - pausedAt;
    paused = false;
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
  };
  window.__manna = Object.assign(window.__manna ?? {}, { pause, resume, isPaused: () => paused });

  /* ── 앵커 위치 — 매 프레임 계산해 바뀌었을 때만 보고 ─────────────────── */
  let anchors: AnchorIn[] = [];
  const cache = new Map<string, { el: Element | null; tried: number }>();
  const tones = new Map<string, number>();
  let lastSent = '';
  let lastTone = 0;

  const shown = (el: Element, r: DOMRect) => {
    if (r.width <= 0 && r.height <= 0) return false;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
    const cv = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
    return cv ? cv.call(el, { opacityProperty: true, visibilityProperty: true }) : true;
  };
  const target = (el: Element, region?: Region) => {
    const r = el.getBoundingClientRect();
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
  /** 마커 자리 배경 밝기 0~1 — 캔버스는 픽셀을, 그 밖은 불투명한 배경색을 본다 */
  const backgroundAt = (x: number, y: number) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.tagName === 'CANVAS') {
        try {
          const cv = el as HTMLCanvasElement;
          const r = cv.getBoundingClientRect();
          const ctx = probe.getContext('2d', { willReadFrequently: true })!;
          ctx.clearRect(0, 0, 1, 1);
          ctx.drawImage(cv, ((x - r.left) / r.width) * cv.width, ((y - r.top) / r.height) * cv.height, 1, 1, 0, 0, 1, 1);
          const p = ctx.getImageData(0, 0, 1, 1).data;
          if (p[3] > 128) return lum(p[0], p[1], p[2]);
        } catch {
          /* 오염된 캔버스 */
        }
        continue;
      }
      const c = parseRgb(getComputedStyle(el).backgroundColor);
      if (c && c[3] > 0.5) return lum(c[0], c[1], c[2]);
    }
    return 1;
  };

  const tick = (t: number) => {
    nativeRaf(tick);
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
        c = { el: resolve(document, a.fp)?.el ?? null, tried: t };
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
  const pickedOf = (el: Element, region?: Region): Picked => ({
    fp: fingerprint(el),
    ...(region ? { region } : {}),
    rect: rectOf(el, region),
    label: labelOf(el),
    trail: trailOf(document),
    props: styleProps(el),
    path: pathLog.map((p) => ({ ...p })),
  });
  const at = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    return el && el !== document.documentElement ? el : document.body;
  };
  /** 드래그 박스를 모두 품는 가장 깊은 요소 */
  const containerFor = (rect: DOMRect) => {
    let el: Element | null = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (r.left <= rect.left + 1 && r.top <= rect.top + 1 && r.right >= rect.right - 1 && r.bottom >= rect.bottom - 1) break;
      el = el.parentElement;
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
        if (!m.on) stack = [];
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
        const r = el.getBoundingClientRect();
        const region = r.width && r.height ? { x: (rect.left - r.left) / r.width, y: (rect.top - r.top) / r.height, w: rect.width / r.width, h: rect.height / r.height } : undefined;
        stack = [];
        return reply(m.rid, pickedOf(el, region));
      }
      case 'pickUp': {
        const parent = stack[stack.length - 1]?.parentElement;
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
          const el = resolve(document, m.fp)?.el;
          return !!el && shown(el, target(el, m.region));
        };
        if (visible()) return reply(m.rid, { ok: true });
        resume();
        if (m.quick) {
          await quickReveal(document, m.steps);
          await new Promise((r) => setTimeout(r, 300));
          return reply(m.rid, { ok: visible() });
        }
        const done = await replay(document, m.steps, () => true);
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

  /* ── 클릭 경로 · 단축키 ─────────────────────────────────────────────── */
  document.addEventListener('click', (e) => !picking && recordClick(e), true);

  const typing = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  };
  const onKey = (phase: 'down' | 'up') => (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!(e.key === 'Control' || e.key === 'Meta' || e.key === 'Escape' || e.key === 'Delete' || mod)) return;
    const ty = typing(e);
    if (e.key === 'Delete' && (ty || phase === 'up')) return;
    if (phase === 'down' && mod && !ty && /^[szy]$/i.test(e.key)) e.preventDefault();
    send({ type: 'key', phase, key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey, alt: e.altKey, repeat: e.repeat, typing: ty });
  };
  window.addEventListener('keydown', onKey('down'), true);
  window.addEventListener('keyup', onKey('up'), true);
  window.addEventListener('blur', () => send({ type: 'key', phase: 'up', key: 'Control', ctrl: false, shift: false, meta: false, alt: false, repeat: false, typing: false }));

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
