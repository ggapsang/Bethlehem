/* 스테이지 — 품은 화면 iframe, 마커, 요소 선택 (docs/ARCHITECTURE.md §4.2, §6.2, §6.3) */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Annotation, Region, Screen } from '@core';
import { displayNo, pkgPath, resolve } from '@core';
import { isTyping, onKeyDown, onKeyUp } from '../keys';
import {
  annotations, blobs, doc, draft, rev, holdPick, hovered, misses, paused, picking, recording, reveal, revealing,
  screen, selected, stageRef, version, versionKey, visible,
} from '../store';
import { prepareScreen } from './loader';
import { quickReveal, recordClick, replay, resetPath } from './path';

interface Fit {
  s: number;
  ox: number;
  oy: number;
}

interface MannaHandle {
  pause(): void;
  resume(): void;
}

const MARK = 24; // 마커 지름 (unit-6)
const PAD = 24;

/** 대상 요소(와 영역)의 iframe 뷰포트 좌표 */
function targetRect(el: Element, region?: Region): DOMRect {
  const r = el.getBoundingClientRect();
  if (!region) return r;
  return new DOMRect(r.left + region.x * r.width, r.top + region.y * r.height, region.w * r.width, region.h * r.height);
}

function isShown(el: Element, r: DOMRect, vw: number, vh: number): boolean {
  if (r.width <= 0 && r.height <= 0) return false;
  if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) return false;
  const cv = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  return cv ? cv.call(el, { opacityProperty: true, visibilityProperty: true }) : true;
}

function place(box: HTMLElement | null, r: DOMRect | null, s: number): void {
  if (!box) return;
  if (!r) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  box.style.transform = `translate(${r.left * s}px, ${r.top * s}px)`;
  box.style.width = `${Math.max(2, r.width * s)}px`;
  box.style.height = `${Math.max(2, r.height * s)}px`;
}

/** 드래그 박스를 모두 품는 가장 깊은 요소 */
function containerFor(d: Document, rect: DOMRect): Element {
  let el: Element | null = d.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  while (el && el !== d.body) {
    const r = el.getBoundingClientRect();
    if (r.left <= rect.left + 1 && r.top <= rect.top + 1 && r.right >= rect.right - 1 && r.bottom >= rect.bottom - 1) break;
    el = el.parentElement;
  }
  return el ?? d.body;
}

/* ── 마커 아래 배경 밝기 — 마커 색을 자동으로 고르는 근거 (0 어두움 ~ 1 밝음) ── */
const probe = typeof document !== 'undefined' ? document.createElement('canvas') : null;
if (probe) probe.width = probe.height = 1;

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function parseRgb(c: string): [number, number, number, number] | null {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)/.exec(c);
  if (!m) return null;
  const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [+m[1], +m[2], +m[3], a];
}

function backgroundAt(d: Document, x: number, y: number): number {
  for (const el of d.elementsFromPoint(x, y)) {
    if (el.tagName === 'CANVAS' && probe) {
      try {
        const cv = el as HTMLCanvasElement;
        const r = cv.getBoundingClientRect();
        const ctx = probe.getContext('2d', { willReadFrequently: true })!;
        ctx.clearRect(0, 0, 1, 1);
        ctx.drawImage(cv, ((x - r.left) / r.width) * cv.width, ((y - r.top) / r.height) * cv.height, 1, 1, 0, 0, 1, 1);
        const p = ctx.getImageData(0, 0, 1, 1).data;
        if (p[3] > 128) return luminance(p[0], p[1], p[2]);
      } catch {
        /* 다른 출처 이미지로 오염된 캔버스 */
      }
      continue;
    }
    const c = parseRgb(d.defaultView!.getComputedStyle(el).backgroundColor);
    if (c && c[3] > 0.5) return luminance(c[0], c[1], c[2]);
  }
  return 1;
}

