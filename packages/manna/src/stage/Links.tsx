/* 연결 — 화면 위 연결 영역, 영역 그리기, 잇는 중 안내 막대, 화면의 연결 목록, 돌아가기 (links.ts) */
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { ArrowLeft, Eye, EyeOff, Link2, ListTree, Monitor, Search, SquareDashed, X } from 'lucide-preact';
import type { Connection, LinkEnd } from '@core';
import { displayNo } from '@core';
import {
  areaKey, areaTool, cancelLinking, endExists, endLabel, finishLinking, flashArea, goBack, goTo, jumpBack, labelText, linking, linksOf, removeConnection, startLinking,
} from '../links';
import { doc, rev, screen, selected, setShowLinks, showLinks, user, version } from '../store';

const ICON = { size: 15, strokeWidth: 1.75 };
const samePage = (a: string | undefined, b: string) => !a || a.split('#')[0] === b.split('#')[0];

/** 반대쪽 끝으로 — 잇는 중이면 이 끝을 반대쪽으로 고른다 */
function follow(c: Connection, side: 'a' | 'b'): void {
  const here = c[side];
  if (linking.peek()) return void finishLinking(here);
  const otherSide = side === 'a' ? 'b' : 'a';
  const other = c[otherSide];
  goTo(other, other.kind === 'area' ? areaKey(c, otherSide) : undefined);
}

