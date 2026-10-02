/* 대상 옆 팝업 — 새 Comment 쓰기와 Comment 보기·답글. 시선을 오른쪽 패널로 옮기지 않아도 된다 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { Camera, Circle, Film, Pin, Square, Trash2, X } from 'lucide-preact';
import type { Annotation, Clip } from '@core';
import { displayNo } from '@core';
import { toggleDone, snipAvailable, addFromDraft, addReply, editBody, editReply, editTitle, removeClip, removeComment, toggleSnipRecording } from '../actions';
import type { Host } from '../host';
import { annotations, draft, draftClip, popHidden, rev, screen, selected, snipMode, snipRec, stageRef, still, user, version } from '../store';
import { useBlobUrl } from '../stage/media';
import { MarkdownEditor } from './editor/MarkdownEditor';
import { ago } from './labels';

const ICON = { size: 16, strokeWidth: 1.5 };
/** 기본 폭 — 클립(영상)이 있으면 훨씬 크게. 오른쪽 아래 모서리를 끌어 크기를 바꾼다 */
const W = 400;
const W_CLIP = 680;
const GAP = 12;

type Box = { x: number; y: number; w: number; h: number };

export interface PopoverProps {
  host: Host;
  fit: { s: number; ox: number; oy: number };
  /** 대상 — 화면 뷰포트 좌표. 없으면 스테이지 오른쪽 위 */
  target: Box | null;
  areaRef: RefObject<HTMLDivElement>;
}

/* 팝업은 화면(탭) 영역에 갇히지 않는다 — 창 위에 떠서(body 에 붙인다) 창 안이면 어디든 둘 수 있다.
 * 머리줄을 끌어 옮기고, 오른쪽 아래 모서리로 크기를 바꾼다. 옮긴 자리는 다른 Comment 를 열 때까지 그대로 둔다 */
