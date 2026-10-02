/* 오른쪽 패널 — 위에 화면 개요(마크다운), 아래에 Comment 목록. 한 스크롤로 이어진다 */
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronDown, ChevronRight, EyeOff, Film, GripVertical, MessageSquare, Plus, Trash2, X } from 'lucide-preact';
import type { Annotation, Clip, Screen } from '@core';
import { decodeBlob, displayNo } from '@core';
import {
  addFromDraft, addReply, addScreenComment, editBody, editNotes, editReply, removeClip, removeComment, reorder,
} from '../actions';
import type { Host } from '../host';
import {
  annotations, blobs, draft, hovered, notesOpen, requestReveal, rev, screen, selected, toggleNotes, user, visible,
} from '../store';
import { MarkdownEditor, plainText } from './editor/MarkdownEditor';
import { ago, anchorLabel } from './labels';

const ICON = { size: 16, strokeWidth: 1.5 };

export function Panel({ host }: { host: Host }) {
  const scr = screen.value;
  if (!scr) return <aside class="panel" aria-label="개요와 Comment" />;
  return (
    <aside class="panel" aria-label="개요와 Comment">
      <div class="panel-scroll">
        <Notes scr={scr} />
        <Comments scr={scr} host={host} />
      </div>
    </aside>
  );
}

function Notes({ scr }: { scr: Screen }) {
  rev.value; // 문서는 제자리에서 고치므로 props 가 같아도 다시 그려야 한다 (signals 의 얕은 비교를 피한다)
  const open = notesOpen.value;
  return (
    <section class="notes">
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
          placeholder="이 화면의 개요 — 마크다운으로 적습니다"
          label="화면 개요"
          class="notes-editor"
        />
      )}
    </section>
  );
}

function Comments({ scr, host }: { scr: Screen; host: Host }) {
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
    <section class="comments">
      <div class="section-head section-head-static">
        <span>Comment</span>
        <span class="count">{list.length}</span>
        <span class="grow" />
        <button type="button" class="btn-icon btn-xs" title="화면 전체에 Comment 달기" aria-label="화면 전체에 Comment 달기" onClick={() => addScreenComment()}>
          <Plus {...ICON} />
        </button>
      </div>
      {draft.value && <Composer key="composer" />}
      {!list.length && !draft.value && (
        <p class="panel-empty muted">Ctrl 을 누른 채 화면의 요소를 클릭하거나, 드래그해 영역을 잡으세요.</p>
      )}
      <ol class="cards" ref={listRef}>
        {list.map((a) => (
          <Fragment key={a.id}>
            {lineBefore === a.id && <li class="drop-line" aria-hidden="true" />}
            <Card a={a} scr={scr} host={host} onGrip={startDrag} dragging={drag?.id === a.id} />
          </Fragment>
        ))}
        {drag && drag.to >= others.length && <li class="drop-line" aria-hidden="true" />}
      </ol>
      {drag && (
        <div class="drag-ghost" style={{ top: `${drag.y}px` }}>
          {displayNo(scr, list.find((a) => a.id === drag.id)!)}번 옮기는 중
        </div>
      )}
    </section>
  );
}

function Card({ a, scr, host, onGrip, dragging }: { a: Annotation; scr: Screen; host: Host; onGrip: (e: PointerEvent, id: string) => void; dragging?: boolean }) {
  rev.value;
  const sel = selected.value === a.id;
  const shown = !a.anchor || visible.value.has(a.id);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (sel) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);

  const open = () => {
    selected.value = a.id;
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
        <button type="button" class="card-title" aria-expanded={sel} onClick={() => (sel && shown ? (selected.value = null) : open())}>
          <span class={`no ${a.anchor ? '' : 'no-screen'}`}>{displayNo(scr, a)}</span>
          <span class="card-meta">{a.author} · {ago(a.createdAt)}</span>
          {!a.anchor && <span class="chip">화면 전체</span>}
          {!shown && <span class="chip chip-hint" title="다른 화면 상태에 있습니다. 누르면 그 상태로 이동합니다."><EyeOff {...ICON} size={12} /> 다른 상태</span>}
          <span class="grow" />
          {(a.clips?.length ?? 0) > 0 && <span class="badge-icon"><Film {...ICON} size={14} /> {a.clips!.length}</span>}
          {a.replies.length > 0 && <span class="badge-icon"><MessageSquare {...ICON} size={14} /> {a.replies.length}</span>}
        </button>
      </div>
      {!sel && a.body && (
        <button type="button" class="card-preview" onClick={open}>
          <span class="clamp">{plainText(a.body)}</span>
        </button>
      )}
      {sel && <Detail a={a} host={host} />}
    </li>
  );
}