/** 이 화면 · 버전 · 페이지에 박힌 연결 영역 — 박스와 반대쪽 이름표. 이름표를 누르면 반대쪽으로 간다 */
export function LinkAreaLayer({ scale, page }: { scale: number; page: string }) {
  rev.value;
  const s = screen.value;
  const v = version.value;
  const fl = flashArea.value;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!fl) return;
    const t = setTimeout(() => tick((n) => n + 1), 2200);
    return () => clearTimeout(t);
  }, [fl]);
  if (!s || !v) return null;
  const d = doc.value;
  const items = (d.connections ?? []).flatMap((c) =>
    (['a', 'b'] as const)
      .filter((side) => {
        const e = c[side];
        return e.kind === 'area' && e.screen === s.id && e.version === v.v && samePage(e.page, page);
      })
      .map((side) => ({ c, side })),
  );
  const showAll = showLinks.value || !!linking.value;
  const fresh = (c: Connection, side: 'a' | 'b') => !!fl && fl.key === areaKey(c, side) && Date.now() - fl.at < 2000;
  const shown = showAll ? items : items.filter(({ c, side }) => fresh(c, side));
  if (!shown.length) return null;
  const me = user.value;
  return (
    <div class="link-layer">
      {shown.map(({ c, side }) => {
        const e = c[side] as Extract<LinkEnd, { kind: 'area' }>;
        const other = c[side === 'a' ? 'b' : 'a'];
        const l = endLabel(d, other);
        const [x, y, w, h] = e.box;
        const flash = fresh(c, side);
        return (
          <div key={areaKey(c, side)} class={`link-area ${flash ? 'is-flash' : ''}`} data-key={areaKey(c, side)} style={{ left: `${x * scale}px`, top: `${y * scale}px`, width: `${w * scale}px`, height: `${h * scale}px` }}>
            <span class="link-tag">
              <button type="button" class={`link-go ${l.missing ? 'is-missing' : ''}`} title={`${labelText(d, other)} — 누르면 그쪽으로`} onClick={() => follow(c, side)}>
                <Link2 {...ICON} size={13} /> <b>{l.tag}</b> <span class="ellipsis">{l.text}</span>
              </button>
              {(me === c.author || !c.author) && (
                <button type="button" class="link-x" aria-label="연결 끊기" title="연결 끊기 (Ctrl+Z 로 되돌린다)" onClick={() => removeConnection(c.id)}><X size={12} /></button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 연결 영역 그리기 — 끌어서 박스를 그리면 그 자리가 연결의 한 끝이 된다 */
export function AreaDraw({ local, page, scale }: { local: (e: PointerEvent) => { x: number; y: number }; page: string; scale: number }) {
  const [box, setBox] = useState<[number, number, number, number] | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const s = screen.value;
  const v = version.value;
  if (!areaTool.value || !s || !v) return null;
  const norm = (a: { x: number; y: number }, b: { x: number; y: number }): [number, number, number, number] =>
    [Math.round(Math.min(a.x, b.x)), Math.round(Math.min(a.y, b.y)), Math.round(Math.abs(a.x - b.x)), Math.round(Math.abs(a.y - b.y))];
  return (
    <div
      class="area-place"
      title="끌어서 연결할 영역을 그리세요 (Esc 로 그만)"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = local(e);
        setBox([start.current.x, start.current.y, 0, 0]);
      }}
      onPointerMove={(e) => start.current && setBox(norm(start.current, local(e)))}
      onPointerUp={(e) => {
        const a = start.current;
        start.current = null;
        setBox(null);
        if (!a) return;
        const b = norm(a, local(e));
        if (b[2] < 8 || b[3] < 8) return;
        const end: LinkEnd = { kind: 'area', screen: s.id, version: v.v, ...(page && page !== v.entry && page !== v.source?.url ? { page } : {}), box: b };
        areaTool.value = false;
        if (linking.peek()) finishLinking(end);
        else startLinking(end);
      }}
    >
      {box && <div class="area-draft" style={{ left: `${box[0] * scale}px`, top: `${box[1] * scale}px`, width: `${box[2] * scale}px`, height: `${box[3] * scale}px` }} />}
    </div>
  );
}

/** 잇는 중 — 창 위쪽에 떠서 무엇을 고르면 되는지 알려 준다. 다른 탭으로 가도 그대로 */
export function LinkingBar() {
  rev.value;
  const l = linking.value;
  const sel = selected.value;
  const start = useRef<string | null | undefined>(undefined);
  const [list, setList] = useState(false);
  const query = useRef('');
  // 시작한 뒤에 새로 고른 Comment 가 반대쪽이다 (시작할 때 골라져 있던 것은 아니다)
  useEffect(() => {
    if (!l) {
      start.current = undefined;
      setList(false);
      return;
    }
    if (start.current === undefined) {
      start.current = sel;
      return;
    }
    if (sel && sel !== start.current) {
      const s = screen.peek();
      if (s) finishLinking({ kind: 'comment', screen: s.id, ann: sel });
    }
  }, [l, sel]);
  useEffect(() => {
    if (!l) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // 검색어가 있으면 먼저 지운다 (엑셀 필터처럼)
      const box = document.activeElement as HTMLInputElement | null;
      if (box?.classList.contains('link-search') && box.value) {
        box.value = '';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (areaTool.peek()) areaTool.value = false;
      else cancelLinking();
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [l]);
  if (!l) return null;
  const d = doc.value;
  const s = screen.value;
  return createPortal(
    <div class="link-bar" role="status" aria-label="연결 만드는 중">
      <Link2 {...ICON} />
      <span class="link-bar-from"><b>{endLabel(d, l.from).tag}</b> {endLabel(d, l.from).text}</span>
      <span class="muted small">에서 이을 곳 — Comment 를 누르거나(마커 · 오른쪽 목록), 다른 탭으로 가도 됩니다</span>
      <button type="button" class={`btn btn-sm ${areaTool.value ? 'is-on' : ''}`} aria-pressed={areaTool.value} onClick={() => (areaTool.value = !areaTool.value)}>
        <SquareDashed {...ICON} size={14} /> 영역 그리기
      </button>
      {s && (
        <button type="button" class="btn btn-sm" title={`${s.id} ${s.title} 화면 전체와 잇는다`} onClick={() => finishLinking({ kind: 'screen', screen: s.id })}>
          <Monitor {...ICON} size={14} /> 이 화면 전체
        </button>
      )}
      <span class="link-list-wrap">
        <button type="button" class="btn btn-sm" aria-expanded={list} onClick={() => setList(!list)}><ListTree {...ICON} size={14} /> 목록에서</button>
        {list && <LinkList query={query} />}
      </span>
      <button type="button" class="btn btn-sm btn-ghost" onClick={cancelLinking}>취소</button>
    </div>,
    document.body,
  );
}

/** 목록에서 고르기 — 모든 탭의 화면 · Comment 를 펼쳐 두고, 위 검색칸으로 거른다 (엑셀 필터처럼).
 *  탭 id · 화면 이름 · #번호 · 제목 · 본문 · 쓴 사람 · 담당에서 찾는다. 여러 낱말은 모두 들어 있는 것만. Enter 는 첫 결과 */
function LinkList({ query }: { query: { current: string } }) {
  const [q, setQ] = useState(query.current);
  // 펼치면 바로 검색칸에 쓴다 (autoFocus 는 나중에 붙인 요소에는 듣지 않는다)
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  const d = doc.value;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every((w) => text.includes(w));
  const groups = d.screens
    .map((x) => {
      const head = `${x.id} ${x.title}`.toLowerCase();
      const anns = x.annotations.filter((a) => {
        const no = displayNo(x, a);
        return hit(`${head} #${no} ${x.id} #${no} v${a.version} ${a.title ?? ''} ${a.body} ${a.author} ${a.assignee ?? ''}`.toLowerCase());
      });
      return { x, screenHit: hit(head), anns };
    })
    .filter((g) => g.screenHit || g.anns.length);
  const count = groups.reduce((n, g) => n + g.anns.length, 0);
  const first = groups[0];
  const pickFirst = () => {
    if (!first) return;
    const a = first.anns[0];
    finishLinking(a ? { kind: 'comment', screen: first.x.id, ann: a.id } : { kind: 'screen', screen: first.x.id });
  };
  return (
    <div class="popover link-list" role="menu">
      <div class="link-search-row">
        <Search size={14} />
        <input
          class="input input-sm link-search"
          placeholder="검색 — SCR-002, #3, 제목 · 본문 · 사람"
          aria-label="연결할 곳 검색"
          value={q}
          ref={box}
          onInput={(e) => {
            query.current = e.currentTarget.value;
            setQ(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              pickFirst();
            }
          }}
        />
        <span class="muted small">{words.length ? `${count}개` : ''}</span>
      </div>
      <div class="link-list-body">
        {groups.length === 0 && <span class="popover-item muted small">맞는 것이 없습니다</span>}
        {groups.map(({ x, anns }) => (
          <div key={x.id} class="link-list-screen">
            <button type="button" role="menuitem" class="popover-item" onClick={() => finishLinking({ kind: 'screen', screen: x.id })}>
              <Monitor {...ICON} size={14} /> <b class="mono">{x.id}</b> <span class="ellipsis">{x.title}</span> <span class="muted small">화면 전체</span>
            </button>
            {anns.map((a) => (
              <button key={a.id} type="button" role="menuitem" class="popover-item link-list-ann" onClick={() => finishLinking({ kind: 'comment', screen: x.id, ann: a.id })}>
                <span class="mono">{x.versions.length > 1 ? `v${a.version} ` : ''}#{displayNo(x, a)}</span>
                <span class="ellipsis">{endLabel(d, { kind: 'comment', screen: x.id, ann: a.id }).text}</span>
                <span class="muted small link-list-who">{a.assignee ? `${a.author} → ${a.assignee}` : a.author}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 화면 막대 — 이 화면에 닿은 연결들 · 화면 전체에서 잇기 · 영역 그려서 잇기 */
export function ScreenLinksMenu() {
  rev.value;
  const s = screen.value;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  if (!s) return null;
  const d = doc.value;
  const mine = linksOf(d, (e) => e.screen === s.id).filter(({ other }) => endExists(d, other));
  return (
    <div class="popover-wrap" ref={ref}>
      <button
        type="button"
        class={`btn-icon link-menu-btn ${mine.length ? 'has-links' : ''} ${showLinks.value ? '' : 'links-off'}`}
        aria-label="연결"
        aria-expanded={open}
        title={`${mine.length ? `이 화면의 연결 ${mine.length}개` : '연결 — 다른 화면 · Comment 와 잇기'}${showLinks.value ? '' : ' · 화면의 연결 영역 숨김'}`}
        onClick={() => setOpen(!open)}
      >
        <Link2 size={18} strokeWidth={1.5} />
        {mine.length > 0 && <span class="link-count">{mine.length}</span>}
      </button>
      {open && (
        <div class="popover link-menu" role="menu" aria-label="연결">
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={showLinks.value}
            class="popover-item"
            title="화면 위의 연결 영역(파란 점선 박스와 이름표)을 보이거나 숨긴다. 숨겨도 연결은 그대로이고, 이 목록 · Comment 의 이름표로 오갈 수 있다"
            onClick={() => setShowLinks(!showLinks.value)}
          >
            {showLinks.value ? <Eye {...ICON} size={14} /> : <EyeOff {...ICON} size={14} />} 화면에 연결 영역 보이기
            <span class="grow" />
            <span class={`switch ${showLinks.value ? 'is-on' : ''}`} aria-hidden="true" />
          </button>
          <div class="popover-sep" />
          <span class="popover-label">이 화면의 연결</span>
          {mine.length === 0 && <span class="popover-item muted small">아직 없습니다</span>}
          {mine.map(({ c, here, other }) => (
            <button key={`${c.id}${here}`} type="button" role="menuitem" class="popover-item link-row" onClick={() => { setOpen(false); goTo(other, other.kind === 'area' ? areaKey(c, here === 'a' ? 'b' : 'a') : undefined); }}>
              <span class="mono small">{endLabel(d, c[here]).tag.replace(`${s.id}`, '').trim() || '화면'}</span>
              <Link2 size={12} />
              <b class="mono">{endLabel(d, other).tag}</b>
              <span class="ellipsis">{endLabel(d, other).text}</span>
            </button>
          ))}
          <div class="popover-sep" />
          <button type="button" role="menuitem" class="popover-item" onClick={() => { setOpen(false); startLinking({ kind: 'screen', screen: s.id }); }}>
            <Monitor {...ICON} size={14} /> 이 화면 전체에서 잇기…
          </button>
          <button type="button" role="menuitem" class="popover-item" onClick={() => { setOpen(false); areaTool.value = true; }}>
            <SquareDashed {...ICON} size={14} /> 영역을 그려서 잇기…
          </button>
        </div>
      )}
    </div>
  );
}

/** 연결을 따라 왔으면 — 왔던 자리로 */
export function BackChip() {
  const b = jumpBack.value;
  if (!b) return null;
  return (
    <button type="button" class="btn btn-sm link-back" title={`${b.label} 로 돌아가기`} onClick={goBack}>
      <ArrowLeft size={14} /> <span class="ellipsis">{b.label}</span>
    </button>
  );
}

/** Comment 의 연결 — 반대쪽 이름표(누르면 그쪽으로) · 끊기 · 새로 잇기 */
export function CommentLinks({ screenId: sid, ann }: { screenId: string; ann: string }) {
  rev.value;
  const d = doc.value;
  const me = user.value;
  const list = linksOf(d, (e) => e.kind === 'comment' && e.screen === sid && e.ann === ann);
  return (
    <div class="comment-links">
      {list.map(({ c, here, other }) => {
        const l = endLabel(d, other);
        return (
          <span key={c.id + here} class="link-chip">
            <button type="button" class={`link-go ${l.missing ? 'is-missing' : ''}`} title={`${labelText(d, other)} — 누르면 그쪽으로`} onClick={() => follow(c, here)}>
              <Link2 size={13} /> <b>{l.tag}</b> <span class="ellipsis">{l.text}</span>
            </button>
            {(me === c.author || !c.author) && (
              <button type="button" class="link-x" aria-label="연결 끊기" title="연결 끊기" onClick={() => removeConnection(c.id)}><X size={12} /></button>
            )}
          </span>
        );
      })}
      {me && (
        <button type="button" class="btn btn-sm btn-ghost link-add" title="다른 탭의 Comment · 영역 · 화면과 잇는다 — 누른 뒤 반대쪽을 고르세요" onClick={() => startLinking({ kind: 'comment', screen: sid, ann })}>
          <Link2 size={14} /> 잇기
        </button>
      )}
    </div>
  );
}

