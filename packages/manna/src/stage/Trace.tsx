/* 조작 표시 — 화면 녹화 중에 커서 · 클릭 · 키 입력을 화면 위에 그린다
 *
 * 탭 녹화에는 마우스 커서가 찍히지 않고, 무엇을 눌렀는지도 영상만으로는 알기 어렵다.
 * 품은 화면 안의 에이전트가 포인터 · 키를 알려 주면(type: 'input') 스테이지 위 이 층에 그린다 — 녹화가 이 층까지 함께 찍는다.
 * 비밀번호 칸에 친 글자는 에이전트가 • 로 가려서 보낸다.
 */
import { useEffect, useRef } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { AgentMsg } from '../agent/protocol';

export type TraceInput = Extract<AgentMsg, { type: 'input' }>;

const KEEP_MS = 2600;
const TYPING_GAP_MS = 1200;
const MAX_CHIPS = 5;

export function TraceLayer({ on, scale, feed }: { on: boolean; scale: number; feed: MutableRef<((m: TraceInput) => void) | null> }) {
  const root = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLDivElement>(null);
  const s = useRef(scale);
  s.current = scale;

  useEffect(() => {
    if (!on) {
      feed.current = null;
      return;
    }
    let typing: { el: HTMLElement; at: number } | null = null;
    const fade = (el: HTMLElement) => {
      clearTimeout(Number(el.dataset.t));
      el.classList.remove('is-out');
      el.dataset.t = String(setTimeout(() => {
        el.classList.add('is-out');
        setTimeout(() => el.remove(), 300);
      }, KEEP_MS));
    };
    const chip = (text: string) => {
      const box = keys.current;
      if (!box) return null;
      const el = document.createElement('span');
      el.className = 'trace-key';
      el.textContent = text;
      box.appendChild(el);
      while (box.children.length > MAX_CHIPS) box.firstElementChild!.remove();
      fade(el);
      return el;
    };
    feed.current = (m) => {
      const c = cursor.current;
      if (m.ev === 'key') {
        if (!m.key) return;
        const now = Date.now();
        // 이어 친 글자는 한 칸에 모은다 ("hello"), 조합 · 특수 키는 따로 ("Ctrl+S", "Enter")
        if (m.text) {
          if (typing && typing.el.isConnected && now - typing.at < TYPING_GAP_MS) {
            typing.el.textContent = (typing.el.textContent ?? '') + m.key;
            typing.at = now;
            fade(typing.el);
          } else {
            const el = chip(m.key);
            typing = el ? { el, at: now } : null;
          }
        } else {
          typing = null;
          chip(m.key);
        }
        return;
      }
      if (!c) return;
      const x = m.x * s.current;
      const y = m.y * s.current;
      c.hidden = false;
      c.style.transform = `translate(${x}px, ${y}px)`;
      if (m.ev === 'down') {
        c.classList.add('is-down');
        const r = document.createElement('span');
        r.className = 'trace-ripple';
        r.style.left = `${x}px`;
        r.style.top = `${y}px`;
        root.current?.appendChild(r);
        setTimeout(() => r.remove(), 700);
      } else if (m.ev === 'up') c.classList.remove('is-down');
    };
    return () => {
      feed.current = null;
    };
  }, [on]);

  if (!on) return null;
  return (
    <div class="trace-layer" ref={root} aria-hidden="true">
      <div class="trace-cursor" ref={cursor} hidden>
        <svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.5 L13.4 19.2 L10.4 12.6 L16.5 12.6 Z" /></svg>
      </div>
      <div class="trace-keys" ref={keys} />
    </div>
  );
}
