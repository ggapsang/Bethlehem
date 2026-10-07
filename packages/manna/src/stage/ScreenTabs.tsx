/* 화면 탭 — 브라우저 탭처럼 여러 화면을 열어 두고 오간다. 끌어서 순서를 바꾼다.
 *   × = 화면 지우기(작성자, 한 번 묻는다) · 받는 사람은 탭 숨기기
 *   가운데 클릭 · 오른쪽 클릭 메뉴의 "탭 숨기기" = 지우지 않고 탭에서만 뺀다 (▾ 목록에서 다시 보이게)
 * 오른쪽 ▾ 는 문서의 모든 화면 목록(눈 아이콘으로 숨기기 · 보이기), tools 는 작성 도구(Bethlehem: 화면 추가)를 끼우는 자리.
 * 여러 창(windowTools 가 있을 때): 탭을 탭 줄 밖으로 끌어 놓으면 별도 창으로 빠진다. 오른쪽 클릭 메뉴에 "새 창으로 빼기" · "복제 보기".
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ChevronDown, Copy, Eye, EyeOff, Pencil, SquareArrowOutUpRight, Trash2, X } from 'lucide-preact';
import { closeTab, detachedTabs, doc, tabMarks, moveTab, mutate, openTab, openTabs, rev, screenId, selectScreen, windowMode } from '../store';
import { deleteScreen } from '../actions';

const ICON = { size: 16, strokeWidth: 1.5 };
/** 탭 줄에서 이만큼(px) 위아래로 벗어나 놓으면 별도 창으로 뺀다 */
const TEAR = 48;

/** 여러 창을 띄울 수 있을 때(작성 프로그램) — 탭을 새 창으로 빼기 · 복제 보기 */
export interface WindowTools {
  tearOff(id: string, screenX: number, screenY: number): void;
  duplicate(id: string): void;
}