export function StagePopover({ host, fit, target, areaRef }: PopoverProps) {
  rev.value;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: string } | null>(null);
  const [moved, setMoved] = useState<{ left: number; top: number } | null>(null);
  const d = draft.value;
  const sel = !d && !popHidden.value ? annotations.value.find((a) => a.id === selected.value) ?? null : null;
  const v = version.value;
  const open = !!d || !!sel;
  const w0 = (sel?.clips?.length ?? 0) > 0 || (d && draftClip.value) ? W_CLIP : W;
  const which = d ? `draft:${d.picked.rect.join(',')}` : sel?.id ?? '';
  useEffect(() => setMoved(null), [which]);

  /* 크기가 바뀌면(클립이 붙어 커짐 등) 자리를 다시 잡는다 — 창 밖으로 밀려나지 않게.
     사람이 모서리를 끌어 크기를 바꾸는 중이면 그 자리에 둔다 */
  const [, bump] = useState(0);
  const pressing = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const ro = new ResizeObserver(() => {
      if (pressing.current) {
        const r = el.getBoundingClientRect();
        setMoved((m) => m ?? { left: r.left, top: r.top });
      } else bump((n) => n + 1);
    });
    ro.observe(el);
    const up = () => (pressing.current = false);
    window.addEventListener('pointerup', up);
    return () => {
      ro.disconnect();
      window.removeEventListener('pointerup', up);
    };
  }, [open, which]);

  useLayoutEffect(() => {
    const area = areaRef.current;
    const el = ref.current;
    if (!open || !area || !el || !v) return setPos(null);
    if (moved) return;
    // 스테이지 안의 자리를 창 좌표로 — 확대해 스크롤했으면 그만큼 빼고
    const ar = area.getBoundingClientRect();
    const toWin = (x: number, y: number) => ({ x: ar.left + x - area.scrollLeft, y: ar.top + y - area.scrollTop });
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ph = el.offsetHeight;
    const W = el.offsetWidth || w0;
    const { s, ox, oy } = fit;
    let left: number;
    let top: number;
    let side = 'right';
    if (target) {
      const p = toWin(ox + target.x * s, oy + target.y * s);
      const tw = target.w * s;
      const th = target.h * s;
      if (p.x + tw + GAP + W <= vw - 8) left = p.x + tw + GAP;
      else if (p.x - GAP - W >= 8) {
        left = p.x - GAP - W;
        side = 'left';
      } else {
        left = Math.min(Math.max(8, p.x), vw - W - 8);
        side = 'below';
      }
      top = side === 'below' ? p.y + th + GAP : p.y;
    } else {
      const p = toWin(ox + v.viewport.w * s - W - GAP, oy + GAP);
      left = p.x;
      top = p.y;
      side = 'corner';
    }
    // 창 안에 다 보이게 — 아래가 잘리면 위로 올린다 (그래도 크면 팝업 안에서 스크롤)
    top = Math.min(Math.max(8, top), Math.max(8, vh - ph - 8));
    left = Math.min(Math.max(8, left), Math.max(8, vw - W - 8));
    setPos((old) => (old && Math.abs(old.left - left) < 1 && Math.abs(old.top - top) < 1 && old.side === side ? old : { left, top, side }));
  });

  /* 머리줄을 끌어 옮긴다 (단추 · 입력칸 위에서는 끌지 않는다) */
  const onDrag = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.pop-drag') || t.closest('button, input, textarea, select, a, .cm-editor')) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('is-moving');
    const move = (ev: PointerEvent) =>
      setMoved({
        left: Math.min(Math.max(-r.width + 80, ev.clientX - dx), window.innerWidth - 80),
        top: Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 40),
      });
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      document.body.classList.remove('is-moving');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };

  if (!open) return null;
  const el = ref.current;
  const at = moved && el
    ? { left: moved.left, top: Math.min(moved.top, Math.max(0, window.innerHeight - Math.min(el.offsetHeight, window.innerHeight - 16) - 8)) }
    : moved ?? pos;
  return createPortal(
    <div
      ref={ref}
      class={`popover-card pop-${moved ? 'moved' : pos?.side ?? 'right'}`}
      key={d ? 'draft' : sel?.id}
      style={{ left: `${at?.left ?? -9999}px`, top: `${at?.top ?? 0}px`, width: `${w0}px` }}
      role="dialog"
      aria-label={d ? '새 Comment' : 'Comment'}
      onPointerDown={(e) => {
        e.stopPropagation();
        pressing.current = true;
        onDrag(e);
      }}
    >
      {d ? <Composer /> : sel && <Detail key={sel.id} a={sel} host={host} />}
    </div>,
    document.body,
  );
}

