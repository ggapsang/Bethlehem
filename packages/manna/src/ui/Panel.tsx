/* 오른쪽 패널 — 위에 화면 개요(마크다운), 아래에 Comment 목록. 한 스크롤로 이어진다 */
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Camera, ChevronDown, ChevronRight, EyeOff, Film, GripVertical, MessageSquare, Plus } from 'lucide-preact';
import type { Annotation, Screen } from '@core';
import { displayNo } from '@core';
import { addScreenComment, editBody, editNotes, reorder } from '../actions';
import type { Host } from '../host';
import {
  annotations, commentsOpen, hovered, notesOpen, popHidden, requestReveal, rev, screen, selected, toggleComments, toggleNotes, visible,
} from '../store';
import { MarkdownEditor, plainText } from './editor/MarkdownEditor';
import { ago } from './labels';

const ICON = { size: 16, strokeWidth: 1.5 };

export function Panel(_props: { host: Host }) {
  const scr = screen.value;
  if (!scr) return <aside class="panel" aria-label="개요와 Comment" />;
  return (
    <aside class="panel" aria-label="개요와 Comment">
      <Notes scr={scr} />
      <Comments scr={scr} />
    </aside>
  );
}

/* 개요 높이 — 펼치면 패널의 절반. 쓰다가 내용이 늘면 늘어난 만큼 같이 늘어나고(Enter 한 번에 한 줄),
   Comment 제목이 밀려나기 직전(HARD)에서 멈춘다. 그 뒤로는 상자 안에서 스크롤한다. 화면을 바꾸거나 다시 펼치면 절반부터 */
const HALF_GAP = 72; // 패널 위 여백 + 개요 제목 + 아래 여백
const HARD_GAP = 124; // 위 + 개요 제목·여백 + Comment 제목 + 아래

