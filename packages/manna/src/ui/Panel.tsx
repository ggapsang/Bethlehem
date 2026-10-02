/* 오른쪽 패널 — 위에 화면 개요(마크다운), 아래에 Comment 목록. 한 스크롤로 이어진다 */
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CheckSquare, Camera, ChevronDown, ChevronRight, EyeOff, Film, GripVertical, MessageSquare, Plus, X } from 'lucide-preact';
import type { Annotation, Screen } from '@core';
import { displayNo } from '@core';
import { toggleDone, MAIN_NOTE, addNoteTab, addScreenComment, editBody, editNoteTab, noteTabs, removeNoteTab, renameNoteTab, reorder } from '../actions';
import type { Host } from '../host';
import {
  setShowDone, showDone, shownAnnotations, version, annotations, commentsOpen, hovered, notesOpen, notesRatio, popHidden, rev, screen, selected, setNotesRatio, toggleComments, toggleNotes, visible,
} from '../store';
import { MarkdownEditor, plainText } from './editor/MarkdownEditor';
import { ago, markState } from './labels';
import { Who } from './Who';
import { openComment } from '../stage/MarkerStrip';

const ICON = { size: 16, strokeWidth: 1.5 };

export function Panel(_props: { host: Host }) {
  const scr = screen.value;
  if (!scr) return <aside class="panel" aria-label="자유 노트와 Comment" />;
  return (
    <aside class="panel" aria-label="자유 노트와 Comment">
      <Notes scr={scr} />
      {notesOpen.value && <NotesSplitter />}
      <Comments scr={scr} />
    </aside>
  );
}

/** 개요와 Comment 사이 — 끌어서 개요 높이를 바꾼다 (더블클릭하면 절반) */
function NotesSplitter() {
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const panel = el.closest('.panel') as HTMLElement;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing-v');
    const top = panel.getBoundingClientRect().top;
    const move = (ev: PointerEvent) => setNotesRatio((ev.clientY - top) / panel.clientHeight);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing-v');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div
      class="notes-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="자유 노트 높이 조절"
      tabIndex={0}
      onPointerDown={onDown}
      onDblClick={() => setNotesRatio(0.5)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') setNotesRatio(notesRatio.peek() - 0.05);
        if (e.key === 'ArrowDown') setNotesRatio(notesRatio.peek() + 0.05);
      }}
    />
  );
}

