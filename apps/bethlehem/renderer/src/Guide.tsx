/* 사용자 가이드 — 프로그램 안에 떠 있는 창. 끌어서 옮기고, 모서리로 크기를 바꾸고, 글자 크기를 바꾼다. 마크다운을 그려서 보인다 */
import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { marked } from 'marked';
import { Minus, Plus, X } from 'lucide-preact';
import guideMd from '../../../../docs/USER_GUIDE.md?raw';

export const guideOpen = signal(false);

const ICON = { size: 16, strokeWidth: 1.5 };
const FONT_KEY = 'terr.guideFont';
const readFont = () => {
  try {
    return Math.min(22, Math.max(11, Number(localStorage.getItem(FONT_KEY)) || 14));
  } catch {
    return 14;
  }
};

export function GuideWindow() {
  const [font, setFont] = useState(readFont);
  const [pos, setPos] = useState(() => ({ x: Math.max(24, window.innerWidth - 820), y: 72 }));
  const box = useRef<HTMLDivElement>(null);
  const html = useMemo(() => marked.parse(guideMd, { async: false, gfm: true }) as string, []);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_KEY, String(font));
    } catch {
      /* 기억하지 못해도 된다 */
    }
  }, [font]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && box.current?.contains(document.activeElement) && (guideOpen.value = false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* 제목줄을 끌어 옮긴다 */
  const onDrag = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const dx = e.clientX - pos.x;
    const dy = e.clientY - pos.y;
    const move = (ev: PointerEvent) =>
      setPos({ x: Math.min(window.innerWidth - 120, Math.max(-200, ev.clientX - dx)), y: Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - dy)) });
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
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

  return (
    <div class="guide-win" ref={box} role="dialog" aria-label="사용자 가이드" style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
      <div class="guide-head" onPointerDown={onDrag}>
        <strong>사용자 가이드</strong>
        <span class="grow" />
        <button type="button" class="btn-icon btn-xs" aria-label="글자 작게" title="글자 작게" onClick={() => setFont((f) => Math.max(11, f - 1))}><Minus {...ICON} /></button>
        <span class="guide-font">{font}px</span>
        <button type="button" class="btn-icon btn-xs" aria-label="글자 크게" title="글자 크게" onClick={() => setFont((f) => Math.min(22, f + 1))}><Plus {...ICON} /></button>
        <button type="button" class="btn-icon btn-xs" aria-label="가이드 닫기" title="닫기 (Esc)" onClick={() => (guideOpen.value = false)}><X {...ICON} /></button>
      </div>
      <article class="guide-body md-render" style={{ fontSize: `${font}px` }} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