function Notes({ scr }: { scr: Screen }) {
  rev.value; // 문서는 제자리에서 고치므로 props 가 같아도 다시 그려야 한다 (signals 의 얕은 비교를 피한다)
  const open = notesOpen.value;
  const box = useRef<HTMLElement>(null);
  const capRef = useRef<number | null>(null);
  const prevH = useRef(0);
  // 내용 높이를 지켜보다가, 쓰는 중에(포커스가 개요 안에) 늘어난 만큼 상자도 늘린다.
  // 다시 그리지 않고 스타일만 바꾼다 — 쓰는 도중에 다시 그리면 아직 반영 전인 개요로 편집기가 되돌아간다
  useEffect(() => {
    capRef.current = null;
    prevH.current = 0;
    const sec = box.current;
    sec?.style.removeProperty('--notes-max');
    const content = sec?.querySelector('.cm-content') as HTMLElement | null;
    if (!open || !sec || !content) return;
    const ro = new ResizeObserver(() => {
      const h = content.offsetHeight;
      const grew = prevH.current ? h - prevH.current : 0;
      prevH.current = h;
      const panel = sec.closest('.panel') as HTMLElement | null;
      if (!panel || grew <= 0 || !sec.contains(document.activeElement)) return;
      const ph = panel.clientHeight;
      const next = Math.min(ph - HARD_GAP, (capRef.current ?? ph * 0.5 - HALF_GAP) + grew);
      if (next !== capRef.current) {
        capRef.current = next;
        sec.style.setProperty('--notes-max', `${next}px`);
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [scr.id, open]);
  return (
    <section ref={box} class={`notes ${open ? 'is-open' : ''}`}>
      <button type="button" class="section-head" aria-expanded={open} onClick={() => toggleNotes()}>
        {open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
        <span>개요</span>
        {!open && scr.notes && <span class="muted small ellipsis">{plainText(scr.notes).split('\n')[0]}</span>}
      </button>
      {open && (
        <MarkdownEditor
          key={scr.id}
          value={scr.notes}
          onChange={editNotes}
          allowCheck
          minRows={3}
          placeholder="개요"
          label="화면 개요"
          class="notes-editor"
        />
      )}
    </section>
  );
}

function Comments({ scr }: { scr: Screen }) {
  const list = annotations.value;
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ id: string; to: number; y: number } | null>(null);

  /* 끌어서 순서 바꾸기 — 손잡이를 잡고 위아래로 */
  const startDrag = (e: PointerEvent, id: string) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const target = (y: number) => {
      const cards = Array.from(listRef.current?.querySelectorAll<HTMLElement>(':scope > .card') ?? []).filter((c) => c.dataset.id !== id);
      return cards.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.top + r.height / 2 < y;
      }).length;
    };
    setDrag({ id, to: target(e.clientY), y: e.clientY });
    const move = (ev: PointerEvent) => setDrag({ id, to: target(ev.clientY), y: ev.clientY });
    const up = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const to = target(ev.clientY);
      setDrag(null);
      if (ev.type === 'pointerup' && to !== list.findIndex((a) => a.id === id)) reorder(id, to);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  // 끄는 카드는 자리를 지킨다(손잡이가 포인터를 잡고 있다). 들어갈 자리는 다른 카드들 사이에 선으로 보인다
  const others = list.filter((a) => a.id !== drag?.id);
  const lineBefore = drag && drag.to < others.length ? others[drag.to].id : null;
  return (
    <section class={`comments ${commentsOpen.value ? 'is-open' : ''}`}>
      <div class="section-row">
        <button type="button" class="section-head" aria-expanded={commentsOpen.value} onClick={() => toggleComments()}>
          {commentsOpen.value ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
          <span>Comment</span>
          <span class="count">{list.length}</span>
        </button>
        <button type="button" class="btn-icon btn-xs" title="화면 전체에 Comment 달기" aria-label="화면 전체에 Comment 달기" onClick={() => addScreenComment()}>
          <Plus {...ICON} />
        </button>
      </div>
      {commentsOpen.value && (
      <div class="cards-scroll">
      <ol class="cards" ref={listRef}>
        {list.map((a) => (
          <Fragment key={a.id}>
            {lineBefore === a.id && <li class="drop-line" aria-hidden="true" />}
            <Card a={a} scr={scr} onGrip={startDrag} dragging={drag?.id === a.id} />
          </Fragment>
        ))}
        {drag && drag.to >= others.length && <li class="drop-line" aria-hidden="true" />}
      </ol>
      </div>
      )}
      {drag && (
        <div class="drag-ghost" style={{ top: `${drag.y}px` }}>
          {displayNo(scr, list.find((a) => a.id === drag.id)!)}번 옮기는 중
        </div>
      )}
    </section>
  );
}

function Card({ a, scr, onGrip, dragging }: { a: Annotation; scr: Screen; onGrip: (e: PointerEvent, id: string) => void; dragging?: boolean }) {
  rev.value;
  const sel = selected.value === a.id;
  const shown = !a.anchor || visible.value.has(a.id);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (sel) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);

  const open = () => {
    selected.value = a.id;
    popHidden.value = false;
    if (!shown && a.anchor) requestReveal(a.id);
  };

  return (
    <li
      ref={ref}
      data-id={a.id}
      class={`card ${sel ? 'is-sel' : ''} ${shown ? '' : 'is-dim'} ${dragging ? 'is-dragging' : ''}`}
      onPointerEnter={() => (hovered.value = a.id)}
      onPointerLeave={() => (hovered.value = null)}
    >
      <div class="card-head">
        <span class="grip" title="끌어서 순서 바꾸기" aria-label="끌어서 순서 바꾸기" onPointerDown={(e) => onGrip(e, a.id)}>
          <GripVertical {...ICON} />
        </span>
        <button type="button" class="card-title" aria-expanded={sel} onClick={() => (sel && shown && !popHidden.value ? (selected.value = null) : open())}>
          <span class={`no ${a.anchor ? '' : 'no-screen'}`}>{displayNo(scr, a)}</span>
          <span class="card-meta">{a.author} · {ago(a.createdAt)}</span>
          {!a.anchor && <span class="chip">화면 전체</span>}
          {!shown && <span class="chip chip-hint" title="다른 화면 상태에 있습니다. 누르면 그 상태로 이동합니다."><EyeOff {...ICON} size={12} /> 다른 상태</span>}
          <span class="grow" />
          {a.shot && <span class="badge-icon" title="달 때의 화면이 함께 저장되어 있습니다"><Camera {...ICON} size={14} /></span>}
          {(a.clips?.length ?? 0) > 0 && <span class="badge-icon"><Film {...ICON} size={14} /> {a.clips!.length}</span>}
          {a.replies.length > 0 && <span class="badge-icon"><MessageSquare {...ICON} size={14} /> {a.replies.length}</span>}
        </button>
      </div>
      {!sel && a.body && (
        <button type="button" class="card-preview" onClick={open}>
          <span class="clamp">{plainText(a.body)}</span>
        </button>
      )}
      {sel && a.body && (
        <div class="card-body">
          <MarkdownEditor value={a.body} editable={false} allowCheck onChange={(t) => editBody(a, t)} label="Comment 본문" />
        </div>
      )}
    </li>
  );
}