export function ScreenTabs({ tools, canRename, windowTools }: { tools?: ComponentChildren; canRename?: boolean; windowTools?: WindowTools }) {
  const mirror = windowMode.value === 'mirror';
  const [tearing, setTearing] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => !(e.target as HTMLElement).closest?.('.tab-menu') && setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [menu]);
  const finish = (id: string, v: string) => {
    setRenaming(null);
    const s = doc.peek().screens.find((x) => x.id === id);
    const t = v.trim();
    if (s && t && t !== s.title) mutate(() => (s.title = t), { label: '화면 이름' });
  };
  rev.value;
  const d = doc.value;
  const cur = screenId.value;
  const detached = detachedTabs.value;
  const ids = mirror ? (cur ? [cur] : []) : openTabs.value.filter((id) => d.screens.some((s) => s.id === id) && !detached.has(id));
  if (cur && !ids.includes(cur) && !detached.has(cur)) ids.push(cur);
  const drag = useRef<{ id: string; x: number; moved: boolean } | null>(null);

  /* 끌기 — 옆으로는 순서 바꾸기, 탭 줄 밖(위아래)으로 끌어 놓으면 별도 창으로 빼기.
     창 밖까지 따라가야 하므로 창 전체에 듣는다 */
  const onDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0 || mirror) return;
    drag.current = { id, x: e.clientX, moved: false };
    // 품은 화면(iframe · webview) 위로 지나가도 끌기가 끊기지 않게 — 포인터를 이 탭이 붙잡는다
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const outside = (ev: PointerEvent) => {
      const r = stripRef.current?.getBoundingClientRect();
      return !!r && !!windowTools && ids.length > 1 && (ev.clientY < r.top - TEAR || ev.clientY > r.bottom + TEAR || ev.clientX < 0 || ev.clientX > innerWidth);
    };
    const move = (ev: PointerEvent) => {
      const g = drag.current;
      if (!g || (!g.moved && Math.abs(ev.clientX - g.x) < 6 && Math.abs(ev.clientY - e.clientY) < 6)) return;
      g.moved = true;
      if (outside(ev)) return setTearing(g.id);
      setTearing(null);
      const tabsEls = stripRef.current?.querySelectorAll<HTMLElement>('.tab') ?? [];
      let to = 0;
      tabsEls.forEach((t, i) => {
        const r = t.getBoundingClientRect();
        if (ev.clientX > r.left + r.width / 2) to = i + (t.dataset.id === g.id ? 0 : 1);
      });
      const from = ids.indexOf(g.id);
      const target = to > from ? to - 1 : to;
      if (target !== from) moveTab(g.id, target);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const g = drag.current;
      setTearing(null);
      if (g?.moved && outside(ev)) windowTools!.tearOff(g.id, ev.screenX, ev.screenY);
      setTimeout(() => (drag.current = null), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <div class="tabs">
    <div class={`tabs-strip ${tearing ? 'is-tearing' : ''}`} role="tablist" aria-label="열린 화면" ref={stripRef}>
      {ids.map((id) => {
        const s = d.screens.find((x) => x.id === id)!;
        const on = id === cur;
        return (
          <div key={id} class={`tab ${on ? 'is-on' : ''} ${tearing === id ? 'is-tearing' : ''}`} data-id={id} title={tearing === id ? '놓으면 새 창으로 뺀다' : undefined}>
            {renaming === id ? (
              <input
                class="tab-input"
                aria-label="화면 이름"
                defaultValue={s.title}
                ref={(el) => {
                  if (el && el !== document.activeElement) requestAnimationFrame(() => (el.focus(), el.select()));
                }}
                onBlur={(e) => (e.currentTarget.dataset.cancel ? setRenaming(null) : finish(id, e.currentTarget.value))}
                onKeyDown={(e) => {
                  // 칸이 포커스를 쥔 채 사라지면 다음 키가 먹히지 않는다 — 먼저 놓고(blur) 그때 끝낸다
                  if (e.key === 'Escape') e.currentTarget.dataset.cancel = '1';
                  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                }}
              />
            ) : (
            <button
              type="button"
              role="tab"
              aria-selected={on}
              class="tab-main"
              title={canRename ? `${s.id} ${s.title} — 두 번 눌러 이름 바꾸기` : `${s.id} ${s.title}`}
              onPointerDown={(e) => onDown(e, id)}
              onClick={() => !drag.current?.moved && !on && selectScreen(id)}
              onDblClick={() => canRename && setRenaming(id)}
              onAuxClick={(e) => e.button === 1 && !mirror && closeTab(id)}
              onContextMenu={(e) => {
                if (mirror) return;
                e.preventDefault();
                setMenu({ id, x: e.clientX, y: e.clientY });
              }}
            >
              <span class="tab-id mono">{s.id}</span>
              <span class="tab-title ellipsis">{s.title}</span>
              {tabMarks.value[id] && <span class="tab-mark" title={tabMarks.value[id]} aria-label={tabMarks.value[id]} />}
            </button>
            )}
            {mirror ? null : canRename ? (
              <button type="button" class="tab-x" aria-label={`${s.id} 화면 지우기`} title="화면 지우기 — 한 번 묻고 지운다 (숨기기는 가운데 클릭 · 오른쪽 클릭)" onClick={() => deleteScreen(id)}>
                <X {...ICON} size={14} />
              </button>
            ) : (
              ids.length > 1 && (
                <button type="button" class="tab-x" aria-label={`${s.id} 탭 숨기기`} title="탭 숨기기 (가운데 클릭) — ▾ 에서 다시 연다" onClick={() => closeTab(id)}>
                  <X {...ICON} size={14} />
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
      {menu && (
        <div class="popover tab-menu" role="menu" aria-label="탭" style={{ position: 'fixed', left: `${menu.x}px`, top: `${menu.y}px`, right: 'auto' }}>
          {windowTools && (
            <>
              <button type="button" role="menuitem" class="popover-item" disabled={ids.length <= 1} title={ids.length <= 1 ? '마지막 탭은 뺄 수 없습니다' : '탭 줄 밖으로 끌어 놓아도 된다'} onClick={() => { windowTools.tearOff(menu.id, window.screenX + menu.x + 40, window.screenY + menu.y + 40); setMenu(null); }}>
                <SquareArrowOutUpRight {...ICON} size={15} /> 새 창으로 빼기 <span class="grow" /><span class="muted small">탭 끌어 놓기</span>
              </button>
              <button type="button" role="menuitem" class="popover-item" title="같은 화면을 새 창에서 하나 더 — 두 창에서 고친 것이 서로 바로 반영된다" onClick={() => { windowTools.duplicate(menu.id); setMenu(null); }}>
                <Copy {...ICON} size={15} /> 복제 보기 (새 창)
              </button>
              <div class="popover-sep" />
            </>
          )}
          <button type="button" role="menuitem" class="popover-item" disabled={ids.length <= 1} title={ids.length <= 1 ? '마지막 탭은 숨길 수 없습니다' : ''} onClick={() => { closeTab(menu.id); setMenu(null); }}>
            <EyeOff {...ICON} size={15} /> 탭 숨기기 <span class="grow" /><span class="muted small">가운데 클릭</span>
          </button>
          {canRename && (
            <button type="button" role="menuitem" class="popover-item" onClick={() => { setRenaming(menu.id); setMenu(null); }}>
              <Pencil {...ICON} size={15} /> 이름 바꾸기 <span class="grow" /><span class="muted small">두 번 누르기</span>
            </button>
          )}
          {canRename && <div class="popover-sep" />}
          {canRename && (
            <button type="button" role="menuitem" class="popover-item btn-danger" onClick={() => { const id = menu.id; setMenu(null); deleteScreen(id); }}>
              <Trash2 {...ICON} size={15} /> 화면 지우기…
            </button>
          )}
        </div>
      )}
      {/* 탭 줄은 옆으로 스크롤되므로, 펼침 메뉴가 잘리지 않게 도구는 그 밖에 둔다 */}
      {!mirror && (
        <div class="tabs-tools">
          <ScreenList openIds={ids} />
          {tools}
        </div>
      )}
      {!mirror && detached.size > 0 && <span class="tabs-detached muted small" title={[...detached].join(', ')}><SquareArrowOutUpRight {...ICON} size={13} /> 별도 창 {detached.size}</span>}
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
        title={`화면 목록 (${screens.length})${screens.length > openIds.length ? ` — 탭으로 안 연 화면 ${screens.length - openIds.length}` : ''}`}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown {...ICON} />
        {screens.length > openIds.length && <span class="tab-more">+{screens.length - openIds.length}</span>}
      </button>
      {open && (
        <div class="popover" role="menu" aria-label="화면 목록">
          {screens.map((s) => {
            const shown = openIds.includes(s.id);
            return (
              <div key={s.id} class={`list-row ${shown ? '' : 'is-hidden'}`}>
                <button
                  type="button"
                  role="menuitem"
                  class="popover-item"
                  data-id={s.id}
                  onClick={() => {
                    selectScreen(s.id);
                    setOpen(false);
                  }}
                >
                  <span class="mono small muted">{s.id}</span>
                  <span class="ellipsis">{s.title}</span>
                </button>
                <button
                  type="button"
                  class="btn-icon btn-xs list-eye"
                  aria-label={shown ? `${s.id} 탭 숨기기` : `${s.id} 탭 보이기`}
                  aria-pressed={shown}
                  disabled={shown && openIds.length <= 1}
                  title={shown ? '탭 숨기기 (지우지 않는다)' : '탭 보이기'}
                  onClick={() => (shown ? closeTab(s.id) : openTab(s.id))}
                >
                  {shown ? <Eye {...ICON} size={15} /> : <EyeOff {...ICON} size={15} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
