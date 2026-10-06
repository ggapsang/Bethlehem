/* 화면 탭 — 브라우저 탭처럼 여러 화면을 열어 두고 오간다. 끌어서 순서를 바꾼다.
 *   × = 화면 지우기(작성자, 한 번 묻는다) · 받는 사람은 탭 숨기기
 *   가운데 클릭 · 오른쪽 클릭 메뉴의 "탭 숨기기" = 지우지 않고 탭에서만 뺀다 (▾ 목록에서 다시 보이게)
 * 오른쪽 ▾ 는 문서의 모든 화면 목록(눈 아이콘으로 숨기기 · 보이기), tools 는 작성 도구(Bethlehem: 화면 추가)를 끼우는 자리.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ChevronDown, Eye, EyeOff, Pencil, Trash2, X } from 'lucide-preact';
import { closeTab, doc, moveTab, mutate, openTab, openTabs, rev, screenId, selectScreen } from '../store';
import { deleteScreen } from '../actions';

const ICON = { size: 16, strokeWidth: 1.5 };

export function ScreenTabs({ tools, canRename }: { tools?: ComponentChildren; canRename?: boolean }) {
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
              onAuxClick={(e) => e.button === 1 && closeTab(id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id, x: e.clientX, y: e.clientY });
              }}
            >
              <span class="tab-id mono">{s.id}</span>
              <span class="tab-title ellipsis">{s.title}</span>
            </button>
            )}
            {canRename ? (
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