function Detail({ a, host }: { a: Annotation; host: Host }) {
  rev.value; // 문서는 제자리에서 고치므로 props 가 같아도 다시 그려야 한다 (signals 의 얕은 비교를 피한다)
  const me = user.value ?? '';
  const mine = a.author === me || host.author;
  const reply = useRef('');
  const [replyKey, setReplyKey] = useState(0);

  const send = () => {
    if (!reply.current.trim()) return;
    addReply(a, reply.current);
    reply.current = '';
    setReplyKey((k) => k + 1);
  };

  return (
    <div class="detail">
      <MarkdownEditor
        key={a.id}
        value={a.body}
        editable={mine}
        allowCheck
        minRows={6}
        autoFocus={mine && !a.body}
        onChange={(t) => editBody(a, t)}
        placeholder={mine ? 'Comment — 마크다운' : ''}
        label={`${a.id} Comment 본문`}
        class="body-editor"
      />
      {(a.clips ?? []).map((c) => <ClipView key={c.id} clip={c} canRemove={c.author === me || host.author} onRemove={() => removeClip(a, c.id)} />)}
      {a.anchor && (
        <p class="muted small ellipsis" title={a.anchor.fp.selector}>
          <code>{anchorLabel(a.anchor.fp, false)}</code>{a.anchor.region ? ' 안의 영역' : ''}
        </p>
      )}
      {a.replies.length > 0 && (
        <ol class="replies">
          {a.replies.map((r) => (
            <li key={r.id} class="reply">
              <span class="reply-meta">{r.author} · {ago(r.at)}</span>
              <MarkdownEditor
                value={r.body}
                editable={r.author === me}
                allowCheck
                onChange={(t) => editReply(a, r.id, t)}
                label="답글"
              />
            </li>
          ))}
        </ol>
      )}
      <div class="reply-box">
        <MarkdownEditor
          key={replyKey}
          value=""
          minRows={2}
          onChange={(t) => (reply.current = t)}
          onSubmit={send}
          placeholder="답글 — 마크다운 (Ctrl+Enter)"
          label="답글 쓰기"
          class="reply-editor"
        />
        <div class="row">
          {mine && (
            <button type="button" class="btn btn-ghost btn-danger" onClick={() => confirm('이 Comment 를 지울까요? 답글도 함께 지워집니다. (Ctrl+Z 로 되돌릴 수 있습니다)') && removeComment(a)}>
              <Trash2 {...ICON} /> 삭제
            </button>
          )}
          <span class="grow" />
          <button type="button" class="btn btn-secondary" onClick={send}>답글</button>
        </div>
      </div>
    </div>
  );
}

const clipUrls = new Map<string, string>();

function ClipView({ clip, canRemove, onRemove }: { clip: Clip; canRemove: boolean; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(clipUrls.get(clip.sha) ?? null);
  useEffect(() => {
    if (src) return;
    const b = blobs.get(clip.sha);
    if (!b) return;
    decodeBlob(b).then((bytes) => {
      const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: clip.type }));
      clipUrls.set(clip.sha, u);
      setSrc(u);
    });
  }, [clip.sha]);
  return (
    <figure class="clip">
      {src ? <video src={src} controls loop muted playsInline style={{ aspectRatio: `${clip.w} / ${clip.h}` }} /> : <div class="clip-missing">클립을 불러오는 중…</div>}
      <figcaption class="row muted small">
        <Film {...ICON} size={14} /> {(clip.ms / 1000).toFixed(1)}초 · {clip.author}
        <span class="grow" />
        {canRemove && <button type="button" class="btn-icon btn-xs" aria-label="클립 지우기" onClick={onRemove}><X {...ICON} size={14} /></button>}
      </figcaption>
    </figure>
  );
}

function Composer() {
  const d = draft.value!;
  const text = useRef('');
  const add = () => addFromDraft(text.current);
  return (
    <div class="composer" role="form" aria-label="새 Comment">
      <div class="row">
        <strong>새 Comment</strong>
        <span class="muted mono ellipsis">{d.region ? '영역' : d.el.tagName.toLowerCase()}</span>
        <span class="grow" />
        <button type="button" class="btn-icon btn-xs" aria-label="취소" onClick={() => (draft.value = null)}><X {...ICON} /></button>
      </div>
      <MarkdownEditor
        value=""
        minRows={6}
        autoFocus
        onChange={(t) => (text.current = t)}
        onSubmit={add}
        onEscape={() => (draft.value = null)}
        placeholder="마크다운 — Ctrl+Enter 로 추가, Esc 취소"
        label="새 Comment 본문"
        class="body-editor"
      />
      <div class="row">
        <span class="grow" />
        <button type="button" class="btn btn-ghost" onClick={() => (draft.value = null)}>취소</button>
        <button type="button" class="btn btn-primary" onClick={add}>추가</button>
      </div>
    </div>
  );
}
