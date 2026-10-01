/* 스테이지 — 품은 화면 iframe, 마커, 요소 선택 (docs/ARCHITECTURE.md §4.2, §6.2, §6.3) */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Annotation, Region, Screen } from '@core';
import { displayNo, pkgPath, resolve } from '@core';
import {
  annotations, blobs, draft, hovered, misses, mode, paused, screen, selected, version, visible,
} from '../store';
import { STATUS_CLASS } from '../ui/labels';
import { prepareScreen } from './loader';

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
function containerFor(doc: Document, rect: DOMRect): Element {
  let el: Element | null = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  while (el && el !== doc.body) {
    const r = el.getBoundingClientRect();
    if (r.left <= rect.left + 1 && r.top <= rect.top + 1 && r.right >= rect.right - 1 && r.bottom >= rect.bottom - 1) break;
    el = el.parentElement;
  }
  return el ?? doc.body;
}

export function Stage({ empty }: { empty?: preact.ComponentChildren }) {
  const area = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const markers = useRef<HTMLDivElement>(null);
  const selBox = useRef<HTMLDivElement>(null);
  const pickBox = useRef<HTMLDivElement>(null);
  const dragBox = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>({ s: 1, ox: 0, oy: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  const v = version.value;
  const scr = screen.value;
  const list = annotations.value;
  const isAnnotate = mode.value === 'annotate';

  /* ── 크기 맞춤 ─────────────────────────────────────────────────────── */
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !v) return;
    const { w, h, fit: how } = v.viewport;
    const update = () => {
      const aw = el.clientWidth - PAD * 2;
      const ah = el.clientHeight - PAD * 2;
      const s = Math.max(0.1, Math.min(1, how === 'width' ? aw / w : Math.min(aw / w, ah / h)));
      setFit({ s, ox: Math.max(PAD, (el.clientWidth - w * s) / 2), oy: how === 'width' ? PAD : Math.max(PAD, (el.clientHeight - h * s) / 2) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [v]);

  /* ── 화면 불러오기 ──────────────────────────────────────────────────── */
  useEffect(() => {
    const f = frame.current;
    if (!v || !f) return;
    let alive = true;
    let dispose: (() => void) | undefined;
    setLoading(true);
    setError(null);
    setWarnings([]);
    paused.value = false;
    prepareScreen(v, blobs)
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
  }, [v]);

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

  /* ── 마커 추적 루프 ──────────────────────────────────────────────── */
  useEffect(() => {
    const cache = new Map<string, { el: Element | null; tried: number }>();
    let raf = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const f = frame.current;
      const d = f?.contentDocument;
      const layer = markers.current;
      if (!f || !d || !layer || !v || !d.body) return;
      const { s } = fitRef.current;
      const vw = v.viewport.w;
      const vh = v.viewport.h;
      const seen = new Set<string>();
      let selRect: DOMRect | null = null;
      for (const node of Array.from(layer.children) as HTMLElement[]) {
        const id = node.dataset.id!;
        const a = annotations.peek().find((x) => x.id === id);
        if (!a) continue;
        let c = cache.get(id);
        if (!c || (c.el && !c.el.isConnected) || (!c.el && t - c.tried > 600)) {
          c = { el: resolve(d, a.anchor.fp)?.el ?? null, tried: t };
          cache.set(id, c);
        }
        const r = c.el ? targetRect(c.el, a.anchor.region) : null;
        if (!c.el || !r || !isShown(c.el, r, vw, vh)) {
          node.style.display = 'none';
          continue;
        }
        seen.add(id);
        const x = Math.min(Math.max(r.left * s - MARK / 2, -MARK / 2), vw * s - MARK / 2);
        const y = Math.min(Math.max(r.top * s - MARK / 2, -MARK / 2), vh * s - MARK / 2);
        node.style.display = 'flex';
        node.style.transform = `translate(${x}px, ${y}px)`;
        if (id === selected.peek() || id === hovered.peek()) selRect = r;
      }
      place(selBox.current, selRect, s);
      const dr = draft.peek();
      if (dr && dr.el.isConnected) place(pickBox.current, targetRect(dr.el, dr.region), s);
      const prev = visible.peek();
      if (prev.size !== seen.size || [...seen].some((id) => !prev.has(id))) visible.value = seen;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v]);

  /* ── 요소 선택 (어노테이션 모드) ─────────────────────────────────── */
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
  };

  const onUp = (e: PointerEvent) => {
    const st = pick.current;
    const d = frame.current?.contentDocument;
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

  /* ↑ 부모 · ↓ 자식 · Esc 취소 — iframe 안에 포커스가 있어도 받는다.
     입력창 안에서는 Alt+↑/↓ 만 받는다 (작성 중인 어노테이션의 대상을 옮길 때). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode.peek() !== 'annotate') return;
      const tgt = e.target as HTMLElement | null;
      const typing = !!tgt && /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName) && tgt.ownerDocument === document;
      if (typing && !(e.altKey && /^Arrow(Up|Down)$/.test(e.key))) return;
      const st = pick.current;
      const dr = draft.peek();
      if (dr && !dr.region && st.stack[st.stack.length - 1] !== dr.el) st.stack = [dr.el];
      if (e.key === 'Escape') {
        if (dr) draft.value = null;
        else mode.value = 'view';
      } else if (e.key === 'ArrowUp') {
        const parent = st.stack[st.stack.length - 1]?.parentElement;
        if (parent && parent.tagName !== 'HTML') st.stack.push(parent);
      } else if (e.key === 'ArrowDown') {
        if (st.stack.length > 1) st.stack.pop();
      } else return;
      e.preventDefault();
      if (dr && !dr.region && e.key !== 'Escape') draft.value = { el: st.stack[st.stack.length - 1] };
      showPick();
    };
    window.addEventListener('keydown', onKey);
    const d = frame.current?.contentDocument;
    d?.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      d?.removeEventListener('keydown', onKey);
    };
  }, [loading]);

  useEffect(() => {
    if (!isAnnotate) {
      pick.current.stack = [];
      if (!draft.peek()) place(pickBox.current, null, 1);
    }
  }, [isAnnotate]);
  useEffect(() => {
    if (!draft.value) place(pickBox.current, null, 1);
  }, [draft.value]);

  if (!v || !scr) return <div class="stage stage-empty">{empty}</div>;

  const { w, h } = v.viewport;
  const frameStyle = { left: `${fit.ox}px`, top: `${fit.oy}px`, width: `${w * fit.s}px`, height: `${h * fit.s}px` };

  return (
    <div class={`stage ${v.viewport.fit === 'width' ? 'stage-scroll' : ''}`} ref={area}>
      <div class="stage-frame" style={frameStyle}>
        <iframe
          ref={frame}
          class="stage-iframe"
          title={`${scr.id} ${scr.title} v${v.v}`}
          style={{ width: `${w}px`, height: `${h}px`, transform: `scale(${fit.s})` }}
          onLoad={() => {
            if (!frame.current?.srcdoc) return;
            setLoading(false);
            if (paused.peek()) handle()?.pause();
          }}
        />
        {isAnnotate && (
          <div class="pick-layer" onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onWheel={onWheel}
            onPointerLeave={() => !pick.current.down && !draft.peek() && place(pickBox.current, null, 1)} />
        )}
        <div class="hl-box hl-sel" ref={selBox} />
        <div class="hl-box hl-pick" ref={pickBox} />
        <div class="hl-box hl-drag" ref={dragBox} />
        <div class="marker-layer" ref={markers}>
          {list.map((a) => <Marker key={a.id} a={a} scr={scr} />)}
        </div>
        {loading && !error && <div class="stage-note">화면을 펼치는 중…</div>}
        {paused.value && <div class="stage-badge">일시정지됨</div>}
      </div>
      {error && (
        <div class="stage-error" role="alert">
          <strong>화면을 열지 못했습니다.</strong>
          <span>{error}</span>
          <span>Bethlehem 에서 이 화면 버전을 다시 등록해 주세요.</span>
        </div>
      )}
      {(misses.value.length > 0 || warnings.length > 0) && <Diagnostics warnings={warnings} />}
    </div>
  );
}

function Marker({ a, scr }: { a: Annotation; scr: Screen }) {
  const sel = selected.value === a.id;
  return (
    <button
      type="button"
      data-id={a.id}
      class={`marker st-${STATUS_CLASS[a.status]} ${sel ? 'is-sel' : ''} ${a.kind === '이슈' ? 'is-issue' : ''}`}
      title={`${displayNo(scr, a)} · ${a.kind} · ${a.status}`}
      onClick={(e) => {
        e.stopPropagation();
        selected.value = sel ? null : a.id;
      }}
      onPointerEnter={() => (hovered.value = a.id)}
      onPointerLeave={() => (hovered.value = null)}
    >
      {displayNo(scr, a).replace(' ', '')}
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
              <p>조치: Bethlehem 에서 이 화면을 다시 등록할 때 위 파일을 포함해 주세요.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
