/* 사용자 가이드 — 프로그램 안에 떠 있는 창. 보통 창처럼 다룬다:
 *   제목줄을 끌어 옮기기 · 가장자리 · 모서리 8곳 어디든 끌어 크기 바꾸기 · 최대화(단추나 제목줄 더블클릭)
 *   글자 크기 − / + (Ctrl+휠, Ctrl+= / Ctrl+-). 자리와 크기는 기억한다. 마크다운을 그려서 보인다
 */
import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { marked } from 'marked';
import { Maximize2, Minimize2, Minus, Plus, X } from 'lucide-preact';
import guideMd from '../../../../docs/USER_GUIDE.md?raw';

export const guideOpen = signal(false);

const ICON = { size: 16, strokeWidth: 1.5 };
const FONT_KEY = 'terr.guideFont';
const RECT_KEY = 'terr.guideRect';
const MIN_W = 360;
const MIN_H = 220;

type Rect = { x: number; y: number; w: number; h: number };
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const load = <T,>(k: string, fb: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
};
const store = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* 기억하지 못해도 된다 */
  }
};

/** 창 안에 들어오게 — 제목줄은 늘 잡을 수 있게 남긴다 */
function clampRect(r: Rect): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(MIN_W, r.w), vw);
  const h = Math.min(Math.max(MIN_H, r.h), vh);
  return { w, h, x: Math.min(Math.max(-w + 120, r.x), vw - 120), y: Math.min(Math.max(0, r.y), vh - 40) };
}

const defaultRect = (): Rect => {
  const w = Math.min(760, window.innerWidth - 48);
  return { x: Math.max(24, window.innerWidth - w - 48), y: 72, w, h: Math.min(820, Math.round(window.innerHeight * 0.8)) };
};

export function GuideWindow() {
  const [font, setFont] = useState(() => Math.min(24, Math.max(11, load<number>(FONT_KEY, 14))));
  const [rect, setRect] = useState<Rect>(() => clampRect(load<Rect>(RECT_KEY, defaultRect())));
  const [maxed, setMaxed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const html = useMemo(() => marked.parse(guideMd, { async: false, gfm: true }) as string, []);

  useEffect(() => store(FONT_KEY, font), [font]);
  useEffect(() => store(RECT_KEY, rect), [rect]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!box.current?.contains(document.activeElement)) return;
      if (e.key === 'Escape') guideOpen.value = false;
      // 가이드 안에서는 Ctrl+= / Ctrl+- 가 화면 배율이 아니라 글자 크기
      if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.key === '-')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setFont((f) => Math.min(24, Math.max(11, f + (e.key === '-' ? -1 : 1))));
      }
    };
    window.addEventListener('keydown', onKey, true);
    // 테라리움 창 크기가 바뀌면 안쪽으로 다시 맞춘다
    const onResize = () => setRect((r) => clampRect(r));
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  /** 끄는 동안 — iframe · webview 가 포인터를 가져가지 않게 막는다 */
  const track = (e: PointerEvent, cursor: string, onMove: (dx: number, dy: number) => void) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    document.body.classList.add('is-moving');
    document.body.style.cursor = cursor;
    const move = (ev: PointerEvent) => onMove(ev.clientX - x0, ev.clientY - y0);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.classList.remove('is-moving');
      document.body.style.cursor = '';
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  /* 제목줄 — 끌어 옮기기 (최대화 중이면 풀면서 잡은 자리 그대로) */
  const onHead = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    let start = rect;
    let wasMax = maxed;
    const grabX = e.clientX;
    track(e, 'move', (dx, dy) => {
      // 최대화 중이면 실제로 끌기 시작할 때 풀고, 잡은 자리 그대로 따라온다 (두 번 누르기는 그대로 둔다)
      if (wasMax) {
        if (Math.hypot(dx, dy) < 5) return;
        wasMax = false;
        start = { ...rect, x: grabX - rect.w * (grabX / window.innerWidth), y: 0 };
        setMaxed(false);
      }
      setRect(clampRect({ ...start, x: start.x + dx, y: start.y + dy }));
    });
  };

  /* 가장자리 · 모서리 — 그쪽으로 늘이고 줄인다 */
  const onEdge = (edge: Edge) => (e: PointerEvent) => {
    if (maxed) return;
    const s = rect;
    track(e, `${edge}-resize`, (dx, dy) => {
      let { x, y, w, h } = s;
      if (edge.includes('e')) w = s.w + dx;
      if (edge.includes('s')) h = s.h + dy;
      if (edge.includes('w')) {
        w = Math.max(MIN_W, s.w - dx);
        x = s.x + (s.w - w);
      }
      if (edge.includes('n')) {
        h = Math.max(MIN_H, s.h - dy);
        y = s.y + (s.h - h);
      }
      setRect(clampRect({ x, y, w, h }));
    });
  };

  /* Ctrl+휠 — 글자 크기 */
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setFont((f) => Math.min(24, Math.max(11, f + (e.deltaY < 0 ? 1 : -1))));
  };

  /* 본문의 링크 — 바깥 주소는 브라우저로, 문서 안 링크(다른 .md)는 막는다 */
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    if (/^https?:/.test(href)) window.open(href);
    else if (href.startsWith('#')) box.current?.querySelector(`[id="${decodeURIComponent(href.slice(1))}"]`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const style = maxed
    ? { left: '0px', top: '0px', width: '100vw', height: '100vh' }
    : { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` };

  return (
    <div class={`guide-win ${maxed ? 'is-max' : ''}`} ref={box} role="dialog" aria-label="사용자 가이드" style={style} tabIndex={-1}>
      <div class="guide-head" onPointerDown={onHead} onDblClick={(e) => !(e.target as HTMLElement).closest('button') && setMaxed(!maxed)} title="끌어서 옮기기 · 두 번 눌러 최대화">
        <strong>사용자 가이드</strong>
        <span class="grow" />
        <button type="button" class="btn-icon btn-xs" aria-label="글자 작게" title="글자 작게 (Ctrl+휠)" onClick={() => setFont((f) => Math.max(11, f - 1))}><Minus {...ICON} /></button>
        <button type="button" class="guide-font" aria-label="글자 크기 처음대로" title="누르면 처음 크기(14px)" onClick={() => setFont(14)}>{font}px</button>
        <button type="button" class="btn-icon btn-xs" aria-label="글자 크게" title="글자 크게 (Ctrl+휠)" onClick={() => setFont((f) => Math.min(24, f + 1))}><Plus {...ICON} /></button>
        <span class="guide-sep" />
        <button type="button" class="btn-icon btn-xs" aria-label={maxed ? '원래 크기로' : '최대화'} title={maxed ? '원래 크기로' : '최대화 (제목줄 두 번 누르기)'} onClick={() => setMaxed(!maxed)}>
          {maxed ? <Minimize2 {...ICON} /> : <Maximize2 {...ICON} />}
        </button>
        <button type="button" class="btn-icon btn-xs" aria-label="가이드 닫기" title="닫기 (Esc)" onClick={() => (guideOpen.value = false)}><X {...ICON} /></button>
      </div>
      <article class="guide-body md-render" style={{ fontSize: `${font}px` }} onClick={onClick} onWheel={onWheel} dangerouslySetInnerHTML={{ __html: html }} />
      {!maxed && EDGES.map((ed) => <div key={ed} class={`gw-edge gw-${ed}`} aria-hidden="true" onPointerDown={onEdge(ed)} />)}
    </div>
  );
}