/** 자유 노트 — 화면의 어느 자리에도 묶이지 않는 글. 탭을 여러 개 두고 탭마다 이름을 단다 (더블클릭해 이름 바꾸기) */
function Notes({ scr }: { scr: Screen }) {
  rev.value; // 문서는 제자리에서 고치므로 props 가 같아도 다시 그려야 한다 (signals 의 얕은 비교를 피한다)
  const open = notesOpen.value;
  const tabs = noteTabs(scr);
  const [cur, setCur] = useState(MAIN_NOTE);
  const [renaming, setRenaming] = useState<string | null>(null);
  const tab = tabs.find((t) => t.id === cur) ?? tabs[0]!;
  useEffect(() => setCur(MAIN_NOTE), [scr.id]);
  const finishRename = (id: string, v: string) => {
    renameNoteTab(id, v);
    setRenaming(null);
  };
  return (
    <section class={`notes ${open ? 'is-open' : ''}`} style={open ? { height: `${notesRatio.value * 100}%` } : undefined}>
      <div class="section-row">
        <button type="button" class="section-head" aria-expanded={open} onClick={() => toggleNotes()} title="화면의 어느 자리에도 묶이지 않는 글">
          {open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
          <span>자유 노트</span>
          {!open && <span class="count">{tabs.length > 1 ? `탭 ${tabs.length}` : ''}</span>}
          {!open && scr.notes && <span class="muted small ellipsis">{plainText(scr.notes).split('\n')[0]}</span>}
        </button>
      </div>
      {open && (
        <div class="note-tabs" role="tablist" aria-label="노트 탭">
          {tabs.map((t) => (
            <div key={t.id} class={`note-tab ${t.id === tab.id ? 'is-on' : ''}`}>
              {renaming === t.id ? (
                <input
                  class="note-tab-input"
                  aria-label="노트 이름"
                  defaultValue={t.title}
                  ref={(el) => {
                    if (el && el !== document.activeElement) requestAnimationFrame(() => (el.focus(), el.select()));
                  }}
                  onBlur={(e) => finishRename(t.id, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishRename(t.id, e.currentTarget.value);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={t.id === tab.id}
                  class="note-tab-main"
                  title="두 번 눌러 이름 바꾸기"
                  onClick={() => setCur(t.id)}
                  onDblClick={() => setRenaming(t.id)}
                >
                  {t.title}
                </button>
              )}
              {renaming !== t.id && (
                <button
                  type="button"
                  class="note-tab-x"
                  aria-label={`${t.title} 탭 지우기`}
                  title="탭 지우기 — 한 번 묻고 지운다"
                  onClick={() => {
                    if (removeNoteTab(t.id) && (t.id === tab.id || t.id === MAIN_NOTE)) setCur(MAIN_NOTE);
                  }}
                >
                  <X {...ICON} size={12} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            class="note-tab-add"
            aria-label="노트 탭 추가"
            title="노트 탭 추가"
            onClick={() => {
              const id = addNoteTab();
              if (id) {
                setCur(id);
                setRenaming(id);
              }
            }}
          >
            <Plus {...ICON} size={14} />
          </button>
        </div>
      )}
      {open && (
        <MarkdownEditor
          key={`${scr.id}:${tab.id}`}
          value={tab.body}
          onChange={(t) => editNoteTab(tab.id, t)}
          allowCheck
          minRows={3}
          placeholder={tab.title}
          label={`자유 노트 — ${tab.title}`}
          class="notes-editor"
        />
      )}
    </section>
  );
}

function Comments({ scr }: { scr: Screen }) {
  const list = shownAnnotations.value;
  const doneN = annotations.value.filter((a) => a.done).length;
  const openN = annotations.value.length - doneN;
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
          <span class="count">{openN}</span>
        </button>
        {doneN > 0 && (
          <button
            type="button"
            class={`done-toggle ${showDone.value ? 'is-on' : ''}`}
            aria-pressed={showDone.value}
            title={showDone.value ? '완료한 Comment 숨기기' : '완료한 Comment 도 보기'}
            onClick={() => setShowDone(!showDone.value)}
          >
            <CheckSquare {...ICON} size={14} /> 완료 {doneN} {showDone.value ? '숨기기' : '보기'}
          </button>
        )}
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
  const st = markState(a, visible.value, version.value?.source?.mode === 'site');
  const shown = st !== 'other';
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (sel) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);

  const open = () => openComment(a);

  return (
    <li
      ref={ref}
      data-id={a.id}
      class={`card ${sel ? 'is-sel' : ''} ${shown ? '' : 'is-dim'} ${dragging ? 'is-dragging' : ''} ${a.done ? 'is-done' : ''}`}
      onPointerEnter={() => (hovered.value = a.id)}
      onPointerLeave={() => (hovered.value = null)}
    >
      <div class="card-head">
        <span class="grip" title="끌어서 순서 바꾸기" aria-label="끌어서 순서 바꾸기" onPointerDown={(e) => onGrip(e, a.id)}>
          <GripVertical {...ICON} />
        </span>
        <input
          type="checkbox"
          class="done-check"
          checked={!!a.done}
          aria-label={`${displayNo(scr, a)}번 완료`}
          title={a.done ? `완료 — ${a.done.by} · ${ago(a.done.at)} (누르면 풀기)` : '완료 — 지우지 않고 숨긴다'}
          onClick={(e) => {
            e.stopPropagation();
            toggleDone(a);
          }}
        />
        <button type="button" class="card-title" aria-expanded={sel} onClick={() => (sel && shown && !popHidden.value ? (selected.value = null) : open())}>
          <span class={`no ${a.anchor ? '' : 'no-screen'}`}>{displayNo(scr, a)}</span>
          <span class="card-lines">
            <span class={`card-name ellipsis ${a.title ? '' : 'is-untitled'}`}>{a.title || plainText(a.body).split('\n').find((l) => l.trim()) || '제목 없음'}</span>
            <span class="card-sub">
              <Who a={a} />
              {!a.anchor && <span class="chip">화면 전체</span>}
          {st === 'other' && <span class="chip chip-hint" title="다른 화면 상태에 있습니다. 누르면 그 상태로 이동합니다."><EyeOff {...ICON} size={12} /> 다른 상태</span>}
          {st === 'capture' && <span class="chip chip-capture" title="그린 영역을 찍어 둔 Comment 입니다. 실시간 화면에는 마커가 붙지 않습니다."><Camera {...ICON} size={12} /> 캡처</span>}
            </span>
          </span>
          {a.shot && st !== 'capture' && <span class="badge-icon" title="달 때의 화면이 함께 저장되어 있습니다"><Camera {...ICON} size={14} /></span>}
          {(a.clips?.length ?? 0) > 0 && <span class="badge-icon"><Film {...ICON} size={14} /> {a.clips!.length}</span>}
          {a.replies.length > 0 && <span class="badge-icon"><MessageSquare {...ICON} size={14} /> {a.replies.length}</span>}
        </button>
      </div>
      {!sel && a.body && a.title && (
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