export function Stage({ empty }: { empty?: preact.ComponentChildren }) {
  const area = useRef<HTMLDivElement>(null);
  const frameBox = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const markers = useRef<HTMLDivElement>(null);
  const selBox = useRef<HTMLDivElement>(null);
  const pickBox = useRef<HTMLDivElement>(null);
  const dragBox = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>({ s: 1, ox: 0, oy: 0 });
  const [loading, setLoading] = useState(false);
  const [loadNo, setLoadNo] = useState(0);
  const [reloadNo, setReloadNo] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const onLoaded = useRef<(() => void) | null>(null);

  const v = version.value;
  const vkey = versionKey.value;
  const scr = screen.value;
  const list = annotations.value;
  const isPicking = picking.value || dragging;
  const markerColor = doc.value.meta.marker ?? 'auto';

  /* ── 크기 맞춤 ─────────────────────────────────────────────────────── */
  const vw = v?.viewport.w ?? 0;
  const vh = v?.viewport.h ?? 0;
  const vfit = v?.viewport.fit ?? 'contain';
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !vw) return;
    const update = () => {
      const aw = el.clientWidth - PAD * 2;
      const ah = el.clientHeight - PAD * 2;
      const s = Math.max(0.1, Math.min(1, vfit === 'width' ? aw / vw : Math.min(aw / vw, ah / vh)));
      setFit({ s, ox: Math.max(PAD, (el.clientWidth - vw * s) / 2), oy: vfit === 'width' ? PAD : Math.max(PAD, (el.clientHeight - vh * s) / 2) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vw, vh, vfit, !!scr]);

  useEffect(() => {
    stageRef.frame = frameBox.current;
  });

  /* ── 화면 불러오기 (버전이 바뀌거나 다시 불러오기를 요청했을 때만) ───── */
  useEffect(() => {
    const f = frame.current;
    const ver = version.peek();
    if (!ver || !f) return;
    let alive = true;
    let dispose: (() => void) | undefined;
    setLoading(true);
    setError(null);
    setWarnings([]);
    paused.value = false;
    resetPath();
    prepareScreen(ver, blobs)
      .then((p) => {
        if (!alive) return p.dispose();
        dispose = p.dispose;
        setWarnings(p.warnings);
        f.srcdoc = p.srcdoc;
      })
      .catch((e: Error) => {
        setLoading(false);
        setError(e.message);
      });
    return () => {
      alive = false;
      dispose?.();
      f.removeAttribute('srcdoc');
    };
  }, [vkey, reloadNo]);

  /* ── 품은 화면 안의 이벤트 — 단축키, 클릭 경로 ───────────────────────── */
  useEffect(() => {
    const d = frame.current?.contentDocument;
    if (!d || loading) return;
    const down = (e: KeyboardEvent) => onKeyDown(e, true);
    const click = (e: MouseEvent) => !picking.peek() && recordClick(e);
    d.addEventListener('keydown', down);
    d.addEventListener('keyup', onKeyUp);
    d.addEventListener('click', click, true);
    return () => {
      d.removeEventListener('keydown', down);
      d.removeEventListener('keyup', onKeyUp);
      d.removeEventListener('click', click, true);
    };
  }, [loading, loadNo]);

  /* ── 찾지 못한 파일 보고 (shim → postMessage) ──────────────────────── */
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.manna !== 'miss') return;
      misses.value = [...misses.value, { url: pkgPath(String(e.data.url)) }];
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  /* ── 일시정지 ─────────────────────────────────────────────────────── */
  const handle = () => (frame.current?.contentWindow as (Window & { __manna?: MannaHandle }) | null)?.__manna;
  useEffect(() => {
    const h = handle();
    if (h) paused.value ? h.pause() : h.resume();
  }, [paused.value]);

  /* ── 다른 화면 상태의 Comment 로 이동 ─────────────────────────────── */
  useEffect(() => {
    const req = reveal.value;
    if (!req) return;
    const a = annotations.peek().find((x) => x.id === req.id);
    const d = frame.current?.contentDocument;
    if (!a?.anchor || !d || loading) return;
    const anchor = a.anchor;
    let alive = true;
    const isVisible = () => {
      const el = resolve(frame.current!.contentDocument!, anchor.fp)?.el;
      return !!el && isShown(el, targetRect(el, anchor.region), vw, vh);
    };
    if (isVisible()) return;
    const steps = anchor.path ?? [];
    revealing.value = true;
    paused.value = false;
    (async () => {
      await quickReveal(d, steps);
      await new Promise((r) => setTimeout(r, 300));
      if (!alive || isVisible()) return;
      // 빠른 길로 안 되면 처음부터 다시 불러와 경로를 다시 누른다
      await new Promise<void>((done) => {
        onLoaded.current = done;
        setReloadNo((n) => n + 1);
      });
      const fresh = frame.current?.contentDocument;
      if (!alive || !fresh) return;
      await replay(fresh, steps, () => alive);
      resetPath(steps);
    })().finally(() => {
      if (alive) revealing.value = false;
    });
    return () => {
      alive = false;
      revealing.value = false;
    };
  }, [reveal.value]);

  /* ── 마커 추적 루프 ──────────────────────────────────────────────── */
  useEffect(() => {
    // 지문으로 찾은 요소 — 화면을 다시 불러오면 옛 문서의 요소도 isConnected 가 참이므로, 문서가 바뀌면 통째로 버린다
    const cache = new Map<string, { el: Element | null; tried: number }>();
    let cachedDoc: Document | null = null;
    let raf = 0;
    let lastTone = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const f = frame.current;
      const d = f?.contentDocument;
      const layer = markers.current;
      if (!f || !d || !layer || !d.body || !vw) return;
      if (d !== cachedDoc) {
        cache.clear();
        cachedDoc = d;
      }
      const { s } = fitRef.current;
      const seen = new Set<string>();
      let selRect: DOMRect | null = null;
      const tone = t - lastTone > 500;
      if (tone) lastTone = t;
      const list = annotations.peek();
      for (const node of Array.from(layer.children) as HTMLElement[]) {
        const a = list.find((x) => x.id === node.dataset.id);
        if (!a?.anchor) continue;
        let c = cache.get(a.id);
        if (!c || (c.el && !c.el.isConnected) || (!c.el && t - c.tried > 600)) {
          c = { el: resolve(d, a.anchor.fp)?.el ?? null, tried: t };
          cache.set(a.id, c);
        }
        const r = c.el ? targetRect(c.el, a.anchor.region) : null;
        if (!c.el || !r || !isShown(c.el, r, vw, vh)) {
          node.style.display = 'none';
          continue;
        }
        seen.add(a.id);
        const x = Math.min(Math.max(r.left * s - MARK / 2, -MARK / 2), vw * s - MARK / 2);
        const y = Math.min(Math.max(r.top * s - MARK / 2, -MARK / 2), vh * s - MARK / 2);
        node.style.display = 'flex';
        node.style.transform = `translate(${x}px, ${y}px)`;
        if (tone) node.dataset.tone = backgroundAt(d, Math.max(0, r.left), Math.max(0, r.top)) > 0.55 ? 'onlight' : 'ondark';
        if (a.id === selected.peek() || a.id === hovered.peek()) selRect = r;
      }
      place(selBox.current, selRect, s);
      const dr = draft.peek();
      if (dr && dr.el.isConnected) place(pickBox.current, targetRect(dr.el, dr.region), s);
      const prev = visible.peek();
      if (prev.size !== seen.size || [...seen].some((id) => !prev.has(id))) visible.value = seen;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [vkey, vw, vh]);

  /* ── 요소 선택 (피커) ─────────────────────────────────────────────── */
  const pick = useRef<{ stack: Element[]; down: { x: number; y: number } | null; dragging: boolean }>({ stack: [], down: null, dragging: false });

  const local = (e: PointerEvent | MouseEvent) => {
    const r = frame.current!.getBoundingClientRect();
    const { s } = fitRef.current;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };

  const showPick = () => {
    const top = pick.current.stack[pick.current.stack.length - 1];
    if (!draft.peek()) place(pickBox.current, top ? top.getBoundingClientRect() : null, fitRef.current.s);
  };

  const onMove = (e: PointerEvent) => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    const p = local(e);
    const st = pick.current;
    if (st.down) {
      const dx = p.x - st.down.x;
      const dy = p.y - st.down.y;
      if (!st.dragging && Math.hypot(dx, dy) * fitRef.current.s > 4) st.dragging = true;
      if (st.dragging) {
        place(dragBox.current, new DOMRect(Math.min(p.x, st.down.x), Math.min(p.y, st.down.y), Math.abs(dx), Math.abs(dy)), fitRef.current.s);
      }
      return;
    }
    const el = d.elementFromPoint(p.x, p.y);
    if (el && el !== d.documentElement && el !== st.stack[0]) {
      st.stack = [el];
      showPick();
    }
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pick.current.down = local(e);
    pick.current.dragging = false;
    setDragging(true);
  };

  const onUp = (e: PointerEvent) => {
    const st = pick.current;
    const d = frame.current?.contentDocument;
    setDragging(false);
    if (!st.down || !d) return;
    const p = local(e);
    if (st.dragging) {
      const rect = new DOMRect(Math.min(p.x, st.down.x), Math.min(p.y, st.down.y), Math.abs(p.x - st.down.x), Math.abs(p.y - st.down.y));
      const el = containerFor(d, rect);
      const r = el.getBoundingClientRect();
      const region = r.width && r.height
        ? { x: (rect.left - r.left) / r.width, y: (rect.top - r.top) / r.height, w: rect.width / r.width, h: rect.height / r.height }
        : undefined;
      draft.value = { el, region };
    } else {
      const el = st.stack[st.stack.length - 1] ?? d.elementFromPoint(p.x, p.y);
      if (el) draft.value = { el };
    }
    place(dragBox.current, null, 1);
    st.down = null;
    st.dragging = false;
  };

  const onWheel = (e: WheelEvent) => frame.current?.contentWindow?.scrollBy(e.deltaX, e.deltaY);

  /* ↑ 부모 · ↓ 자식 — 피커 중에. 작성 창에 글을 쓰는 중에는 Alt+↑/↓ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!/^Arrow(Up|Down)$/.test(e.key)) return;
      const dr = draft.peek();
      if (!picking.peek() && !dr) return;
      if (isTyping(e) && !e.altKey) return;
      const st = pick.current;
      if (dr && !dr.region && st.stack[st.stack.length - 1] !== dr.el) st.stack = [dr.el];
      if (e.key === 'ArrowUp') {
        const parent = st.stack[st.stack.length - 1]?.parentElement;
        if (parent && parent.tagName !== 'HTML') st.stack.push(parent);
      } else if (st.stack.length > 1) st.stack.pop();
      e.preventDefault();
      if (dr && !dr.region) draft.value = { el: st.stack[st.stack.length - 1] };
      showPick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!isPicking) {
      pick.current.stack = [];
      if (!draft.peek()) place(pickBox.current, null, 1);
    }
  }, [isPicking]);
  useEffect(() => {
    if (!draft.value) place(pickBox.current, null, 1);
  }, [draft.value]);

  if (!v || !scr) return <div class="stage stage-empty">{empty}</div>;

  const frameStyle = { left: `${fit.ox}px`, top: `${fit.oy}px`, width: `${vw * fit.s}px`, height: `${vh * fit.s}px` };

  return (
    <div class={`stage ${vfit === 'width' ? 'stage-scroll' : ''}`} ref={area}>
      <div class={`stage-frame ${recording.value ? 'is-recording' : ''}`} style={frameStyle} ref={frameBox}>
        <iframe
          ref={frame}
          class="stage-iframe"
          title={`${scr.id} ${scr.title} v${v.v}`}
          style={{ width: `${vw}px`, height: `${vh}px`, transform: `scale(${fit.s})` }}
          onLoad={() => {
            if (!frame.current?.srcdoc) return;
            setLoading(false);
            setLoadNo((n) => n + 1);
            if (paused.peek()) handle()?.pause();
            onLoaded.current?.();
            onLoaded.current = null;
          }}
        />
        {isPicking && (
          <div class="pick-layer" onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onWheel={onWheel}
            onPointerLeave={() => !pick.current.down && !draft.peek() && place(pickBox.current, null, 1)} />
        )}
        <div class="hl-box hl-sel" ref={selBox} />
        <div class="hl-box hl-pick" ref={pickBox} />
        <div class="hl-box hl-drag" ref={dragBox} />
        <div class="marker-layer" ref={markers} data-color={markerColor}>
          {list.filter((a) => a.anchor).map((a) => <Marker key={a.id} a={a} scr={scr} />)}
        </div>
        {loading && !error && <div class="stage-note">화면을 펼치는 중…</div>}
        {revealing.value && <div class="stage-note">Comment 가 있는 화면 상태로 이동하는 중…</div>}
        {paused.value && !recording.value && <div class="stage-badge">일시정지됨</div>}
        {holdPick.value && <div class="stage-badge stage-badge-pick">피커 — 클릭하거나 드래그하세요</div>}
      </div>
      {error && (
        <div class="stage-error" role="alert">
          <strong>화면을 열지 못했습니다.</strong>
          <span>{error}</span>
          <span>테라리움에서 이 화면 버전을 다시 등록해 주세요.</span>
        </div>
      )}
      {(misses.value.length > 0 || warnings.length > 0) && <Diagnostics warnings={warnings} />}
    </div>
  );
}

function Marker({ a, scr }: { a: Annotation; scr: Screen }) {
  rev.value; // 순서가 바뀌면 번호도 바뀐다
  const sel = selected.value === a.id;
  return (
    <button
      type="button"
      data-id={a.id}
      class={`marker ${sel ? 'is-sel' : ''}`}
      title={`${displayNo(scr, a)} · ${a.author}`}
      onClick={(e) => {
        e.stopPropagation();
        selected.value = sel ? null : a.id;
      }}
      onPointerEnter={() => (hovered.value = a.id)}
      onPointerLeave={() => (hovered.value = null)}
    >
      {displayNo(scr, a)}
    </button>
  );
}

function Diagnostics({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false);
  const m = misses.value;
  return (
    <div class="stage-diag" role="status">
      <button type="button" class="diag-head" onClick={() => setOpen(!open)}>
        {m.length > 0 ? `화면이 파일 ${m.length}개를 찾지 못했습니다` : warnings[0]}
        <span class="diag-more">{open ? '접기' : '자세히'}</span>
      </button>
      {open && (
        <div class="diag-body">
          {warnings.map((w) => <p key={w}>{w}</p>)}
          {m.length > 0 && (
            <>
              <p>원인: 화면이 실행 중에 요청한 파일이 문서에 담겨 있지 않습니다.</p>
              <ul>{m.map((x) => <li key={x.url}><code>{x.url}</code></li>)}</ul>
              <p>조치: 테라리움에서 이 화면을 다시 등록할 때 위 파일을 포함해 주세요.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

