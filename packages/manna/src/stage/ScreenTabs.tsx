/* 화면 탭 — 브라우저 탭처럼 여러 화면을 열어 두고 오간다. 끌어서 순서를 바꾸고, 가운데 클릭이나 × 로 닫는다.
 * 오른쪽 ▾ 는 문서의 모든 화면 목록, tools 는 작성 도구(Bethlehem: 화면 추가)를 끼우는 자리.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Check, ChevronDown, X } from 'lucide-preact';
import { closeTab, doc, moveTab, openTabs, rev, screenId, selectScreen } from '../store';

const ICON = { size: 16, strokeWidth: 1.5 };

export function ScreenTabs({ tools }: { tools?: ComponentChildren }) {
  rev.value;
  const d = doc.value;
  const cur = screenId.value;
  const ids = openTabs.value.filter((id) => d.screens.some((s) => s.id === id));
  if (cur && !ids.includes(cur)) ids.push(cur);
  const drag = useRef<{ id: string; x: number; moved: boolean } | null>(null);

  const onDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0) return;
    drag.current = { id, x: e.clientX, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const g = drag.current;
    if (!g || (!g.moved && Math.abs(e.clientX - g.x) < 6)) return;
    g.moved = true;
    const strip = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.tab');
    let to = 0;
    strip.forEach((t, i) => {
      const r = t.getBoundingClientRect();
      if (e.clientX > r.left + r.width / 2) to = i + (t.dataset.id === g.id ? 0 : 1);
    });
    const from = ids.indexOf(g.id);
    const target = to > from ? to - 1 : to;
    if (target !== from) moveTab(g.id, target);
  };
  const onUp = () => {
    drag.current = null;
  };

  return (
    <div class="tabs">
    <div class="tabs-strip" role="tablist" aria-label="열린 화면" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
      {ids.map((id) => {
        const s = d.screens.find((x) => x.id === id)!;
        const on = id === cur;
        return (
          <div key={id} class={`tab ${on ? 'is-on' : ''}`} data-id={id}>
            <button
              type="button"
              role="tab"
              aria-selected={on}
              class="tab-main"
              title={`${s.id} ${s.title}`}
              onPointerDown={(e) => onDown(e, id)}
              onClick={() => !drag.current?.moved && !on && selectScreen(id)}
              onAuxClick={(e) => e.button === 1 && closeTab(id)}
            >
              <span class="tab-id mono">{s.id}</span>
              <span class="tab-title ellipsis">{s.title}</span>
            </button>
            {ids.length > 1 && (
              <button type="button" class="tab-x" aria-label={`${s.id} 탭 닫기`} title="탭 닫기 (가운데 클릭)" onClick={() => closeTab(id)}>
                <X {...ICON} size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
      {/* 탭 줄은 옆으로 스크롤되므로, 펼침 메뉴가 잘리지 않게 도구는 그 밖에 둔다 */}
      <div class="tabs-tools">
        <ScreenList openIds={ids} />
        {tools}
      </div>
    </div>
  );
}

/** 문서의 모든 화면 — 고르면 탭으로 연다 */
function ScreenList({ openIds }: { openIds: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const screens = doc.value.screens;
  return (
    <div class="popover-wrap" ref={ref}>
      <button
        type="button"
        class="tab-tool"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="화면 목록"
        title={`화면 목록 (${screens.length})`}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown {...ICON} />
      </button>
      {open && (
        <div class="popover" role="menu" aria-label="화면 목록">
          {screens.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              class="popover-item"
              data-id={s.id}
              onClick={() => {
                selectScreen(s.id);
                setOpen(false);
              }}
            >
              <span class="menu-check">{openIds.includes(s.id) && <Check {...ICON} size={14} />}</span>
              <span class="mono small muted">{s.id}</span>
              <span class="ellipsis">{s.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