function Composer() {
  const text = useRef('');
  const title = useRef('');
  const add = () => addFromDraft(text.current, title.current);
  return (
    <div class="composer" aria-label="새 Comment">
      <div class="row pop-drag" title="끌어서 옮기기">
        <strong>새 Comment</strong>
        <span class="grow" />
        <button type="button" class="btn-icon btn-xs" aria-label="취소" onClick={() => (draft.value = null)}><X {...ICON} /></button>
      </div>
      <SnipBar />
      <input
        class="input title-input"
        placeholder="제목 (없어도 됩니다)"
        aria-label="Comment 제목"
        onInput={(e) => (title.current = e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add();
          if (e.key === 'Escape') draft.value = null;
        }}
      />
      <MarkdownEditor
        value=""
        minRows={6}
        autoFocus
        onChange={(t) => (text.current = t)}
        onSubmit={add}
        onEscape={() => (draft.value = null)}
        placeholder="Comment"
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

/** 영역을 그렸을 때 — 윈도우 캡처 도구처럼 캡처(기본) · 그 자리만 녹화 · 화면에 붙이기 */
function SnipBar() {
  draft.value;
  still.value;
  const can = snipAvailable();
  // URL 화면 — 요소를 골라도 그 순간의 화면 전체를 찍는다. 붙이기는 없다
  const site = version.value?.source?.mode === 'site';
  const rec = snipRec.value;
  const clip = draftClip.value;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [rec]);
  if (!can) return null;
  const m = site ? 'capture' : snipMode.value;
  const sec = rec ? Math.floor((Date.now() - rec.startedAt) / 1000) : 0;
  return (
    <>
      <div class="snip-bar" role="group" aria-label="영역 Comment 방식">
        <button type="button" class="snip-btn" aria-pressed={m === 'capture'} title="그린 영역을 그림으로 남깁니다. 실시간 화면에는 마커가 붙지 않습니다." onClick={() => (snipMode.value = 'capture')}>
          <Camera {...ICON} /> 캡처
        </button>
        <button
          type="button"
          class={`snip-btn ${rec ? 'is-rec' : ''}`}
          aria-pressed={!!rec}
          title={rec ? '녹화 멈추기' : '그린 영역만 녹화합니다 (최대 30초)'}
          onClick={() => toggleSnipRecording(stageRef.snip)}
        >
          {rec ? <><Square {...ICON} size={12} fill="currentColor" /> 멈추기 {`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`}</> : <><Circle {...ICON} /> 녹화</>}
        </button>
        {!site && (
          <button type="button" class="snip-btn" aria-pressed={m === 'pin'} title="실시간 화면의 이 자리에 마커를 붙입니다" onClick={() => (snipMode.value = 'pin')}>
            <Pin {...ICON} /> 화면에 붙이기
          </button>
        )}
      </div>
      {clip && <ClipView clip={clip} canRemove onRemove={() => (draftClip.value = null)} />}
    </>
  );
}

export function Detail({ a, host }: { a: Annotation; host: Host }) {
  rev.value; // 문서는 제자리에서 고치므로 props 가 같아도 다시 그려야 한다
  const me = user.value ?? '';
  const mine = a.author === me || host.author;
  const reply = useRef('');
  const [replyKey, setReplyKey] = useState(0);
  const scr = screen.value!;

  const send = () => {
    if (!reply.current.trim()) return;
    addReply(a, reply.current);
    reply.current = '';
    setReplyKey((k) => k + 1);
  };

  return (
    <div class="detail">
      <div class="row detail-head pop-drag" title="끌어서 옮기기">
        <span class={`no ${a.anchor ? '' : 'no-screen'}`}>{displayNo(scr, a)}</span>
        <span class="card-meta"><strong class="author">{a.author}</strong> · {ago(a.createdAt)}</span>
        <span class="grow" />
        <label class={`done-label ${a.done ? 'is-on' : ''}`} title={a.done ? `${a.done.by} · ${ago(a.done.at)}` : '완료 — 지우지 않고 숨긴다'}>
          <input type="checkbox" checked={!!a.done} onChange={() => toggleDone(a)} /> 완료
        </label>
        <button type="button" class="btn-icon btn-xs" aria-label="닫기" title="팝업 닫기 (선택은 그대로)" onClick={() => (popHidden.value = true)}><X {...ICON} /></button>
      </div>
      {mine ? (
        <input
          key={`t-${a.id}`}
          class="input title-input"
          placeholder="제목 (없어도 됩니다)"
          aria-label="Comment 제목"
          defaultValue={a.title ?? ''}
          onChange={(e) => editTitle(a, e.currentTarget.value)}
        />
      ) : (
        a.title && <h3 class="detail-title">{a.title}</h3>
      )}
      <MarkdownEditor
        key={a.id}
        value={a.body}
        editable={mine}
        allowCheck
        minRows={5}
        autoFocus={mine && !a.body}
        onChange={(t) => editBody(a, t)}
        placeholder={mine ? 'Comment' : ''}
        label={`${a.id} Comment 본문`}
        class="body-editor"
      />
      {(a.clips ?? []).map((c) => <ClipView key={c.id} clip={c} canRemove={c.author === me || host.author} onRemove={() => removeClip(a, c.id)} />)}
      {a.replies.length > 0 && (
        <ol class="replies">
          {a.replies.map((r) => (
            <li key={r.id} class="reply">
              <span class="reply-meta">{r.author} · {ago(r.at)}</span>
              <MarkdownEditor value={r.body} editable={r.author === me} allowCheck onChange={(t) => editReply(a, r.id, t)} label="답글" />
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
          placeholder="답글"
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

function ClipView({ clip, canRemove, onRemove }: { clip: Clip; canRemove: boolean; onRemove: () => void }) {
  const src = useBlobUrl(clip.sha, clip.type);
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
